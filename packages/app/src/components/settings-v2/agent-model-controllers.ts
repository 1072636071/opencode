/**
 * Agent 模型绑定面板——纯逻辑模块。
 *
 * 承载「来源识别 + 写入路由 + 两态 payload 构造」三件事，UI 面板只是薄壳。
 * 遵守测试决策：只测外部行为、不测实现细节（沿用 general-controllers.test.ts 先例）。
 *
 * 设计依据：docs/memorial/001-agent-model-config-ui/context.md（D1-D11）与 ADR-017。
 * 无统一写入点，按 agent 来源分发、均用户级：
 *   - OMO 内置 agent → `~/.omo/omo.jsonc` 的 `agents.<name>.model`（updateOmoConfig）
 *   - 其余（.md 自定义 / OpenCode 自带）→ 全局 opencode config 的 `agent.<name>.model`
 *     （config.updateGlobal，jsonc 走 patchJsonc 保留注释、changed 自动 reload）
 * 两态：指定模型 → 写 model 字段（"providerID/modelID"）；「自动」→ 删 model 字段。
 */

/**
 * OMO 插件注入的内置 agent 名集合（来源识别路由的关键）。
 * 与 oh-my-openagent/packages/omo-opencode/src/agents/builtin-agents.ts 的
 * agentSources 键一致（sisyphus/hephaestus/oracle/librarian/explore/multimodal-looker/
 * metis/momus/atlas/sisyphus-junior）。
 */
export const OMO_BUILTIN_AGENT_NAMES = [
  "sisyphus",
  "hephaestus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "metis",
  "momus",
  "atlas",
  "sisyphus-junior",
] as const

const omoAgentNameSet: ReadonlySet<string> = new Set<string>(OMO_BUILTIN_AGENT_NAMES)

/** Agent 归属来源：omo（内置）或 opencode（自定义/自带）。 */
export type AgentModelSource = "omo" | "opencode"

/** 面板行：一个可绑定模型的 agent。 */
export type AgentModelRow = {
  name: string
  description?: string
  /** 当前绑定（来自 agent 列表端点返回的 model 字段）。 */
  model?: { providerID: string; modelID: string }
}

/** 来源识别：是否属于 OMO 内置 agent 名集合。 */
export function isOmoBuiltinAgent(name: string): boolean {
  return omoAgentNameSet.has(name)
}

/** 写入路由：按 agent 名判定归属来源。 */
export function resolveAgentModelSource(name: string): AgentModelSource {
  return isOmoBuiltinAgent(name) ? "omo" : "opencode"
}

/** 模型规范形式：providerID/modelID（与 opencode config `agent.*.model` 及会话级一致）。 */
export function modelSpec(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

/**
 * 两态——指定模型：把 modelID 规范化为可写值。
 * 两态——自动：modelID 为 undefined，表示「删字段」。
 */
export type AgentModelBind =
  | { source: "omo" | "opencode"; name: string; model: { providerID: string; modelID: string } }
  | { source: "omo" | "opencode"; name: string; model: undefined }

/**
 * OpenCode 全局写入 payload（config.updateGlobal 的 config 对象）。
 * 深合并写全局 opencode.json/jsonc 的 `agent.<name>.model`；
 * model 为 undefined 时删该字段（patchJsonc 对 undefined 走 modify 删除）。
 */
export function buildOpenCodeGlobalPatch(
  name: string,
  model: { providerID: string; modelID: string } | undefined,
): { agent: Record<string, { model?: string }> } {
  return { agent: { [name]: model ? { model: modelSpec(model.providerID, model.modelID) } : {} } }
}

/** OMO 配置写入单条 edit（updateOmoConfig 的 edits 元素）。 */
export type OmoConfigEdit = {
  path: readonly string[]
  value?: string
}

/**
 * OMO 写入 edits 构造：写 `~/.omo/omo.jsonc` 的 `agents.<name>.model`；
 * model 为 undefined 时删该字段。
 */
export function buildOmoConfigEdits(
  name: string,
  model: { providerID: string; modelID: string } | undefined,
): OmoConfigEdit[] {
  return [{ path: ["agents", name, "model"], value: model ? modelSpec(model.providerID, model.modelID) : undefined }]
}

/** 便捷：把面板行的两态选择落到「双路径分发」所需的两种 payload。 */
export function buildBindPayload(bind: AgentModelBind): {
  source: AgentModelSource
  openCodePatch: ReturnType<typeof buildOpenCodeGlobalPatch>
  omoEdits: OmoConfigEdit[]
} {
  const source: AgentModelSource = bind.source
  return {
    source,
    openCodePatch: buildOpenCodeGlobalPatch(bind.name, bind.model),
    omoEdits: buildOmoConfigEdits(bind.name, bind.model),
  }
}

/**
 * 将 agent 列表归一为面板行，过滤 hidden 的内部 agent（compaction/title/summary 等）。
 * 保留 OMO 内置 agent（即便 opencode 列表里 hidden 标记为 true 也应显示，
 * 但 compaction/title/summary 这类纯内部 agent 一律隐藏）。
 */
export const HIDDEN_INTERNAL_AGENTS: ReadonlySet<string> = new Set<string>([
  "compaction",
  "title",
  "summary",
])

export function toAgentModelRows(input: readonly AgentModelRow[]): AgentModelRow[] {
  return input.filter((agent) => !HIDDEN_INTERNAL_AGENTS.has(agent.name))
}
