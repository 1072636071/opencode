import { createSignal, createEffect, onCleanup, onMount, Show, For, on } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { useServerSDK } from "@/context/server-sdk"
import { useTheme } from "@opencode-ai/ui/theme/context"
import {
  reduceCharacter,
  initialCharacterStatus,
  type CharacterEvent,
  type CharacterState,
  type CharacterStatus,
} from "@/components/character-state"
import { JiangxiaoIcon, type JiangxiaoIconName } from "@/components/jiangxiao-icons"
import {
  clampPosition,
  clearPosition,
  isNarrowViewport,
  loadPosition,
  resolvePosition,
  savePosition,
  type Position,
} from "@/components/character-position"

/**
 * 姜晓角色悬浮层（唐风二次元主题）
 * - 固定于界面左边缘的悬浮层（position:fixed + inset-inline-start:0），纵向铺满，不占布局空间
 * - 10 状态 WebP 动画由 character-state reducer 驱动，全局会话事件归一化后喂入
 * - 交叉淡入淡出切换（0.1s），高优先级打断低优先级
 * - 点击角色弹气泡 + 提示音
 * - 全断点常驻：挂载处（layout/layout-new）无条件渲染，窄屏由 CSS 等比缩小而非隐藏（ADR-007）
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

// 透明度 clamp 到 [0.2, 1]（无完全隐藏）
const clampOpacity = (v: number) => Math.max(0.2, Math.min(1, v))

// 模块级透明度 signal：角色组件与设置面板共享同一 signal，天然同步。
// 初始值从 localStorage 读取并 clamp 到 [0.2, 1]，默认 1（100%）。
const initialOpacity = readLS(LS_OPACITY, 1)
const [characterOpacity, setCharacterOpacityInternal] = createSignal(clampOpacity(initialOpacity))

/** 读取当前角色透明度（0.2~1） */
export function getCharacterOpacity() {
  return characterOpacity()
}

/** 设置角色透明度：clamp 到 [0.2, 1]（无完全隐藏），持久化到 localStorage，更新 signal */
export function setCharacterOpacity(v: number) {
  const clamped = clampOpacity(v)
  writeLS(LS_OPACITY, clamped)
  setCharacterOpacityInternal(clamped)
}

// 右键菜单常用档位
const OPACITY_PRESETS = [
  { label: "100%", value: 1 },
  { label: "60%", value: 0.6 },
  { label: "30%", value: 0.3 },
] as const

// ---------- 工单 07：状态演示面板（char-tools 落地） ----------
// 状态 → 图标映射参照 preview jiangxiao-ui-preview.html 的 STATES 表（idle→leaf、thinking→spark、
// thinking2→read、replying→msg、working→term、error→alert、welcome→enter、complete→check、
// permission→shield、waiting→clock），用到新图标 msg/alert/check/clock。
const DEMO_STATES: { id: CharacterState; label: string; icon: JiangxiaoIconName }[] = [
  { id: "idle", label: "待机", icon: "leaf" },
  { id: "thinking", label: "思考", icon: "spark" },
  { id: "thinking2", label: "思考·看书", icon: "read" },
  { id: "replying", label: "回复", icon: "msg" },
  { id: "working", label: "工作", icon: "term" },
  { id: "error", label: "报错", icon: "alert" },
  { id: "welcome", label: "欢迎", icon: "enter" },
  { id: "complete", label: "完成", icon: "check" },
  { id: "permission", label: "权限", icon: "shield" },
  { id: "waiting", label: "等待输入", icon: "clock" },
]

