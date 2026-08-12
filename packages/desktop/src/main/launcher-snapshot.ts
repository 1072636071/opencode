import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type SnapshotType = "auto" | "manual"

export type PluginSpec = {
  spec: string
  source: "npm" | "file" | "unknown"
  version?: string
}

export type SnapshotMeta = {
  id: string
  timestamp: number
  type: SnapshotType
  tag: string | null
  projectHash: string | null
  pluginCount: number
  configFiles: string[]
}

export type Snapshot = SnapshotMeta & {
  configContents: Record<string, string>
  plugins: PluginSpec[]
}

const DEFAULT_MAX_AUTO = 50
const CONFIG_CANDIDATES = ["opencode.jsonc", "opencode.json", "config.json"]
const PROJECT_CONFIG_CANDIDATES = ["opencode.jsonc", "opencode.json"]

function opencodeConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR
  const xdgConfig =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === "win32"
      ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
      : join(homedir(), ".config"))
  return join(xdgConfig, "opencode")
}

export { opencodeConfigDir }

/**
 * Resolve the opencode data directory (where `auth.json` lives).
 * Mirrors `Global.Path.data` from `@opencode-ai/core`: `xdgData/opencode`.
 * On Windows xdg-data is `LOCALAPPDATA` (not `APPDATA`, which is config/roaming).
 */
function opencodeDataDir(): string {
  if (process.env.OPENCODE_DATA_DIR) return process.env.OPENCODE_DATA_DIR
  const xdgData =
    process.env.XDG_DATA_HOME ||
    (process.platform === "win32"
      ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : join(homedir(), ".local", "share"))
  return join(xdgData, "opencode")
}

export { opencodeDataDir }

function snapshotsRoot(): string {
  return join(opencodeConfigDir(), "launcher", "snapshots")
}

function projectHash(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 12)
}

function snapshotDir(projectPath?: string): string {
  const root = snapshotsRoot()
  return projectPath ? join(root, projectHash(projectPath)) : root
}

function snapshotPath(id: string, projectPath?: string): string {
  return join(snapshotDir(projectPath), `${id}.json`)
}

function snapshotId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function findConfigFiles(projectPath?: string): string[] {
  const files: string[] = []
  for (const candidate of CONFIG_CANDIDATES) {
    const file = join(opencodeConfigDir(), candidate)
    if (existsSync(file)) files.push(file)
  }
  if (projectPath) {
    for (const candidate of PROJECT_CONFIG_CANDIDATES) {
      const file = join(projectPath, candidate)
      if (existsSync(file)) files.push(file)
    }
  }
  return files
}

// 从 config 文本尽力提取 plugins 声明 spec（不严格解析 schema——ADR-021 不透明文件版本化）。
function extractPluginSpecs(configContents: Record<string, string>): PluginSpec[] {
  const specs: PluginSpec[] = []
  const seen = new Set<string>()
  for (const text of Object.values(configContents)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    if (typeof parsed !== "object" || parsed === null) continue
    const plugins = (parsed as { plugins?: unknown }).plugins
    if (!Array.isArray(plugins)) continue
    for (const entry of plugins) {
      const spec = typeof entry === "string" ? entry : (entry as { id?: string })?.id
      if (typeof spec !== "string" || seen.has(spec)) continue
      seen.add(spec)
      specs.push({
        spec,
        source: spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file:") ? "file" : "npm",
      })
    }
  }
  return specs
}

export async function createSnapshot(opts: { type: SnapshotType; projectPath?: string }): Promise<Snapshot> {
  const id = snapshotId()
  const timestamp = Date.now()
  const configFiles = findConfigFiles(opts.projectPath)
  const configContents: Record<string, string> = {}
  for (const file of configFiles) {
    try {
      configContents[file] = await readFile(file, "utf8")
    } catch {
      continue
    }
  }
  const plugins = extractPluginSpecs(configContents)
  const snapshot: Snapshot = {
    id,
    timestamp,
    type: opts.type,
    tag: null,
    projectHash: opts.projectPath ? projectHash(opts.projectPath) : null,
    pluginCount: plugins.length,
    configFiles,
    configContents,
    plugins,
  }
  const dir = snapshotDir(opts.projectPath)
  await mkdir(dir, { recursive: true })
  await writeFile(snapshotPath(id, opts.projectPath), JSON.stringify(snapshot, null, 2), "utf8")
  return snapshot
}

