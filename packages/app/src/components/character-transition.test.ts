import { describe, expect, test } from "bun:test"
import {
  TRANSITIONS,
  getTransitionPath,
  type TransitionSegment,
} from "./character-transition"

// 素材目录 public/character/transition-*.webp 实际产物清单（工单 01 已生成，36 文件，含正放+倒放）。
// 表完整性测试用它比对：TRANSITIONS 每条 webp 必须与清单一一对应。
// prettier-ignore
const ASSET_WEBP_FILENAMES = [
  "transition-cheek-rest-idle.webp",
  "transition-chin-rest-idle.webp",
  "transition-done-idle.webp",
  "transition-error-idle.webp",
  "transition-frown-wave-idle.webp",
  "transition-frown-wave-permission.webp",
  "transition-idle-cheek-rest.webp",
  "transition-idle-chin-rest.webp",
  "transition-idle-done.webp",
  "transition-idle-error.webp",
  "transition-idle-frown-wave.webp",
  "transition-idle-listening.webp",
  "transition-idle-nod-smile.webp",
  "transition-idle-permission.webp",
  "transition-idle-reading.webp",
  "transition-idle-replying.webp",
  "transition-idle-shush.webp",
  "transition-idle-shy-smile.webp",
  "transition-idle-thinking.webp",
  "transition-idle-welcome.webp",
  "transition-idle-working.webp",
  "transition-listening-idle.webp",
  "transition-nod-smile-idle.webp",
  "transition-nod-smile-permission.webp",
  "transition-permission-frown-wave.webp",
  "transition-permission-idle.webp",
  "transition-permission-nod-smile.webp",
  "transition-reading-idle.webp",
  "transition-replying-idle.webp",
  "transition-replying-thinking.webp",
  "transition-shush-idle.webp",
  "transition-shy-smile-idle.webp",
  "transition-thinking-idle.webp",
  "transition-thinking-replying.webp",
  "transition-welcome-idle.webp",
  "transition-working-idle.webp",
] as const

const webpBasename = (seg: TransitionSegment) => seg.webp.split("/").pop() ?? ""

describe("character-transition", () => {
  test("direct hit returns 1 segment (idle→thinking, idle→working, thinking→replying)", () => {
    const p1 = getTransitionPath("idle", "thinking")
    expect(p1).toHaveLength(1)
    expect(p1[0].webp).toBe("/character/transition-idle-thinking.webp")
    expect(p1[0].key).toBe("idle→thinking")

    const p2 = getTransitionPath("idle", "working")
    expect(p2).toHaveLength(1)
    expect(p2[0].webp).toBe("/character/transition-idle-working.webp")

    const p3 = getTransitionPath("thinking", "replying")
    expect(p3).toHaveLength(1)
    expect(p3[0].webp).toBe("/character/transition-thinking-replying.webp")
  })

  test("reversed segment hit (working→idle uses transition-working-idle.webp)", () => {
    const p = getTransitionPath("working", "idle")
    expect(p).toHaveLength(1)
    expect(p[0].webp).toBe("/character/transition-working-idle.webp")
    expect(p[0].key).toBe("working→idle")
  })

  test("hub route returns 2 segments for core states without direct edge (reading→error)", () => {
    const p = getTransitionPath("reading", "error")
    expect(p).toHaveLength(2)
    expect(p[0].webp).toBe("/character/transition-reading-idle.webp") // reading→idle 倒放
    expect(p[1].webp).toBe("/character/transition-idle-error.webp") // idle→error 正放
    // 段时长取自素材帧数（reading→idle 82 帧、idle→error 82 帧）
    expect(p[0].durationMs).toBe(Math.round((82 * 1000) / 15))
    expect(p[1].durationMs).toBe(Math.round((82 * 1000) / 15))
  })

  test("hub route: listening→working → listening→idle + idle→working", () => {
    const p = getTransitionPath("listening", "working")
    expect(p).toHaveLength(2)
    expect(p[0].key).toBe("listening→idle")
    expect(p[1].key).toBe("idle→working")
  })

  test("from === to returns empty sequence", () => {
    for (const s of ["idle", "thinking", "replying", "working", "done"] as const) {
      expect(getTransitionPath(s, s)).toEqual([])
    }
  })

  test("unknown state with no material returns empty sequence (crossfade fallback)", () => {
    // 构造表中不存在的状态名，lookup 失败 → 空序列
    const p = getTransitionPath("idle" as never, "unknown-state" as never)
    expect(p).toEqual([])
  })

  test("TRANSITIONS table completeness: every key maps to a real asset file, durationMs > 0", () => {
    const keys = Object.keys(TRANSITIONS)
    expect(keys.length).toBe(ASSET_WEBP_FILENAMES.length)

    const webpFiles = keys.map((k) => webpBasename(TRANSITIONS[k]))
    const expectedSet = new Set<string>(ASSET_WEBP_FILENAMES)
    // 无缺失：每个素材文件都被表引用
    for (const f of webpFiles) {
      expect(expectedSet.has(f), `表引用了不存在素材 ${f}`).toBe(true)
    }
    // 无多余：表引用的文件不超出素材清单
    const webpSet = new Set(webpFiles)
    for (const f of ASSET_WEBP_FILENAMES) {
      expect(webpSet.has(f), `素材 ${f} 未入表`).toBe(true)
    }
    // 每条 durationMs > 0
    for (const seg of Object.values(TRANSITIONS)) {
      expect(seg.durationMs).toBeGreaterThan(0)
    }
  })
})
