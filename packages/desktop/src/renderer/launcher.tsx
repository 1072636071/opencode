import { render } from "solid-js/web"
import { createSignal, onMount, Show, For, Switch, Match, createEffect } from "solid-js"
import type {
  OpencodeStatus,
  LauncherSnapshotMeta,
  RollbackProgress,
  LauncherPluginInfo,
  LauncherPluginLogEntry,
  LauncherPluginLoadEntry,
  LauncherErrorSnippet,
  LauncherDiagnosticsMeta,
  LauncherConfigFileInfo,
  LauncherCreateConfigLocation,
  LauncherCreateConfigType,
  LauncherOpencodeSubdirInfo,
  LauncherDirectoryEntry,
} from "../preload/types"
import { mergeProviderConfig, validateLlmApiForm, type LlmApiFormState } from "./llm-api-form"
import {
  groupConfigFilesByGroup,
  togglePath,
  openFileHandler,
  CREATE_LOCATIONS,
  CREATE_TYPES,
  locationLabel,
  detectConfigFileKind,
  pickFormFields,
  mergeConfigField,
  isAuthKeyForm,
  isSourceOnlyForm,
  extractAgentBindings,
  buildAgentConfig,
  extractMcpServers,
  buildMcpConfig,
  extractPermissionRules,
  buildPermissionConfig,
  type ConfigFileKind,
  type ConfigFormFields,
  type AgentBinding,
  type McpServerEntry,
  type PermissionRule,
} from "./launcher-config-groups"
import "./launcher.css"

const [sidecarStatus, setSidecarStatus] = createSignal<OpencodeStatus>("idle")
const [lastError, setLastError] = createSignal<string | undefined>()
const [snapshots, setSnapshots] = createSignal<LauncherSnapshotMeta[]>([])
const [rollbackProgress, setRollbackProgress] = createSignal<RollbackProgress>({ phase: "idle" })
const [safeMode, setSafeMode] = createSignal(false)
const [disabledPlugins, setDisabledPlugins] = createSignal<Set<string>>(new Set())
const [pluginList, setPluginList] = createSignal<LauncherPluginInfo[]>([])
const [pluginLogs, setPluginLogs] = createSignal<LauncherPluginLogEntry[]>([])
const [pluginLoads, setPluginLoads] = createSignal<LauncherPluginLoadEntry[]>([])
const [errorSnippets, setErrorSnippets] = createSignal<LauncherErrorSnippet[]>([])
const [diagnosticsMeta, setDiagnosticsMeta] = createSignal<LauncherDiagnosticsMeta | null>(null)
const [importPhase, setImportPhase] = createSignal<string>("")

export { setSidecarStatus, sidecarStatus }
export type { OpencodeStatus }


const rollbackPhaseLabel: Record<string, string> = {
  idle: "",
  stopping: "停止中…",
  restoring: "恢复配置中…",
  reinstalling: "重装插件中…",
  restarting: "重启中…",
  done: "回滚完成",
  failed: "回滚失败",
}

const statusLabel: Record<OpencodeStatus, string> = {
  idle: "OpenCode 未启动",
  starting: "OpenCode 启动中…",
  running: "OpenCode 运行中",
  stopping: "OpenCode 停止中…",
  failed: "OpenCode 启动失败",
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  )
}

function Titlebar() {
  return (
    <header class="launcher-titlebar">
      <span class="launcher-titlebar__title">OpenCode 启动器</span>
      <div class="launcher-titlebar__actions">
        <button class="launcher-iconbtn" aria-label="最小化" onClick={() => window.api.launcherMinimize()}>
          <MinimizeIcon />
        </button>
        <button class="launcher-iconbtn" aria-label="关闭" onClick={() => window.api.launcherClose()}>
          <CloseIcon />
        </button>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <div class="launcher-hero">
      <h1 class="launcher-hero__title">墨染启动器</h1>
      <p class="launcher-hero__subtitle">
        OpenCode 起不来时仍能工作。回滚配置、定位坏插件、一键救活——控制平面与数据平面分离。
      </p>
    </div>
  )
}

function ControlPanel() {
  const isBusy = () => {
    const s = sidecarStatus()
    return s === "starting" || s === "stopping"
  }
  const isRunning = () => sidecarStatus() === "running"
  const start = () => {
    const disabled = safeMode() ? [] : Array.from(disabledPlugins())
    window.api.launcherStart({
      safeMode: safeMode(),
      disabledPlugins: disabled,
    })
  }
  const safeStart = () => {
    window.api.launcherStart({ safeMode: true, disabledPlugins: [] })
  }
  const openUI = () => {
    // 既有 IPC：runDesktopMenuAction("window.new") → main 端 createMainWindow()。
    // 不新增 IPC 契约（PRD 硬约束）。
    window.api.runDesktopMenuAction("window.new")
  }
  const restart = async () => {
    await window.api.launcherStop()
    // 等状态回到 idle 再启动；onLauncherStatusChange 会更新 sidecarStatus。
    // 简单起见直接调 start，main 端 startOpencode 会幂等处理 starting/running。
    start()
  }

  // 圆环启停纽：未运行点 → 启动；运行中点 → 打开界面。
  const ringClick = () => {
    if (isBusy()) return
    if (isRunning()) openUI()
    else start()
  }
  const ringLabel = () => {
    const s = sidecarStatus()
    if (s === "idle") return "启动\nOpenCode"
    if (s === "starting") return "启动中…"
    if (s === "running") return "打开\n界面"
    if (s === "stopping") return "停止中…"
    if (s === "failed") return "启动失败\n点此重试"
    return "启动\nOpenCode"
  }
  const ringClass = () => {
    const s = sidecarStatus()
    if (s === "stopping") return "launcher-stage__ring--idle"
    return `launcher-stage__ring--${s}`
  }

  return (
    <div class="launcher-control">
      <div class="launcher-stage">
        <button
          class={`launcher-stage__ring ${ringClass()}`}
          aria-label={isRunning() ? "打开 OpenCode 界面" : "启动 OpenCode"}
          disabled={isBusy()}
          onClick={ringClick}
        >
          <span class="launcher-stage__ring-label">{ringLabel()}</span>
        </button>
        {/* 状态信息行：端口/PID/版本/工作目录/运行时长——从 launcherGetStatus 读取 */}
        <Show when={sidecarStatus() === "running"}>
          <StatusInfoRow />
        </Show>
        {/* 启动失败就近错误摘要 + 诊断入口 */}
        <Show when={sidecarStatus() === "failed" && lastError()}>
          <pre class="launcher-stage__error">{lastError()}</pre>
          <button
            class="launcher-btn launcher-btn--small"
            aria-label="进入安全模式诊断"
            onClick={() => {
              if (typeof location !== "undefined") location.hash = "#safemode"
            }}
          >
            查看诊断
          </button>
        </Show>
        {/* 次按钮行：安全模式启动 / 打开界面 / 停止 / 重启 */}
        <div class="launcher-stage__actions">
          <Show when={!isRunning() && !isBusy()}>
            <button
              class="launcher-btn launcher-btn--small"
              aria-label="安全模式启动 OpenCode"
              onClick={safeStart}
            >
              安全模式启动
            </button>
          </Show>
          <Show when={isRunning()}>
            <button class="launcher-btn launcher-btn--small" aria-label="打开 OpenCode 界面" onClick={openUI}>
              打开界面
            </button>
            <button
              class="launcher-btn launcher-btn--small launcher-btn--danger"
              aria-label="停止 OpenCode"
              disabled={isBusy()}
              onClick={() => window.api.launcherStop()}
            >
              停止服务
            </button>
            <button
              class="launcher-btn launcher-btn--small"
              aria-label="重启 OpenCode"
              disabled={isBusy()}
              onClick={restart}
            >
              重启服务
            </button>
          </Show>
        </div>
      </div>
    </div>
  )
}