export function JiangxiaoCharacterSidebar() {
  // 主题守卫（B1）：仅姜晓主题下渲染，避免非姜晓主题下裸 DOM 破坏布局。
  // useTheme() 在 ThemeProvider 内可用（角色组件挂在 layout 根，ThemeProvider 在 AppBaseProviders 中包裹整个 AppInterface）。
  const theme = useTheme()
  const sdk = useServerSDK()
  const [state, setState] = createStore({
    status: initialCharacterStatus(Date.now()) as CharacterStatus,
    prevDisplay: "idle" as CharacterState,
    transitioning: false,
    bubble: undefined as string | undefined,
    menu: undefined as { x: number; y: number } | undefined,
    collapsed: readLS(LS_COLLAPSED, false),
    demoOpen: false,
  })

  let fadeTimer: ReturnType<typeof setTimeout> | undefined
  let autoBubbleTimer: ReturnType<typeof setTimeout> | undefined

  // 归一化事件 → reducer → 新状态。reducer 是纯函数，所有时序由 Date.now() 驱动。
  function dispatch(event: CharacterEvent) {
    setState("status", reduceCharacter(state.status, event, Date.now()))
  }

  // 状态变化触发 crossfade：记录前一状态并标记 transitioning，CROSSFADE_MS 后清除。
  createEffect(
    on(
      () => state.status.state,
      (next, prev) => {
        if (prev === undefined || next === prev) return
        setState("prevDisplay", prev)
        setState("transitioning", true)
        if (fadeTimer) clearTimeout(fadeTimer)
        fadeTimer = setTimeout(() => setState("transitioning", false), CROSSFADE_MS)
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

  // 右键角色：弹出透明度快捷菜单（100%/60%/30%）+ 重置位置 + 状态演示入口
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    // 边界检查：菜单不超出视口。菜单含 3 透明度档 + 分隔线 + 重置位置 + 分隔线 + 状态演示
    // 共 7 行，每行 ~32px + 分隔线 2×7px + 容器 padding 8px ≈ 222px，取 230 留余量。
    const MENU_W = 120
    const MENU_H = 230
    setState("menu", {
      x: Math.min(e.clientX, window.innerWidth - MENU_W),
      y: Math.min(e.clientY, window.innerHeight - MENU_H),
    })
  }

  // 菜单打开期间：点击或右键外部时关闭
  createEffect(() => {
    const m = state.menu
    if (!m) return
    const close = () => setState("menu", undefined)
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
    setState("bubble", line)
    playChime()
    if (autoBubbleTimer) clearTimeout(autoBubbleTimer)
    autoBubbleTimer = setTimeout(() => setState("bubble", undefined), 3500)
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

  const currentState = () => state.status.state

  // 折叠/展开切换（持久化到 localStorage）
  function toggleCollapsed() {
    const next = !state.collapsed
    setState("collapsed", next)
    writeLS(LS_COLLAPSED, next)
  }

  // ---------- 工单 07：状态演示 ----------
  // 强制切态：dispatch force 覆盖事件驱动，台词气泡按态弹出 + 提示音（样式语义同 preview setCharState(s.id)）
  function forceState(s: CharacterState) {
    dispatch({ type: "force", state: s })
    setState("bubble", STATUS_TEXT[s])
    playChime()
    if (autoBubbleTimer) clearTimeout(autoBubbleTimer)
    autoBubbleTimer = setTimeout(() => setState("bubble", undefined), 3500)
  }

  // 回到自动：清除 override 恢复事件驱动
  function returnToAuto() {
    dispatch({ type: "auto" })
  }

  // 右键菜单「状态演示」入口：toggle 演示面板开合
  function toggleDemo() {
    setState("menu", undefined)
    setState("demoOpen", !state.demoOpen)
  }

  // ---------- 工单 02：拖动移动位置（ADR-010） ----------
  // 拖拽手柄 pointerdown → window pointermove/up；位置用 transform 叠加偏移（不改 CSS inset）。
  // 偏移相对拖动起点累积；clamp 用 getBoundingClientRect 的起点尺寸保证角色+手柄不超出视口。
  const [dragOffset, setDragOffset] = createSignal<Position>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = createSignal(false)
  let asideEl: HTMLElement | undefined
  let dragStart:
    | { px: number; py: number; originLeft: number; originTop: number; w: number; h: number }
    | undefined

  // 视口尺寸（handleDragMove / syncPosition 共用）
  const getViewport = () => ({ width: window.innerWidth, height: window.innerHeight })

  function handleDragStart(e: PointerEvent) {
    if (!asideEl) return
    // 工单 04：窄屏强制回左下默认，不允许拖动
    if (isNarrowViewport(window.innerWidth)) return
    e.preventDefault()
    e.stopPropagation()
    const rect = asideEl.getBoundingClientRect()
    dragStart = { px: e.clientX, py: e.clientY, originLeft: rect.left, originTop: rect.top, w: rect.width, h: rect.height }
    setIsDragging(true)
    window.addEventListener("pointermove", handleDragMove)
    window.addEventListener("pointerup", handleDragEnd)
    // 指针设备取消（触摸中断等）同样结束拖动，避免残留监听
    window.addEventListener("pointercancel", handleDragEnd)
  }

  function handleDragMove(e: PointerEvent) {
    if (!dragStart) return
    const clamped = clampPosition(
      { x: dragStart.originLeft + e.clientX - dragStart.px, y: dragStart.originTop + e.clientY - dragStart.py },
      getViewport(),
      { width: dragStart.w, height: dragStart.h },
    )
    setDragOffset({ x: clamped.x - dragStart.originLeft, y: clamped.y - dragStart.originTop })
  }

  function handleDragEnd() {
    dragStart = undefined
    setIsDragging(false)
    window.removeEventListener("pointermove", handleDragMove)
    window.removeEventListener("pointerup", handleDragEnd)
    window.removeEventListener("pointercancel", handleDragEnd)
    // 工单 03：拖动结束保存绝对视口位置（已被 clamp 到视口内），刷新/重启后恢复
    if (asideEl) {
      const rect = asideEl.getBoundingClientRect()
      savePosition({ x: rect.left, y: rect.top }, localStorage)
    }
  }

  // ---------- 工单 03/04：位置持久化 + 窄屏回默认 + resize 实时 ----------
  // 统一位置同步：反推 CSS 默认基准（当前 rect - 当前 offset），再经 resolvePosition 判定最终位置——
  // 窄屏回默认（offset 归零）、宽屏恢复并 clamp 存储位置。用于挂载恢复与 resize 时重新计算。
  function syncPosition() {
    if (!asideEl) return
    const rect = asideEl.getBoundingClientRect()
    const cssDefault = { x: rect.left - dragOffset().x, y: rect.top - dragOffset().y }
    const stored = loadPosition(localStorage, cssDefault)
    const resolved = resolvePosition(stored, cssDefault, getViewport(), { width: rect.width, height: rect.height })
    setDragOffset({ x: resolved.x - cssDefault.x, y: resolved.y - cssDefault.y })
  }

  // 挂载时恢复存储位置（宽屏）或回默认（窄屏）；resize 时实时窄屏判定 + 重 clamp 到新视口
  onMount(() => {
    syncPosition()
    window.addEventListener("resize", syncPosition)
  })

  // 右键菜单「重置位置」：回左下默认并清空存储
  function resetPosition() {
    setDragOffset({ x: 0, y: 0 })
    clearPosition(localStorage)
    setState("menu", undefined)
  }

  onCleanup(() => {
    window.removeEventListener("pointermove", handleDragMove)
    window.removeEventListener("pointerup", handleDragEnd)
    window.removeEventListener("pointercancel", handleDragEnd)
    window.removeEventListener("resize", syncPosition)
  })

  return (
    <Show when={theme.themeId() === "jiangxiao"}>
      <aside
        ref={asideEl}
        data-component="jiangxiao-character"
        data-collapsed={state.collapsed ? "true" : undefined}
        data-dragging={isDragging() ? "true" : undefined}
        style={{
          opacity: characterOpacity(),
          // offset 为 0 时不输出 transform：避免恒建 containing block 使 fixed 菜单定位错乱（ADR-010 审查修复）
          transform: dragOffset().x === 0 && dragOffset().y === 0 ? undefined : `translate(${dragOffset().x}px, ${dragOffset().y}px)`,
        }}
      onContextMenu={handleContextMenu}
    >
      {/* 拖拽手柄（ADR-010）：角色头顶上方，线描四向移动图标，默认半透 hover 变亮，pointerdown 发起拖动 */}
      <div
        data-slot="character-drag-handle"
        onPointerDown={handleDragStart}
        role="button"
        aria-label="拖动移动姜晓"
        title="拖动移动姜晓"
      >
        <JiangxiaoIcon name="move" size={16} />
      </div>
      <div data-slot="character-video" onClick={handleClick}>
        <For each={VIDEO_STATES}>
          {(v) => (
            <img
              draggable={false}
              src={`/character/${v}.webp`}
              loading={v === "idle" ? "eager" : "lazy"}
              data-state={v}
              data-active={currentState() === v ? true : undefined}
              data-prev={state.prevDisplay === v && state.transitioning ? true : undefined}
              onError={(e) => {
                // 素材缺失时静默隐藏，不报错
                ;(e.currentTarget as HTMLImageElement).style.display = "none"
              }}
            />
          )}
        </For>
      </div>

      {/* 点击气泡：漫画对白气泡，浮于角色头部上方，带小箭头指向角色，纯装饰穿透 */}
      <Show when={state.bubble}>
        <div
          data-slot="character-bubble"
          style={{
            position: "absolute",
            "inset-block-start": "6px",
            "inset-inline-start": "50%",
            transform: "translateX(-50%)",
            "max-width": "200px",
            padding: "8px 12px",
            background: "var(--jx-ink-950)",
            border: "1px solid var(--jx-gold-deep)",
            "border-radius": "10px",
            color: "var(--jx-cream)",
            "font-size": "var(--jx-fs-small)",
            "text-align": "center",
            "box-shadow": "0 4px 16px rgba(0,0,0,0.6)",
            "pointer-events": "none",
            "user-select": "none",
            "z-index": 3,
          }}
        >
          {state.bubble}
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
              "border-top": "8px solid var(--jx-gold-deep)",
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
        aria-label={state.collapsed ? "展开姜晓" : "收起姜晓"}
        title={state.collapsed ? "展开姜晓" : "收起姜晓"}
      >
        {/* chevron 图标：折叠时显示向下（展开方向），展开时显示向上（收起方向） */}
        <JiangxiaoIcon name={state.collapsed ? "chev-d" : "chev-u"} size={16} />
      </button>

      {/* 右键菜单（工单 05：透明度 100%/60%/30%；工单 03：重置位置；工单 07：状态演示入口）。
          Portal 到 body：角色拖动后 aside 带 transform（创建 containing block），fixed 菜单若留在
          aside 内会相对 aside 定位而错位（ADR-010 审查修复）。 */}
      <Show when={state.menu}>
        {(m) => (
          <Portal>
            <div data-slot="character-opacity-menu" style={{ left: `${m().x}px`, top: `${m().y}px` }}>
              <For each={OPACITY_PRESETS}>
                {(preset) => (
                  <button
                    type="button"
                    onClick={() => {
                      setCharacterOpacity(preset.value)
                      setState("menu", undefined)
                    }}
                  >
                    {preset.label}
                  </button>
                )}
              </For>
              <span data-slot="opacity-menu-sep" aria-hidden="true" />
              <button type="button" onClick={resetPosition}>
                重置位置
              </button>
              <span data-slot="opacity-menu-sep" aria-hidden="true" />
              <button
                type="button"
                class={state.demoOpen ? "on" : undefined}
                onClick={toggleDemo}
                aria-pressed={state.demoOpen}
              >
                {state.demoOpen ? "关闭演示" : "状态演示"}
              </button>
            </div>
          </Portal>
        )}
      </Show>

      {/* 工单 07：状态演示面板（默认收起；竖排 10 态按钮 + 分隔线 + 「回到自动」+ 折叠钮，样式同 preview #char-tools）。
          角色折叠（collapsed）时隐藏——演示态看不到动画无意义，展开角色后可从右键菜单重新唤起。 */}
      <Show when={state.demoOpen && !state.collapsed}>
        <div data-slot="character-demo-tools" role="group" aria-label="角色状态演示">
          <For each={DEMO_STATES}>
            {(d) => (
              <button
                type="button"
                data-state={d.id}
                title={d.label}
                aria-label={d.label}
                aria-pressed={currentState() === d.id}
                class={currentState() === d.id ? "on" : undefined}
                onClick={() => forceState(d.id)}
              >
                <JiangxiaoIcon name={d.icon} size={13} />
              </button>
            )}
          </For>
          <span data-slot="char-demo-sep" aria-hidden="true" />
          <button
            type="button"
            class="char-demo-auto"
            onClick={returnToAuto}
            title="回到自动"
            aria-label="回到自动，恢复事件驱动"
          >
            <JiangxiaoIcon name="spark" size={13} />
            <span>回到自动</span>
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            title="收起姜晓"
            aria-label="收起姜晓"
          >
            <JiangxiaoIcon name="chev-u" size={13} />
          </button>
        </div>
      </Show>
    </aside>
    </Show>
  )
}
