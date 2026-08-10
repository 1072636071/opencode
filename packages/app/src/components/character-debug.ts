// character-debug: 调试叠加层（调试牌子 + 播放日志）的纯函数模块。
//
// 与 character-state / transition / position 并列的 seam。无 DOM 依赖、无副作用，
// 所有时间输入通过参数（ms 时间戳）传入，可在 bun:test 中确定性测试。
// 职责：
//   - deriveBadgeLines：牌子第二行文案推导（loop / 过渡段序 / crossfade / 404）。
//   - formatLog / pushLog / clearLog：播放日志条目格式化 + 200 条环形缓冲。
// PRD：.scratch/animation-overlay/PRD.md；决策 D3/D4/D12/D13（docs/memorial/archived/001-animation-overlay/context.md）。

import type { CharacterState } from "./character-state"

/** 中文状态标签（与演示面板 DEMO_STATES 的 label 一致，作为牌子第一行）。 */
export const STATE_LABELS: Record<CharacterState, string> = {
  idle: "待机",
  thinking: "思考",
  reading: "思考·看书",
  replying: "回复",
  working: "工作",
  error: "报错",
  welcome: "欢迎",
  done: "完成",
  permission: "权限",
  listening: "等待输入",
}

/** 牌子播放场景：由组件把当前播放状态归一化为该结构后传入推导。 */
export type BadgePlayback = {
  /** 当前目标状态（reducer 的 state）。 */
  state: CharacterState
  /** 当前播放的过渡段序列；空数组 = 非过渡播放。 */
  segs: ReadonlyArray<{ webp: string }>
  /** 当前过渡段索引；-1 = 无过渡。 */
  segIdx: number
  /** 是否处于 crossfade 兜底播放中。 */
  crossfading: boolean
  /** 当前素材加载失败的文件名（basename）；undefined = 无失败。 */
  failedFile?: string
}

/** 取文件名（去掉 `/character/` 前缀）。导出供播放层复用（避免各处内联 split）。 */
export const webpBasename = (p: string) => {
  const i = p.lastIndexOf("/")
  return i >= 0 ? p.slice(i + 1) : p
}

/**
 * 推导调试牌子两行文案：
 * - 第一行：中文状态名（复用 STATE_LABELS）。
 * - 第二行优先级（D12）：素材失败 `{file} · 404` > 过渡播放 `{段webp} · 段n/m` >
 *   crossfade 兜底 `crossfade 100ms` > 循环播放 `{state}.webp · loop`。
 */
export function deriveBadgeLines(playback: BadgePlayback): { line1: string; line2: string } {
  const line1 = STATE_LABELS[playback.state] ?? playback.state
  let line2: string
  if (playback.failedFile) {
    line2 = `${playback.failedFile} · 404`
  } else if (playback.segs.length > 0 && playback.segIdx >= 0) {
    const seg = playback.segs[playback.segIdx]
    line2 = `${webpBasename(seg.webp)} · 段${playback.segIdx + 1}/${playback.segs.length}`
  } else if (playback.crossfading) {
    line2 = "crossfade 100ms"
  } else {
    line2 = `${playback.state}.webp · loop`
  }
  return { line1, line2 }
}

/** 播放日志环形缓冲容量（D13：200 条）。 */
export const LOG_CAPACITY = 200

/** 状态切换触发源区分（PRD「状态切换（含触发源区分）」）。 */
export type LogSource = "tick" | "event"

/** 播放日志条目：typed union，纯数据。at = ms 时间戳。 */
export type PlaybackLogEntry =
  | {
      kind: "transition"
      from: CharacterState
      to: CharacterState
      file: string
      segIndex: number
      total: number
      durMs: number
      source: LogSource
      at: number
    }
  | { kind: "crossfade"; from: CharacterState; to: CharacterState; source: LogSource; at: number }
  | { kind: "missing"; file: string; at: number }
  | { kind: "force"; state: CharacterState; at: number }
  | { kind: "auto"; at: number }
  | { kind: "log-open"; at: number }
  | { kind: "log-clear"; at: number }

/** `HH:MM:SS` 时间戳（基于 ms 时间戳，可确定性测试）。 */
export function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 单条播放日志格式化（D13）。transition/crossfade 末尾带触发源（tick/event）区分。 */
export function formatLog(entry: PlaybackLogEntry): string {
  const t = formatTime(entry.at)
  switch (entry.kind) {
    case "transition":
      return `[${t}] ${entry.from}→${entry.to} · ${entry.file}(${entry.segIndex + 1}/${entry.total}) · ${entry.durMs}ms · ${entry.source}`
    case "crossfade":
      return `[${t}] crossfade兜底 ${entry.from}→${entry.to} · ${entry.source}`
    case "missing":
      return `[${t}] 素材缺失 ${entry.file}`
    case "force":
      return `[${t}] force: ${entry.state}`
    case "auto":
      return `[${t}] auto恢复`
    case "log-open":
      return `[${t}] 日志窗打开`
    case "log-clear":
      return `[${t}] 日志清空`
  }
}

/** 向环形缓冲压入一条日志；超过 LOG_CAPACITY 时 FIFO 滚出最早的。返回新数组。 */
export function pushLog(buffer: readonly string[], entry: PlaybackLogEntry): string[] {
  const next = [...buffer, formatLog(entry)]
  if (next.length > LOG_CAPACITY) next.splice(0, next.length - LOG_CAPACITY)
  return next
}

/** 清空日志缓冲（返回空数组）。 */
export function clearLog(): string[] {
  return []
}