// 状态信息行：从 launcherGetStatus() 拉取端口/PID/版本/工作目录/运行时长。
// main 端 status 只含 status+error，扩展信息按需读取（不破坏既有契约）。
function StatusInfoRow() {
  const [info, setInfo] = createSignal<{ port?: number; pid?: number; version?: string; cwd?: string; uptimeMs?: number }>({})
  onMount(() => {
    void window.api.launcherGetStatus().then((res) => {
      // 既有契约只保证 status+error；扩展字段按需读取，缺失则不显示。
      const ext = res as { port?: number; pid?: number; version?: string; cwd?: string; uptimeMs?: number }
      setInfo({
        port: ext.port,
        pid: ext.pid,
        version: ext.version,
        cwd: ext.cwd,
        uptimeMs: ext.uptimeMs,
      })
    })
  })
  const fmtUptime = (ms?: number) => {
    if (ms === undefined) return undefined
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m${s % 60}s`
    const h = Math.floor(m / 60)
    return `${h}h${m % 60}m`
  }
  const items: Array<[string, string | undefined]> = [
    ["端口", info().port ? String(info().port) : undefined],
    ["PID", info().pid ? String(info().pid) : undefined],
    ["版本", info().version],
    ["工作目录", info().cwd],
    ["运行时长", fmtUptime(info().uptimeMs)],
  ]
  return (
    <div class="launcher-stage__info">
      <For each={items}>
        {(item) => (
          <Show when={item[1]}>
            <span class="launcher-stage__info-item">
              <span class="launcher-stage__info-key">{item[0]}:</span>
              <span class="launcher-stage__info-val">{item[1]}</span>
            </span>
          </Show>
        )}
      </For>
    </div>
  )
}

async function refreshSnapshots() {
  try {
    setSnapshots(await window.api.launcherListSnapshots())
  } catch {
    setSnapshots([])
  }
}

function SnapshotPanel() {
  const [tagEditingId, setTagEditingId] = createSignal<string | null>(null)
  const [tagInput, setTagInput] = createSignal("")
  const formatTime = (ts: number) => new Date(ts).toLocaleString()

  const startTag = (id: string) => {
    setTagEditingId(id)
    setTagInput("")
  }
  const confirmTag = async (id: string) => {
    const name = tagInput().trim()
    setTagEditingId(null)
    if (!name) return
    await window.api.launcherTagSnapshot(id, name)
    await refreshSnapshots()
  }
  const removeTag = async (id: string) => {
    await window.api.launcherUntagSnapshot(id)
    await refreshSnapshots()
  }

  const isRolling = () => {
    const p = rollbackProgress().phase
    return p !== "idle" && p !== "done" && p !== "failed"
  }

  return (
    <div class="launcher-snapshots">
      <div class="launcher-snapshots__head">
        <h2 class="launcher-snapshots__title">配置版本</h2>
        {rollbackProgress().phase !== "idle" && (
          <span class="launcher-snapshots__progress">
            {rollbackPhaseLabel[rollbackProgress().phase]}
            {rollbackProgress().failedPlugins?.length
              ? `（${rollbackProgress()!.failedPlugins!.length} 插件重装失败）`
              : ""}
          </span>
        )}
        <button
          class="launcher-btn launcher-btn--small"
          aria-label="手动打 snapshot"
          disabled={isRolling()}
          onClick={async () => {
            await window.api.launcherManualSnapshot()
            await refreshSnapshots()
          }}
        >
          手动 snapshot
        </button>
        <button
          class="launcher-btn launcher-btn--small"
          aria-label="导入整包"
          disabled={isRolling()}
          onClick={async () => {
            const result = await window.api.openFilePicker({ extensions: ["json"] })
            if (!result || result.files.length === 0) return
            const { token, files } = result
            try {
              const buffer = await window.api.readPickedFile(token, files[0].path)
              const content = new TextDecoder().decode(buffer)
              await window.api.launcherImportBundle(content)
              await refreshSnapshots()
            } finally {
              await window.api.releasePickedFiles(token)
            }
          }}
        >
          导入
        </button>
        {importPhase() && importPhase() !== "done" && (
          <span class="launcher-snapshots__progress">导入: {importPhase()}</span>
        )}
      </div>
      <ul class="launcher-snapshots__list">
        {snapshots()
          .slice(0, 20)
          .map((s) => (
            <li class="launcher-snapshots__item">
              <span class="launcher-snapshots__time">{formatTime(s.timestamp)}</span>
              <span class={`launcher-snapshots__type launcher-snapshots__type--${s.type}`}>{s.type}</span>
              {s.tag ? (
                <>
                  <span class="launcher-snapshots__tag">{s.tag}</span>
                  <button class="launcher-btn launcher-btn--mini" aria-label="删除 tag" onClick={() => removeTag(s.id)}>
                    删 tag
                  </button>
                </>
              ) : tagEditingId() === s.id ? (
                <>
                  <input
                    class="launcher-snapshots__input"
                    placeholder="tag 名称"
                    value={tagInput()}
                    onInput={(e) => setTagInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void confirmTag(s.id)
                      if (e.key === "Escape") setTagEditingId(null)
                    }}
                  />
                  <button
                    class="launcher-btn launcher-btn--mini"
                    aria-label="确认 tag"
                    onClick={() => confirmTag(s.id)}
                  >
                    确认
                  </button>
                  <button
                    class="launcher-btn launcher-btn--mini"
                    aria-label="取消"
                    onClick={() => setTagEditingId(null)}
                  >
                    取消
                  </button>
                </>
              ) : (
                <button class="launcher-btn launcher-btn--mini" aria-label="打 tag" onClick={() => startTag(s.id)}>
                  打 tag
                </button>
              )}
              <span class="launcher-snapshots__count">{s.pluginCount} 插件</span>
              <button
                class="launcher-btn launcher-btn--mini launcher-btn--danger"
                aria-label="回滚到此版本"
                disabled={isRolling()}
                onClick={async () => {
                  await window.api.launcherRollbackSnapshot(s.id)
                  await refreshSnapshots()
                }}
              >
                回滚
              </button>
              <button
                class="launcher-btn launcher-btn--mini"
                aria-label="导出整包"
                onClick={async () => {
                  const content = await window.api.launcherExportBundle(s.id)
                  const path = await window.api.saveFilePicker({ defaultPath: `opencode-bundle-${s.id}.json` })
                  if (path) await window.api.launcherExportLogs(path, content)
                }}
              >
                导出
              </button>
            </li>
          ))}
      </ul>
    </div>
  )
}

const RESOURCES = {
  docs: "https://opencode.ai/docs",
  website: "https://opencode.ai",
  tools: [
    { name: "Bun", url: "https://bun.sh" },
    { name: "Node.js", url: "https://nodejs.org" },
    { name: "Git", url: "https://git-scm.com" },
  ],
}

const RECOMMENDED_PLUGINS = [
  { name: "opencode-plugin-git", description: "Git 工作流增强" },
  { name: "opencode-plugin-linter", description: "代码检查集成" },
]

async function checkPluginActive(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`)
    if (!res.ok) return null
    const data = (await res.json()) as { time?: Record<string, string>; "dist-tags"?: { latest?: string } }
    const times = data.time ?? {}
    const latest = data["dist-tags"]?.latest
    if (latest && times[latest]) return times[latest]
    return null
  } catch {
    return null
  }
}