export async function listSnapshots(projectPath?: string): Promise<SnapshotMeta[]> {
  const dir = snapshotDir(projectPath)
  if (!existsSync(dir)) return []
  const entries = await readdir(dir)
  const metas: SnapshotMeta[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    try {
      const raw = await readFile(join(dir, entry), "utf8")
      const snap = JSON.parse(raw) as Snapshot
      metas.push(toMeta(snap))
    } catch {
      continue
    }
  }
  metas.sort((a, b) => b.timestamp - a.timestamp)
  return metas
}

export async function getSnapshot(id: string, projectPath?: string): Promise<Snapshot | null> {
  const file = snapshotPath(id, projectPath)
  if (!existsSync(file)) return null
  const raw = await readFile(file, "utf8")
  return JSON.parse(raw) as Snapshot
}

export async function deleteSnapshot(id: string, projectPath?: string): Promise<void> {
  const file = snapshotPath(id, projectPath)
  await rm(file, { force: true })
}

// 自动 snapshot 按数量保留，tag 永久（ADR-021 D9）。返回清理数。
export async function pruneAutoSnapshots(maxAuto = DEFAULT_MAX_AUTO, projectPath?: string): Promise<number> {
  const metas = await listSnapshots(projectPath)
  const auto = metas.filter((m) => m.tag === null)
  if (auto.length <= maxAuto) return 0
  const toRemove = auto.slice(maxAuto)
  for (const m of toRemove) await deleteSnapshot(m.id, projectPath)
  return toRemove.length
}

export async function tagSnapshot(id: string, tag: string, projectPath?: string): Promise<void> {
  const snap = await getSnapshot(id, projectPath)
  if (!snap) throw new Error(`snapshot not found: ${id}`)
  snap.tag = tag
  await writeFile(snapshotPath(id, projectPath), JSON.stringify(snap, null, 2), "utf8")
}

export async function untagSnapshot(id: string, projectPath?: string): Promise<void> {
  const snap = await getSnapshot(id, projectPath)
  if (!snap) throw new Error(`snapshot not found: ${id}`)
  snap.tag = null
  await writeFile(snapshotPath(id, projectPath), JSON.stringify(snap, null, 2), "utf8")
}

function toMeta(snap: Snapshot): SnapshotMeta {
  return {
    id: snap.id,
    timestamp: snap.timestamp,
    type: snap.type,
    tag: snap.tag,
    projectHash: snap.projectHash,
    pluginCount: snap.pluginCount,
    configFiles: snap.configFiles,
  }
}

// 恢复 snapshot 的 config 文件到原路径（ADR-021 D5 整文件版本化）。
export async function restoreSnapshotConfig(snapshot: Snapshot): Promise<void> {
  for (const [filePath, content] of Object.entries(snapshot.configContents)) {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, "utf8")
  }
}

// 读当前 config 的插件 spec 列表（不创建 snapshot）。供安全模式 UI 列出可禁用插件。
export async function readCurrentPlugins(projectPath?: string): Promise<PluginSpec[]> {
  const configFiles = findConfigFiles(projectPath)
  const configContents: Record<string, string> = {}
  for (const file of configFiles) {
    try {
      configContents[file] = await readFile(file, "utf8")
    } catch {
      continue
    }
  }
  return extractPluginSpecs(configContents)
}

// 返回第一个存在的 config 文件路径（供"打开配置文件"按钮）。
export function getConfigFilePath(projectPath?: string): string | null {
  const files = findConfigFiles(projectPath)
  return files[0] ?? null
}

