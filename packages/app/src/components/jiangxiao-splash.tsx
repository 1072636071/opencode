import { createEffect, createMemo, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useCheckServerHealth } from "@/utils/server-health"
import { JiangxiaoIcon } from "@/components/jiangxiao-icons"

/**
 * 姜晓启动画面（ADR-007 定稿）：冷启动时展示信使链接品牌 + 姜晓欢迎图
 * - 仅姜晓主题下生效（响应式主题判断，主题切换时自动更新）
 * - 烫金楷书主标题「信使链接」+ 副标题「跨越时空为你而来的伙伴」+ 拉丁小标
 * - 欢迎图主视觉；右下角 AI 水印以墨晕 + 竖排诗句 + 朱砂印章叠层遮盖（原图只读）
 * - 加载动画保留（朱砂印章旋转），1.8s 后 loading → CTA 切换
 * - CTA：朱红印章「进入终端」圆钮（线描 enter 图标 + aria-label，无单字中文）+「设置」ghost 钮
 * - 状态行：server 连接状态 · 主题 · 版本（连接状态跟随一次性健康检查）
 * - 「进入终端」点击后隐藏移除进入工作区；「设置」沿用 command keybind（mod+,）打开设置对话框
 * - 纯视觉组件，不影响任何功能逻辑
 */

const CTA_DELAY_MS = 1800 // 基准：1.8s 后 loading 隐藏、CTA 淡入
const FADE_MS = 600

type ConnState = "connecting" | "connected" | "disconnected"

