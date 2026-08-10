// character-transition: 状态切换过渡段解析的纯函数模块。
//
// 唯一 seam：getTransitionPath(from, to) → TransitionSegment[]。
// 无 DOM 依赖、无副作用——不访问 window/document/定时器，可在 bun:test 中独立确定性测试。
// ADR-013 §10：枢纽制过渡视频，状态 A→B 有直达段则播 1 段，否则经 idle 枢纽 2 段，无素材回空序列
// 由播放层走 crossfade 兜底。
//
// TRANSITIONS 表以 docs/video/transition-*.mp4 经 chroma_key_green.py 抠绿转出的
// public/character/transition-*.webp 文件为准（工单 01 产物）。key 格式 "<from>→<to>"，
// 对应文件 transition-<from>-<to>.webp。durationMs = 帧数 / 15fps（素材侧 --hold-tail 尾帧静置已计入帧数）。

import type { CharacterState } from "./character-state"

/** 过渡播放段：webp 素材 + 时长 + 唯一 key（供播放层打断作废判定）。 */
export type TransitionSegment = {
  /** webp 素材路径（public 下相对路径）。 */
  webp: string
  /** 播放时长（ms）= 帧数 / 15fps，含素材侧 hold-tail 尾帧静置。 */
  durationMs: number
  /** 唯一键 "<from>→<to>"，用于「当前过渡 id + 目标态」作废判定。 */
  key: string
}

/** 每帧时长（ms）= 1000 / 15fps。 */
const FRAME_MS = Math.round(1000 / 15)

/** 已生成过渡段的帧数 → durationMs 快速换算。 */
const DURATION_MS = {
  52: Math.round((52 * 1000) / 15), // 3467ms
  82: Math.round((82 * 1000) / 15), // 5467ms
} as const

/** 过渡段定义：(from, to, 帧数)。帧数取自工单 01 帧数汇总（含 hold-tail）。 */
// 注：B 级扩展态（cheek-rest 等）尚未进 reducer 的 CharacterState，故段端点类型用 string 放宽。
// prettier-ignore
const SEGMENTS: ReadonlyArray<readonly [string, string, number]> = [
  // idle 枢纽：正放 idle→X
  ["idle", "done", 52], ["idle", "error", 82], ["idle", "listening", 82],
  ["idle", "permission", 52], ["idle", "reading", 82], ["idle", "replying", 52],
  ["idle", "thinking", 52], ["idle", "welcome", 52], ["idle", "working", 52],
  // idle 枢纽：倒放 X→idle
  ["done", "idle", 52], ["error", "idle", 82], ["listening", "idle", 82],
  ["permission", "idle", 52], ["reading", "idle", 82], ["replying", "idle", 52],
  ["thinking", "idle", 52], ["welcome", "idle", 52], ["working", "idle", 52],
  // 直达链：核心 10 态内 thinking↔replying
  ["thinking", "replying", 82], ["replying", "thinking", 82],
  // B 级扩展态段（第二阶段接入 reducer，先入表不影响第一阶段）
  ["idle", "cheek-rest", 82], ["cheek-rest", "idle", 82],
  ["idle", "chin-rest", 82], ["chin-rest", "idle", 82],
  ["idle", "frown-wave", 82], ["frown-wave", "idle", 82],
  ["idle", "nod-smile", 82], ["nod-smile", "idle", 82],
  ["idle", "shush", 82], ["shush", "idle", 82],
  ["idle", "shy-smile", 82], ["shy-smile", "idle", 82],
  ["frown-wave", "permission", 52], ["permission", "frown-wave", 52],
  ["nod-smile", "permission", 52], ["permission", "nod-smile", 52],
]

/**
 * TRANSITIONS 常量表：key "<from>→<to>" → { webp, durationMs }。
 * 覆盖全部已生成过渡段（正放 + 倒放文件本体），供 getTransitionPath 与完整性测试使用。
 */
export const TRANSITIONS: Readonly<Record<string, TransitionSegment>> = Object.freeze(
  Object.fromEntries(
    SEGMENTS.map(([from, to, frames]) => [
      `${from}→${to}`,
      {
        webp: `/character/transition-${from}-${to}.webp`,
        durationMs: DURATION_MS[frames as 52 | 82] ?? Math.round((frames * 1000) / 15),
        key: `${from}→${to}`,
      } satisfies TransitionSegment,
    ]),
  ),
)

/** 过渡段在表中的查找。 */
function lookup(from: CharacterState, to: CharacterState): TransitionSegment | undefined {
  return TRANSITIONS[`${from}→${to}`]
}

/**
 * 解析状态切换过渡段序列：
 * - from === to → 空序列（无过渡）；
 * - 有直达段（from→to 在表）→ 1 段；
 * - 否则经枢纽 → 2 段（from→idle + idle→to，两段都需在表；任一缺失则落空）；
 * - 无素材 → 空序列（调用方走 crossfade 兜底）。
 */
export function getTransitionPath(from: CharacterState, to: CharacterState): TransitionSegment[] {
  if (from === to) return []
  const direct = lookup(from, to)
  if (direct) return [direct]
  const a = lookup(from, "idle")
  const b = lookup("idle", to)
  if (a && b) return [a, b]
  return []
}