// 读 config 文件并解析为对象。返回 null 如果无 config 或解析失败。
export async function readConfigObject(projectPath?: string): Promise<Record<string, unknown> | null> {
  const path = getConfigFilePath(projectPath)
  if (!path) return null
  try {
    const text = await readFile(path, "utf8")
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

// 写 config 文件。若不存在则创建 opencode.json。
export async function saveConfigObject(config: Record<string, unknown>, projectPath?: string): Promise<string> {
  const path = getConfigFilePath(projectPath) ?? join(opencodeConfigDir(), "opencode.json")
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(config, null, 2), "utf8")
  return path
}

// auth.json 路径（与 opencode 核心包 `Global.Path.data/auth.json` 一致）。
export function getAuthFilePath(): string {
  return join(opencodeDataDir(), "auth.json")
}

// 写 API key 到 auth.json 的 `<providerID>: { type: "api", key }`。
// 若 key 为 null 则删除该条目。文件不存在时自动创建。
export async function writeAuthKey(providerID: string, key: string | null): Promise<string> {
  const path = getAuthFilePath()
  await mkdir(dirname(path), { recursive: true })
  let auth: Record<string, unknown> = {}
  try {
    const text = await readFile(path, "utf8")
    auth = JSON.parse(text) as Record<string, unknown>
  } catch {
    // file doesn't exist or is invalid — start fresh
  }
  if (key === null) {
    delete auth[providerID]
  } else {
    auth[providerID] = { type: "api", key }
  }
  await writeFile(path, JSON.stringify(auth, null, 2), "utf8")
  return path
}

// 安装插件：npm i spec + 加到 config.plugins + 保存 + snapshot。
export async function installPlugin(spec: string): Promise<void> {
  const cwd = opencodeConfigDir()
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  if (!existsSync(join(cwd, "package.json"))) {
    await execFileAsync(npm, ["init", "-y"], { cwd })
  }
  await execFileAsync(npm, ["i", spec], { cwd })
  const config = (await readConfigObject()) ?? {}
  const plugins = Array.isArray(config.plugins) ? (config.plugins as unknown[]) : []
  if (!plugins.includes(spec)) plugins.push(spec)
  config.plugins = plugins
  await saveConfigObject(config)
  await createSnapshot({ type: "auto" }).catch(() => {})
}

// 卸载插件：npm rm + 从 config.plugins 移除 + 从 plugin_enabled 移除 + 保存 + snapshot。
export async function uninstallPlugin(spec: string): Promise<void> {
  const cwd = opencodeConfigDir()
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  await execFileAsync(npm, ["rm", spec], { cwd }).catch(() => {})
  const config = (await readConfigObject()) ?? {}
  if (Array.isArray(config.plugins)) {
    config.plugins = (config.plugins as unknown[]).filter((p) => p !== spec)
  }
  if (config.plugin_enabled && typeof config.plugin_enabled === "object") {
    const enabled = { ...(config.plugin_enabled as Record<string, unknown>) }
    delete enabled[spec]
    config.plugin_enabled = enabled
  }
  await saveConfigObject(config)
  await createSnapshot({ type: "auto" }).catch(() => {})
}

// 启用/禁用插件：设 config.plugin_enabled[spec] = enabled + 保存。
export async function togglePlugin(spec: string, enabled: boolean): Promise<void> {
  const config = (await readConfigObject()) ?? {}
  const map = (config.plugin_enabled as Record<string, unknown> | undefined) ?? {}
  map[spec] = enabled
  config.plugin_enabled = map
  await saveConfigObject(config)
}

// 导出整包：把 snapshot 的 config + 插件 spec + 元数据打包为可移植 JSON。
// 路径转为相对文件名（跨平台），导入时映射到目标机器的 config 目录。
export async function exportBundle(id: string): Promise<string> {
  const snap = await getSnapshot(id)
  if (!snap) throw new Error(`snapshot not found: ${id}`)
  const bundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    launcherVersion: "v0.1.0",
    configFiles: snap.configFiles.map((f) => basename(f)),
    configContents: Object.fromEntries(
      Object.entries(snap.configContents).map(([f, content]) => [basename(f), content]),
    ),
    plugins: snap.plugins,
  }
  return JSON.stringify(bundle, null, 2)
}

// 导入整包：恢复 config 文件（映射到本机 config 目录）+ 按 spec 重装插件。
export async function importBundle(
  content: string,
  onProgress?: (phase: string) => void,
): Promise<{ failedPlugins: string[] }> {
  const bundle = JSON.parse(content) as {
    configContents: Record<string, string>
    plugins: PluginSpec[]
  }
  onProgress?.("restoring")
  const dir = opencodeConfigDir()
  await mkdir(dir, { recursive: true })
  for (const [filename, text] of Object.entries(bundle.configContents)) {
    await writeFile(join(dir, filename), text, "utf8")
  }
  onProgress?.("reinstalling")
  const failedPlugins: string[] = []
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  if (!existsSync(join(dir, "package.json"))) {
    await execFileAsync(npm, ["init", "-y"], { cwd: dir })
  }
  for (const plugin of bundle.plugins) {
    try {
      await execFileAsync(npm, ["i", plugin.spec], { cwd: dir })
    } catch {
      failedPlugins.push(plugin.spec)
    }
  }
  onProgress?.("done")
  await createSnapshot({ type: "auto" }).catch(() => {})
  return { failedPlugins }
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] || path
}
