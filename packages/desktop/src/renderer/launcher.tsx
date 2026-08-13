import { render } from "solid-js/web"
import { createSignal, onMount, Show, For, Switch, Match } from "solid-js"
import type {
  OpencodeStatus,
  LauncherSnapshotMeta,
  RollbackProgress,
  LauncherPluginInfo,
  LauncherPluginLogEntry,
  LauncherPluginLoadEntry,
  LauncherErrorSnippet,
  LauncherDiagnosticsMeta,
  LauncherToolStatus,
} from "../preload/types"
import { mergeProviderConfig, validateLlmApiForm, type LlmApiFormState } from "./llm-api-form"
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
  const [config, setConfig] = createSignal<Record<string, unknown> | null>(null)
  const [model, setModel] = createSignal("")
  const [plugins, setPlugins] = createSignal<string[]>([])
  const [saving, setSaving] = createSignal(false)
  const refresh = async () => {
    const cfg = await window.api.launcherReadConfig()
    setConfig(cfg)
    if (cfg) {
      setModel(typeof cfg.model === "string" ? cfg.model : "")
      setPlugins(
        Array.isArray(cfg.plugins)
          ? (cfg.plugins as unknown[])
              .map((p) => (typeof p === "string" ? p : ((p as { id?: string })?.id ?? "")))
              .filter(Boolean)
          : [],
      )
    }
  }
  onMount(() => void refresh())
  const openConfigFile = async () => {
    const path = await window.api.launcherGetConfigPath()
    if (path) window.api.openLocalFile(path)
  }
  const save = async () => {
    setSaving(true)
    try {
      const cfg = config() ?? {}
      cfg.model = model()
      cfg.plugins = plugins()
      await window.api.launcherSaveConfig(cfg)
      await refresh()
    } finally {
      setSaving(false)
    }
  }
  const removePlugin = (spec: string) => setPlugins(plugins().filter((p) => p !== spec))

  return (
    <div class="launcher-configedit">
      <div class="launcher-configedit__head">
        <h2 class="launcher-configedit__title">配置编辑</h2>
        <button class="launcher-btn launcher-btn--small" onClick={openConfigFile}>
          打开配置文件
        </button>
      </div>
      {config() === null ? (
        <p class="launcher-configedit__empty">无 config 文件（点"打开配置文件"创建）</p>
      ) : (
        <div class="launcher-configedit__form">
          <label class="launcher-configedit__field">
            <span class="launcher-configedit__label">当前模型</span>
            <input
              class="launcher-configedit__input"
              value={model()}
              onInput={(e) => setModel(e.currentTarget.value)}
              placeholder="如: claude-sonnet-4"
            />
          </label>
          <div class="launcher-configedit__field">
            <span class="launcher-configedit__label">插件列表</span>
            {plugins().length === 0 ? (
              <span class="launcher-configedit__empty">无插件</span>
            ) : (
              <ul class="launcher-configedit__plugins">
                {plugins().map((spec) => (
                  <li class="launcher-configedit__plugin">
                    <span class="launcher-configedit__spec">{spec}</span>
                    <button
                      class="launcher-btn launcher-btn--mini launcher-btn--danger"
                      onClick={() => removePlugin(spec)}
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button class="launcher-btn launcher-btn--primary" disabled={saving()} onClick={save}>
            {saving() ? "保存中…" : "保存"}
          </button>
        </div>
      )}
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

// 工单 10：内置工具一键安装（RTK + codebase-memory-mcp，ADR-033）。
// 两者均不随安装包分发，由启动器检测二进制存在 + 版本，并提供安装入口。
function ToolsPanel() {
  const [tools, setTools] = createSignal<LauncherToolStatus[]>([])
  const [busy, setBusy] = createSignal(false)
  const [rtkMsg, setRtkMsg] = createSignal<string | null>(null)
  const [codemapMsg, setCodemapMsg] = createSignal<string | null>(null)
  const refresh = async () => {
    try {
      setTools(await window.api.launcherGetTools())
    } catch {
      setTools([])
    }
  }
  onMount(() => void refresh())
  const installRtk = async () => {
    setBusy(true)
    setRtkMsg(null)
    try {
      const res = await window.api.launcherInstallRtk()
      setRtkMsg(res.ok ? `已安装到 ${res.binaryPath}，$PROFILE hook 已写入（${res.profilePath}）` : res.error ?? "安装失败")
      await refresh()
    } catch (err) {
      setRtkMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const installCodemap = async () => {
    setBusy(true)
    setCodemapMsg(null)
    try {
      const res = await window.api.launcherInstallCodemap()
      setCodemapMsg(
        res.ok
          ? `已写入 mcp 配置 ${res.mcpName} → ${res.configPath ?? "opencode.json"}（重启 OpenCode 后生效）`
          : res.error ?? "安装失败",
      )
      await refresh()
    } catch (err) {
      setCodemapMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const rtk = tools().find((t) => t.name === "rtk")
  const codemap = tools().find((t) => t.name === "codebase-memory-mcp")

  return (
    <div class="launcher-tools">
      <h2 class="launcher-tools__title">内置工具</h2>
      <p class="launcher-tools__hint">RTK 与 codebase-memory-mcp 为外部二进制，不随安装包分发，在此一键安装（ADR-033）。</p>

      <div class="launcher-tools__item">
        <div class="launcher-tools__head">
          <span class="launcher-tools__name">RTK（命令行输出精简器）</span>
          <span class={`launcher-tools__state ${rtk?.present ? "launcher-tools__state--ok" : ""}`}>
            {rtk?.present ? (rtk.version ? `已安装 v${rtk.version}` : "已安装") : "未安装"}
          </span>
        </div>
        <p class="launcher-tools__desc">
          过滤进度条/重复日志，实测省 75%–90% token。安装 = 装二进制 + 写入 <code>$PROFILE</code> hook。
        </p>
        <button class="launcher-btn launcher-btn--small" disabled={busy()} onClick={installRtk}>
          {rtk?.present ? "重新安装" : "一键安装"}
        </button>
        <pre class="launcher-tools__usage">{`# 手动管道用法（hook 仅对手动命令生效，agent 输出不一定经过）：
git status | rtk
npm test 2>&1 | rtk`}</pre>
        {rtkMsg() && <p class="launcher-tools__msg">{rtkMsg()}</p>}
      </div>

      <div class="launcher-tools__item">
        <div class="launcher-tools__head">
          <span class="launcher-tools__name">codebase-memory-mcp（代码知识图谱）</span>
          <span class={`launcher-tools__state ${codemap?.present ? "launcher-tools__state--ok" : ""}`}>
            {codemap?.present ? (codemap.version ? `已安装 v${codemap.version}` : "已安装") : "未安装"}
          </span>
        </div>
        <p class="launcher-tools__desc">
          158 语言 AST 索引、调用链追踪。安装 = 装二进制 + 写入 opencode 原生 mcp 配置。
        </p>
        <button class="launcher-btn launcher-btn--small" disabled={busy()} onClick={installCodemap}>
          {codemap?.present ? "重新安装" : "一键安装"}
        </button>
        {codemapMsg() && <p class="launcher-tools__msg">{codemapMsg()}</p>}
      </div>
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

/* 工单 07：插件页；工单 10：内置工具一键安装入口 */
function PluginsPage() {
  return (
    <div class="launcher-page">
      <h2 class="launcher-page__title">插件与工具</h2>
      <p class="launcher-page__subtitle">插件管理，以及 RTK / codebase-memory-mcp 内置工具一键安装。</p>
      <PluginManagementPanel />
      <ToolsPanel />
    </div>
  )
}

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("launcher root not found")
}

render(() => <LauncherShell />, root!)
