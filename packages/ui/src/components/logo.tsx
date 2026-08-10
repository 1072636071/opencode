import { type ComponentProps } from "solid-js"

// 唐风印章「信」字标（ADR-014）。
// viewBox 0 0 24 24：烫金/朱红圆印章 + 楷书「信」字（左亻右言）+ 云纹点饰。
// 颜色全部走 CSS 变量，深底浅金/朱红、浅底深墨随主题切换。
const SEAL_MARK = (
  <g>
    {/* 外圈印章边框 */}
    <circle
      data-slot="logo-seal-ring"
      cx="12"
      cy="12"
      r="11"
      fill="none"
      stroke="var(--icon-strong-base)"
      stroke-width="1.2"
    />
    <circle
      data-slot="logo-seal-ring-inner"
      cx="12"
      cy="12"
      r="9.4"
      fill="none"
      stroke="var(--icon-weak-base)"
      stroke-width="0.5"
    />
    {/* 云纹点饰（四向） */}
    <g stroke="var(--icon-strong-base)" stroke-width="0.6" fill="none" stroke-linecap="round">
      <path d="M12 2.6 v-0.9" />
      <path d="M12 21.4 v0.9" />
      <path d="M2.6 12 h-0.9" />
      <path d="M21.4 12 h0.9" />
    </g>
    {/* 信字：左亻 */}
    <g fill="var(--icon-strong-base)">
      <path d="M6.6 4.6 c0.2 -0.9 1.4 -1.3 2.2 -0.8 l-0.3 0.7 c-0.5 -0.4 -1.2 -0.3 -1.4 0.2 l0 0.4 c0.8 0.4 1.4 1.1 1.6 1.9 l-0.8 0.2 c-0.2 -0.5 -0.6 -0.9 -1.1 -1.1 z" />
      <path d="M6.0 8.4 h3.0 v0.8 h-1.2 v4.4 h-0.9 v-4.4 h-0.9 z" />
    </g>
    {/* 信字：右言 */}
    <g fill="var(--icon-base)">
      <path d="M10.2 5.2 h5.6 v0.9 h-5.6 z" />
      <path d="M10.2 7.2 h0.9 v0.8 h-0.9 z" />
      <path d="M10.2 8.2 h5.6 v0.9 h-5.6 z" />
      <path d="M10.2 10.0 h5.6 v0.9 h-5.6 z" />
      <path d="M10.2 11.8 v5.0 c0 0.5 0.4 0.9 0.9 0.9 h3.8 c0.5 0 0.9 -0.4 0.9 -0.9 v-5.0 h0.9 v4.9 c0 1.0 -0.8 1.8 -1.8 1.8 h-3.8 c-1.0 0 -1.8 -0.8 -1.8 -1.8 v-4.9 z" />
    </g>
  </g>
)

export const Mark = (props: { class?: string }) => {
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
      {SEAL_MARK}
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  // 竖版（16:20）印章：上方印章 + 下方印柱，适配 splash 的 w/h 比例不拉伸。
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
      {/* 印章（24→12 缩小）居中上部 */}
      <g transform="translate(2 0) scale(0.5)">
        {SEAL_MARK}
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
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
      role="img"
      aria-label="信使链接"
    >
      {/* 左侧印章，1:1 缩放后置于 24..72 区 */}
      <g transform="translate(24 9) scale(1)">
        <g transform="translate(0 0) scale(1)">
          <circle cx="12" cy="12" r="11" fill="none" stroke="var(--icon-strong-base)" stroke-width="1.4" />
          <circle cx="12" cy="12" r="9.4" fill="none" stroke="var(--icon-weak-base)" stroke-width="0.6" />
          <g stroke="var(--icon-strong-base)" stroke-width="0.7" fill="none" stroke-linecap="round">
            <path d="M12 2.6 v-0.9" />
            <path d="M12 21.4 v0.9" />
            <path d="M2.6 12 h-0.9" />
            <path d="M21.4 12 h0.9" />
          </g>
          <g fill="var(--icon-strong-base)">
            <path d="M6.6 4.6 c0.2 -0.9 1.4 -1.3 2.2 -0.8 l-0.3 0.7 c-0.5 -0.4 -1.2 -0.3 -1.4 0.2 l0 0.4 c0.8 0.4 1.4 1.1 1.6 1.9 l-0.8 0.2 c-0.2 -0.5 -0.6 -0.9 -1.1 -1.1 z" />
            <path d="M6.0 8.4 h3.0 v0.8 h-1.2 v4.4 h-0.9 v-4.4 h-0.9 z" />
          </g>
          <g fill="var(--icon-base)">
            <path d="M10.2 5.2 h5.6 v0.9 h-5.6 z" />
            <path d="M10.2 7.2 h0.9 v0.8 h-0.9 z" />
            <path d="M10.2 8.2 h5.6 v0.9 h-5.6 z" />
            <path d="M10.2 10.0 h5.6 v0.9 h-5.6 z" />
            <path d="M10.2 11.8 v5.0 c0 0.5 0.4 0.9 0.9 0.9 h3.8 c0.5 0 0.9 -0.4 0.9 -0.9 v-5.0 h0.9 v4.9 c0 1.0 -0.8 1.8 -1.8 1.8 h-3.8 c-1.0 0 -1.8 -0.8 -1.8 -1.8 v-4.9 z" />
          </g>
        </g>
      </g>
      {/* 右侧品牌字标「信使链接」——本地楷体链（随主题着色），弱化水印场景可回退系统楷体 */}
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