function ResourcePanel() {
  const [activeTimes, setActiveTimes] = createSignal<Record<string, string | null>>({})
  const formatActive = (ts: string) => {
    const d = new Date(ts)
    return isNaN(d.getTime()) ? ts : d.toLocaleDateString()
  }
  return (
    <div class="launcher-resources">
      <h2 class="launcher-resources__title">资源面板</h2>
      <div class="launcher-resources__links">
        <button class="launcher-btn launcher-btn--small" onClick={() => window.api.openExternal(RESOURCES.docs)}>
          文档
        </button>
        <button class="launcher-btn launcher-btn--small" onClick={() => window.api.openExternal(RESOURCES.website)}>
          官网
        </button>
        {RESOURCES.tools.map((t) => (
          <button class="launcher-btn launcher-btn--small" onClick={() => window.api.openExternal(t.url)}>
            {t.name}
          </button>
        ))}
      </div>
      <h3 class="launcher-resources__subtitle">推荐插件</h3>
      <ul class="launcher-resources__plugins">
        {RECOMMENDED_PLUGINS.map((p) => (
          <li class="launcher-resources__plugin">
            <span class="launcher-resources__plugin-name">{p.name}</span>
            <span class="launcher-resources__plugin-desc">{p.description}</span>
            {activeTimes()[p.name] ? (
              <span class="launcher-resources__active">活跃: {formatActive(activeTimes()[p.name]!)}</span>
            ) : (
              <button
                class="launcher-btn launcher-btn--mini"
                aria-label={`查询 ${p.name} 活跃时间`}
                onClick={async () => {
                  const ts = await checkPluginActive(p.name)
                  setActiveTimes({ ...activeTimes(), [p.name]: ts })
                }}
              >
                查活跃时间
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SettingsPanel() {
  const [autoStart, setAutoStart] = createSignal(true)
  onMount(() => {
    void window.api.launcherGetSettings().then((s) => setAutoStart(s.autoStart))
  })
  const toggle = async () => {
    const next = await window.api.launcherSetSettings({ autoStart: !autoStart() })
    setAutoStart(next.autoStart)
  }
  return (
    <div class="launcher-settings">
      <label class="launcher-settings__item">
        <input type="checkbox" checked={autoStart()} onChange={toggle} />
        <span>自动启动 OpenCode（关闭后打开启动器停在面板）</span>
      </label>
    </div>
  )
}

function SafeModePanel() {
  const [expanded, setExpanded] = createSignal(false)
  const refreshPlugins = async () => {
    try {
      setPluginList(await window.api.launcherListPlugins())
    } catch {
      setPluginList([])
    }
    try {
      setPluginLoads(await window.api.launcherGetPluginLoads())
    } catch {}
    try {
      setErrorSnippets(await window.api.launcherGetErrorSnippets())
    } catch {}
    try {
      setDiagnosticsMeta(await window.api.launcherGetDiagnosticsMeta())
    } catch {}
  }
  const formatLogsForExport = () => {
    const meta = [
      `# OpenCode Launcher 诊断日志`,
      `# 导出时间: ${new Date().toISOString()}`,
      `# Launcher 版本: v0.1.0`,
      `# Sidecar 状态: ${sidecarStatus()}`,
      `# 插件数: ${pluginList().length}`,
      `# 日志条数: ${pluginLogs().length}`,
      "",
    ].join("\n")
    const body = pluginLogs()
      .map((l) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.level.toUpperCase()} ${relativizeLine(l.line)}`)
      .join("\n")
    return `${meta}\n${body}`
  }
  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(formatLogsForExport())
    } catch {}
  }
  const exportLogs = async () => {
    const path = await window.api.saveFilePicker({ defaultPath: "opencode-launcher-logs.txt" })
    if (!path) return
    await window.api.launcherExportLogs(path, formatLogsForExport())
  }
  const togglePlugin = (spec: string) => {
    const next = new Set(disabledPlugins())
    if (next.has(spec)) next.delete(spec)
    else next.add(spec)
    setDisabledPlugins(next)
  }
  const enableAll = () => setDisabledPlugins(new Set<string>())
  const disableAll = () => setDisabledPlugins(new Set<string>(pluginList().map((p) => p.spec)))

  return (
    <div class="launcher-safemode">
      <div class="launcher-safemode__head">
        <h2 class="launcher-safemode__title">调试工具</h2>
        <button
          class="launcher-btn launcher-btn--small"
          aria-label={expanded() ? "收起" : "展开"}
          onClick={() => {
            const next = !expanded()
            setExpanded(next)
            if (next) void refreshPlugins()
          }}
        >
          {expanded() ? "收起" : "展开"}
        </button>
      </div>
      <label class="launcher-safemode__item">
        <input type="checkbox" checked={safeMode()} onChange={(e) => setSafeMode(e.currentTarget.checked)} />
        <span>安全模式（跳过所有插件启动，确认本体能起）</span>
      </label>
      {expanded() && !safeMode() && (
        <div class="launcher-safemode__plugins">
          <div class="launcher-safemode__plugins-head">
            <span class="launcher-safemode__count">
              {pluginList().length} 个插件，{disabledPlugins().size} 个禁用
            </span>
            <button class="launcher-btn launcher-btn--mini" onClick={enableAll}>
              全启用
            </button>
            <button class="launcher-btn launcher-btn--mini" onClick={disableAll}>
              全禁用
            </button>
            <button class="launcher-btn launcher-btn--mini" onClick={() => void refreshPlugins()}>
              刷新
            </button>
          </div>
          {pluginList().length === 0 ? (
            <p class="launcher-safemode__empty">config 无插件声明</p>
          ) : (
            <ul class="launcher-safemode__list">
              {pluginList().map((p) => (
                <li class="launcher-safemode__plugin">
                  <label>
                    <input
                      type="checkbox"
                      checked={!disabledPlugins().has(p.spec)}
                      onChange={() => togglePlugin(p.spec)}
                    />
                    <span class="launcher-safemode__spec">{p.spec}</span>
                    <span class={`launcher-safemode__source launcher-safemode__source--${p.source}`}>{p.source}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {expanded() && (
        <div class="launcher-safemode__diagnosis">
          <PluginLoadPanel />
          <DiagnosticPanel />
          <div class="launcher-safemode__diagnosis-head">
            <h3 class="launcher-safemode__subtitle">启动诊断日志</h3>
            {pluginLogs().length > 0 && (
              <>
                <button class="launcher-btn launcher-btn--mini" onClick={copyLogs}>
                  复制
                </button>
                <button class="launcher-btn launcher-btn--mini" onClick={exportLogs}>
                  导出
                </button>
              </>
            )}
          </div>
          {pluginLogs().length === 0 ? (
            <p class="launcher-safemode__empty">暂无日志（启动后实时显示插件加载信息）</p>
          ) : (
            <pre class="launcher-safemode__logs">
              {pluginLogs()
                .slice(-50)
                .map(
                  (l) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.level.toUpperCase()} ${relativizeLine(l.line)}`,
                )
                .join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

const STAGE_ORDER: LauncherPluginLoadEntry["stages"][number]["stage"][] = [
  "install",
  "entry",
  "compatibility",
  "load",
]

const stageLabel: Record<string, string> = {
  install: "安装",
  entry: "入口",
  compatibility: "兼容",
  load: "加载",
}

// 08 路径相对化：绝对路径转相对项目根（`packages/...`），隐私 + 简洁。
function relativizeLine(line: string): string {
  return line
    .replace(/[A-Za-z]:[\\/][^\s:)]+[\\/]opencode[\\/]packages[\\/]/g, "packages/")
    .replace(/\/[^\s:)]+\/opencode\/packages\//g, "packages/")
}

// 07 插件加载阶段可视化：按加载顺序排列，显示每插件 pending→install→entry→compatibility→loaded/failed + 耗时。
function PluginLoadPanel() {
  return (
    <div class="launcher-pluginload">
      <h3 class="launcher-safemode__subtitle">插件加载详情</h3>
      <Show
        when={pluginLoads().length > 0}
        fallback={<p class="launcher-safemode__empty">暂无加载记录（启动后实时显示每插件加载阶段）</p>}
      >
        <ul class="launcher-pluginload__list">
          <For each={pluginLoads()}>
            {(load) => (
              <li class="launcher-pluginload__item">
                <div class="launcher-pluginload__head">
                  <span class="launcher-pluginload__spec">{load.spec}</span>
                  <span class={`launcher-pluginload__status launcher-pluginload__status--${load.status}`}>
                    {load.status}
                  </span>
                </div>
                <div class="launcher-pluginload__stages">
                  <For each={STAGE_ORDER}>
                    {(stage) => {
                      const state = load.stages.find((s) => s.stage === stage)
                      return (
                        <span
                          class={`launcher-pluginload__stage ${
                            state ? `launcher-pluginload__stage--${load.status}` : ""
                          }`}
                        >
                          {stageLabel[stage]}
                          {state?.durationMs !== undefined && ` ${(state.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      )
                    }}
                  </For>
                </div>
                {load.error && <pre class="launcher-pluginload__error">{load.error}</pre>}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

// 08 诊断报告：元数据 + 错误片段 + 原始日志。一键复制 / 导出 .txt。
function buildDiagnosticReport(): string {
  const meta = diagnosticsMeta()
  const header = [
    "# OpenCode Launcher 诊断日志",
    `# 生成时间: ${meta?.generatedAt ?? new Date().toISOString()}`,
    `# Launcher 版本: ${meta?.launcherVersion ?? "v0.1.0"}`,
    `# OpenCode 版本: ${meta?.opencodeVersion ?? "unknown"}`,
    `# Sidecar 状态: ${sidecarStatus()}`,
    `# 插件加载条目: ${pluginLoads().length}`,
    `# 错误片段: ${errorSnippets().length}`,
    "",
  ].join("\n")

  const loadsBody = pluginLoads()
    .map((l) => {
      const stages = l.stages.map((s) => {
        const dur = s.durationMs !== undefined ? `${(s.durationMs / 1000).toFixed(1)}s` : ""
        return `${s.stage}${dur ? `(${dur})` : ""}${s.error ? `: ${s.error}` : ""}`
      })
      return `  ${l.order + 1}. ${l.spec} [${l.status}] ${stages.join(" → ") || "pending"}`
    })
    .join("\n")

  const snippetsBody = errorSnippets()
    .map((s) => {
      const loc = s.path ? `${s.path}${s.line !== null ? `:${s.line}` : ""}` : "?"
      const ctx = [s.spec ? `spec=${s.spec}` : "", s.stage ? `stage=${s.stage}` : ""]
        .filter(Boolean)
        .join(" ")
      return `  - ${loc}${ctx ? ` (${ctx})` : ""}: ${s.message}`
    })
    .join("\n")

  const logsBody = pluginLogs()
    .slice(-100)
    .map((l) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.level.toUpperCase()} ${relativizeLine(l.line)}`)
    .join("\n")

  return [
    header,
    "## 插件加载",
    loadsBody || "  (无)",
    "",
    "## 错误片段",
    snippetsBody || "  (无)",
    "",
    "## 原始日志（最近 100 行）",
    logsBody || "  (无)",
  ].join("\n")
}

function DiagnosticPanel() {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildDiagnosticReport())
    } catch {}
  }
  const exportTxt = async () => {
    const path = await window.api.saveFilePicker({ defaultPath: "opencode-diagnostic-report.txt" })
    if (!path) return
    await window.api.launcherExportLogs(path, buildDiagnosticReport())
  }
  return (
    <div class="launcher-diagnostic">
      <div class="launcher-diagnostic__head">
        <h3 class="launcher-safemode__subtitle">诊断报告</h3>
        <button class="launcher-btn launcher-btn--mini" onClick={copy}>
          复制
        </button>
        <button class="launcher-btn launcher-btn--mini" onClick={exportTxt}>
          导出 .txt
        </button>
      </div>
      <Show
        when={errorSnippets().length > 0}
        fallback={<p class="launcher-safemode__empty">暂无错误片段（无插件加载失败或启动失败）</p>}
      >
        <ul class="launcher-diagnostic__snippets">
          <For each={errorSnippets()}>
            {(s) => (
              <li class="launcher-diagnostic__snippet">
                <span class="launcher-diagnostic__loc">
                  {s.path ? `${relativizeLine(s.path)}${s.line !== null ? `:${s.line}` : ""}` : "未知位置"}
                </span>
                <span class="launcher-diagnostic__meta">
                  {[s.spec && `spec: ${s.spec}`, s.stage && `stage: ${s.stage}`].filter(Boolean).join(" · ")}
                </span>
                <pre class="launcher-diagnostic__message">{s.message}</pre>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

function ConfigEditPanel() {
  const [configFiles, setConfigFiles] = createSignal<LauncherConfigFileInfo[]>([])
  const [expandedPaths, setExpandedPaths] = createSignal<Set<string>>(new Set())
  const [showCreateDialog, setShowCreateDialog] = createSignal(false)
  const [createLocation, setCreateLocation] = createSignal<LauncherCreateConfigLocation>("global")
  const [createType, setCreateType] = createSignal<LauncherCreateConfigType>("opencode.json")
  const [createError, setCreateError] = createSignal<string | null>(null)
  const [creating, setCreating] = createSignal(false)
  // 工单 04：.opencode/ 下目录节点。
  const [opencodeSubdirs, setOpencodeSubdirs] = createSignal<LauncherOpencodeSubdirInfo[]>([])

  const refresh = async () => {
    const files = await window.api.launcherListConfigFiles()
    setConfigFiles(files)
    const subdirs = await window.api.launcherListOpencodeSubdirs()
    setOpencodeSubdirs(subdirs)
  }
  onMount(() => void refresh())

  const openConfigFile = (path: string) => {
    openFileHandler(window.api.openLocalFile, path)()
  }

  const toggleExpand = (path: string) => {
    setExpandedPaths(togglePath(expandedPaths(), path))
  }

  const openCreateDialog = () => {
    setCreateError(null)
    setShowCreateDialog(true)
  }

  const createConfig = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      await window.api.launcherCreateConfigFile({
        location: createLocation(),
        type: createType(),
      })
      await refresh()
      setShowCreateDialog(false)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const grouped = () => groupConfigFilesByGroup(configFiles())
  // 工单 04：只显示存在的 .opencode/ 子目录节点（不铺平到顶层清单）。
  const visibleSubdirs = () => opencodeSubdirs().filter((d) => d.exists)

  return (
    <div class="launcher-configedit">
      <div class="launcher-configedit__head">
        <h2 class="launcher-configedit__title">配置编辑</h2>
        <button class="launcher-btn launcher-btn--small" onClick={openCreateDialog}>
          新建配置文件
        </button>
      </div>
      {configFiles().length === 0 ? (
        <p class="launcher-configedit__empty">未发现配置文件</p>
      ) : (
        <div class="launcher-configedit__files">
          <For each={grouped()}>
            {(entry) => (
              <div class="launcher-configedit__group">
                <h3 class="launcher-configedit__group-title">{entry.label}</h3>
                <For each={entry.files}>
                  {(file) => (
                    <div class="launcher-configedit__file">
                      <div class="launcher-configedit__file-row">
                        <button
                          class="launcher-configedit__expand"
                          aria-label={expandedPaths().has(file.path) ? "折叠" : "展开"}
                          onClick={() => toggleExpand(file.path)}
                        >
                          {expandedPaths().has(file.path) ? "▼" : "▶"}
                        </button>
                        <span class="launcher-configedit__filename">{file.name}</span>
                        <button
                          class="launcher-btn launcher-btn--small"
                          onClick={() => openConfigFile(file.path)}
                        >
                          打开源文件
                        </button>
                      </div>
                      <Show when={expandedPaths().has(file.path)}>
                        <div class="launcher-configedit__expand-content">
                          <ConfigFileForm file={file} />
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
          {/* 工单 04：.opencode/ 下目录节点可展开 + 内部文件打开，不铺平到顶层清单 */}
          <Show when={visibleSubdirs().length > 0}>
            <div class="launcher-configedit__group">
              <h3 class="launcher-configedit__group-title">.opencode 目录</h3>
              <For each={visibleSubdirs()}>
                {(subdir) => (
                  <OpencodeSubdirNode
                    name={subdir.name}
                    path={subdir.path}
                    expanded={expandedPaths().has(subdir.path)}
                    onToggle={() => toggleExpand(subdir.path)}
                    onOpenFile={openConfigFile}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
      <Show when={showCreateDialog()}>
        <div class="launcher-configedit__dialog-overlay" onClick={() => setShowCreateDialog(false)}>
          <div class="launcher-configedit__dialog" onClick={(e) => e.stopPropagation()}>
            <h3 class="launcher-configedit__dialog-title">新建配置文件</h3>
            <div class="launcher-configedit__dialog-field">
              <span class="launcher-configedit__dialog-label">位置</span>
              <div class="launcher-configedit__dialog-options">
                <For each={CREATE_LOCATIONS}>
                  {(loc) => (
                    <label class="launcher-configedit__dialog-option">
                      <input
                        type="radio"
                        name="create-location"
                        checked={createLocation() === loc}
                        onChange={() => setCreateLocation(loc)}
                      />
                      <span>{locationLabel(loc)}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
            <div class="launcher-configedit__dialog-field">
              <span class="launcher-configedit__dialog-label">类型</span>
              <div class="launcher-configedit__dialog-options">
                <For each={CREATE_TYPES}>
                  {(typ) => (
                    <label class="launcher-configedit__dialog-option">
                      <input
                        type="radio"
                        name="create-type"
                        checked={createType() === typ}
                        onChange={() => setCreateType(typ)}
                      />
                      <span>{typ}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
            <Show when={createError()}>
              <p class="launcher-configedit__dialog-error">{createError()}</p>
            </Show>
            <div class="launcher-configedit__dialog-actions">
              <button
                class="launcher-btn launcher-btn--small"
                disabled={creating()}
                onClick={() => void createConfig()}
              >
                创建
              </button>
              <button
                class="launcher-btn launcher-btn--small"
                disabled={creating()}
                onClick={() => setShowCreateDialog(false)}
              >
                取消
              </button>
            </div>
          </div>
         </div>
      </Show>
    </div>
  )
}

/**
 * 工单 06：agent 模型绑定表单。
 *
 * - 列出所有 agent（含现有 + 未来新增），每个 agent 下拉选模型或「自动」。
 * - 保存写入 opencode.json 的 agent.*.model。
 * - 「自动」= 不绑（primary 形态会话级选、派遣形态继承派遣者）。
 * - 不改 core（只在 UI 层，符合路线 A）。
 */
function AgentModelForm(props: {
  config: Record<string, unknown> | null
  saving: boolean
  onSave: (key: string, value: unknown) => Promise<void>
}) {
  // S6 修复：移除 initialBindings，统一由 createEffect 驱动初始化。
  const [bindings, setBindings] = createSignal<AgentBinding[]>([])
  const [newName, setNewName] = createSignal("")
  const [newModel, setNewModel] = createSignal("auto")

  // 同步外部 config 变化（保存后 refresh）
  createEffect(() => {
    setBindings(extractAgentBindings(props.config?.agent))
  })

  const updateModel = (name: string, model: string) => {
    setBindings((list) => list.map((b) => (b.name === name ? { ...b, model } : b)))
  }

  const addAgent = () => {
    const name = newName().trim()
    if (!name) return
    // 避免重名
    if (bindings().some((b) => b.name === name)) return
    setBindings((list) => [...list, { name, model: newModel() || "auto" }].sort((a, b) => a.name.localeCompare(b.name)))
    setNewName("")
    setNewModel("auto")
  }

  const removeAgent = (name: string) => {
    setBindings((list) => list.filter((b) => b.name !== name))
  }

  const save = () => void props.onSave("agent", buildAgentConfig(bindings(), props.config?.agent))

  return (
    <div class="launcher-configedit__subform">
      <p class="launcher-configedit__label">agent 模型绑定（「自动」= 不绑，会话级选或继承派遣者）</p>
      <For each={bindings()}>
        {(binding) => (
          <div class="launcher-configedit__kv-row">
            <span class="launcher-configedit__kv-key">{binding.name}</span>
            <select
              class="launcher-configedit__input"
              value={binding.model}
              onChange={(e) => updateModel(binding.name, e.currentTarget.value)}
            >
              <option value="auto">自动</option>
              <option value="claude-sonnet-4">claude-sonnet-4</option>
              <option value="claude-opus-4">claude-opus-4</option>
              <option value="gpt-5">gpt-5</option>
              <option value="deepseek-chat">deepseek-chat</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              <Show when={!isPresetModel(binding.model)}>
                <option value={binding.model}>{binding.model}</option>
              </Show>
            </select>
            <button
              class="launcher-btn launcher-btn--small"
              onClick={() => removeAgent(binding.name)}
              aria-label={`删除 agent ${binding.name}`}
            >
              删除
            </button>
          </div>
        )}
      </For>
      <div class="launcher-configedit__kv-row">
        <input
          class="launcher-configedit__input"
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          placeholder="新 agent 名称"
        />
        <select
          class="launcher-configedit__input"
          value={newModel()}
          onChange={(e) => setNewModel(e.currentTarget.value)}
        >
          <option value="auto">自动</option>
          <option value="claude-sonnet-4">claude-sonnet-4</option>
          <option value="claude-opus-4">claude-opus-4</option>
          <option value="gpt-5">gpt-5</option>
          <option value="deepseek-chat">deepseek-chat</option>
          <option value="gemini-2.5-pro">gemini-2.5-pro</option>
        </select>
        <button class="launcher-btn launcher-btn--small" onClick={addAgent}>
          添加
        </button>
      </div>
      <button class="launcher-btn launcher-btn--primary" disabled={props.saving} onClick={save}>
        {props.saving ? "保存中…" : "保存 agent 绑定"}
      </button>
    </div>
  )
}

// 预设模型清单——下拉选项里已列出的模型。用于判断是否需要额外追加自定义选项。
const PRESET_MODELS = new Set(["auto", "claude-sonnet-4", "claude-opus-4", "gpt-5", "deepseek-chat", "gemini-2.5-pro"])

function isPresetModel(model: string): boolean {
  return PRESET_MODELS.has(model)
}

/**
 * 工单 07：MCP 服务器表单。
 *
 * - 可新增/删除 MCP 服务器（name + command 或 url + args + env）。
 * - args 为可增删字符串列表，env 为可增删键值对列表。
 * - 保存写入 opencode.json 的 mcp.*。
 */
function McpServerForm(props: {
  config: Record<string, unknown> | null
  saving: boolean
  onSave: (key: string, value: unknown) => Promise<void>
}) {
  // S6 修复：移除 initialServers，统一由 createEffect 驱动初始化。
  const [servers, setServers] = createSignal<McpServerEntry[]>([])
  const [newName, setNewName] = createSignal("")
  const [newCommand, setNewCommand] = createSignal("")
  const [newUrl, setNewUrl] = createSignal("")

  createEffect(() => {
    setServers(extractMcpServers(props.config?.mcp))
  })

  const addServer = () => {
    const name = newName().trim()
    if (!name) return
    if (servers().some((s) => s.name === name)) return
    const entry: McpServerEntry = {
      name,
      args: [],
      env: [],
    }
    if (newCommand().trim()) entry.command = newCommand().trim()
    if (newUrl().trim()) entry.url = newUrl().trim()
    setServers((list) => [...list, entry])
    setNewName("")
    setNewCommand("")
    setNewUrl("")
  }

  const removeServer = (name: string) => {
    setServers((list) => list.filter((s) => s.name !== name))
  }

  const updateField = <K extends keyof McpServerEntry>(name: string, key: K, value: McpServerEntry[K]) => {
    setServers((list) => list.map((s) => (s.name === name ? { ...s, [key]: value } : s)))
  }

  const addArg = (name: string) => {
    setServers((list) => list.map((s) => (s.name === name ? { ...s, args: [...s.args, ""] } : s)))
  }

  const updateArg = (name: string, idx: number, value: string) => {
    setServers((list) =>
      list.map((s) =>
        s.name === name ? { ...s, args: s.args.map((a, i) => (i === idx ? value : a)) } : s,
      ),
    )
  }

  const removeArg = (name: string, idx: number) => {
    setServers((list) =>
      list.map((s) => (s.name === name ? { ...s, args: s.args.filter((_, i) => i !== idx) } : s)),
    )
  }

  const addEnv = (name: string) => {
    setServers((list) => list.map((s) => (s.name === name ? { ...s, env: [...s.env, { key: "", value: "" }] } : s)))
  }

  const updateEnvKey = (name: string, idx: number, key: string) => {
    setServers((list) =>
      list.map((s) =>
        s.name === name ? { ...s, env: s.env.map((e, i) => (i === idx ? { ...e, key } : e)) } : s,
      ),
    )
  }

  const updateEnvValue = (name: string, idx: number, value: string) => {
    setServers((list) =>
      list.map((s) =>
        s.name === name ? { ...s, env: s.env.map((e, i) => (i === idx ? { ...e, value } : e)) } : s,
      ),
    )
  }

  const removeEnv = (name: string, idx: number) => {
    setServers((list) =>
      list.map((s) => (s.name === name ? { ...s, env: s.env.filter((_, i) => i !== idx) } : s)),
    )
  }

  const save = () => void props.onSave("mcp", buildMcpConfig(servers(), props.config?.mcp))

  return (
    <div class="launcher-configedit__subform">
      <p class="launcher-configedit__label">MCP 服务器（name + command 或 url + args + env）</p>
      <For each={servers()}>
        {(server) => (
          <div class="launcher-configedit__card">
            <div class="launcher-configedit__card-head">
              <span class="launcher-configedit__kv-key">{server.name}</span>
              <button
                class="launcher-btn launcher-btn--small"
                onClick={() => removeServer(server.name)}
                aria-label={`删除 MCP 服务器 ${server.name}`}
              >
                删除
              </button>
            </div>
            <label class="launcher-configedit__field">
              <span class="launcher-configedit__label">command（本地命令）</span>
              <input
                class="launcher-configedit__input"
                value={server.command ?? ""}
                onInput={(e) => updateField(server.name, "command", e.currentTarget.value || undefined)}
                placeholder="如: node"
              />
            </label>
            <label class="launcher-configedit__field">
              <span class="launcher-configedit__label">url（远程服务器）</span>
              <input
                class="launcher-configedit__input"
                value={server.url ?? ""}
                onInput={(e) => updateField(server.name, "url", e.currentTarget.value || undefined)}
                placeholder="https://example.com/mcp"
              />
            </label>
            <div class="launcher-configedit__field">
              <span class="launcher-configedit__label">args（参数列表）</span>
              <For each={server.args}>
                {(arg, idx) => (
                  <div class="launcher-configedit__kv-row">
                    <input
                      class="launcher-configedit__input"
                      value={arg}
                      onInput={(e) => updateArg(server.name, idx(), e.currentTarget.value)}
                    />
                    <button
                      class="launcher-btn launcher-btn--small"
                      onClick={() => removeArg(server.name, idx())}
                      aria-label="删除参数"
                    >
                      删除
                    </button>
                  </div>
                )}
              </For>
              <button class="launcher-btn launcher-btn--small" onClick={() => addArg(server.name)}>
                添加参数
              </button>
            </div>
            <div class="launcher-configedit__field">
              <span class="launcher-configedit__label">env（环境变量键值对）</span>
              <For each={server.env}>
                {(env, idx) => (
                  <div class="launcher-configedit__kv-row">
                    <input
                      class="launcher-configedit__input"
                      value={env.key}
                      onInput={(e) => updateEnvKey(server.name, idx(), e.currentTarget.value)}
                      placeholder="变量名"
                    />
                    <input
                      class="launcher-configedit__input"
                      value={env.value}
                      onInput={(e) => updateEnvValue(server.name, idx(), e.currentTarget.value)}
                      placeholder="变量值"
                    />
                    <button
                      class="launcher-btn launcher-btn--small"
                      onClick={() => removeEnv(server.name, idx())}
                      aria-label="删除环境变量"
                    >
                      删除
                    </button>
                  </div>
                )}
              </For>
              <button class="launcher-btn launcher-btn--small" onClick={() => addEnv(server.name)}>
                添加环境变量
              </button>
            </div>
          </div>
        )}
      </For>
      <div class="launcher-configedit__card">
        <p class="launcher-configedit__label">新增 MCP 服务器</p>
        <label class="launcher-configedit__field">
          <span class="launcher-configedit__label">name（必填）</span>
          <input
            class="launcher-configedit__input"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            placeholder="如: my-server"
          />
        </label>
        <label class="launcher-configedit__field">
          <span class="launcher-configedit__label">command</span>
          <input
            class="launcher-configedit__input"
            value={newCommand()}
            onInput={(e) => setNewCommand(e.currentTarget.value)}
            placeholder="如: node"
          />
        </label>
        <label class="launcher-configedit__field">
          <span class="launcher-configedit__label">url</span>
          <input
            class="launcher-configedit__input"
            value={newUrl()}
            onInput={(e) => setNewUrl(e.currentTarget.value)}
            placeholder="https://example.com/mcp"
          />
        </label>
        <button class="launcher-btn launcher-btn--small" onClick={addServer}>
          添加服务器
        </button>
      </div>
      <button class="launcher-btn launcher-btn--primary" disabled={props.saving} onClick={save}>
        {props.saving ? "保存中…" : "保存 MCP 配置"}
      </button>
    </div>
  )
}

/**
 * 工单 08：权限规则表单。
 *
 * - 可新增/删除权限规则（glob 模式 + allow/deny/ask）。
 * - 保存写入 opencode.json 的 permission。
 */
function PermissionRuleForm(props: {
  config: Record<string, unknown> | null
  saving: boolean
  onSave: (key: string, value: unknown) => Promise<void>
}) {
  // S6 修复：移除 initialRules，统一由 createEffect 驱动初始化。
  const [rules, setRules] = createSignal<PermissionRule[]>([])
  const [newGlob, setNewGlob] = createSignal("")
  const [newMode, setNewMode] = createSignal<"allow" | "deny" | "ask">("allow")

  createEffect(() => {
    setRules(extractPermissionRules(props.config?.permission))
  })

  const addRule = () => {
    const glob = newGlob().trim()
    if (!glob) return
    setRules((list) => [...list, { glob, mode: newMode() }])
    setNewGlob("")
    setNewMode("allow")
  }

  const updateMode = (idx: number, mode: "allow" | "deny" | "ask") => {
    setRules((list) => list.map((r, i) => (i === idx ? { ...r, mode } : r)))
  }

  const removeRule = (idx: number) => {
    setRules((list) => list.filter((_, i) => i !== idx))
  }

  const save = () => void props.onSave("permission", buildPermissionConfig(rules(), props.config?.permission))

  return (
    <div class="launcher-configedit__subform">
      <p class="launcher-configedit__label">权限规则（glob 模式 + allow/deny/ask）</p>
      <For each={rules()}>
        {(rule, idx) => (
          <div class="launcher-configedit__kv-row">
            <input
              class="launcher-configedit__input"
              value={rule.glob}
              onInput={(e) =>
                setRules((list) => list.map((r, i) => (i === idx() ? { ...r, glob: e.currentTarget.value } : r)))
              }
              placeholder="如: src/**"
            />
            <select
              class="launcher-configedit__input"
              value={rule.mode}
              onChange={(e) => updateMode(idx(), e.currentTarget.value as "allow" | "deny" | "ask")}
            >
              <option value="allow">allow</option>
              <option value="deny">deny</option>
              <option value="ask">ask</option>
            </select>
            <button
              class="launcher-btn launcher-btn--small"
              onClick={() => removeRule(idx())}
              aria-label="删除规则"
            >
              删除
            </button>
          </div>
        )}
      </For>
      <div class="launcher-configedit__kv-row">
        <input
          class="launcher-configedit__input"
          value={newGlob()}
          onInput={(e) => setNewGlob(e.currentTarget.value)}
          placeholder="新规则 glob 模式"
        />
        <select
          class="launcher-configedit__input"
          value={newMode()}
          onChange={(e) => setNewMode(e.currentTarget.value as "allow" | "deny" | "ask")}
        >
          <option value="allow">allow</option>
          <option value="deny">deny</option>
          <option value="ask">ask</option>
        </select>
        <button class="launcher-btn launcher-btn--small" onClick={addRule}>
          添加规则
        </button>
      </div>
      <button class="launcher-btn launcher-btn--primary" disabled={props.saving} onClick={save}>
        {props.saving ? "保存中…" : "保存权限规则"}
      </button>
    </div>
  )
}

/**
 * 工单 03：按文件分别编辑的表单。
 *
 * - opencode.json/opencode.jsonc/config.json：显示该文件实际存在的 model/plugins/provider/agent/mcp/permission 字段。
 *   保存时：读全量 → 改对应字段 → 写全量（保留其他字段如 instructions/theme）。
 * - auth.json：API key 表单（不展示现有 key，只提供设置/修改输入）。
 * - tui.json：提示「打开源文件编辑」（不走表单）。
 * - unknown：提示「打开源文件编辑」。
 *
 * 保存触发 auto snapshot（main 端 launcher:save-config-file handler 内置）。
 * 保存后提示重启生效（配置不热加载）。
 */
function ConfigFileForm(props: { file: LauncherConfigFileInfo }) {
  const kind: ConfigFileKind = detectConfigFileKind(props.file.name)
  const [config, setConfig] = createSignal<Record<string, unknown> | null>(null)
  const [saving, setSaving] = createSignal(false)
  const [message, setMessage] = createSignal<{ kind: "ok" | "err"; text: string } | null>(null)
  // opencode.json 表单字段输入
  const [modelValue, setModelValue] = createSignal("")
  const [pluginsValue, setPluginsValue] = createSignal("")
  // auth.json 表单字段输入
  const [authProviderID, setAuthProviderID] = createSignal("")
  const [authKey, setAuthKey] = createSignal("")

  const fields = (): ConfigFormFields => pickFormFields(config())

  const refresh = async () => {
    const cfg = await window.api.launcherReadConfigFile(props.file.path)
    setConfig(cfg)
    if (cfg && typeof cfg.model === "string") setModelValue(cfg.model)
    if (cfg && Array.isArray(cfg.plugins)) setPluginsValue((cfg.plugins as unknown[]).join(", "))
  }
  onMount(() => void refresh())

  // S4 修复：保存后不调 refresh()，避免重置其他字段的未保存编辑。
  // 只更新 config signal（用于 fields() 计算），不重置 modelValue/pluginsValue 等输入。
  const saveField = async (key: string, value: unknown) => {
    setSaving(true)
    setMessage(null)
    try {
      const current = await window.api.launcherReadConfigFile(props.file.path)
      const merged = mergeConfigField(current, key, value)
      await window.api.launcherSaveConfigFile(props.file.path, merged)
      // 不调 refresh()，避免重置其他字段未保存编辑
      // 只更新 config signal（用于 fields() 计算）
      setConfig(merged)
      setMessage({ kind: "ok", text: `已保存 ${key}，重启 OpenCode 后生效` })
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  // S3 修复：空值时从 config 删除 model key，而非写入 model: null。
  const saveModel = async () => {
    const trimmed = modelValue().trim()
    if (!trimmed) {
      // 删除 model 字段
      const current = await window.api.launcherReadConfigFile(props.file.path)
      if (current) {
        const merged = { ...current }
        delete merged.model
        setSaving(true)
        try {
          await window.api.launcherSaveConfigFile(props.file.path, merged)
          setConfig(merged)
          setMessage({ kind: "ok", text: "已删除 model，重启 OpenCode 后生效" })
        } catch (err) {
          setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) })
        } finally {
          setSaving(false)
        }
      }
      return
    }
    void saveField("model", trimmed)
  }

  const savePlugins = () => {
    const trimmed = pluginsValue()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    void saveField("plugins", trimmed)
  }

  const saveAuthKey = async () => {
    const providerID = authProviderID().trim()
    const key = authKey().trim()
    if (!providerID) {
      setMessage({ kind: "err", text: "厂商 ID 必填" })
      return
    }
    if (!key) {
      setMessage({ kind: "err", text: "API Key 必填" })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      await window.api.launcherSaveAuthKey(providerID, key)
      setAuthProviderID("")
      setAuthKey("")
      setMessage({ kind: "ok", text: `已保存 ${providerID} 的 API Key，重启 OpenCode 后生效` })
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  // S5 修复：暴露删除 API key 功能。
  const deleteAuthKey = async () => {
    const providerID = authProviderID().trim()
    if (!providerID) {
      setMessage({ kind: "err", text: "请输入要删除的厂商 ID" })
      return
    }
    setSaving(true)
    try {
      await window.api.launcherSaveAuthKey(providerID, null)
      setAuthProviderID("")
      setAuthKey("")
      setMessage({ kind: "ok", text: `已删除 ${providerID} 的 API Key` })
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  const openSource = () => openFileHandler(window.api.openLocalFile, props.file.path)()

  return (
    <div class="launcher-configedit__form">
      <Show when={message()}>
        {(msg) => (
          <p
            class="launcher-configedit__empty"
            style={{ color: msg().kind === "ok" ? "var(--jx-success)" : "var(--jx-error)" }}
          >
            {msg().text}
          </p>
        )}
      </Show>
      <Switch>
        {/* auth.json：API key 表单（不展示现有 key） */}
        <Match when={isAuthKeyForm(kind)}>
          <p class="launcher-configedit__empty">设置或修改 API Key（出于安全考虑，不展示现有 key）</p>
          <label class="launcher-configedit__field">
            <span class="launcher-configedit__label">厂商标识</span>
            <input
              class="launcher-configedit__input"
              value={authProviderID()}
              onInput={(e) => setAuthProviderID(e.currentTarget.value)}
              placeholder="如: deepseek"
            />
          </label>
          <label class="launcher-configedit__field">
            <span class="launcher-configedit__label">API Key</span>
            <input
              class="launcher-configedit__input"
              type="password"
              value={authKey()}
              onInput={(e) => setAuthKey(e.currentTarget.value)}
              placeholder="sk-..."
            />
          </label>
          <button class="launcher-btn launcher-btn--primary" disabled={saving()} onClick={saveAuthKey}>
            {saving() ? "保存中…" : "保存"}
          </button>
          <button class="launcher-btn launcher-btn--small launcher-btn--danger" disabled={saving()} onClick={deleteAuthKey}>
            删除 API Key
          </button>
        </Match>
        {/* tui.json / unknown：提示「打开源文件编辑」 */}
        <Match when={isSourceOnlyForm(kind) || kind === "unknown"}>
          <p class="launcher-configedit__empty">此文件建议直接打开源文件编辑</p>
          <button class="launcher-btn launcher-btn--small" onClick={openSource}>
            打开源文件
          </button>
        </Match>
        {/* opencode.json/opencode.jsonc/config.json：按实际有的字段渲染 */}
        <Match when={kind === "opencode"}>
          <Show when={!config()}>
            <p class="launcher-configedit__empty">文件为空或解析失败</p>
          </Show>
          <Show when={config()}>
            <Show when={fields().model}>
              <label class="launcher-configedit__field">
                <span class="launcher-configedit__label">model（当前模型）</span>
                <input
                  class="launcher-configedit__input"
                  value={modelValue()}
                  onInput={(e) => setModelValue(e.currentTarget.value)}
                  placeholder="如: deepseek-chat"
                />
                <button
                  class="launcher-btn launcher-btn--small"
                  disabled={saving()}
                  onClick={saveModel}
                >
                  保存 model
                </button>
              </label>
            </Show>
            <Show when={fields().plugins}>
              <label class="launcher-configedit__field">
                <span class="launcher-configedit__label">plugins（逗号分隔）</span>
                <input
                  class="launcher-configedit__input"
                  value={pluginsValue()}
                  onInput={(e) => setPluginsValue(e.currentTarget.value)}
                  placeholder="如: @opencode-ai/plugin-x, ./local-plugin"
                />
                <button
                  class="launcher-btn launcher-btn--small"
                  disabled={saving()}
                  onClick={savePlugins}
                >
                  保存 plugins
                </button>
              </label>
            </Show>
            <Show when={fields().provider}>
              <p class="launcher-configedit__empty">
                provider 字段已存在——建议通过下方「LLM API 快捷配置」或打开源文件编辑
              </p>
            </Show>
            <Show when={fields().agent}>
              <AgentModelForm config={config()} saving={saving()} onSave={saveField} />
            </Show>
            <Show when={fields().mcp}>
              <McpServerForm config={config()} saving={saving()} onSave={saveField} />
            </Show>
            <Show when={fields().permission}>
              <PermissionRuleForm config={config()} saving={saving()} onSave={saveField} />
            </Show>
            {/* 只显示该文件实际有的字段——没有字段时不显示任何表单 */}
            <Show
              when={
                !fields().model &&
                !fields().plugins &&
                !fields().provider &&
                !fields().agent &&
                !fields().mcp &&
                !fields().permission
              }
            >
              <p class="launcher-configedit__empty">
                此文件无可编辑字段（仅含 $schema/instructions/theme 等非表单字段）
              </p>
            </Show>
            {/* 保留其他字段提示 */}
            <Show when={fields().instructions || fields().theme}>
              <p class="launcher-configedit__empty">
                instructions/theme 等字段保留不变（保存只改对应字段）
              </p>
            </Show>
          </Show>
        </Match>
      </Switch>
    </div>
  )
}

/**
 * 工单 04：.opencode/ 下目录节点（agents/skills/plugins/themes/command）。
 *
 * - 显示为可展开节点，展开后列出目录内文件。
 * - 点内部文件「打开源文件」调系统编辑器打开。
 * - 不铺平到顶层清单（保持目录节点折叠形态）。
 */
function OpencodeSubdirNode(props: {
  name: string
  path: string
  expanded: boolean
  onToggle: () => void
  onOpenFile: (path: string) => void
}) {
  const [entries, setEntries] = createSignal<LauncherDirectoryEntry[]>([])

  const refresh = async () => {
    if (!props.expanded) return
    const list = await window.api.launcherListDirectoryEntries(props.path)
    setEntries(list)
  }
  // 展开时加载目录内容
  createEffect(() => {
    if (props.expanded) void refresh()
  })

  return (
    <div class="launcher-configedit__file">
      <div class="launcher-configedit__file-row">
        <button
          class="launcher-configedit__expand"
          aria-label={props.expanded ? "折叠" : "展开"}
          onClick={props.onToggle}
        >
          {props.expanded ? "▼" : "▶"}
        </button>
        <span class="launcher-configedit__filename">{props.name}/</span>
      </div>
      <Show when={props.expanded}>
        <div class="launcher-configedit__expand-content">
          <Show
            when={entries().length > 0}
            fallback={<p class="launcher-configedit__placeholder">空目录</p>}
          >
            <ul class="launcher-configedit__subdir-list">
              <For each={entries()}>
                {(entry) => (
                  <li class="launcher-configedit__subdir-entry">
                    <span class="launcher-configedit__subdir-name">
                      {entry.isDirectory ? `${entry.name}/` : entry.name}
                    </span>
                    <Show when={!entry.isDirectory}>
                      <button
                        class="launcher-btn launcher-btn--small"
                        onClick={() => props.onOpenFile(entry.path)}
                      >
                        打开源文件
                      </button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function LlmApiPanel() {
  const [form, setForm] = createSignal<LlmApiFormState>({
    providerID: "",
    baseURL: "",
    apiKey: "",
    modelName: "",
  })
  const [saving, setSaving] = createSignal(false)
  const [message, setMessage] = createSignal<{ kind: "ok" | "err"; text: string } | null>(null)

  const setField = (key: keyof LlmApiFormState, value: string) => {
    setForm({ ...form(), [key]: value })
    setMessage(null)
  }

  const save = async () => {
    const { errors, result } = validateLlmApiForm(form())
    if (!result) {
      const first = Object.values(errors).find(Boolean)
      setMessage({ kind: "err", text: first ?? "表单填写有误" })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const cfg = await window.api.launcherReadConfig()
      const merged = mergeProviderConfig(cfg, result.providerID, result.providerConfig)
      // Write auth.json BEFORE config so the post-save snapshot (triggered by
      // launcherSaveConfig) captures a consistent state — both the provider
      // entry in opencode.json and the key in auth.json. If config save failed
      // after auth write, the orphaned key is harmless; the reverse order would
      // snapshot a config whose auth.json hasn't been updated yet.
      if (result.authKey) {
        await window.api.launcherSaveAuthKey(result.providerID, result.authKey)
      }
      await window.api.launcherSaveConfig(merged)
      setMessage({ kind: "ok", text: `已保存 ${result.providerID}，重启 OpenCode 后生效` })
      setForm({ providerID: "", baseURL: "", apiKey: "", modelName: "" })
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div class="launcher-configedit">
      <div class="launcher-configedit__head">
        <h2 class="launcher-configedit__title">LLM API 快捷配置</h2>
      </div>
      <div class="launcher-configedit__form">
        <p class="launcher-configedit__empty" style={{ "margin-bottom": "var(--jx-space-2)" }}>
          填写 OpenAI 兼容厂商信息，保存后写入 opencode.json + auth.json。
        </p>
        <label class="launcher-configedit__field">
          <span class="launcher-configedit__label">厂商标识</span>
          <input
            class="launcher-configedit__input"
            value={form().providerID}
            onInput={(e) => setField("providerID", e.currentTarget.value)}
            placeholder="如: deepseek"
          />
        </label>
        <label class="launcher-configedit__field">
          <span class="launcher-configedit__label">Base URL</span>
          <input
            class="launcher-configedit__input"
            value={form().baseURL}
            onInput={(e) => setField("baseURL", e.currentTarget.value)}
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label class="launcher-configedit__field">
          <span class="launcher-configedit__label">API Key</span>
          <input
            class="launcher-configedit__input"
            type="password"
            value={form().apiKey}
            onInput={(e) => setField("apiKey", e.currentTarget.value)}
            placeholder="sk-..."
          />
        </label>
        <label class="launcher-configedit__field">
          <span class="launcher-configedit__label">模型名</span>
          <input
            class="launcher-configedit__input"
            value={form().modelName}
            onInput={(e) => setField("modelName", e.currentTarget.value)}
            placeholder="如: deepseek-chat"
          />
        </label>
        <Show when={message()}>
          {(msg) => (
            <p
              class="launcher-configedit__empty"
              style={{ color: msg().kind === "ok" ? "var(--jx-success)" : "var(--jx-error)" }}
            >
              {msg().text}
            </p>
          )}
        </Show>
        <button class="launcher-btn launcher-btn--primary" disabled={saving()} onClick={save}>
          {saving() ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  )
}

function PluginManagementPanel() {
  const [pluginInfos, setPluginInfos] = createSignal<LauncherPluginInfo[]>([])
  const [newSpec, setNewSpec] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const refresh = async () => {
    try {
      setPluginInfos(await window.api.launcherListPlugins())
    } catch {
      setPluginInfos([])
    }
  }
  onMount(() => void refresh())
  const install = async () => {
    const spec = newSpec().trim()
    if (!spec) return
    setBusy(true)
    try {
      await window.api.launcherInstallPlugin(spec)
      setNewSpec("")
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  const uninstall = async (spec: string) => {
    setBusy(true)
    try {
      await window.api.launcherUninstallPlugin(spec)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="launcher-pluginmgr">
      <h2 class="launcher-pluginmgr__title">插件管理</h2>
      <div class="launcher-pluginmgr__install">
        <input
          class="launcher-pluginmgr__input"
          placeholder="npm spec 或本地路径"
          value={newSpec()}
          onInput={(e) => setNewSpec(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void install()
          }}
        />
        <button class="launcher-btn launcher-btn--small" disabled={busy()} onClick={install}>
          安装
        </button>
      </div>
      {pluginInfos().length === 0 ? (
        <p class="launcher-pluginmgr__empty">无插件</p>
      ) : (
        <ul class="launcher-pluginmgr__list">
          {pluginInfos().map((p) => (
            <li class="launcher-pluginmgr__item">
              <span class="launcher-pluginmgr__spec">{p.spec}</span>
              <span class={`launcher-pluginmgr__source launcher-pluginmgr__source--${p.source}`}>{p.source}</span>
              {p.version && <span class="launcher-pluginmgr__version">{p.version}</span>}
              <button
                class="launcher-btn launcher-btn--mini launcher-btn--danger"
                disabled={busy()}
                onClick={() => uninstall(p.spec)}
              >
                卸载
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function UpdatePanel() {
  const [updateState, setUpdateState] = createSignal<{ status: string; version?: string }>({ status: "idle" })
  const [updating, setUpdating] = createSignal(false)
  const check = async () => {
    setUpdateState({ status: "checking" })
    try {
      const state = await window.api.updater.check()
      setUpdateState({ status: state.status, version: "version" in state ? state.version : undefined })
    } catch {
      setUpdateState({ status: "error" })
    }
  }
  const install = async () => {
    setUpdating(true)
    try {
      // main 端保证更新前自动 snapshot（ADR-023 D13）
      await window.api.launcherInstallUpdate()
    } finally {
      setUpdating(false)
    }
  }
  const statusText = () => {
    const s = updateState()
    if (s.status === "checking") return "检查中…"
    if (s.status === "up-to-date") return "已是最新版本"
    if (s.status === "ready") return `新版本 ${s.version} 可用`
    if (s.status === "error") return "检查失败"
    if (s.status === "disabled") return "更新已禁用"
    return "点击检查更新"
  }

  return (
    <div class="launcher-update">
      <h2 class="launcher-update__title">版本更新</h2>
      <p class="launcher-update__status">{statusText()}</p>
      {updateState().status === "ready" && (
        <button class="launcher-btn launcher-btn--primary" disabled={updating()} onClick={install}>
          {updating() ? "安装中…" : "下载并安装"}
        </button>
      )}
      {updateState().status !== "ready" && updateState().status !== "checking" && (
        <button class="launcher-btn launcher-btn--small" onClick={check}>
          检查更新
        </button>
      )}
      <p class="launcher-update__hint">更新前自动 snapshot，更新后起不来可回滚</p>
    </div>
  )
}

function PlaceholderCards() {
  const cards = [{ title: "版本更新", desc: "检查 / 下载 / 更新前 snapshot（工单 11）" }]
  return (
    <div class="launcher-placeholder">
      {cards.map((card) => (
        <div class="launcher-card">
          <h3 class="launcher-card__title">{card.title}</h3>
          <p class="launcher-card__desc">{card.desc}</p>
        </div>
      ))}
    </div>
  )
}

function Statusbar() {
  const status = sidecarStatus()
  return (
    <footer class="launcher-statusbar">
      <span>
        <span class={`launcher-statusbar__dot launcher-statusbar__dot--${status}`} />
        {statusLabel[status]}
      </span>
      <span>launcher v0.1.0</span>
    </footer>
  )
}

function LauncherShell() {
  onMount(() => {
    void window.api.launcherGetStatus().then((res) => {
      setSidecarStatus(res.status)
      setLastError(res.error)
    })
    window.api.onLauncherStatusChange((status, error) => {
      setSidecarStatus(status)
      setLastError(error)
    })
    window.api.onLauncherRollbackProgress((p) => setRollbackProgress(p))
    window.api.onLauncherPluginLogs((logs) => setPluginLogs(logs))
    window.api.onLauncherPluginLoads((entries) => setPluginLoads(entries))
    window.api.onLauncherImportProgress((phase) => setImportPhase(phase))
    void window.api.launcherGetPluginLogs().then(setPluginLogs)
    void window.api.launcherGetPluginLoads().then(setPluginLoads)
    void window.api.launcherGetErrorSnippets().then(setErrorSnippets)
    void window.api.launcherGetDiagnosticsMeta().then(setDiagnosticsMeta)
    void refreshSnapshots()
  })

  return (
    <div class="launcher-shell">
      <AtmosphereLayer />
      <Titlebar />
      <main class="launcher-body">
        <SideNav />
        <div class="launcher-content">
          <PageRouter />
        </div>
      </main>
      <Statusbar />
    </div>
  )
}

/* 墨染氛围层：远山墨晕 + 月光 + 金粉粒子。pointer-events: none。
   prefers-reduced-motion 下动画与粒子由 CSS 关闭。 */
function AtmosphereLayer() {
  return (
    <div class="launcher-atmosphere" aria-hidden="true">
      <div class="launcher-atmosphere__mountains" />
      <div class="launcher-atmosphere__moon" />
      <div class="launcher-atmosphere__particles">
        <For each={Array.from({ length: 12 })}>
          {() => <span class="launcher-atmosphere__particle" />}
        </For>
      </div>
    </div>
  )
}

/* hash 路由：6 页导航。初始页 #control。 */
const NAV_PAGES = [
  { hash: "#control", label: "启动控制", icon: ControlIcon },
  { hash: "#settings", label: "偏好设置", icon: SettingsIcon },
  { hash: "#safemode", label: "安全模式", icon: ShieldIcon },
  { hash: "#config", label: "配置", icon: ConfigIcon },
  { hash: "#snapshots", label: "快照", icon: SnapshotIcon },
  { hash: "#plugins", label: "插件", icon: PluginIcon },
] as const

function currentHash(): string {
  if (typeof location === "undefined") return "#control"
  const h = location.hash
  if (!h || !NAV_PAGES.some((p) => p.hash === h)) return "#control"
  return h
}

const [activeHash, setActiveHash] = createSignal<string>(currentHash())

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => setActiveHash(currentHash()))
}

function navigate(hash: string) {
  if (typeof location !== "undefined") location.hash = hash
  setActiveHash(hash)
}

/* 侧边导航：唐风卷轴签风格，6 入口 + 快照角标 */
function SideNav() {
  return (
    <nav class="launcher-nav" aria-label="启动器主导航">
      <div class="launcher-nav__brand">墨染启动器</div>
      <For each={NAV_PAGES}>
        {(page) => {
          const Icon = page.icon
          const isCurrent = () => activeHash() === page.hash
          return (
            <button
              class={`launcher-nav__item ${isCurrent() ? "launcher-nav__item--current" : ""}`}
              aria-current={isCurrent() ? "page" : undefined}
              aria-label={page.label}
              onClick={() => navigate(page.hash)}
            >
              <span class="launcher-nav__icon">
                <Icon />
              </span>
              <span class="launcher-nav__label">{page.label}</span>
              <Show when={page.hash === "#snapshots" && snapshots().length > 0}>
                <span class="launcher-nav__badge" aria-label={`${snapshots().length} 个快照`}>
                  {snapshots().length}
                </span>
              </Show>
            </button>
          )
        }}
      </For>
    </nav>
  )
}

/* 页面路由：按 activeHash 渲染对应页组件（响应式 Switch/Match） */
function PageRouter() {
  return (
    <Switch fallback={<ControlPage />}>
      <Match when={activeHash() === "#control"}>
        <ControlPage />
      </Match>
      <Match when={activeHash() === "#settings"}>
        <SettingsPage />
      </Match>
      <Match when={activeHash() === "#safemode"}>
        <SafeModePage />
      </Match>
      <Match when={activeHash() === "#config"}>
        <ConfigPage />
      </Match>
      <Match when={activeHash() === "#snapshots"}>
        <SnapshotsPage />
      </Match>
      <Match when={activeHash() === "#plugins"}>
        <PluginsPage />
      </Match>
    </Switch>
  )
}

/* 6 个导航图标：唐风线描，24 网格，stroke 1.8，currentColor */
function ControlIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2l8 3v7c0 5-3.5 8-8 10-4.5-2-8-5-8-10V5z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

function ConfigIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12" />
    </svg>
  )
}

function SnapshotIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function PluginIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h6v4h6V7h6v10H3z" />
      <path d="M9 11v2M15 11v2" />
    </svg>
  )
}

/* === 6 个页组件 === */

/* 工单 03：启动控制主舞台页 */
function ControlPage() {
  return (
    <div class="launcher-page">
      <h2 class="launcher-page__title">启动控制</h2>
      <p class="launcher-page__subtitle">中央启动舞台——状态即视觉，一眼即得。</p>
      <ControlPanel />
      <UpdatePanel />
      <ResourcePanel />
    </div>
  )
}

/* 工单 08：偏好设置页 */
function SettingsPage() {
  return (
    <div class="launcher-page">
      <h2 class="launcher-page__title">偏好设置</h2>
      <p class="launcher-page__subtitle">打开启动器后是否直接启动 OpenCode。</p>
      <SettingsPanel />
    </div>
  )
}

/* 工单 06：安全模式页 */
function SafeModePage() {
  return (
    <div class="launcher-page">
      <h2 class="launcher-page__title">安全模式</h2>
      <p class="launcher-page__subtitle">事故排查全套——跳过插件、逐个启停、加载详情、诊断日志与报告。</p>
      <SafeModePanel />
    </div>
  )
}

/* 工单 05：配置页 */
function ConfigPage() {
  return (
    <div class="launcher-page">
      <h2 class="launcher-page__title">配置</h2>
      <p class="launcher-page__subtitle">打开配置文件、模型与插件快捷编辑、LLM API 快捷配置。</p>
      <ConfigEditPanel />
      <LlmApiPanel />
    </div>
  )
}

/* 工单 04：快照页时间线 */
function SnapshotsPage() {
  return (
    <div class="launcher-page">
      <h2 class="launcher-page__title">快照时间线</h2>
      <p class="launcher-page__subtitle">配置回滚点——自动/手动、tag、导入导出、回滚、备注。</p>
      <SnapshotPanel />
    </div>
  )
}

/* 工单 07：插件页 */
function PluginsPage() {
  return (
    <div class="launcher-page">
      <h2 class="launcher-page__title">插件管理</h2>
      <p class="launcher-page__subtitle">安装、卸载、查看来源与版本。</p>
      <PluginManagementPanel />
    </div>
  )
}

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("launcher root not found")
}

render(() => <LauncherShell />, root!)
