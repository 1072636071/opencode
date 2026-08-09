import { describe, expect, test } from "bun:test"
import {
  COMPLETE_HOLD_MIN_MS,
  initialCharacterStatus,
  reduceCharacter,
  THINKING2_THRESHOLD_MS,
  WELCOME_HOLD_MS,
  type CharacterEvent,
  type CharacterStatus,
} from "./character-state"

// 连续应用事件，时间从 0 起按 events 顺序递增（每步 +1ms），返回最终状态。
// 需要指定时间的用 runAt。
function run(events: CharacterEvent[]): CharacterStatus {
  let status = initialCharacterStatus(0)
  let now = 0
  for (const event of events) {
    now += 1
    status = reduceCharacter(status, event, now)
  }
  return status
}

// 应用单事件于给定状态。
function step(state: CharacterStatus, event: CharacterEvent, now: number): CharacterStatus {
  return reduceCharacter(state, event, now)
}

describe("character-state reducer", () => {
  test("initial state is idle", () => {
    expect(initialCharacterStatus(0).state).toBe("idle")
  })

  test("all 10 states are reachable via their trigger events", () => {
    // idle（初始）
    expect(initialCharacterStatus(0).state).toBe("idle")
    // thinking：prompt_admitted
    expect(run([{ type: "prompt_admitted" }]).state).toBe("thinking")
    // replying：prompt → text_delta
    expect(run([{ type: "prompt_admitted" }, { type: "text_delta" }]).state).toBe("replying")
    // working：tool_called
    expect(run([{ type: "prompt_admitted" }, { type: "tool_called" }]).state).toBe("working")
    // error：session_error
    expect(run([{ type: "session_error" }]).state).toBe("error")
    // welcome：server_connected
    expect(run([{ type: "server_connected" }]).state).toBe("welcome")
    // complete：replying → execution_finished(pendingTools=false)
    expect(run([
      { type: "prompt_admitted" },
      { type: "text_delta" },
      { type: "execution_finished", pendingTools: false },
    ]).state).toBe("complete")
    // permission：permission_asked
    expect(run([{ type: "permission_asked" }]).state).toBe("permission")
    // waiting：replying → text_ended
    expect(run([{ type: "prompt_admitted" }, { type: "text_delta" }, { type: "text_ended" }]).state).toBe("waiting")
    // thinking2：thinking 持续超 8s 后 tick
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking at 1
    s = step(s, { type: "tick" }, 1 + THINKING2_THRESHOLD_MS) // 超时
    expect(s.state).toBe("thinking2")
  })

  test("error preempts everything", () => {
    // error 打断 working
    expect(run([{ type: "tool_called" }, { type: "session_error" }]).state).toBe("error")
    // error 打断 permission
    expect(run([{ type: "permission_asked" }, { type: "session_error" }]).state).toBe("error")
    // error 打断 thinking
    expect(run([{ type: "prompt_admitted" }, { type: "session_error" }]).state).toBe("error")
    // error 打断 replying
    expect(run([{ type: "text_delta" }, { type: "session_error" }]).state).toBe("error")
  })

  test("working preempts thinking and replying but not error", () => {
    // working 打断 thinking
    expect(run([{ type: "prompt_admitted" }, { type: "tool_called" }]).state).toBe("working")
    // working 打断 replying
    expect(run([{ type: "text_delta" }, { type: "tool_called" }]).state).toBe("working")
    // working 不打断 error
    expect(run([{ type: "session_error" }, { type: "tool_called" }]).state).toBe("error")
  })

  test("permission preempts thinking and replying but not error/working", () => {
    // permission 打断 thinking
    expect(run([{ type: "prompt_admitted" }, { type: "permission_asked" }]).state).toBe("permission")
    // permission 打断 replying
    expect(run([{ type: "text_delta" }, { type: "permission_asked" }]).state).toBe("permission")
    // permission 不打断 error
    expect(run([{ type: "session_error" }, { type: "permission_asked" }]).state).toBe("error")
    // permission 不打断 working
    expect(run([{ type: "tool_called" }, { type: "permission_asked" }]).state).toBe("working")
  })

  test("low-priority events do not preempt high-priority states", () => {
    // text_delta 不打断 working
    expect(run([{ type: "tool_called" }, { type: "text_delta" }]).state).toBe("working")
    // prompt_admitted 不打断 working
    expect(run([{ type: "tool_called" }, { type: "prompt_admitted" }]).state).toBe("working")
    // prompt_admitted 不打断 permission
    expect(run([{ type: "permission_asked" }, { type: "prompt_admitted" }]).state).toBe("permission")
    // text_delta 不打断 permission
    expect(run([{ type: "permission_asked" }, { type: "text_delta" }]).state).toBe("permission")
    // session_idle 不打断 working
    expect(run([{ type: "tool_called" }, { type: "session_idle" }]).state).toBe("working")
  })

  test("complete: execution_finished without pending tools plays then returns to idle", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    s = step(s, { type: "text_delta" }, 2)
    s = step(s, { type: "execution_finished", pendingTools: false }, 3)
    expect(s.state).toBe("complete")
    expect(s.completeSince).toBe(3)
    // 未满 3s 不切待机
    s = step(s, { type: "tick" }, 3 + COMPLETE_HOLD_MIN_MS - 1)
    expect(s.state).toBe("complete")
    // 满 3s 切待机
    s = step(s, { type: "tick" }, 3 + COMPLETE_HOLD_MIN_MS)
    expect(s.state).toBe("idle")
    expect(s.completeSince).toBeUndefined()
  })

  test("complete: pending tools suppresses complete", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    s = step(s, { type: "text_delta" }, 2)
    s = step(s, { type: "execution_finished", pendingTools: true }, 3)
    // 有 pending 工具时不触发 complete，保持 replying
    expect(s.state).toBe("replying")
  })

  test("complete: does not trigger from idle/welcome/waiting", () => {
    // idle 下 execution_finished 不切 complete
    expect(step(initialCharacterStatus(0), { type: "execution_finished", pendingTools: false }, 1).state).toBe("idle")
    // waiting 下不切 complete
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    s = step(s, { type: "text_delta" }, 2)
    s = step(s, { type: "text_ended" }, 3)
    s = step(s, { type: "execution_finished", pendingTools: false }, 4)
    expect(s.state).toBe("waiting")
  })

  test("thinking2: auto-engages after ~8s of thinking", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 100) // thinking at 100
    expect(s.thinkingSince).toBe(100)
    // 未满 8s 不切
    s = step(s, { type: "tick" }, 100 + THINKING2_THRESHOLD_MS - 1)
    expect(s.state).toBe("thinking")
    // 满 8s 切 thinking2
    s = step(s, { type: "tick" }, 100 + THINKING2_THRESHOLD_MS)
    expect(s.state).toBe("thinking2")
  })

  test("thinking2: any business event switches back immediately", () => {
    // text_delta → replying（切回）
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    s = step(s, { type: "tick" }, 1 + THINKING2_THRESHOLD_MS)
    expect(s.state).toBe("thinking2")
    s = step(s, { type: "text_delta" }, 1 + THINKING2_THRESHOLD_MS + 1)
    expect(s.state).toBe("replying")

    // tool_called → working（切回）
    s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    s = step(s, { type: "tick" }, 1 + THINKING2_THRESHOLD_MS)
    expect(s.state).toBe("thinking2")
    s = step(s, { type: "tool_called" }, 1 + THINKING2_THRESHOLD_MS + 1)
    expect(s.state).toBe("working")

    // session_idle → idle（切回）
    s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    s = step(s, { type: "tick" }, 1 + THINKING2_THRESHOLD_MS)
    expect(s.state).toBe("thinking2")
    s = step(s, { type: "session_idle" }, 1 + THINKING2_THRESHOLD_MS + 1)
    expect(s.state).toBe("idle")

    // prompt_admitted → thinking（切回并重置计时）
    s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    s = step(s, { type: "tick" }, 1 + THINKING2_THRESHOLD_MS)
    expect(s.state).toBe("thinking2")
    s = step(s, { type: "prompt_admitted" }, 100)
    expect(s.state).toBe("thinking")
    expect(s.thinkingSince).toBe(100)
  })

  test("thinking2: tick keeps thinking2 (no switch back on tick)", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    s = step(s, { type: "tick" }, 1 + THINKING2_THRESHOLD_MS)
    expect(s.state).toBe("thinking2")
    s = step(s, { type: "tick" }, 1 + THINKING2_THRESHOLD_MS + 100)
    expect(s.state).toBe("thinking2")
  })

  test("welcome: plays once then returns to idle", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "server_connected" }, 1)
    expect(s.state).toBe("welcome")
    expect(s.welcomeSince).toBe(1)
    // 未满时长不切
    s = step(s, { type: "tick" }, 1 + WELCOME_HOLD_MS - 1)
    expect(s.state).toBe("welcome")
    // 满时长切待机
    s = step(s, { type: "tick" }, 1 + WELCOME_HOLD_MS)
    expect(s.state).toBe("idle")
    expect(s.welcomeSince).toBeUndefined()
  })

  test("session_idle: deprecated session.idle and session.status(idle) both map to session_idle", () => {
    // 从 thinking 切 idle
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    s = step(s, { type: "session_idle" }, 2)
    expect(s.state).toBe("idle")
    // 从 replying 切 idle
    s = initialCharacterStatus(0)
    s = step(s, { type: "text_delta" }, 1)
    s = step(s, { type: "session_idle" }, 2)
    expect(s.state).toBe("idle")
    // 不打断 working
    s = initialCharacterStatus(0)
    s = step(s, { type: "tool_called" }, 1)
    s = step(s, { type: "session_idle" }, 2)
    expect(s.state).toBe("working")
  })

  test("same-priority events do not preempt each other (arrival order preserved)", () => {
    // replying(2) 下 prompt_admitted(→thinking,2) 同级不抢占，保持 replying
    let s = initialCharacterStatus(0)
    s = step(s, { type: "text_delta" }, 1) // replying
    s = step(s, { type: "prompt_admitted" }, 2) // 同级 thinking，不抢占
    expect(s.state).toBe("replying")
    // thinking(2) 下 text_ended(→waiting,2) 同级不抢占，保持 thinking
    s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking
    s = step(s, { type: "text_ended" }, 2) // 同级 waiting，不抢占
    expect(s.state).toBe("thinking")
  })

  test("unknown events are ignored (state unchanged)", () => {
    const s = initialCharacterStatus(0)
    // 未知事件类型（通过 as 绕过类型检查模拟运行时未知事件）
    const next = reduceCharacter(s, { type: "totally_unknown_event" } as unknown as CharacterEvent, 1)
    expect(next).toBe(s)
    // 已进入 thinking 后未知事件也不改变
    const thinking = step(s, { type: "prompt_admitted" }, 1)
    const next2 = reduceCharacter(thinking, { type: "???" } as unknown as CharacterEvent, 2)
    expect(next2).toBe(thinking)
  })

  test("tool_finished returns to preWorking state", () => {
    // thinking → working → tool_finished 回 thinking
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking
    s = step(s, { type: "tool_called" }, 2) // working, preWorking=thinking
    expect(s.preWorking).toBe("thinking")
    s = step(s, { type: "tool_finished" }, 3)
    expect(s.state).toBe("thinking")
    expect(s.preWorking).toBeUndefined()
    // replying → working → tool_finished 回 replying
    s = initialCharacterStatus(0)
    s = step(s, { type: "text_delta" }, 1) // replying
    s = step(s, { type: "tool_called" }, 2) // working, preWorking=replying
    s = step(s, { type: "tool_finished" }, 3)
    expect(s.state).toBe("replying")
  })

  test("tool_finished is ignored when not working", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking
    s = step(s, { type: "tool_finished" }, 2) // 非 working，忽略
    expect(s.state).toBe("thinking")
  })

  test("permission_replied returns to prePermission state", () => {
    // thinking → permission → permission_replied 回 thinking
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking
    s = step(s, { type: "permission_asked" }, 2) // permission, prePermission=thinking
    expect(s.prePermission).toBe("thinking")
    s = step(s, { type: "permission_replied" }, 3)
    expect(s.state).toBe("thinking")
    expect(s.prePermission).toBeUndefined()
    // replying → permission → permission_replied 回 replying
    s = initialCharacterStatus(0)
    s = step(s, { type: "text_delta" }, 1) // replying
    s = step(s, { type: "permission_asked" }, 2) // permission
    s = step(s, { type: "permission_replied" }, 3)
    expect(s.state).toBe("replying")
  })

  test("permission_replied defaults to idle when no prePermission", () => {
    // 直接 permission_asked（从 idle）→ permission_replied 回 idle
    let s = initialCharacterStatus(0)
    s = step(s, { type: "permission_asked" }, 1) // permission, prePermission=idle
    s = step(s, { type: "permission_replied" }, 2)
    expect(s.state).toBe("idle")
  })

  test("seq increments on each state-changing event", () => {
    let s = initialCharacterStatus(0)
    expect(s.seq).toBe(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    expect(s.seq).toBe(1)
    s = step(s, { type: "text_delta" }, 2)
    expect(s.seq).toBe(2)
    // 被忽略的事件不递增 seq
    s = step(s, { type: "tool_finished" }, 3) // 非 working，忽略
    expect(s.seq).toBe(2)
  })

  test("full session lifecycle: prompt → thinking → replying → working → replying → complete → idle", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1)
    expect(s.state).toBe("thinking")
    s = step(s, { type: "text_delta" }, 2)
    expect(s.state).toBe("replying")
    s = step(s, { type: "tool_called" }, 3)
    expect(s.state).toBe("working")
    s = step(s, { type: "tool_finished" }, 4)
    expect(s.state).toBe("replying")
    s = step(s, { type: "execution_finished", pendingTools: false }, 5)
    expect(s.state).toBe("complete")
    s = step(s, { type: "tick" }, 5 + COMPLETE_HOLD_MIN_MS)
    expect(s.state).toBe("idle")
  })

  test("error during working then recovery", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "tool_called" }, 1) // working
    s = step(s, { type: "session_error" }, 2) // error 抢占 working
    expect(s.state).toBe("error")
    // 新 prompt 开始新轮次，从 error 切回 thinking
    s = step(s, { type: "prompt_admitted" }, 3)
    expect(s.state).toBe("thinking")
  })

  test("thinking2 resets thinking timer on new prompt", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking at 1
    s = step(s, { type: "tick" }, 1 + THINKING2_THRESHOLD_MS) // thinking2
    expect(s.state).toBe("thinking2")
    // 新 prompt 切回 thinking 并重置 thinkingSince
    s = step(s, { type: "prompt_admitted" }, 1000)
    expect(s.state).toBe("thinking")
    expect(s.thinkingSince).toBe(1000)
    // 重新计时 8s 才切 thinking2
    s = step(s, { type: "tick" }, 1000 + THINKING2_THRESHOLD_MS - 1)
    expect(s.state).toBe("thinking")
    s = step(s, { type: "tick" }, 1000 + THINKING2_THRESHOLD_MS)
    expect(s.state).toBe("thinking2")
  })

  // ---------- 工单 07：演示/调试 强制切态 + 回到自动（override 机制） ----------

  test("force: pins any of the 10 states and freezes tick timing", () => {
    const states = [
      "idle", "thinking", "thinking2", "replying", "working", "error",
      "welcome", "complete", "permission", "waiting",
    ] as const
    for (const target of states) {
      let s = initialCharacterStatus(0)
      s = step(s, { type: "force", state: target }, 1)
      expect(s.state).toBe(target)
      expect(s.override).toBe(target)
      // 演示模式下 tick 不自动流转（complete/welcome 不延时切待机，thinking 不超时切 thinking2）
      s = step(s, { type: "tick" }, 1 + Math.max(THINKING2_THRESHOLD_MS, COMPLETE_HOLD_MIN_MS, WELCOME_HOLD_MS))
      expect(s.state).toBe(target)
    }
  })

  test("force: remembers preOverride; auto restores it", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking
    s = step(s, { type: "force", state: "complete" }, 2)
    expect(s.state).toBe("complete")
    expect(s.preOverride).toBe("thinking")
    s = step(s, { type: "auto" }, 3)
    expect(s.state).toBe("thinking")
    expect(s.override).toBeUndefined()
    expect(s.preOverride).toBeUndefined()
  })

  test("force: switching pinned state keeps original preOverride", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking
    s = step(s, { type: "force", state: "error" }, 2) // preOverride=thinking
    s = step(s, { type: "force", state: "welcome" }, 3) // 保持 preOverride=thinking
    expect(s.state).toBe("welcome")
    expect(s.preOverride).toBe("thinking")
    s = step(s, { type: "auto" }, 4)
    expect(s.state).toBe("thinking")
  })

  test("force: same pinned state is idempotent (no seq bump)", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "force", state: "error" }, 1)
    const seq = s.seq
    s = step(s, { type: "force", state: "error" }, 2)
    expect(s.state).toBe("error")
    expect(s.seq).toBe(seq)
  })

  test("auto: falls back to idle when no preOverride", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "force", state: "error" }, 1)
    s = step(s, { type: "auto" }, 2)
    expect(s.state).toBe("idle")
    expect(s.override).toBeUndefined()
  })

  test("real business event clears override and is processed normally", () => {
    // 演示 error 下 session_idle：override 清除（恢复事件驱动），error 优先级高不被 idle 抢占 → 仍 error
    let s = initialCharacterStatus(0)
    s = step(s, { type: "force", state: "error" }, 1)
    s = step(s, { type: "session_idle" }, 2)
    expect(s.override).toBeUndefined()
    expect(s.state).toBe("error")
    // 演示 working 下 session_error 抢占为 error
    s = initialCharacterStatus(0)
    s = step(s, { type: "force", state: "working" }, 1)
    s = step(s, { type: "session_error" }, 2)
    expect(s.override).toBeUndefined()
    expect(s.state).toBe("error")
    // 演示 idle 下 prompt_admitted → thinking（并重计时）
    s = initialCharacterStatus(0)
    s = step(s, { type: "force", state: "idle" }, 1)
    s = step(s, { type: "prompt_admitted" }, 2)
    expect(s.override).toBeUndefined()
    expect(s.state).toBe("thinking")
    expect(s.thinkingSince).toBe(2)
    // 演示 thinking 下 text_delta → replying
    s = initialCharacterStatus(0)
    s = step(s, { type: "force", state: "thinking" }, 1)
    s = step(s, { type: "text_delta" }, 2)
    expect(s.override).toBeUndefined()
    expect(s.state).toBe("replying")
  })

  test("auto with no active override is ignored", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking
    const next = step(s, { type: "auto" }, 2)
    expect(next.state).toBe("thinking")
    expect(next.override).toBeUndefined()
  })

  test("force clears stale timing fields but keeps preWorking", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "prompt_admitted" }, 1) // thinking, thinkingSince=1
    s = step(s, { type: "tool_called" }, 2) // working, preWorking=thinking
    expect(s.preWorking).toBe("thinking")
    s = step(s, { type: "force", state: "complete" }, 3)
    expect(s.thinkingSince).toBeUndefined()
    expect(s.completeSince).toBeUndefined()
    expect(s.preWorking).toBe("thinking") // 保留回退依据
    // 真实事件 tool_finished 清除 override 恢复事件驱动；complete 下 exitWorking 无效果，仍 complete
    s = step(s, { type: "tool_finished" }, 4)
    expect(s.override).toBeUndefined()
    expect(s.state).toBe("complete")
  })

  test("complete lifecycle in demo mode: force complete stays pinned, auto returns", () => {
    let s = initialCharacterStatus(0)
    s = step(s, { type: "force", state: "complete" }, 1)
    // 演示下 complete 不延时切待机
    s = step(s, { type: "tick" }, 1 + COMPLETE_HOLD_MIN_MS * 2)
    expect(s.state).toBe("complete")
    // auto 回到进入演示前的状态（idle）
    s = step(s, { type: "auto" }, 2 + COMPLETE_HOLD_MIN_MS * 2)
    expect(s.state).toBe("idle")
    expect(s.completeSince).toBeUndefined()
  })
})