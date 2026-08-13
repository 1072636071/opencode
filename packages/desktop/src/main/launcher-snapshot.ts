import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/** Strip UTF-8 BOM — PowerShell Set-Content -Encoding UTF8 and some editors
 * prepend \uFEFF, which causes JSON.parse to throw SyntaxError silently. */
export function stripBom(raw: string): string {
  return raw.replace(/^\uFEFF/, "")
}

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
// 配置文件候选名（对齐本体 config/paths.ts + config/tui.ts + auth/index.ts）。
// 全局配置目录与 OPENCODE_CONFIG_DIR 下查找这些候选名。
const CONFIG_CANDIDATES = ["opencode.jsonc", "opencode.json", "config.json", "tui.json"]
// 项目根目录与 findUp `.opencode` 目录下查找这些候选名。
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

// C1 安全修复：IPC 路径遍历防护。
// 验证目标路径在允许的配置/数据/项目目录树内，防止 ../../etc/passwd 之类遍历。
function isPathAllowed(targetPath: string, allowedRoots: string[]): boolean {
  const resolved = resolve(targetPath)
  for (const root of allowedRoots) {
    const rel = relative(resolve(root), resolved)
    // relative 返回的路径不以 .. 开头、且不是绝对路径，表示在 root 内
    // 空字符串 rel 表示 targetPath === root 本身
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return true
  }
  return false
}

// 获取允许的根目录列表（配置目录 + 数据目录 + 当前工作目录及其 .opencode + home/.opencode + 环境变量覆盖）。
function getAllowedRoots(): string[] {
  const roots = [opencodeConfigDir(), opencodeDataDir()]
  const cwd = process.cwd()
  roots.push(cwd)
  roots.push(join(cwd, ".opencode"))
  roots.push(join(homedir(), ".opencode"))
  if (process.env.OPENCODE_CONFIG_DIR) roots.push(process.env.OPENCODE_CONFIG_DIR)
  if (process.env.OPENCODE_DATA_DIR) roots.push(process.env.OPENCODE_DATA_DIR)
  return roots
}

// 验证文件路径在允许的配置目录树内（供 IPC handler 调用）。
export function isConfigPathAllowed(filePath: string): boolean {
  return isPathAllowed(filePath, getAllowedRoots())
}

// 验证目录路径在允许的配置目录树内（供 IPC handler 调用）。
export function isDirectoryPathAllowed(dirPath: string): boolean {
  return isPathAllowed(dirPath, getAllowedRoots())
}

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

// 配置文件来源分组（对齐本体 config/paths.ts 的 directories() 顺序）。
export type ConfigFileGroup = "global" | "project" | "opencode" | "home" | "env"

export type ConfigFileInfo = {
  path: string
  group: ConfigFileGroup
  name: string
}

// 发现所有存在的配置文件，按本体 config/paths.ts 的 directories() 顺序遍历：
//   1. xdg 全局配置目录（Global.Path.config）
//   2. findUp `.opencode` 目录 from projectPath
//   3. `~/.opencode` 目录
//   4. OPENCODE_CONFIG_DIR 环境变量目录
//   5. auth.json 位于 xdg 数据目录（Global.Path.data）
// 不查找 `~/.config/opencode`（本体也不读，xdg 全局目录已由 opencodeConfigDir() 处理）。
function findConfigFiles(projectPath?: string): string[] {
  return findConfigFilesGrouped(projectPath).map((f) => f.path)
}

export { findConfigFiles }

