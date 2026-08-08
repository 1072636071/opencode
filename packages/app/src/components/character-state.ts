// character-state: 会话事件 → 角色状态 的纯函数 reducer。
//
// 唯一 seam：reduceCharacter(currentStatus, event, now) → nextStatus。
// 无 DOM 依赖、无副作用、无 setTimeout——所有时序由调用方传入的 now（毫秒）驱动，
// 因此可在 bun:test 中独立、确定性地测试。
//
// 事件名核实结论（实现前已完成）：
//   PRD 映射表里的 session.next.* 系列在 app 实际处理中均使用不带 .next. 的 V2 事件名，
//   归一化层（调用方）负责把 V1/V2 SDK 原始事件映射为下方的 CharacterEvent。
//   - session.next.text.delta   → V2 session.text.delta
//   - session.next.text.ended   → V2 session.text.ended
//   - session.next.prompt.admitted → V2 session.input.admitted（或 V1 message.updated role=user）
//   - session.next.tool.called  → V2 session.tool.called
//   - session.next.tool.success → V2 session.tool.success
//   - session.next.tool.failed  → V2 session.tool.failed
//   - session.error / session.idle / session.status / message.updated / permission.* / server.connected 为 V1。

/** 10 个角色状态。 */
export type CharacterState =
  | "idle"
  | "thinking"
  | "thinking2"
  | "replying"
  | "working"
  | "error"
  | "welcome"
  | "complete"
  | "permission"
  | "waiting"

/**
 * 归一化后的角色事件。调用方把 V1/V2 SDK 原始事件映射为此联合类型后喂给 reducer。
 * 每个事件类型对应 PRD 状态触发映射表的一行。
 */
export type CharacterEvent =
  // 待机：V1 session.idle（deprecated）或 session.status status.type=idle 兜底
  | { type: "session_idle" }
  // 思考：收到用户 prompt（V2 session.input.admitted / V1 message.updated role=user）
  | { type: "prompt_admitted" }
  // 回复：assistant 流式输出（V2 session.text.delta / V1 message.updated role=assistant）
  | { type: "text_delta" }
  // 等待输入：assistant 流式结束（V2 session.text.ended）
  | { type: "text_ended" }
  // 工作：工具调用开始（V2 session.tool.called）
  | { type: "tool_called" }
  // 工具调用结束（V2 session.tool.success / session.tool.failed）——退出 working 回到先前态
  | { type: "tool_finished" }
  // 报错：V1 session.error
  | { type: "session_error" }
  // 欢迎：V1 server.connected（启动画面关闭后播一轮 → 待机）
  | { type: "server_connected" }
  // 完成：V2 session.execution.succeeded/failed/interrupted。pendingTools=true 时不触发 complete。
  | { type: "execution_finished"; pendingTools: boolean }
  // 权限：V1 permission.asked
  | { type: "permission_asked" }
  // 权限回复：V1 permission.replied——退出 permission 回到先前态
  | { type: "permission_replied" }
  // 时间滴答：驱动 thinking2 超时切入、complete 延时切待机、welcome 播完切待机
  | { type: "tick" }

/** reducer 状态：当前状态 + 时序元数据。 */
export type CharacterStatus = {
  state: CharacterState
  /** thinking 进入时间戳（ms），用于 thinking2 超时判定。 */
  thinkingSince?: number
  /** complete 进入时间戳（ms），用于 3~5s 后切待机判定。 */
  completeSince?: number
  /** welcome 进入时间戳（ms），用于播一轮后切待机判定。 */
  welcomeSince?: number
  /** 进入 working 前的状态，tool_finished 回退到此态。 */
  preWorking?: CharacterState
  /** 进入 permission 前的状态，permission_replied 回退到此态。 */
  prePermission?: CharacterState
  /** 已处理的事件序号（同级按到达序的依据）。 */
  seq: number
}

// 时序常量（ms）。PRD：thinking2 ~8s；complete 播 3~5s；welcome 播一轮。
export const THINKING2_THRESHOLD_MS = 8000
export const COMPLETE_HOLD_MIN_MS = 3000
export const COMPLETE_HOLD_MAX_MS = 5000
export const WELCOME_HOLD_MS = 3000

// 状态优先级（高 → 低）：报错 > 工作 > 权限 > 思考/回复/完成/思考2 > 等待输入/欢迎/待机。
// 高优先级状态显示时，低优先级事件不能打断。
const PRIORITY: Record<CharacterState, number> = {
  error: 5,
  working: 4,
  permission: 3,
  thinking: 2,
  replying: 2,
  complete: 2,
  thinking2: 2,
  waiting: 1,
  welcome: 1,
  idle: 1,
}

/** 初始状态。 */
export function initialCharacterStatus(now: number): CharacterStatus {
  return { state: "idle", seq: 0 }
}

/**
 * 角色状态 reducer：输入 = 当前状态 + 归一化事件 + 当前时间，输出 = 新状态。
 * 纯函数，无副作用。未知事件忽略（不改变状态）。
 */
export function reduceCharacter(state: CharacterStatus, event: CharacterEvent, now: number): CharacterStatus {
  if (event.type === "tick") return applyTick(state, now)
  return applyEvent(state, event, now)
}

