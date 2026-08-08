import { createSignal, createEffect, onCleanup, Show, For, on } from "solid-js"
import { useServerSDK } from "@/context/server-sdk"
import { useTheme } from "@opencode-ai/ui/theme/context"
import {
  reduceCharacter,
  initialCharacterStatus,
  type CharacterEvent,
  type CharacterState,
  type CharacterStatus,
} from "@/components/character-state"
import { JiangxiaoIcon } from "@/components/jiangxiao-icons"

/**
 * 姜晓角色悬浮层（唐风二次元主题）
 * - 固定于界面左边缘的悬浮层（position:fixed + inset-inline-start:0），纵向铺满，不占布局空间
 * - 10 状态 WebP 动画由 character-state reducer 驱动，全局会话事件归一化后喂入
 * - 交叉淡入淡出切换（0.1s），高优先级打断低优先级
 * - 点击角色弹气泡 + 提示音
 * - 仅桌面端显示（由挂载处 isDesktop() 控制）
 * - 纯视觉组件，不改任何功能逻辑
 */

const VIDEO_STATES: CharacterState[] = [
  "idle",
  "thinking",
  "thinking2",
  "replying",
  "working",
  "error",
  "welcome",
  "complete",
  "permission",
  "waiting",
]

// 状态对应的角色台词（CONTEXT.md 词汇表定稿表，ADR-007）
const STATUS_TEXT: Record<CharacterState, string> = {
  idle: "大人，有何吩咐？",
  thinking: "容姜晓思量片刻……",
  thinking2: "正在阅卷，稍候。",
  replying: "为大人细细道来。",
  working: "遵命，这就去办。",
  error: "此事有蹊跷，容我再查。",
  welcome: "大人来了，姜晓候久。",
  complete: "此事已毕，大人过目。",
  permission: "此事需大人首肯。",
  waiting: "姜晓静候大人示下。",
}

const IDLE_LINES = ["大人，有何吩咐？", "姜晓在此候命。", "需要我做些什么？", "静候您的指令。"]

// tick 间隔：驱动 reducer 的 thinking2 超时、complete/welcome 延时切待机
const TICK_INTERVAL_MS = 500
// crossfade 时长（工单 03：300ms → 0.1s）
const CROSSFADE_MS = 100

// ---------- 工单 05：角色透明度调节（20%~100%，localStorage 持久化） ----------
// localStorage 简模式工具函数（try/catch + fallback，SSR/隐私模式下静默降级）
function readLS(key: string, fallback: number): number
function readLS(key: string, fallback: boolean): boolean
function readLS(key: string, fallback: number | boolean): number | boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    if (typeof fallback === "boolean") return v === "true"
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}
function writeLS(key: string, value: number | boolean) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // localStorage 不可用时静默
  }
}

const LS_OPACITY = "jiangxiao.character.opacity"
const LS_COLLAPSED = "jiangxiao.character.collapsed"

// 模块级透明度 signal：角色组件与设置面板共享同一 signal，天然同步。
// 初始值从 localStorage 读取并 clamp 到 [0.2, 1]，默认 1（100%）。
const initialOpacity = readLS(LS_OPACITY, 1)
const [characterOpacity, setCharacterOpacityInternal] = createSignal(
  Math.max(0.2, Math.min(1, initialOpacity)),
)

/** 读取当前角色透明度（0.2~1） */
export function getCharacterOpacity() {
  return characterOpacity()
}

/** 设置角色透明度：clamp 到 [0.2, 1]（无完全隐藏），持久化到 localStorage，更新 signal */
export function setCharacterOpacity(v: number) {
  const clamped = Math.max(0.2, Math.min(1, v))
  writeLS(LS_OPACITY, clamped)
  setCharacterOpacityInternal(clamped)
}

// 右键菜单常用档位
const OPACITY_PRESETS = [
  { label: "100%", value: 1 },
  { label: "60%", value: 0.6 },
  { label: "30%", value: 0.3 },
] as const

