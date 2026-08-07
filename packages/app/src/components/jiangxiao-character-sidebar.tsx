import { createSignal, createEffect, onCleanup, Show, For } from "solid-js"
import { useSDK } from "@/context/sdk"

/**
 * 姜晓角色侧边栏（唐风二次元主题）
 * - 视频状态：待机/思考/回复/工作/报错（素材放 packages/app/public/character/）
 * - 交叉淡入淡出切换，高优先级打断低优先级
 * - 折叠按钮 + 点击角色弹气泡 + 提示音
 * - 纯视觉组件，不改任何功能逻辑
 */

export type CharacterState = "idle" | "thinking" | "replying" | "working" | "error"

const VIDEO_STATES: CharacterState[] = ["idle", "thinking", "replying", "working", "error"]

// 状态对应的角色台词
const STATUS_TEXT: Record<CharacterState, string> = {
  idle: "有何吩咐？",
  thinking: "容我思量……",
  replying: "且听我道来。",
  working: "正在为您效劳。",
  error: "出了些差错……",
}

const IDLE_LINES = ["大人，有何吩咐？", "姜晓在此候命。", "需要我做些什么？", "静候您的指令。"]

const LS_OPEN = "jiangxiao.character.open"
const LS_DECO = "jiangxiao.deco"

function readLS(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function writeLS(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function JiangxiaoCharacterSidebar(props: { sessionID?: () => string | undefined }) {
  const sdk = useSDK()
  const [state, setState] = createSignal<CharacterState>("idle")
  const [prevState, setPrevState] = createSignal<CharacterState>("idle")
  const [transitioning, setTransitioning] = createSignal(false)
  const [open, setOpen] = createSignal(readLS(LS_OPEN, "1") === "1")
  const [bubble, setBubble] = createSignal<string | undefined>(undefined)

  let fadeTimer: ReturnType<typeof setTimeout> | undefined
  let autoBubbleTimer: ReturnType<typeof setTimeout> | undefined

  function switchTo(next: CharacterState) {
    if (next === state()) return
    setPrevState(state())
    setState(next)
    setTransitioning(true)
    if (fadeTimer) clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => setTransitioning(false), 300)
  }

  // 事件驱动状态切换
  createEffect(() => {
    const client = sdk()
    const sessionID = props.sessionID?.()

    const onMessageUpdated = (evt: { payload: { type: string; properties: { sessionID?: string; info?: { role?: string } } } }) => {
      const { type, properties } = evt.payload
      if (type !== "message.updated" || !properties) return
      if (sessionID && properties.sessionID !== sessionID) return
      const role = properties.info?.role
      if (role === "assistant") switchTo("replying")
      else if (role === "user") switchTo("thinking")
    }

    const onToolExecute = () => switchTo("working")
    const onSessionError = () => switchTo("error")
    const onSessionIdle = () => switchTo("idle")

    const unsubs = [
      client.event.on("event", onMessageUpdated),
      client.event.on("session.error", onSessionError),
      client.event.on("session.idle", onSessionIdle),
      client.event.on("tool.execute.before", onToolExecute),
    ]

    onCleanup(() => {
      for (const unsub of unsubs) unsub()
    })
  })

  // 折叠状态持久化
  createEffect(() => {
    writeLS(LS_OPEN, open() ? "1" : "0")
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

  return (
    <Show
      when={open()}
      fallback={
        <button
          data-component="jiangxiao-character-toggle"
          data-state="closed"
          style={{ position: "absolute", insetBlockStart: "12px", insetInlineEnd: "8px" }}
          onClick={() => setOpen(true)}
          title="展开角色"
          aria-label="展开角色"
        >
          <span style={{ fontSize: "14px" }}>✦</span>
        </button>
      }
    >
      <aside data-component="jiangxiao-character">
        <button
          data-component="jiangxiao-character-toggle"
          data-state="open"
          onClick={() => setOpen(false)}
          title="收起角色"
          aria-label="收起角色"
        >
          <span style={{ fontSize: "12px" }}>✕</span>
        </button>

        <div data-slot="character-video" onClick={handleClick}>
          <For each={VIDEO_STATES}>
            {(v) => (
              <video
                src={`/character/${v}.webm`}
                muted
                loop
                autoplay
                playsinline
                preload={v === "idle" ? "auto" : "none"}
                data-state={v}
                data-prev={prevState() === v && transitioning() ? true : undefined}
                onError={(e) => {
                  // 素材缺失时静默隐藏，不报错
                  ;(e.currentTarget as HTMLVideoElement).style.display = "none"
                }}
              />
            )}
          </For>
        </div>

        {/* 点击气泡 */}
        <Show when={bubble()}>
          <div
            data-slot="character-bubble"
            style={{
              position: "absolute",
              insetInlineStart: "12px",
              insetBlockEnd: "70px",
              maxWidth: "180px",
              padding: "8px 12px",
              background: "#17130d",
              border: "1px solid #d6b34a",
              borderRadius: "8px",
              color: "#f2ead8",
              fontSize: "12px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
              zIndex: 2,
            }}
          >
            {bubble()}
          </div>
        </Show>

        <div data-slot="character-status">{STATUS_TEXT[state()]}</div>
      </aside>
    </Show>
  )
}
