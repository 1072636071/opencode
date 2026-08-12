import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:net"
import { promisify } from "node:util"
import { join } from "node:path"
import { app, BrowserWindow } from "electron"
import type { ServerReadyData, LauncherErrorSnippet, LauncherDiagnosticsMeta } from "../preload/types"
import { spawnLocalServer, type SidecarListener } from "./server"
import { startBackgroundCli } from "./background-cli"
import { restoreMainWindows } from "./windows"
import { getLauncherWindow } from "./launcher-window"
import { createPluginLoadTracker, parsePathAndLine, type PluginLoadEntry } from "./launcher-plugin-loads"
import {
  createSnapshot,
  pruneAutoSnapshots,
  getSnapshot,
  restoreSnapshotConfig,
  opencodeConfigDir,
} from "./launcher-snapshot"

const execFileAsync = promisify(execFile)

export type OpencodeStatus = "idle" | "starting" | "running" | "stopping" | "failed"

export type RollbackPhase = "idle" | "stopping" | "restoring" | "reinstalling" | "restarting" | "done" | "failed"

export type RollbackProgress = {
  phase: RollbackPhase
  failedPlugins?: string[]
  error?: string
}

export type PluginLogEntry = {
  line: string
  level: "log" | "warn" | "error"
  ts: number
}