// 时间驱动转换：thinking2 超时切入、complete 延时切待机、welcome 播完切待机。
function applyTick(state: CharacterStatus, now: number): CharacterStatus {
  if (state.state === "thinking" && state.thinkingSince !== undefined && now - state.thinkingSince >= THINKING2_THRESHOLD_MS) {
    return { ...state, state: "thinking2", seq: state.seq + 1 }
  }
  if (state.state === "complete" && state.completeSince !== undefined && now - state.completeSince >= COMPLETE_HOLD_MIN_MS) {
    return { ...state, state: "idle", completeSince: undefined, seq: state.seq + 1 }
  }
  if (state.state === "welcome" && state.welcomeSince !== undefined && now - state.welcomeSince >= WELCOME_HOLD_MS) {
    return { ...state, state: "idle", welcomeSince: undefined, seq: state.seq + 1 }
  }
  return state
}

// 业务事件处理。thinking2 下任何业务事件先切回 thinking（"事件到来立即切回"）。
function applyEvent(state: CharacterStatus, event: CharacterEvent, now: number): CharacterStatus {
  const base: CharacterStatus = state.state === "thinking2" ? { ...state, state: "thinking" } : state

  switch (event.type) {
    case "session_error":
      return { ...base, state: "error", seq: base.seq + 1 }
    case "tool_called":
      return enterWorking(base)
    case "tool_finished":
      return exitWorking(base)
    case "permission_asked":
      return enterPermission(base)
    case "permission_replied":
      return exitPermission(base)
    case "prompt_admitted":
      return enterThinking(base, now)
    case "text_delta":
      return preempt(base, "replying", 2, new Set(["thinking", "replying"]))
    case "text_ended":
      return preempt(base, "waiting", 2, new Set(["replying"]))
    case "server_connected":
      return { ...base, state: "welcome", welcomeSince: now, seq: base.seq + 1 }
    case "execution_finished":
      return handleExecutionFinished(base, event, now)
    case "session_idle":
      return preempt(base, "idle", 3, new Set())
    default:
      return state
  }
}

// 抢占 + 流转判定：
//   - flowFrom 命中：同级流转（如 thinking → replying），允许切换。
//   - PRIORITY[当前] < gate：抢占更低优先级状态。
//   - 已在目标态且无 extra 变化时保持不变（不无谓递增 seq）。
function preempt(state: CharacterStatus, target: CharacterState, gate: number, flowFrom: ReadonlySet<CharacterState>): CharacterStatus {
  if (!flowFrom.has(state.state) && PRIORITY[state.state] >= gate) return state
  if (state.state === target) return state
  return { ...state, state: target, seq: state.seq + 1 }
}

// prompt_admitted：新轮次。从 error 恢复、thinking 重置计时；抢占低优先级；
// 不打断 working/permission（进行中）；不打断同级 replying/complete（按到达序）。
function enterThinking(state: CharacterStatus, now: number): CharacterStatus {
  if (state.state === "thinking" || state.state === "error")
    return { ...state, state: "thinking", thinkingSince: now, seq: state.seq + 1 }
  if (PRIORITY[state.state] < 2) return { ...state, state: "thinking", thinkingSince: now, seq: state.seq + 1 }
  return state
}

// working：记录 preWorking 以便 tool_finished 回退。不抢占 error；working 下保持（保留原回退态）。
function enterWorking(state: CharacterStatus): CharacterStatus {
  if (state.state === "working") return state
  if (PRIORITY[state.state] >= 5) return state
  return { ...state, state: "working", preWorking: state.state, seq: state.seq + 1 }
}

// 退出 working：仅当前在 working 时回退到 preWorking（默认 replying）。
function exitWorking(state: CharacterStatus): CharacterStatus {
  if (state.state !== "working") return state
  return { ...state, state: state.preWorking ?? "replying", preWorking: undefined, seq: state.seq + 1 }
}

// permission：记录 prePermission 以便 permission_replied 回退。不抢占 error/working。
function enterPermission(state: CharacterStatus): CharacterStatus {
  if (PRIORITY[state.state] >= 3) return state
  return { ...state, state: "permission", prePermission: state.state, seq: state.seq + 1 }
}

// 退出 permission：仅当前在 permission 时回退到 prePermission（默认 idle）。
function exitPermission(state: CharacterStatus): CharacterStatus {
  if (state.state !== "permission") return state
  return { ...state, state: state.prePermission ?? "idle", prePermission: undefined, seq: state.seq + 1 }
}

// complete 组合判定：execution_finished 且无 pending 工具 → complete（播 3~5s 后切待机）。
// pendingTools=true 时不触发 complete（保持当前）。不抢占 error/working/permission。
function handleExecutionFinished(
  state: CharacterStatus,
  event: { pendingTools: boolean },
  now: number,
): CharacterStatus {
  if (event.pendingTools) return state
  if (PRIORITY[state.state] >= 3) return state
  // 已经是 idle/welcome/waiting 时不需要再播 complete 动画。
  if (state.state === "idle" || state.state === "welcome" || state.state === "waiting") return state
  return { ...state, state: "complete", completeSince: now, seq: state.seq + 1 }
}