import { createUniqueId, type ComponentProps } from "solid-js"

// 二次元「信」字印章字标 v2（ADR-017）。
// 横向：左侧圆润金章「信」字（姜晓紫瞳点睛）+ 右侧品牌字标「信使链接」。
// 颜色走 CSS 变量，随主题深浅自适应。
export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const irisId = createUniqueId()
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <radialGradient id={irisId} cx="0.35" cy="0.3" r="1.2" gradientUnits="objectBoundingBox">
        <stop offset="0" stop-color="#c8b8ec" />
        <stop offset="0.5" stop-color="var(--jx-wisteria, #997694)" />
        <stop offset="1" stop-color="#5b4367" />
      </radialGradient>

      {/* 左侧印章 */}
      <g transform="translate(24 9) scale(1)">
        <circle cx="12" cy="12" r="10.9" fill="none" stroke="var(--icon-strong-base)" stroke-width="1.6" stroke-linecap="round" />
        <circle cx="12" cy="12" r="9.3" fill="none" stroke="var(--icon-weak-base)" stroke-width="0.5" opacity="0.7" />
        <path d="M3.9 8.2 A10.9 10.9 0 0 1 8.2 3.9" stroke="#ffffff" stroke-width="0.5" fill="none" opacity="0.55" stroke-linecap="round" />
        <g fill="var(--icon-strong-base)">
          <path d="M12 1.2 l0.55 1.25 1.25 0.55 -1.25 0.55 -0.55 1.25 -0.55 -1.25 -1.25 -0.55 1.25 -0.55 z" />
          <path d="M12 22.8 l0.55 -1.25 1.25 -0.55 -1.25 -0.55 -0.55 -1.25 -0.55 1.25 -1.25 0.55 1.25 0.55 z" />
          <path d="M1.2 12 l1.25 0.55 0.55 1.25 0.55 -1.25 1.25 -0.55 -1.25 -0.55 -0.55 -1.25 -0.55 1.25 z" />
          <path d="M22.8 12 l-1.25 0.55 -0.55 1.25 -0.55 -1.25 -1.25 -0.55 1.25 -0.55 0.55 -1.25 0.55 1.25 z" />
        </g>
        <g fill="var(--icon-strong-base)">
          <path d="M6.9 4.5 c0.2 -0.95 1.5 -1.4 2.4 -0.9 l-0.35 0.75 c-0.55 -0.42 -1.3 -0.32 -1.55 0.2 l-0.05 0.45 c0.9 0.45 1.55 1.2 1.75 2.1 l-0.85 0.2 c-0.22 -0.55 -0.65 -1.0 -1.2 -1.25 z" />
          <path d="M6.2 8.5 h3.2 v0.85 h-1.3 v4.6 h-0.95 v-4.6 h-0.95 z" />
        </g>
        <g fill="var(--icon-base)">
          <path d="M10.3 8.3 h5.9 v0.95 h-5.9 z" />
          <path d="M10.3 10.2 h5.9 v0.95 h-5.9 z" />
          <path d="M10.3 12.1 v5.1 c0 0.55 0.45 1.0 1.0 1.0 h3.9 c0.55 0 1.0 -0.45 1.0 -1.0 v-5.1 h0.95 v5.0 c0 1.1 -0.85 1.95 -1.95 1.95 h-3.9 c-1.1 0 -1.95 -0.85 -1.95 -1.95 v-5.0 z" />
        </g>
        <g transform="translate(13.7 5.6)">
          <ellipse cx="0" cy="0" rx="1.35" ry="1.75" fill={`url(#${irisId})`} stroke="#4a3456" stroke-width="0.25" />
          <path d="M-1.2 -0.5 q1.2 -1.4 2.4 -0.1" stroke="var(--icon-strong-base)" stroke-width="0.3" fill="none" stroke-linecap="round" />
          <circle cx="-0.45" cy="-0.6" r="0.4" fill="#ffffff" opacity="0.9" />
          <circle cx="0.45" cy="0.45" r="0.18" fill="#ffffff" opacity="0.6" />
          <circle cx="0.05" cy="0.35" r="0.42" fill="#3d2a47" />
        </g>
      </g>

      {/* 右侧品牌字标「信使链接」 */}
      <text
        x="88"
        y="31"
        font-family="'TangKai','Kaiti SC','STKaiti','KaiTi',serif"
        font-size="30"
        letter-spacing="3"
        fill="var(--icon-strong-base)"
      >
        信使链接
      </text>
    </svg>
  )
}