type Logger = {
  log(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

type ShellEnv = { XDG_STATE_HOME?: string } | null

let logger: Logger
let shellEnv: ShellEnv

let server: SidecarListener | null = null
let status: OpencodeStatus = "idle"
let lastError: string | undefined

// renderer 通过 awaitInitialization 拿 sidecar url/credentials。每次 start 创建新 Promise，
// 保证重启后 renderer 拿到最新 data（旧 Promise 已 resolve 不会重用）。
let serverDataPromise: Promise<ServerReadyData> = neverResolvingPromise()
let serverDataResolver: (data: ServerReadyData) => void = () => {}

const listeners = new Set<(status: OpencodeStatus, error?: string) => void>()

function neverResolvingPromise(): Promise<ServerReadyData> {
  return new Promise<ServerReadyData>(() => {})
}

export function initLauncherController(opts: { logger: Logger; shellEnv: ShellEnv }) {
  logger = opts.logger
  shellEnv = opts.shellEnv
}

export function getOpencodeStatus(): OpencodeStatus {
  return status
}

export function getLastError(): string | undefined {
  return lastError
}

export function onStatusChange(cb: (status: OpencodeStatus, error?: string) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function awaitServerData(): Promise<ServerReadyData> {
  return serverDataPromise
}

function setStatus(next: OpencodeStatus, error?: string) {
  status = next
  lastError = error
  for (const cb of listeners) cb(next, error)
}

export type StartOptions = {
  safeMode?: boolean
  disabledPlugins?: string[]
}

// 安全模式：OPENCODE_DISABLE_DEFAULT_PLUGINS=1 禁默认插件 + OPENCODE_CONFIG_CONTENT='{"plugin":[]}' 清空用户插件列表。
// 禁用特定插件：OPENCODE_CONFIG_CONTENT='{"plugin_enabled":{"<spec>":false}}' merge 进 config。
function applyStartEnv(opts: StartOptions): () => void {
  const saved: Array<[string, string | undefined]> = []
  const save = (key: string) => saved.push([key, process.env[key]])
  const parts: Array<Record<string, unknown>> = []
  if (opts.safeMode) {
    save("OPENCODE_DISABLE_DEFAULT_PLUGINS")
    process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"
    parts.push({ plugin: [] })
  }
  if (opts.disabledPlugins?.length) {
    const map: Record<string, boolean> = {}
    for (const spec of opts.disabledPlugins) map[spec] = false
    parts.push({ plugin_enabled: map })
  }
  if (parts.length === 0) return () => {}
  const merged = parts.reduce<Record<string, unknown>>((acc, part) => ({ ...acc, ...part }), {})
  save("OPENCODE_CONFIG_CONTENT")
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(merged)
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

export async function startOpencode(opts: StartOptions = {}): Promise<void> {
  if (status === "starting" || status === "running") return
  setStatus("starting")
  const restoreEnv = applyStartEnv(opts)
  try {
    clearPluginLogs()
    clearPluginLoads()
    // 启动 sidecar 前自动 snapshot（ADR-021 D9：启动前必有回滚点）。失败不阻止启动。
    await createSnapshot({ type: "auto" }).catch((err) => logger.warn("auto snapshot failed", { error: String(err) }))
    await pruneAutoSnapshots().catch((err) => logger.warn("prune snapshots failed", { error: String(err) }))
    serverDataPromise = new Promise<ServerReadyData>((resolve) => {
      serverDataResolver = resolve
    })
    const data = await spawnSidecar()
    serverDataResolver(data)
    restoreMainWindows()
    setStatus("running")
  } catch (err) {
    // 07 验收：sidecar 启动失败时显示完整错误日志/堆栈。
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    logger.error("launcher startOpencode failed", { error: detail })
    setStatus("failed", detail)
  } finally {
    restoreEnv()
  }
}

export async function stopOpencode(): Promise<void> {
  if (status === "idle") return
  setStatus("stopping")
  const launcher = getLauncherWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win === launcher || win.isDestroyed()) continue
    win.close()
  }
  if (server) {
    await server.stop()
    server = null
  }
  serverDataPromise = neverResolvingPromise()
  setStatus("idle")
}

async function spawnSidecar(): Promise<ServerReadyData> {
  const useV2 = process.env.OPENCODE_SIDECAR_V2 === "1"
  if (useV2) {
    logger.log("launcher spawning v2 sidecar")
    const sidecar = await startBackgroundCli(logger, shellEnv?.XDG_STATE_HOME)
    return { url: sidecar.url, username: sidecar.username, password: sidecar.password }
  }
  const port = await allocatePort()
  const hostname = "127.0.0.1"
  const password = randomUUID()
  logger.log("launcher spawning v1 sidecar", { url: `http://${hostname}:${port}` })
  const { listener, health } = await spawnLocalServer(hostname, port, password, {
    userDataPath: app.getPath("userData"),
    onStdout: (message) => logger.log("server stdout", { message }),
    onStderr: (message) => logger.warn("server stderr", { message }),
    onExit: (code) => logger.warn("sidecar exited", { code }),
    onPluginLog: (line, level, ts) => appendPluginLog({ line, level, ts }),
    onPluginStage: (event) => applyPluginStageEvent(event),
  })
  server = listener
  // 等 health check 通过再向 renderer 暴露凭据，避免插件加载期间连接的启动竞态。
  await withTimeout(health.wait, 30_000)
  return { url: `http://${hostname}:${port}`, username: "opencode", password }
}

function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createServer()
    socket.on("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address()
      if (typeof address !== "object" || !address) {
        socket.close()
        reject(new Error("Failed to get port"))
        return
      }
      const port = address.port
      socket.close(() => resolve(port))
    })
  })
}

// 回滚进度（ADR-021 D10：停止→恢复→重装→重启）
let rollbackProgress: RollbackProgress = { phase: "idle" }
const rollbackListeners = new Set<(p: RollbackProgress) => void>()

// 插件加载日志（ADR-020 D7：sidecar 回传加载进度）
const pluginLogs: PluginLogEntry[] = []
const PLUGIN_LOG_MAX = 200
const pluginLogListeners = new Set<(logs: PluginLogEntry[]) => void>()

export function getPluginLogs(): PluginLogEntry[] {
  return pluginLogs
}

export function onPluginLogs(cb: (logs: PluginLogEntry[]) => void): () => void {
  pluginLogListeners.add(cb)
  return () => pluginLogListeners.delete(cb)
}

function appendPluginLog(entry: PluginLogEntry) {
  pluginLogs.push(entry)
  if (pluginLogs.length > PLUGIN_LOG_MAX) pluginLogs.splice(0, pluginLogs.length - PLUGIN_LOG_MAX)
  for (const cb of pluginLogListeners) cb(pluginLogs)
}

function clearPluginLogs() {
  pluginLogs.length = 0
  for (const cb of pluginLogListeners) cb(pluginLogs)
}

