import { createUniqueId, type ComponentProps } from "solid-js"

// 二次元「信」字印章标 v2（ADR-017）。
// viewBox 0 0 24 24：圆润烫金圆印章 + 楷书「信」字 + 姜晓紫瞳点睛 + 星芒装饰 + 高光弧。
// 颜色全部走 CSS 变量：深底浅金/朱红、浅底深墨随主题切换；紫瞳为角色标志色（--jx-wisteria）。
const SEAL_MARK = (irisId: string) => (
  <g>
    {/* 外圈印章边框（圆润加粗） */}
    <circle
      data-slot="logo-seal-ring"
      cx="12"
      cy="12"
      r="10.9"
      fill="none"
      stroke="var(--icon-strong-base)"
      stroke-width="1.6"
      stroke-linecap="round"
    />
    <circle
      data-slot="logo-seal-ring-inner"
      cx="12"
      cy="12"
      r="9.3"
      fill="none"
      stroke="var(--icon-weak-base)"
      stroke-width="0.5"
      opacity="0.7"
    />
    {/* 顶部高光弧（二次元高光） */}
    <path
      d="M3.9 8.2 A10.9 10.9 0 0 1 8.2 3.9"
      stroke="#ffffff"
      stroke-width="0.5"
      fill="none"
      opacity="0.55"
      stroke-linecap="round"
    />
    {/* 星芒点饰（四向 sparkle） */}
    <g fill="var(--icon-strong-base)">
      <path d="M12 1.2 l0.55 1.25 1.25 0.55 -1.25 0.55 -0.55 1.25 -0.55 -1.25 -1.25 -0.55 1.25 -0.55 z" />
      <path d="M12 22.8 l0.55 -1.25 1.25 -0.55 -1.25 -0.55 -0.55 -1.25 -0.55 1.25 -1.25 0.55 1.25 0.55 z" />
      <path d="M1.2 12 l1.25 0.55 0.55 1.25 0.55 -1.25 1.25 -0.55 -1.25 -0.55 -0.55 -1.25 -0.55 1.25 z" />
      <path d="M22.8 12 l-1.25 0.55 -0.55 1.25 -0.55 -1.25 -1.25 -0.55 1.25 -0.55 0.55 -1.25 0.55 1.25 z" />
    </g>
    {/* 信字：左亻（亮金） */}
    <g fill="var(--icon-strong-base)">
      <path d="M6.9 4.5 c0.2 -0.95 1.5 -1.4 2.4 -0.9 l-0.35 0.75 c-0.55 -0.42 -1.3 -0.32 -1.55 0.2 l-0.05 0.45 c0.9 0.45 1.55 1.2 1.75 2.1 l-0.85 0.2 c-0.22 -0.55 -0.65 -1.0 -1.2 -1.25 z" />
      <path d="M6.2 8.5 h3.2 v0.85 h-1.3 v4.6 h-0.95 v-4.6 h-0.95 z" />
    </g>
    {/* 信字：右言（暗金） */}
    <g fill="var(--icon-base)">
      <path d="M10.3 8.3 h5.9 v0.95 h-5.9 z" />
      <path d="M10.3 10.2 h5.9 v0.95 h-5.9 z" />
      <path d="M10.3 12.1 v5.1 c0 0.55 0.45 1.0 1.0 1.0 h3.9 c0.55 0 1.0 -0.45 1.0 -1.0 v-5.1 h0.95 v5.0 c0 1.1 -0.85 1.95 -1.95 1.95 h-3.9 c-1.1 0 -1.95 -0.85 -1.95 -1.95 v-5.0 z" />
    </g>
    {/* 姜晓紫瞳点睛（言部顶横位置） */}
    <g transform="translate(13.7 5.6)">
      <ellipse cx="0" cy="0" rx="1.35" ry="1.75" fill={`url(#${irisId})`} stroke="#4a3456" stroke-width="0.25" />
      {/* 上眼睑弧 */}
      <path d="M-1.2 -0.5 q1.2 -1.4 2.4 -0.1" stroke="var(--icon-strong-base)" stroke-width="0.3" fill="none" stroke-linecap="round" />
      {/* 高光 */}
      <circle cx="-0.45" cy="-0.6" r="0.4" fill="#ffffff" opacity="0.9" />
      <circle cx="0.45" cy="0.45" r="0.18" fill="#ffffff" opacity="0.6" />
      {/* 瞳孔 */}
      <circle cx="0.05" cy="0.35" r="0.42" fill="#3d2a47" />
    </g>
  </g>
)

const IrisGradient = (id: string) => (
  <radialGradient id={id} cx="0.35" cy="0.3" r="1.2" gradientUnits="objectBoundingBox">
    <stop offset="0" stop-color="#c8b8ec" />
    <stop offset="0.5" stop-color="var(--jx-wisteria, #997694)" />
    <stop offset="1" stop-color="#5b4367" />
  </radialGradient>
)

export const Mark = (props: { class?: string }) => {
  const irisId = createUniqueId()
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="信使链接"
    >
      {IrisGradient(irisId)}
      {SEAL_MARK(irisId)}
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  // 竖版（16:20）印章：上方印章 + 下方印柱，适配 splash 的 w/h 比例不拉伸。
  const irisId = createUniqueId()
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="信使链接"
    >
      {IrisGradient(irisId)}
      {/* 印章（24→12 缩小）居中上部 */}
      <g transform="translate(2 0) scale(0.5)">
        {SEAL_MARK(irisId)}
      </g>
      {/* 印柱 */}
      <path d="M8 14.2 v2.4" stroke="var(--icon-strong-base)" stroke-width="0.7" stroke-linecap="round" />
      <path d="M5.6 14.2 h4.8" stroke="var(--icon-strong-base)" stroke-width="0.7" stroke-linecap="round" />
      <path d="M6.4 16.6 h3.2" stroke="var(--icon-weak-base)" stroke-width="0.6" stroke-linecap="round" />
    </svg>
  )
}

// 横向字标：左侧印章 + 右侧「信使链接」标题（Ma Shan Zheng 楷书，矢量 path 化）。
export const Logo = (props: { class?: string }) => {
  const irisId = createUniqueId()
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
      role="img"
      aria-label="信使链接"
    >
      {IrisGradient(irisId)}
      {/* 左侧印章，1:1 缩放后置于 24..72 区 */}
      <g transform="translate(24 9) scale(1)">
        <g transform="translate(0 0) scale(1)">{SEAL_MARK(irisId)}</g>
      </g>
      {/* 右侧品牌字标「信使链接」——本地楷体链（随主题着色） */}
      <g fill="var(--icon-strong-base)" transform="translate(88 31)">
        <text
          x="0"
          y="0"
          font-family="'TangKai','Kaiti SC','STKaiti','KaiTi',serif"
          font-size="30"
          letter-spacing="3"
        >
          信使链接
        </text>
      </g>
    </svg>
  )
}