export function JiangxiaoCharacterSidebar() {
  // 主题守卫（B1）：仅姜晓主题下渲染，避免非姜晓主题下裸 DOM 破坏布局。
  // useTheme() 在 ThemeProvider 内可用（角色组件挂在 layout 根，ThemeProvider 在 AppBaseProviders 中包裹整个 AppInterface）。
  const theme = useTheme()
  const sdk = useServerSDK()
  const [status, setStatus] = createSignal<CharacterStatus>(initialCharacterStatus(Date.now()))
  const [prevDisplay, setPrevDisplay] = createSignal<CharacterState>("idle")
  const [transitioning, setTransitioning] = createSignal(false)
  const [bubble, setBubble] = createSignal<string | undefined>(undefined)
  // 右键菜单位置（undefined 表示关闭）
  const [menu, setMenu] = createSignal<{ x: number; y: number } | undefined>(undefined)
  // 折叠状态（localStorage 持久化，ADR-007：可折叠）
  const [collapsed, setCollapsed] = createSignal(readLS(LS_COLLAPSED, false))

  let fadeTimer: ReturnType<typeof setTimeout> | undefined
  let autoBubbleTimer: ReturnType<typeof setTimeout> | undefined

  // 归一化事件 → reducer → 新状态。reducer 是纯函数，所有时序由 Date.now() 驱动。
  function dispatch(event: CharacterEvent) {
    setStatus(reduceCharacter(status(), event, Date.now()))
  }

  // 状态变化触发 crossfade：记录前一状态并标记 transitioning，CROSSFADE_MS 后清除。
  createEffect(
    on(
      () => status().state,
      (next, prev) => {
        if (prev === undefined || next === prev) return
        setPrevDisplay(prev)
        setTransitioning(true)
        if (fadeTimer) clearTimeout(fadeTimer)
        fadeTimer = setTimeout(() => setTransitioning(false), CROSSFADE_MS)
      },
      { defer: true },
    ),
  )

  // 全局事件订阅：通过 ServerSDK.event.listen 监听所有 directory 的 SDK 事件，归一化为
  // CharacterEvent，无 sessionID/directory 过滤，任何会话活动都驱动角色。用 server-scoped
  // emitter 而非 directory-scoped useSDK，使本组件可在 layout 根（SDKProvider 之外）常驻挂载。
  //
  // ADR-007 有意决策（M2）：事件订阅采用 server-scoped 无 sessionID 过滤，任何会话活动驱动
  // 角色状态切换，以实现全页面常驻陪伴感连续。这是行为语义变化（从 directory-scoped 到
  // server-scoped），非 bug——角色是全局陪伴层，应响应所有会话的活动，而非仅当前会话。
  createEffect(() => {
    const serverSDK = sdk()
    const unsub = serverSDK.event.listen((e) => {
      const evt = e.details
      const type: string = evt.type
      switch (type) {
        case "message.updated": {
          const role = (evt.properties as { info?: { role?: string } }).info?.role
          if (role === "assistant") dispatch({ type: "text_delta" })
          else if (role === "user") dispatch({ type: "prompt_admitted" })
          break
        }
        case "session.status":
          if ((evt.properties as { status: { type: string } }).status.type === "idle") dispatch({ type: "session_idle" })
          break
        case "session.idle":
          dispatch({ type: "session_idle" })
          break
        case "session.error":
          dispatch({ type: "session_error" })
          break
        case "server.connected":
          dispatch({ type: "server_connected" })
          break
        case "session.input.admitted":
          dispatch({ type: "prompt_admitted" })
          break
        case "session.text.delta":
          dispatch({ type: "text_delta" })
          break
        case "session.text.ended":
          dispatch({ type: "text_ended" })
          break
        case "session.tool.called":
          dispatch({ type: "tool_called" })
          break
        case "session.tool.success":
        case "session.tool.failed":
          dispatch({ type: "tool_finished" })
          break
        case "session.execution.succeeded":
        case "session.execution.failed":
        case "session.execution.interrupted":
          dispatch({ type: "execution_finished", pendingTools: false })
          break
        case "permission.asked":
          dispatch({ type: "permission_asked" })
          break
        case "permission.replied":
          dispatch({ type: "permission_replied" })
          break
      }
    })
    onCleanup(unsub)
  })

  // tick：定期驱动 reducer 的时序转换（thinking2 超时切入、complete/welcome 延时切待机）。
  const tickInterval = setInterval(() => dispatch({ type: "tick" }), TICK_INTERVAL_MS)
  onCleanup(() => clearInterval(tickInterval))

  // 右键角色：弹出透明度快捷菜单（100%/60%/30%）
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    // 边界检查：菜单不超出视口
    const MENU_W = 120
    const MENU_H = 130
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - MENU_W),
      y: Math.min(e.clientY, window.innerHeight - MENU_H),
    })
  }

  // 菜单打开期间：点击或右键外部时关闭
  createEffect(() => {
    const m = menu()
    if (!m) return
    const close = () => setMenu(undefined)
    document.addEventListener("click", close)
    document.addEventListener("contextmenu", close)
    onCleanup(() => {
      document.removeEventListener("click", close)
      document.removeEventListener("contextmenu", close)
    })
  })

  // 点击角色：弹气泡 + 提示音
  function handleClick() {
    const line = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)]
    setBubble(line)
    playChime()
    if (autoBubbleTimer) clearTimeout(autoBubbleTimer)
    autoBubbleTimer = setTimeout(() => setBubble(undefined), 3500)
  }

  function playChime() {
    try {
      const ctx = new AudioContext()
      const gain = ctx.createGain()
      gain.gain.value = 0.08
      const osc = ctx.createOscillator()
      osc.type = "sine"
      osc.frequency.setValueAtTime(1244.5, ctx.currentTime) // D#6
      osc.frequency.setValueAtTime(1864.7, ctx.currentTime + 0.12) // A#6
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.6)
      setTimeout(() => ctx.close(), 800)
    } catch {
      // 音频不可用时静默
    }
  }

  onCleanup(() => {
    if (fadeTimer) clearTimeout(fadeTimer)
    if (autoBubbleTimer) clearTimeout(autoBubbleTimer)
  })

  const currentState = () => status().state

  // 折叠/展开切换（持久化到 localStorage）
  function toggleCollapsed() {
    const next = !collapsed()
    setCollapsed(next)
    writeLS(LS_COLLAPSED, next)
  }

  return (
    <Show when={theme.themeId() === "jiangxiao"}>
      <aside
        data-component="jiangxiao-character"
        data-collapsed={collapsed() ? "true" : undefined}
        style={{ opacity: characterOpacity() }}
      onContextMenu={handleContextMenu}
    >
      <div data-slot="character-video" onClick={handleClick}>
        <For each={VIDEO_STATES}>
          {(v) => (
            <img
              src={`/character/${v}.webp`}
              loading={v === "idle" ? "eager" : "lazy"}
              data-state={v}
              data-active={currentState() === v ? true : undefined}
              data-prev={prevDisplay() === v && transitioning() ? true : undefined}
              onError={(e) => {
                // 素材缺失时静默隐藏，不报错
                ;(e.currentTarget as HTMLImageElement).style.display = "none"
              }}
            />
          )}
        </For>
      </div>

      {/* 点击气泡：漫画对白气泡，浮于角色头部上方，带小箭头指向角色，纯装饰穿透 */}
      <Show when={bubble()}>
        <div
          data-slot="character-bubble"
          style={{
            position: "absolute",
            "inset-block-start": "6px",
            "inset-inline-start": "50%",
            transform: "translateX(-50%)",
            "max-width": "200px",
            padding: "8px 12px",
            background: "#0a0a0a",
            border: "1px solid #B8860B",
            "border-radius": "10px",
            color: "#f2ead8",
            "font-size": "12px",
            "text-align": "center",
            "box-shadow": "0 4px 16px rgba(0,0,0,0.6)",
            "pointer-events": "none",
            "user-select": "none",
            "z-index": 3,
          }}
        >
          {bubble()}
          {/* 向下小箭头，指向角色头部 */}
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              "border-left": "6px solid transparent",
              "border-right": "6px solid transparent",
              "border-top": "8px solid #B8860B",
              "pointer-events": "none",
            }}
          />
        </div>
      </Show>

      <div data-slot="character-status">{STATUS_TEXT[currentState()]}</div>

      {/* 折叠钮（chevron 图标，无单字中文；ADR-007） */}
      <button
        type="button"
        data-slot="character-toggle"
        onClick={toggleCollapsed}
        aria-label={collapsed() ? "展开姜晓" : "收起姜晓"}
        title={collapsed() ? "展开姜晓" : "收起姜晓"}
      >
        {/* chevron 图标：折叠时显示向下（展开方向），展开时显示向上（收起方向） */}
        <JiangxiaoIcon name={collapsed() ? "chev-d" : "chev-u"} size={16} />
      </button>

      {/* 工单 05：透明度快捷菜单（右键角色弹出，100%/60%/30% 常用档位） */}
      <Show when={menu()}>
        {(m) => (
          <div data-slot="character-opacity-menu" style={{ left: `${m().x}px`, top: `${m().y}px` }}>
            <For each={OPACITY_PRESETS}>
              {(preset) => (
                <button
                  type="button"
                  onClick={() => {
                    setCharacterOpacity(preset.value)
                    setMenu(undefined)
                  }}
                >
                  {preset.label}
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
    </aside>
    </Show>
  )
}