// 插件加载阶段状态机（ADR-020 D7：四阶段 + 耗时 + 错误标注）
const pluginLoads = createPluginLoadTracker()

export function getPluginLoads(): PluginLoadEntry[] {
  return pluginLoads.get()
}

export function onPluginLoads(cb: (entries: PluginLoadEntry[]) => void): () => void {
  return pluginLoads.subscribe(cb)
}

function applyPluginStageEvent(event: Parameters<typeof pluginLoads.apply>[0]) {
  pluginLoads.apply(event)
}

function clearPluginLoads() {
  pluginLoads.clear()
}

// 08 错误日志处理：从加载状态 + 文本日志中提取结构化错误片段。
export function getErrorSnippets(): LauncherErrorSnippet[] {
  const snippets: LauncherErrorSnippet[] = []
  const seen = new Set<string>()

  // 1. 插件加载失败片段（含 spec + stage + 错误消息）
  for (const load of pluginLoads.get()) {
    if (load.status !== "failed" || !load.error) continue
    const stage = load.stages[load.stages.length - 1]
    const key = `${load.spec}:${stage?.stage ?? ""}:${load.error}`
    if (seen.has(key)) continue
    seen.add(key)
    const parsed = parsePathAndLine(load.error)
    snippets.push({
      path: parsed.path,
      line: parsed.line,
      message: load.error,
      spec: load.spec,
      stage: stage?.stage,
      ts: stage?.startedAt ?? Date.now(),
    })
  }

  // 2. 文本日志中的错误行（含文件路径:行号）
  for (const log of pluginLogs) {
    if (log.level !== "error") continue
    const parsed = parsePathAndLine(log.line)
    if (!parsed.path) continue
    const key = `${parsed.path}:${parsed.line ?? ""}:${log.line}`
    if (seen.has(key)) continue
    seen.add(key)
    snippets.push({
      path: parsed.path,
      line: parsed.line,
      message: log.line,
      ts: log.ts,
    })
  }

  return snippets
}

// 08 元数据：launcher 版本 + OpenCode 版本 + 生成时间。
export function getDiagnosticsMeta(): LauncherDiagnosticsMeta {
  return {
    launcherVersion: "v0.1.0",
    opencodeVersion: app.getVersion(),
    generatedAt: new Date().toISOString(),
  }
}

export function getRollbackProgress(): RollbackProgress {
  return rollbackProgress
}

export function onRollbackProgress(cb: (p: RollbackProgress) => void): () => void {
  rollbackListeners.add(cb)
  return () => rollbackListeners.delete(cb)
}

function setRollbackProgress(p: RollbackProgress) {
  rollbackProgress = p
  for (const cb of rollbackListeners) cb(p)
}

export async function rollbackToSnapshot(id: string, projectPath?: string): Promise<{ failedPlugins: string[] }> {
  setRollbackProgress({ phase: "stopping" })
  await stopOpencode().catch((err) => logger.warn("rollback stop failed", { error: String(err) }))
  setRollbackProgress({ phase: "restoring" })
  const snap = await getSnapshot(id, projectPath)
  if (!snap) {
    setRollbackProgress({ phase: "failed", error: `snapshot not found: ${id}` })
    throw new Error(`snapshot not found: ${id}`)
  }
  await restoreSnapshotConfig(snap)
  setRollbackProgress({ phase: "reinstalling" })
  const failedPlugins: string[] = []
  for (const plugin of snap.plugins) {
    try {
      await reinstallPlugin(plugin.spec)
    } catch (err) {
      logger.warn("plugin reinstall failed", { spec: plugin.spec, error: String(err) })
      failedPlugins.push(plugin.spec)
    }
  }
  setRollbackProgress({ phase: "restarting" })
  await startOpencode()
  setRollbackProgress({ phase: "done", failedPlugins })
  return { failedPlugins }
}

async function reinstallPlugin(spec: string): Promise<void> {
  const cwd = opencodeConfigDir()
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  if (!existsSync(join(cwd, "package.json"))) {
    await execFileAsync(npm, ["init", "-y"], { cwd })
  }
  await execFileAsync(npm, ["i", spec], { cwd })
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