// 返回带分组信息的配置文件列表，供面板按来源分组显示。
export function findConfigFilesGrouped(projectPath?: string): ConfigFileInfo[] {
  const files: ConfigFileInfo[] = []
  const seen = new Set<string>()
  const add = (path: string, group: ConfigFileGroup) => {
    if (seen.has(path) || !existsSync(path)) return
    seen.add(path)
    files.push({ path, group, name: basename(path) })
  }

  // 1. xdg 全局配置目录
  const configDir = opencodeConfigDir()
  for (const candidate of CONFIG_CANDIDATES) {
    add(join(configDir, candidate), "global")
  }

  // 2. findUp `.opencode` 目录 from projectPath
  if (projectPath) {
    let current = projectPath
    while (true) {
      add(join(current, ".opencode", "opencode.jsonc"), "opencode")
      add(join(current, ".opencode", "opencode.json"), "opencode")
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    // 项目根目录直接放置的配置（向后兼容）
    for (const candidate of PROJECT_CONFIG_CANDIDATES) {
      add(join(projectPath, candidate), "project")
    }
  }

  // 3. `~/.opencode` 目录
  const homeOpencode = join(homedir(), ".opencode")
  add(join(homeOpencode, "opencode.jsonc"), "home")
  add(join(homeOpencode, "opencode.json"), "home")

  // 4. OPENCODE_CONFIG_DIR 环境变量目录
  if (process.env.OPENCODE_CONFIG_DIR) {
    for (const candidate of CONFIG_CANDIDATES) {
      add(join(process.env.OPENCODE_CONFIG_DIR, candidate), "env")
    }
  }

  // 5. auth.json 位于 xdg 数据目录（Global.Path.data）
  add(join(opencodeDataDir(), "auth.json"), "global")

  return files
}

// 从 config 文本尽力提取 plugins 声明 spec（不严格解析 schema——ADR-021 不透明文件版本化）。
function extractPluginSpecs(configContents: Record<string, string>): PluginSpec[] {
  const specs: PluginSpec[] = []
  const seen = new Set<string>()
  for (const text of Object.values(configContents)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(stripBom(text))
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
      const snap = JSON.parse(stripBom(raw)) as Snapshot
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
  return JSON.parse(stripBom(raw)) as Snapshot
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
    return JSON.parse(stripBom(text)) as Record<string, unknown>
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
    auth = JSON.parse(stripBom(text)) as Record<string, unknown>
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
  const bundle = JSON.parse(stripBom(content)) as {
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

// 新建配置文件的位置类型（工单 05）。
export type CreateConfigLocation = "global" | "project" | "opencode"
export type CreateConfigType = "opencode.json" | "tui.json" | "auth.json"

// C2 安全修复：createConfigFile 入口运行时枚举校验白名单。
// 防止通过 IPC 传入恶意 type/location 构造任意路径写入。
const ALLOWED_CREATE_TYPES = new Set<CreateConfigType>(["opencode.json", "tui.json", "auth.json"])
const ALLOWED_CREATE_LOCATIONS = new Set<CreateConfigLocation>(["global", "project", "opencode"])

// 新建配置文件（工单 05）。不覆盖已存在文件，返回文件路径。
// auth.json 在全局位置时创建于数据目录（与本体 auth 读取位置一致），
// 这样 findConfigFilesGrouped 能发现它并显示在清单中。
export async function createConfigFile(opts: {
  location: CreateConfigLocation
  type: CreateConfigType
  projectPath?: string
}): Promise<string> {
  // C2 安全修复：运行时枚举校验，拒绝未知的 type/location。
  if (!ALLOWED_CREATE_TYPES.has(opts.type)) throw new Error(`不支持的配置文件类型: ${opts.type}`)
  if (!ALLOWED_CREATE_LOCATIONS.has(opts.location)) throw new Error(`不支持的位置: ${opts.location}`)
  const dir = resolveCreateDir(opts)
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, opts.type)
  if (existsSync(filePath)) return filePath
  const defaultContent = opts.type === "auth.json" ? "{}" : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n'
  await writeFile(filePath, defaultContent, "utf8")
  return filePath
}

function resolveCreateDir(opts: {
  location: CreateConfigLocation
  type: CreateConfigType
  projectPath?: string
}): string {
  if (opts.location === "global") {
    // auth.json 属于数据目录（与本体 Global.Path.data 一致）
    if (opts.type === "auth.json") return opencodeDataDir()
    return opencodeConfigDir()
  }
  if (opts.location === "project") {
    if (!opts.projectPath) throw new Error("project 位置需要 projectPath")
    return opts.projectPath
  }
  // .opencode
  return join(opts.projectPath ?? process.cwd(), ".opencode")
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/")
  return parts[parts.length - 1] || path
}

// 工单 03：读取指定路径的配置文件并解析为对象。
// 与 readConfigObject 不同——readConfigObject 只读第一个存在的 config 文件，
// 此函数读取任意指定路径（含 auth.json / tui.json / 项目配置等）。
// 返回 null 如果文件不存在或解析失败。
export async function readConfigFileAtPath(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(filePath, "utf8")
    return JSON.parse(stripBom(text)) as Record<string, unknown>
  } catch {
    return null
  }
}

// 工单 03：保存配置到指定路径（全量写入）。
// 调用方负责读全量 → 改字段 → 写全量，以保留表单未覆盖的字段（如 instructions/theme）。
// 不在此处做字段合并——保持单一职责。
export async function saveConfigFileAtPath(filePath: string, config: Record<string, unknown>): Promise<string> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(config, null, 2), "utf8")
  return filePath
}

// 工单 04：.opencode/ 下可展开子目录节点。固定列表——agents/skills/plugins/themes/command。
// 这些目录内容不常改，走「打开源文件」（ADR-026 D3），不铺平到顶层清单。
const OPENCODE_SUBDIRS = ["agents", "skills", "plugins", "themes", "command"]

export type OpencodeSubdirInfo = {
  name: string
  path: string
  exists: boolean
}

// 返回 .opencode/ 下固定子目录列表（含是否存在标志）。
// projectPath 优先用其 `.opencode`，回退到 xdg 全局配置目录。
export function findOpencodeSubdirs(projectPath?: string): OpencodeSubdirInfo[] {
  const baseDir = projectPath ? join(projectPath, ".opencode") : opencodeConfigDir()
  return OPENCODE_SUBDIRS.map((name) => {
    const path = join(baseDir, name)
    return { name, path, exists: existsSync(path) }
  })
}

// 工单 04：列出目录内容（用于 .opencode/ 子目录节点展开）。
// 隐藏点文件，目录在前按名称排序。返回空数组如果目录不存在或不可读。
export async function listDirectoryEntries(
  dirPath: string,
): Promise<{ name: string; path: string; isDirectory: boolean }[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: join(dirPath, e.name), isDirectory: e.isDirectory() }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  } catch {
    return []
  }
}
