import { onMount, Show, createSignal } from "solid-js"
import { useTheme } from "@opencode-ai/ui/theme/context"

/**
 * 姜晓启动画面（ADR-007 定稿）：冷启动时展示信使链接品牌 + 姜晓欢迎图
 * - 仅姜晓主题下生效（响应式主题判断，主题切换时自动更新）
 * - 烫金楷书主标题「信使链接」+ 副标题「跨越时空为你而来的伙伴」+ 拉丁小标
 * - 欢迎图主视觉；右下角 AI 水印以墨晕 + 竖排诗句 + 朱砂印章叠层遮盖（原图只读）
 * - 加载动画保留（朱砂印章旋转），1.8s 后淡出进入工作
 * - 纯视觉组件，不影响任何功能逻辑
 */

const MIN_DISPLAY_MS = 1500
const FADE_MS = 600

export function JiangxiaoSplash() {
  // 响应式主题判断：useTheme().themeId() 是 SolidJS 响应式 accessor，
  // 主题切换时 <Show> 自动重新求值。
  const theme = useTheme()
  const [hidden, setHidden] = createSignal(false)

  onMount(() => {
    const el = document.getElementById("jiangxiao-splash")
    if (!el) return
    const t = setTimeout(() => {
      setHidden(true)
      setTimeout(() => el.remove(), FADE_MS)
    }, MIN_DISPLAY_MS)
    return () => clearTimeout(t)
  })

  return (
    <Show when={theme.themeId() === "jiangxiao"}>
      <div
        id="jiangxiao-splash"
        class="jiangxiao-splash-root"
        classList={{ "jiangxiao-splash-hidden": hidden() }}
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
          <div class="jiangxiao-splash-loading">
            <div class="jiangxiao-splash-seal-spinner" />
            <span>正在连通灵犀……</span>
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
            z-index: 9999;
            overflow: hidden;
            background: #0b090d;
            transition: opacity ${FADE_MS}ms ease;
          }
          .jiangxiao-splash-root.jiangxiao-splash-hidden {
            opacity: 0;
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
            color: #B8860B;
            font-size: 11px;
            font-weight: 500;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            opacity: 0.85;
          }
          .jiangxiao-splash-h1 {
            margin: 0;
            color: #F6D365;
            font-family: "Ma Shan Zheng", "TangKai", "KaiTi", "STKaiti", serif;
            font-size: 64px;
            font-weight: 400;
            letter-spacing: 0.04em;
            line-height: 1.15;
            text-shadow: 0 0 24px rgba(246, 211, 101, 0.35);
          }
          @supports (background-clip: text) or (-webkit-background-clip: text) {
            .jiangxiao-splash-h1 {
              background: linear-gradient(135deg, #F6D365 0%, #FDA085 50%, #B8860B 100%);
              -webkit-background-clip: text;
              background-clip: text;
              color: transparent;
              -webkit-text-fill-color: transparent;
            }
          }
          .jiangxiao-splash-subtitle {
            color: #f2ead8;
            font-family: "Noto Serif SC", "Songti SC", "SimSun", serif;
            font-size: 16px;
            font-weight: 400;
            letter-spacing: 0.08em;
            opacity: 0.9;
          }
          .jiangxiao-splash-loading {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 8px;
            color: #a99c8a;
            font-size: 12px;
            letter-spacing: 0.1em;
          }
          .jiangxiao-splash-seal-spinner {
            width: 20px;
            height: 20px;
            border: 1.5px solid #C3272B;
            border-radius: 50%;
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
            color: #dfb793;
            font-family: "Ma Shan Zheng", "TangKai", "KaiTi", "STKaiti", serif;
            font-size: 15px;
            letter-spacing: 0.12em;
            writing-mode: vertical-rl;
            text-orientation: upright;
            opacity: 0.7;
          }
          .jiangxiao-splash-seal-stamp {
            margin-top: 8px;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #C3272B;
            border-radius: 4px;
            color: #f2ead8;
            font-family: "Ma Shan Zheng", "TangKai", "KaiTi", "STKaiti", serif;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0;
            box-shadow: 0 0 12px rgba(194, 39, 43, 0.4), inset 0 0 0 1px rgba(242, 234, 216, 0.3);
          }
        `}</style>
      </div>
    </Show>
  )
}
