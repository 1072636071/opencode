import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { promisify } from "node:util"
import { parse, modify, applyEdits } from "jsonc-parser"
import type { FormattingOptions } from "jsonc-parser"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"

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
// 工单 09（审计 S1）：auth.json 脱敏占位——快照/导出存此标记而非明文 key，恢复/导入时跳过。
export const REDACTED_PLACEHOLDER = "<redacted>"
// 配置文件候选名（对齐本体 config/paths.ts + config/tui.ts + auth/index.ts）。
// 全局配置目录与 OPENCODE_CONFIG_DIR 下查找这些候选名。
const CONFIG_CANDIDATES = ["opencode.jsonc", "opencode.json", "config.json", "tui.json"]
// 项目根目录与 findUp `.opencode` 目录下查找这些候选名。
const PROJECT_CONFIG_CANDIDATES = ["opencode.jsonc", "opencode.json"]

// ADR-028：复用本体 Global.Path.config（xdg-basedir）消灭配置发现漂移。
// 保留 OPENCODE_CONFIG_DIR 覆盖——本体 Global.make().config 即此语义（Flag.OPENCODE_CONFIG_DIR ?? Path.config），
// 供测试隔离与用户手动指定。
function opencodeConfigDir(): string {
  return Flag.OPENCODE_CONFIG_DIR ?? Global.Path.config
}

export { opencodeConfigDir }

// ADR-028：复用本体 Global.Path.data（xdg-basedir）消灭数据目录漂移。
// 保留 OPENCODE_DATA_DIR 覆盖供测试隔离与用户手动指定（core 包未提供此 flag，此处补齐）。
function opencodeDataDir(): string {
  return process.env.OPENCODE_DATA_DIR ?? Global.Path.data
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
//   1. xdg 全局配置目录（Global.Path.config = ~/.config/opencode，ADR-028 对齐本体）
//   2. findUp `.opencode` 目录 from projectPath
//   3. `~/.opencode` 目录
//   4. OPENCODE_CONFIG_DIR 环境变量目录
//   5. auth.json 位于 xdg 数据目录（Global.Path.data）
// ADR-028：第 1 条即 ~/.config/opencode（本体读此目录，20 工单"本体不读"为错误查证，已废弃）。
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
      // 工单 09（审计 S1）：auth.json 脱敏——存占位而非明文 key，恢复时跳过。
      configContents[file] = isAuthConfigFile(file) ? REDACTED_PLACEHOLDER : await readFile(file, "utf8")
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
  // 工单 09（审计 S1）：快照文件收紧 0600，防止配置明文被同机其他用户读取。
  await writeFile(snapshotPath(id, opts.projectPath), JSON.stringify(snapshot, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  })
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
  await writeFile(snapshotPath(id, projectPath), JSON.stringify(snap, null, 2), { encoding: "utf8", mode: 0o600 })
}

// M2（审计 S1 拖留泄露面）：迁移旧快照——工单09 前创建的旧快照可能含 auth.json 明文 key
// 且权限未收紧（默认）。此函数扫描所有快照，对含明文 auth.json 的快照脱敏重写 + 收紧 0o600。
// 整体 try/catch，不抛异常（迁移失败不阻断启动）。返回迁移的快照数量。
export async function migrateRedactOldSnapshots(projectPath?: string): Promise<number> {
  try {
    const metas = await listSnapshots(projectPath)
    const dir = snapshotDir(projectPath)
    let migrated = 0
    for (const meta of metas) {
      const file = join(dir, `${meta.id}.json`)
      let raw: string
      try {
        raw = await readFile(file, "utf8")
      } catch {
        continue
      }
      let snap: Snapshot
      try {
        snap = JSON.parse(stripBom(raw)) as Snapshot
      } catch {
        continue
      }
      let needsRewrite = false
      // 检查 configContents 是否含 auth.json 明文——脱敏为占位
      if (snap.configContents && typeof snap.configContents === "object") {
        for (const [filePath, content] of Object.entries(snap.configContents)) {
          if (isAuthConfigFile(filePath) && content !== REDACTED_PLACEHOLDER) {
            snap.configContents[filePath] = REDACTED_PLACEHOLDER
            needsRewrite = true
          }
        }
      }
      // 检查文件权限是否 0o600（非 Windows）——未收紧则重写收紧
      if (process.platform !== "win32") {
        try {
          const s = await stat(file)
          if ((s.mode & 0o777) !== 0o600) needsRewrite = true
        } catch {
          // stat 失败不阻断——继续处理其他快照
        }
      }
      if (!needsRewrite) continue
      await writeFile(file, JSON.stringify(snap, null, 2), { encoding: "utf8", mode: 0o600 })
      migrated++
    }
    return migrated
  } catch {
    return 0
  }
}

