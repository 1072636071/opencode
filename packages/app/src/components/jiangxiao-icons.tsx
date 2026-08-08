import { Show, type JSX } from "solid-js"
import { useTheme } from "@opencode-ai/ui/theme/context"

/**
 * 姜晓唐风线描图标体系（ADR-007 / DESIGN.md Iconography）
 *
 * 规格：
 * - 24×24 网格 viewBox
 * - stroke: currentColor（随文字色继承，hover/active 联动）
 * - stroke-width: 1.8
 * - stroke-linecap/linejoin: round
 * - 尺寸三档：16（默认）/ 13（小）/ 20（大）
 * - fill: none（纯线描，无填充）
 *
 * 用法：
 * 1. 在应用根挂载 `<JiangxiaoIconSprite />` 一次（sprite 单次定义全局复用）
 * 2. 各处用 `<JiangxiaoIcon name="send" />` 引用 symbol
 *
 * 清单（DESIGN.md Iconography）：
 * send / enter / x / chev-l / chev-r / chev-u / chev-d / plus / search / gear /
 * help / file / read / brush / term / shield / cmd / clip / bot / spark /
 * menu / eye / leaf / swap / diff
 *
 * 纯视觉组件，不影响任何功能逻辑。作用域：自研组件内引用，不影响其他主题。
 */

export type JiangxiaoIconName =
  | "send"
  | "enter"
  | "x"
  | "chev-l"
  | "chev-r"
  | "chev-u"
  | "chev-d"
  | "plus"
  | "search"
  | "gear"
  | "help"
  | "file"
  | "read"
  | "brush"
  | "term"
  | "shield"
  | "cmd"
  | "clip"
  | "bot"
  | "spark"
  | "menu"
  | "eye"
  | "leaf"
  | "swap"
  | "diff"

export type JiangxiaoIconSize = 13 | 16 | 20

const ICON_PATHS: Record<JiangxiaoIconName, string> = {
  // 发送：纸飞机意象（唐风信使）
  send: "M4 12l16-8-6 18-3-7-7-3z M4 12l7 3",
  // 回车：拐角箭头
  enter: "M9 5l-5 5 5 5 M4 10h12a4 4 0 0 1 4 4v3",
  // 关闭：交叉
  x: "M6 6l12 12 M18 6L6 18",
  // chevron 左/右/上/下
  "chev-l": "M15 6l-6 6 6 6",
  "chev-r": "M9 6l6 6-6 6",
  "chev-u": "M6 15l6-6 6 6",
  "chev-d": "M6 9l6 6 6-6",
  // 加号
  plus: "M12 5v14 M5 12h14",
  // 搜索：放大镜
  search: "M11 11a6 6 0 1 0 0 .01 M20 20l-5-5",
  // 设置：齿轮（唐风简化为六瓣）
  gear: "M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2 M12 8a4 4 0 1 0 0 .01",
  // 帮助：问号
  help: "M9 9a3 3 0 1 1 4 2c-1 1-1 2-1 3 M12 17v.01",
  // 文件
  file: "M6 3h9l4 4v14H6z M15 3v4h4",
  // 书卷（read）：展开卷轴
  read: "M4 6h16v12H4z M4 6a2 2 0 0 1 2-2 M20 6a2 2 0 0 0-2-2 M4 18a2 2 0 0 0 2 2 M20 18a2 2 0 0 1-2 2 M8 10h8 M8 13h6",
  // 毛笔（brush=edit）：斜笔 + 墨迹
  brush: "M4 20l4-4 M8 16l8-8-3-3-8 8z M16 5l3 3 M5 20h6",
  // 终端
  term: "M5 7l4 4-4 4 M11 15h6 M3 5h18v14H3z",
  // 盾牌（shield=权限）
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  // 命令
  cmd: "M7 9l-3 3 3 3 M17 9l3 3-3 3 M14 7l-4 10",
  // 回形针（clip=附件）
  clip: "M16 8l-7 7a3 3 0 0 1-4-4l8-8a4 4 0 0 1 6 6l-9 9a6 6 0 0 1-9-9l10-10",
  // 机器人（bot=agent）
  bot: "M8 11v.01 M16 11v.01 M5 6h14v10H5z M5 9H3v4h2 M19 9h2v4h-2 M9 16v2h6v-2 M12 3v3",
  // 火花（spark=AI）
  spark: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z M19 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z",
  // 菜单
  menu: "M4 7h16 M4 12h16 M4 17h16",
  // 眼睛（eye=review）
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 9a3 3 0 1 0 0 .01",
  // 银杏叶（leaf=项目/主题）
  leaf: "M12 3c-4 4-6 8-6 12 0 2 1 4 3 4 M12 3c4 4 6 8 6 12 0 2-1 4-3 4 M12 3v18 M9 15l3 3 3-3",
  // 交换
  swap: "M4 8h13l-3-3 M20 16H7l3 3",
  // diff
  diff: "M9 4v6h6 M9 10l-4 4h8l-4-4z M15 20v-6h-6 M15 14l4-4h-8l4 4z",
}

/**
 * SVG sprite：单次定义所有 symbol，全局复用。
 * 在应用根挂载一次（AppInterface 中），渲染为隐藏的 inline SVG。
 * 仅在姜晓主题下挂载，不影响其他主题。响应式：主题切换时自动挂载/卸载。
 */
export function JiangxiaoIconSprite(): JSX.Element {
  // 响应式主题判断（M1 修复）：useTheme().themeId() 是 SolidJS 响应式 accessor，
  // 主题切换时 <Show> 会自动重新求值，确保从其他主题切到姜晓时 sprite 正确挂载。
  const theme = useTheme()
  return (
    <Show when={theme.themeId() === "jiangxiao"}>
      <svg
        aria-hidden="true"
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", "pointer-events": "none" }}
      >
        <defs>
          {(Object.keys(ICON_PATHS) as JiangxiaoIconName[]).map((name) => (
            <symbol
              id={`jx-icon-${name}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d={ICON_PATHS[name]} />
            </symbol>
          ))}
        </defs>
      </svg>
    </Show>
  )
}

/**
 * 唐风线描图标：通过 `<use>` 引用 sprite 中的 symbol。
 * stroke 继承 currentColor，随父元素 color 联动（hover/active）。
 */
export function JiangxiaoIcon(props: {
  name: JiangxiaoIconName
  size?: JiangxiaoIconSize
  class?: string
  "aria-label"?: string
  title?: string
}): JSX.Element {
  const size = props.size ?? 16
  const label = props["aria-label"] ?? props.title
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : "true"}
    >
      <Show when={props.title}>
        <title>{props.title}</title>
      </Show>
      <use href={`#jx-icon-${props.name}`} />
    </svg>
  )
}