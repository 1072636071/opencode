import { describe, expect, test } from "bun:test"
import {
  LOG_CAPACITY,
  clearLog,
  deriveBadgeLines,
  formatLog,
  formatTime,
  pushLog,
  type BadgePlayback,
  type PlaybackLogEntry,
} from "./character-debug"

const seg = (webp: string) => ({ webp })
const at = (h: number, m: number, s: number) => new Date(2026, 7, 10, h, m, s).getTime()

describe("deriveBadgeLines", () => {
  test("loop playback shows {state}.webp · loop", () => {
    const p: BadgePlayback = { state: "thinking", segs: [], segIdx: -1, crossfading: false }
    expect(deriveBadgeLines(p)).toEqual({ line1: "思考", line2: "thinking.webp · loop" })
  })

  test("transition playback shows current segment 段1/1", () => {
    const p: BadgePlayback = {
      state: "thinking",
      segs: [seg("/character/transition-idle-thinking.webp")],
      segIdx: 0,
      crossfading: false,
    }
    expect(deriveBadgeLines(p)).toEqual({ line1: "思考", line2: "transition-idle-thinking.webp · 段1/1" })
  })

  test("multi-segment transition progresses 段序 (段1/2 → 段2/2)", () => {
    const segs = [
      seg("/character/transition-reading-idle.webp"),
      seg("/character/transition-idle-error.webp"),
    ]
    expect(deriveBadgeLines({ state: "error", segs, segIdx: 0, crossfading: false })).toEqual({
      line1: "报错",
      line2: "transition-reading-idle.webp · 段1/2",
    })
    expect(deriveBadgeLines({ state: "error", segs, segIdx: 1, crossfading: false })).toEqual({
      line1: "报错",
      line2: "transition-idle-error.webp · 段2/2",
    })
  })

  test("crossfade fallback shows crossfade 100ms", () => {
    expect(deriveBadgeLines({ state: "error", segs: [], segIdx: -1, crossfading: true })).toEqual({
      line1: "报错",
      line2: "crossfade 100ms",
    })
  })

  test("asset failure shows {file} · 404", () => {
    expect(
      deriveBadgeLines({ state: "welcome", segs: [], segIdx: -1, crossfading: false, failedFile: "welcome.webp" }),
    ).toEqual({ line1: "欢迎", line2: "welcome.webp · 404" })
  })

  test("asset failure takes priority even during transition", () => {
    expect(
      deriveBadgeLines({
        state: "thinking",
        segs: [seg("/character/transition-idle-thinking.webp")],
        segIdx: 0,
        crossfading: false,
        failedFile: "thinking.webp",
      }),
    ).toEqual({ line1: "思考", line2: "thinking.webp · 404" })
  })
})

describe("formatTime", () => {
  test("zero-pads hours/minutes/seconds", () => {
    expect(formatTime(at(9, 5, 7))).toBe("09:05:07")
  })
  test("no padding needed when values are double-digit", () => {
    expect(formatTime(at(19, 30, 45))).toBe("19:30:45")
  })
  test("epoch renders 00:00:00 (local)", () => {
    const d = new Date(0)
    const pad = (n: number) => String(n).padStart(2, "0")
    expect(formatTime(0)).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`)
  })
})

describe("formatLog", () => {
  test("transition entry format: [HH:MM:SS] from→to · file(seg/total) · durMs · source", () => {
    const entry: PlaybackLogEntry = {
      kind: "transition",
      from: "idle",
      to: "thinking",
      file: "transition-idle-thinking.webp",
      segIndex: 0,
      total: 1,
      durMs: 3467,
      source: "event",
      at: at(9, 5, 7),
    }
    expect(formatLog(entry)).toBe("[09:05:07] idle→thinking · transition-idle-thinking.webp(1/1) · 3467ms · event")
  })

  test("multi-segment transition second seg index with tick source", () => {
    const entry: PlaybackLogEntry = {
      kind: "transition",
      from: "reading",
      to: "error",
      file: "transition-idle-error.webp",
      segIndex: 1,
      total: 2,
      durMs: 5467,
      source: "tick",
      at: at(9, 5, 8),
    }
    expect(formatLog(entry)).toBe("[09:05:08] reading→error · transition-idle-error.webp(2/2) · 5467ms · tick")
  })

  test("crossfade fallback entry with source", () => {
    const entry: PlaybackLogEntry = { kind: "crossfade", from: "idle", to: "error", source: "tick", at: at(9, 5, 9) }
    expect(formatLog(entry)).toBe("[09:05:09] crossfade兜底 idle→error · tick")
  })

  test("missing asset entry", () => {
    const entry: PlaybackLogEntry = { kind: "missing", file: "welcome.webp", at: at(9, 5, 10) }
    expect(formatLog(entry)).toBe("[09:05:10] 素材缺失 welcome.webp")
  })

  test("force entry", () => {
    const entry: PlaybackLogEntry = { kind: "force", state: "working", at: at(9, 5, 11) }
    expect(formatLog(entry)).toBe("[09:05:11] force: working")
  })

  test("auto restore entry", () => {
    const entry: PlaybackLogEntry = { kind: "auto", at: at(9, 5, 12) }
    expect(formatLog(entry)).toBe("[09:05:12] auto恢复")
  })

  test("log window open/clear entries", () => {
    expect(formatLog({ kind: "log-open", at: at(9, 5, 13) })).toBe("[09:05:13] 日志窗打开")
    expect(formatLog({ kind: "log-clear", at: at(9, 5, 14) })).toBe("[09:05:14] 日志清空")
  })
})

describe("pushLog ring buffer", () => {
  test("push appends entries in order", () => {
    let buf: string[] = []
    buf = pushLog(buf, { kind: "log-open", at: at(9, 5, 13) })
    buf = pushLog(buf, { kind: "auto", at: at(9, 5, 14) })
    expect(buf).toHaveLength(2)
    expect(buf[0]).toContain("日志窗打开")
    expect(buf[1]).toContain("auto恢复")
  })

  test("buffer rolls off oldest when exceeding capacity (FIFO)", () => {
    let buf: string[] = []
    for (let i = 0; i < LOG_CAPACITY + 10; i++) {
      buf = pushLog(buf, { kind: "force", state: "idle", at: i })
    }
    expect(buf).toHaveLength(LOG_CAPACITY)
    // 最旧 10 条（at=0..9）被滚出：第一条是 at=10，最后一条是 at=209
    expect(buf[0]).toContain(formatTime(10))
    expect(buf[LOG_CAPACITY - 1]).toContain(formatTime(LOG_CAPACITY + 9))
  })

  test("buffer does not roll off under capacity", () => {
    let buf: string[] = []
    for (let i = 0; i < LOG_CAPACITY - 1; i++) {
      buf = pushLog(buf, { kind: "force", state: "idle", at: i })
    }
    expect(buf).toHaveLength(LOG_CAPACITY - 1)
    expect(buf[0]).toContain(formatTime(0))
  })

  test("clearLog returns empty", () => {
    let buf = pushLog([], { kind: "auto", at: at(9, 5, 0) })
    expect(buf).toHaveLength(1)
    expect(clearLog()).toEqual([])
  })
})