export async function untagSnapshot(id: string, projectPath?: string): Promise<void> {
  const snap = await getSnapshot(id, projectPath)
  if (!snap) throw new Error(`snapshot not found: ${id}`)
  snap.tag = null
  await writeFile(snapshotPath(id, projectPath), JSON.stringify(snap, null, 2), { encoding: "utf8", mode: 0o600 })
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
// 工单 09（审计 S1）：跳过脱敏占位——不覆盖现有 auth.json。
export async function restoreSnapshotConfig(snapshot: Snapshot): Promise<void> {
  for (const [filePath, content] of Object.entries(snapshot.configContents)) {
    if (content === REDACTED_PLACEHOLDER) continue
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
// 用 jsonc-parser parse 容错解析注释/尾逗号（工单 10，修复审计 S2）。
export async function readConfigObject(projectPath?: string): Promise<Record<string, unknown> | null> {
  const path = getConfigFilePath(projectPath)
  if (!path) return null
  try {
    const text = await readFile(path, "utf8")
    const parsed = parse(stripBom(text), undefined, { allowTrailingComma: true })
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

// 写 config 文件。若不存在则创建 opencode.json。
// .jsonc 用最小编辑保留注释/字段顺序；.json 用整体 stringify（工单 10）。
export async function saveConfigObject(config: Record<string, unknown>, projectPath?: string): Promise<string> {
  const path = getConfigFilePath(projectPath) ?? join(opencodeConfigDir(), "opencode.json")
  await mkdir(dirname(path), { recursive: true })
  if (path.endsWith(".jsonc")) {
    await writeJsoncMinimal(path, config)
  } else {
    await writeFile(path, JSON.stringify(config, null, 2), "utf8")
  }
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
      Object.entries(snap.configContents).map(([f, content]) => [
        basename(f),
        // 工单 09（审计 S1）：导出双保险——旧快照可能含明文，再次脱敏 auth.json。
        isAuthConfigFile(f) ? REDACTED_PLACEHOLDER : content,
      ]),
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
    // 工单 09（审计 S1）：跳过脱敏占位——不覆盖现有 auth.json。
    if (text === REDACTED_PLACEHOLDER) continue
    await writeFile(join(dir, filename), text, { encoding: "utf8", mode: 0o600 })
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

// 工单 09（审计 S1）：判断是否为 auth.json——快照/导出需脱敏，恢复需跳过。
function isAuthConfigFile(path: string): boolean {
  return basename(path) === "auth.json"
}

// 工单 03：读取指定路径的配置文件并解析为对象。
// 与 readConfigObject 不同——readConfigObject 只读第一个存在的 config 文件，
// 此函数读取任意指定路径（含 auth.json / tui.json / 项目配置等）。
// 工单 10（O4 联动）：返回 { config, error } 判别式，让 UI 区分「读失败 vs 文件为空」，
// 解析失败时引导「打开源文件」。用 jsonc-parser parse 容错解析注释/尾逗号。
export type ConfigReadResult = {
  config: Record<string, unknown> | null
  error?: "not-found" | "parse-failed" | "not-object"
}

export async function readConfigFileAtPath(filePath: string): Promise<ConfigReadResult> {
  let text: string
  try {
    text = await readFile(filePath, "utf8")
  } catch {
    return { config: null, error: "not-found" }
  }
  // M1（审计 M1 防御性编程）：parse 包进 try/catch——jsonc-parser 容错模式当前不抛，
  // 但未来版本/异常输入可能抛，包裹后与 undefined 分支统一返回 parse-failed。
  let parsed: unknown
  try {
    parsed = parse(stripBom(text), undefined, { allowTrailingComma: true })
  } catch {
    return { config: null, error: "parse-failed" }
  }
  if (parsed === undefined) return { config: null, error: "parse-failed" }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { config: null, error: "not-object" }
  }
  return { config: parsed as Record<string, unknown> }
}

// 工单 03：保存配置到指定路径（全量写入）。
// 调用方负责读全量 → 改字段 → 写全量，以保留表单未覆盖的字段（如 instructions/theme）。
// 不在此处做字段合并——保持单一职责。
// 工单 10：.jsonc 用 jsonc-parser modify/applyEdits 最小编辑保留注释/字段顺序；.json 整体 stringify。
export async function saveConfigFileAtPath(filePath: string, config: Record<string, unknown>): Promise<string> {
  await mkdir(dirname(filePath), { recursive: true })
  if (filePath.endsWith(".jsonc")) {
    await writeJsoncMinimal(filePath, config)
  } else {
    await writeFile(filePath, JSON.stringify(config, null, 2), "utf8")
  }
  return filePath
}

// 对 .jsonc 文件用 jsonc-parser modify/applyEdits 做最小编辑写回，
// 保留注释、字段顺序与 $schema 位置（工单 10，修复审计 S2）。
// 文件不存在或原内容解析失败时回退整体 stringify（无注释可保留）。
async function writeJsoncMinimal(filePath: string, config: Record<string, unknown>): Promise<void> {
  let text: string
  try {
    text = stripBom(await readFile(filePath, "utf8"))
  } catch {
    await writeFile(filePath, JSON.stringify(config, null, 2), "utf8")
    return
  }
  // M1（审计 M1 防御性编程）：parse 包进 try/catch——异常时回退整体 stringify，
  // 与"parse 返回非对象时回退"分支合并，保证写入不因 parse 抛异常而失败。
  let original: unknown
  try {
    original = parse(text, undefined, { allowTrailingComma: true })
  } catch {
    await writeFile(filePath, JSON.stringify(config, null, 2), "utf8")
    return
  }
  if (typeof original !== "object" || original === null || Array.isArray(original)) {
    await writeFile(filePath, JSON.stringify(config, null, 2), "utf8")
    return
  }
  const formattingOptions: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" }
  const allKeys = new Set([...Object.keys(config), ...Object.keys(original)])
  // 逐个 key 链式 applyEdits——合并所有 edits 一次应用会在删除/新增字段时产生 Overlapping edit。
  let current = text
  for (const key of allKeys) {
    const newValue = key in config ? config[key] : undefined
    current = applyEdits(current, modify(current, [key], newValue, { formattingOptions }))
  }
  await writeFile(filePath, current, "utf8")
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