export function JiangxiaoSplash() {
  // 响应式主题判断：useTheme().themeId() 是 SolidJS 响应式 accessor，
  // 主题切换时 <Show> 自动重新求值。
  const theme = useTheme()
  const server = useServer()
  const platform = usePlatform()
  const checkHealth = useCheckServerHealth()

  const [state, setState] = createStore({
    hidden: false,
    showCta: false,
    connState: "connecting" as ConnState,
  })

  // 连通状态：一次性检查，不引入轮询 interval（splash 常驻期间保持轻量；
  // checkServerHealth 有 750ms 结果缓存，与 GlobalProvider 的轮询共享同一结果）。
  createEffect(() => {
    const conn = server.current
    if (!conn) return
    let dead = false
    setState("connState", "connecting")
    void checkHealth(conn.http).then((health) => {
      if (dead) return
      setState("connState", health.healthy ? "connected" : "disconnected")
    })
    return () => {
      dead = true
    }
  })

  // loading → CTA：1.8s 后切换，splash 保持显示等待用户点击「进入终端」
  onMount(() => {
    const el = document.getElementById("jiangxiao-splash")
    if (!el) return
    const t = setTimeout(() => setState("showCta", true), CTA_DELAY_MS)
    return () => clearTimeout(t)
  })

  let dismissed = false
  function dismiss() {
    if (dismissed) return
    dismissed = true
    setState("hidden", true)
    setTimeout(() => document.getElementById("jiangxiao-splash")?.remove(), FADE_MS)
  }

  // 打开设置：沿用 command keybind 机制（mod+, → settings.open）。
  // 在 CommandProvider 上下文中执行 onSelect，保证 DialogSettings 依赖的
  // layout/tabs/serverSync 等 context 可用（splash 自身位于 provider 树外层，无法直接渲染）。
  // mod 在 macOS 是 metaKey、其他平台是 ctrlKey（与 command.tsx IS_MAC 判定一致）；
  // matchKeybind 对每个修饰键做精确匹配，故须按平台派发对应修饰键，否则 macOS 上不触发。
  function openSettings() {
    const isMac = typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ",",
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
        cancelable: true,
      }),
    )
    dismiss()
  }

  const statusLine = createMemo(() => {
    const label =
      state.connState === "connected"
        ? "server.connected"
        : state.connState === "disconnected"
          ? "server.disconnected"
          : "server.connecting"
    return `${label} · 主题 姜晓·墨染 · v${platform.version ?? "0.1.0"}`
  })

  return (
    <Show when={theme.themeId() === "jiangxiao"}>
      <div
        id="jiangxiao-splash"
        class="jiangxiao-splash-root"
        classList={{ "jiangxiao-splash-hidden": state.hidden }}
      >
        {/* 欢迎图主视觉（派生压缩资产，原图 docs/image/欢迎16-9.png 只读） */}
        <img class="jiangxiao-splash-bg" src="/splash-welcome.jpg" alt="" aria-hidden="true" />

        {/* 底部墨晕渐晕，保证标题列可读 */}
        <div class="jiangxiao-splash-vignette" />

        {/* 右下角水印遮盖叠层 1/3：墨晕 */}
        <div class="jiangxiao-splash-ink-corner" />

        {/* 标题列：左缘 8%，垂直居中偏上 */}
        <div class="jiangxiao-splash-title">
          <div class="jiangxiao-splash-latin">Opencode · Messenger Link</div>
          <h1 class="jiangxiao-splash-h1">信使链接</h1>
          <div class="jiangxiao-splash-subtitle">跨越时空为你而来的伙伴</div>

          {/* CTA 区：loading 显示 1.8s 后切换为「进入终端」+「设置」 */}
          <div class="jiangxiao-splash-cta">
            <Show when={!state.showCta}>
              <div class="jiangxiao-splash-loading">
                <div class="jiangxiao-splash-seal-spinner" />
                <span>正在连通灵犀……</span>
              </div>
            </Show>
            <Show when={state.showCta}>
              <div class="jiangxiao-splash-cta-group">
                <button
                  type="button"
                  class="jiangxiao-splash-seal-btn"
                  title="进入终端"
                  aria-label="进入终端"
                  onClick={dismiss}
                >
                  <JiangxiaoIcon name="enter" size={16} />
                </button>
                <span class="jiangxiao-splash-cta-label">进入终端</span>
                <button type="button" class="jiangxiao-splash-ghost-btn" onClick={openSettings}>
                  <JiangxiaoIcon name="gear" size={13} />
                  设置
                </button>
              </div>
            </Show>
          </div>

          {/* 状态行：server 连接状态 · 主题 · 版本 */}
          <div class="jiangxiao-splash-status">
            <span
              class="jiangxiao-splash-status-dot"
              classList={{
                connected: state.connState === "connected",
                disconnected: state.connState === "disconnected",
                connecting: state.connState === "connecting",
              }}
            />
            <span>{statusLine()}</span>
          </div>
        </div>

        {/* 右缘竖排诗句 + 朱砂印章（水印遮盖叠层 2/3 + 3/3） */}
        <div class="jiangxiao-splash-poem">
          <span>海上生明月</span>
          <span>天涯共此时</span>
          <div class="jiangxiao-splash-seal-stamp">姜晓</div>
        </div>

        <style>{`
          .jiangxiao-splash-root {
            position: fixed;
            inset: 0;
            z-index: var(--jx-z-splash, 200);
            overflow: hidden;
            background: var(--jx-ink-950, #0b090d);
            transition: opacity ${FADE_MS}ms ease;
          }
          .jiangxiao-splash-root.jiangxiao-splash-hidden {
            opacity: 0;
            pointer-events: none;
          }
          .jiangxiao-splash-bg {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: center;
          }
          .jiangxiao-splash-vignette {
            position: absolute;
            inset: 0;
            pointer-events: none;
            background:
              linear-gradient(to top, rgba(11,9,13,0.92) 0%, rgba(11,9,13,0.3) 30%, transparent 55%),
              linear-gradient(to right, rgba(11,9,13,0.7) 0%, transparent 30%);
          }
          .jiangxiao-splash-ink-corner {
            position: absolute;
            bottom: 0;
            right: 0;
            width: 26%;
            height: 16%;
            pointer-events: none;
            background: radial-gradient(120% 120% at 100% 100%, rgba(11,9,13,0.95) 30%, rgba(11,9,13,0.6) 60%, transparent 100%);
          }
          .jiangxiao-splash-title {
            position: absolute;
            left: 8%;
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            flex-direction: column;
            gap: 14px;
            z-index: 2;
          }
          .jiangxiao-splash-latin {
            color: var(--jx-gold-deep, #B8860B);
            font-size: var(--jx-fs-caption, 11px);
            font-weight: 500;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            opacity: 0.85;
          }
          .jiangxiao-splash-h1 {
            margin: 0;
            color: var(--jx-gold-bright, #F6D365);
            font-family: "Ma Shan Zheng", "TangKai", "KaiTi", "STKaiti", serif;
            font-size: var(--jx-fs-display);
            font-weight: 400;
            letter-spacing: 0.04em;
            line-height: 1.15;
            text-shadow: 0 0 24px rgba(246, 211, 101, 0.35);
          }
          @supports (background-clip: text) or (-webkit-background-clip: text) {
            .jiangxiao-splash-h1 {
              background: var(--jx-gold-foil);
              -webkit-background-clip: text;
              background-clip: text;
              color: transparent;
              -webkit-text-fill-color: transparent;
            }
          }
          .jiangxiao-splash-subtitle {
            color: var(--jx-cream, #f2ead8);
            font-family: "Noto Serif SC", "Songti SC", "SimSun", serif;
            font-size: var(--jx-fs-body);
            font-weight: 400;
            letter-spacing: 0.08em;
            opacity: 0.9;
          }
          .jiangxiao-splash-loading {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 0;
            color: var(--jx-cream-dim, #a99c8a);
            font-size: var(--jx-fs-small, 12px);
            letter-spacing: 0.1em;
          }
          .jiangxiao-splash-seal-spinner {
            width: 20px;
            height: 20px;
            border: 1.5px solid var(--jx-cinnabar, #C3272B);
            border-radius: var(--jx-radius-seal, 50%);
            border-top-color: transparent;
            animation: jiangxiao-splash-spin 1.4s linear infinite;
            flex-shrink: 0;
          }
          @keyframes jiangxiao-splash-spin {
            to { transform: rotate(360deg); }
          }
          .jiangxiao-splash-poem {
            position: absolute;
            right: 4.5%;
            bottom: 8%;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            z-index: 2;
            pointer-events: none;
          }
          .jiangxiao-splash-poem span {
            color: var(--jx-ginkgo, #dfb793);
            font-family: "Ma Shan Zheng", "TangKai", "KaiTi", "STKaiti", serif;
            font-size: var(--jx-fs-body);
            letter-spacing: 0.12em;
            writing-mode: vertical-rl;
            text-orientation: upright;
            opacity: 0.7;
          }
          .jiangxiao-splash-seal-stamp {
            margin-top: var(--jx-space-2, 8px);
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--jx-cinnabar, #C3272B);
            border-radius: var(--jx-radius-sm, 4px);
            color: var(--jx-cream, #f2ead8);
            font-family: "Ma Shan Zheng", "TangKai", "KaiTi", "STKaiti", serif;
            font-size: var(--jx-fs-body, 14px);
            font-weight: 700;
            letter-spacing: 0;
            box-shadow: 0 0 12px rgba(194, 39, 43, 0.4), inset 0 0 0 1px rgba(242, 234, 216, 0.3);
          }
          /* ---------- CTA 区（进入终端 / 设置）与状态行（工单 05，DESIGN.md §4/§10） ---------- */
          .jiangxiao-splash-cta {
            margin-top: 20px; /* 34 - 14（flex gap），对齐基准 .splash-cta 的 margin-top: 34 */
            min-height: 56px;
            display: flex;
            align-items: center;
          }
          .jiangxiao-splash-cta-group {
            display: flex;
            align-items: center;
            gap: var(--jx-space-4, 16px);
            animation: jiangxiao-splash-fade-in 0.6s ease;
          }
          .jiangxiao-splash-seal-btn {
            width: 44px;
            height: 44px;
            border-radius: var(--jx-radius-seal, 50%);
            background: var(--jx-cinnabar, #C3272B);
            color: var(--jx-cream, #f2ead8);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 auto;
            border: none;
            padding: 0;
            cursor: pointer;
            box-shadow: inset 0 0 0 1px rgba(242, 234, 216, 0.5), var(--jx-shadow-1, 0 2px 8px rgba(5, 3, 8, 0.5));
            transition: box-shadow 0.25s, transform 0.15s;
          }
          .jiangxiao-splash-seal-btn svg {
            width: 18px;
            height: 18px;
            stroke-width: 2;
          }
          .jiangxiao-splash-seal-btn:hover {
            box-shadow: inset 0 0 0 1px rgba(242, 234, 216, 0.5), 0 0 12px rgba(195, 39, 43, 0.45);
          }
          .jiangxiao-splash-seal-btn:active {
            transform: scale(0.96);
          }
          .jiangxiao-splash-cta-label {
            color: var(--jx-gold-bright, #F6D365);
            font-size: var(--jx-fs-small);
            letter-spacing: 0.14em;
          }
          .jiangxiao-splash-ghost-btn {
            color: var(--jx-gold-dim, #996515);
            font-size: var(--jx-fs-small);
            letter-spacing: 0.1em;
            padding: 6px 10px;
            border: none;
            border-bottom: 1px solid transparent;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: none;
            cursor: pointer;
            font-family: inherit;
          }
          .jiangxiao-splash-ghost-btn:hover {
            color: var(--jx-gold-bright, #F6D365);
            border-bottom-color: var(--jx-gold-dim, #996515);
          }
          .jiangxiao-splash-status {
            margin-top: 30px; /* 44 - 14（flex gap），对齐基准 .splash-status 的 margin-top: 44 */
            font-size: var(--jx-fs-small, 12px);
            color: var(--jx-cream-dim, #a99c8a);
            display: flex;
            align-items: center;
            gap: var(--jx-space-2, 8px);
            letter-spacing: 0.06em;
          }
          .jiangxiao-splash-status-dot {
            width: 7px;
            height: 7px;
            border-radius: var(--jx-radius-seal, 50%);
            background: var(--jx-gold-deep, #B8860B);
            box-shadow: 0 0 8px var(--jx-gold-deep, #B8860B);
            flex-shrink: 0;
          }
          .jiangxiao-splash-status-dot.connected {
            background: var(--jx-success, #86b08a);
            box-shadow: 0 0 8px var(--jx-success, #86b08a);
          }
          .jiangxiao-splash-status-dot.disconnected {
            background: var(--jx-error, #d06552);
            box-shadow: 0 0 8px var(--jx-error, #d06552);
          }
          .jiangxiao-splash-status-dot.connecting {
            animation: jiangxiao-splash-blink 1.2s ease-in-out infinite;
          }
          @keyframes jiangxiao-splash-fade-in {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: none; }
          }
          @keyframes jiangxiao-splash-blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
          }
        `}</style>
      </div>
    </Show>
  )
}
