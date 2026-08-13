/**
 * Launcher config file grouping & 面板纯逻辑（Seam D, 工单 01/02/05）.
 *
 * Pure, synchronous, no Electron dependency. Tested by `launcher-config-edit.test.ts`.
 *
 * - 工单 01：将 findConfigFilesGrouped 返回的配置文件列表按来源分组，供 ConfigEditPanel 渲染。
 * - 工单 02：展开/折叠切换 + 打开源文件 handler 接缝。
 * - 工单 05：新建配置文件的位置/类型常量与标签。
 */

import type {
  LauncherConfigFileInfo,
  LauncherConfigFileGroup,
  LauncherCreateConfigLocation,
  LauncherCreateConfigType,
} from "../preload/types"

// 配置文件分组显示顺序与标签。
const CONFIG_FILE_GROUP_ORDER: LauncherConfigFileGroup[] = ["global", "project", "opencode", "home", "env"]

// I2 i18n 接缝：此处标签为可替换常量，后续 i18n 接入时改为 (group) => t(`config.group.${group}`)。
// 当前保持中文硬编码与现有代码一致（launcher.tsx 中 LlmApiPanel 等也是硬编码中文）。
const CONFIG_FILE_GROUP_LABEL: Record<LauncherConfigFileGroup, string> = {
  global: "全局配置",
  project: "项目配置",
  opencode: ".opencode 配置",
  home: "用户主目录配置",
  env: "环境变量配置",
}

// 按分组顺序将已发现的配置文件分组，空分组不出现。
export function groupConfigFilesByGroup(
  files: LauncherConfigFileInfo[],
): { group: LauncherConfigFileGroup; label: string; files: LauncherConfigFileInfo[] }[] {
  return CONFIG_FILE_GROUP_ORDER.map((group) => ({
    group,
    label: CONFIG_FILE_GROUP_LABEL[group],
    files: files.filter((f) => f.group === group),
  })).filter((entry) => entry.files.length > 0)
}

// 工单 02：展开/折叠切换。返回新 Set，不修改原 Set。
export function togglePath(set: Set<string>, path: string): Set<string> {
  const next = new Set(set)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

// 工单 02：打开源文件按钮的点击 handler 接缝。
// 供 ConfigEditPanel 和单测共用——单测验证按钮对已列出文件触发 opener 调用。
// opener 类型放宽为 `(path) => unknown`：caller 传 `window.api.openPath`（返回 Promise）时兼容，
// 单测传 `(path) => void` mock 也兼容（void 是 unknown 子类型）。
// 不用 `window.api.openLocalFile`：它经 `resolveLocalFilePath` 要求 `file://` URL，
// 普通路径会被静默拒绝（resolveLocalFilePath 返回 undefined），不符合"总能打开"要求。
export function openFileHandler(opener: (path: string) => unknown, path: string): () => void {
  return () => opener(path)
}

// 工单 05：新建配置文件的可选位置与类型。
export const CREATE_LOCATIONS: readonly LauncherCreateConfigLocation[] = ["global", "project", "opencode"]
export const CREATE_TYPES: readonly LauncherCreateConfigType[] = ["opencode.json", "tui.json", "auth.json"]

// 工单 05：位置中文标签。
export function locationLabel(loc: LauncherCreateConfigLocation): string {
  if (loc === "global") return "全局"
  if (loc === "project") return "项目"
  return ".opencode"
}

/**
 * 工单 03 次 seam：表单按文件分别编辑的纯逻辑。
 *
 * - detectConfigFileKind：根据文件名判断表单类型（opencode/tui/auth/unknown）。
 * - pickFormFields：根据文件实际有的字段返回表单字段集合（只显示该文件实际有的字段）。
 * - mergeConfigField：合并字段到原 config，保留其他字段不变（读全量 → 改字段 → 写全量）。
 * - isAuthKeyForm：auth.json 表单不展示现有 key，只提供设置/修改输入。
 */

export type ConfigFileKind = "opencode" | "tui" | "auth" | "unknown"

// 根据文件名判断表单类型。
export function detectConfigFileKind(name: string): ConfigFileKind {
  if (name === "auth.json") return "auth"
  if (name === "tui.json") return "tui"
  if (name === "opencode.json" || name === "opencode.jsonc" || name === "config.json") return "opencode"
  return "unknown"
}

// 表单可编辑的字段集合（只显示这些字段）。
export type ConfigFormFields = {
  model: boolean
  plugins: boolean
  provider: boolean
  agent: boolean
  mcp: boolean
  permission: boolean
  instructions: boolean
  theme: boolean
}

const NO_FIELDS: ConfigFormFields = {
  model: false,
  plugins: false,
  provider: false,
  agent: false,
  mcp: false,
  permission: false,
  instructions: false,
  theme: false,
}

// 根据文件实际有的字段返回表单字段集合。
// 只显示该文件实际有的字段——不发明新字段，不展示文件里没有的字段。
export function pickFormFields(config: Record<string, unknown> | null): ConfigFormFields {
  if (!config) return { ...NO_FIELDS }
  return {
    model: "model" in config,
    plugins: "plugins" in config,
    provider: "provider" in config,
    agent: "agent" in config,
    mcp: "mcp" in config,
    permission: "permission" in config,
    instructions: "instructions" in config,
    theme: "theme" in config,
  }
}

// 合并字段到原 config，保留其他字段不变。
// 读全量 → 改字段 → 写全量，以保留表单未覆盖的字段（如 instructions/theme）。
export function mergeConfigField(
  orig: Record<string, unknown> | null,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...(orig ?? {}), [key]: value }
}

// auth.json 表单不展示现有 key（安全要求），只提供设置/修改输入。
// 此函数返回 true 表示该文件应渲染脱敏的 API key 表单。
export function isAuthKeyForm(kind: ConfigFileKind): boolean {
  return kind === "auth"
}

// tui.json 不走表单，提示「打开源文件编辑」。
export function isSourceOnlyForm(kind: ConfigFileKind): boolean {
  return kind === "tui"
}

/**
 * 工单 06 次 seam：agent 模型绑定纯逻辑。
 *
 * - extractAgentBindings：从 config.agent 提取 agent 列表（含名称和当前绑定的 model）。
 * - buildAgentConfig：将 agent 绑定列表写回 config.agent 格式。
 *
 * 「自动」= 不绑（model 为 "auto" 或空字符串）。
 */
export type AgentBinding = { name: string; model: string }

// 从 config.agent 提取 agent 列表，按名称字典序排序。
// S1 安全修复：model 字段类型断言改安全——只接受 string，否则回退 "auto"。
export function extractAgentBindings(agentConfig: unknown): AgentBinding[] {
  if (typeof agentConfig !== "object" || agentConfig === null) return []
  return Object.entries(agentConfig as Record<string, unknown>)
    .map(([name, val]) => ({
      name,
      model:
        typeof val === "object" && val !== null
          ? typeof (val as { model?: unknown }).model === "string"
            ? (val as { model: string }).model
            : "auto"
          : "auto",
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// 将 agent 绑定列表写回 config.agent 格式。空 model 视为「自动」。
// I1 修复：字段级合并，保留原 agent 配置中的其他嵌套字段（如 description/tools/prompt）。
// 同时保留原 config 中不在 bindings 里的 agent（用户可能在源文件中添加了新 agent）。
export function buildAgentConfig(bindings: AgentBinding[], origAgentConfig?: unknown): Record<string, unknown> {
  const orig =
    typeof origAgentConfig === "object" && origAgentConfig !== null ? (origAgentConfig as Record<string, unknown>) : {}
  const result: Record<string, unknown> = {}
  for (const { name, model } of bindings) {
    const origEntry =
      typeof orig[name] === "object" && orig[name] !== null ? (orig[name] as Record<string, unknown>) : {}
    result[name] = { ...origEntry, model: model || "auto" }
  }
  // 保留原 config 中不在 bindings 里的 agent
  for (const [name, val] of Object.entries(orig)) {
    if (!(name in result)) result[name] = val
  }
  return result
}

/**
 * 工单 07 次 seam：MCP 服务器纯逻辑。
 *
 * - extractMcpServers：从 config.mcp 提取 MCP 服务器列表。
 * - buildMcpConfig：将 MCP 服务器列表写回 config.mcp 格式。
 *
 * 每个服务器含 name + command 或 url + args（字符串数组）+ env（键值对列表）。
 */
export type McpServerEntry = {
  name: string
  command?: string
  url?: string
  args: string[]
  env: { key: string; value: string }[]
}

// 从 config.mcp 提取 MCP 服务器列表。
// S2 安全修复：args 元素类型校验——只保留 string 元素。
// S7 安全修复：校验 val 为对象，非对象条目返回空 args/env。
export function extractMcpServers(mcpConfig: unknown): McpServerEntry[] {
  if (typeof mcpConfig !== "object" || mcpConfig === null) return []
  return Object.entries(mcpConfig as Record<string, unknown>).map(([name, val]) => {
    if (typeof val !== "object" || val === null) return { name, args: [], env: [] }
    const server = val as { command?: string; url?: string; args?: unknown; env?: unknown }
    return {
      name,
      command: server.command,
      url: server.url,
      args: Array.isArray(server.args)
        ? (server.args as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      env:
        typeof server.env === "object" && server.env !== null
          ? Object.entries(server.env as Record<string, unknown>).map(([key, value]) => ({
              key,
              value: String(value),
            }))
          : [],
    }
  })
}

// 将 MCP 服务器列表写回 config.mcp 格式。空 args/env 不写入。
// I1 修复：字段级合并，保留每个服务器下的未知字段（如 enabled/timeout/type 等）。
// 同时保留原 config 中不在 servers 里的条目。
export function buildMcpConfig(servers: McpServerEntry[], origMcpConfig?: unknown): Record<string, unknown> {
  const orig =
    typeof origMcpConfig === "object" && origMcpConfig !== null ? (origMcpConfig as Record<string, unknown>) : {}
  const result: Record<string, unknown> = {}
  for (const server of servers) {
    const origEntry =
      typeof orig[server.name] === "object" && orig[server.name] !== null
        ? (orig[server.name] as Record<string, unknown>)
        : {}
    const entry: Record<string, unknown> = { ...origEntry }
    // 覆盖表单管理的字段
    if (server.command) entry.command = server.command
    else delete entry.command
    if (server.url) entry.url = server.url
    else delete entry.url
    if (server.args.length > 0) entry.args = server.args
    else delete entry.args
    if (server.env.length > 0) {
      const envObj: Record<string, string> = {}
      for (const { key, value } of server.env) envObj[key] = value
      entry.env = envObj
    } else delete entry.env
    result[server.name] = entry
  }
  // 保留原 config 中不在 servers 里的条目
  for (const [name, val] of Object.entries(orig)) {
    if (!(name in result)) result[name] = val
  }
  return result
}

/**
 * 工单 08 次 seam：权限规则纯逻辑。
 *
 * - extractPermissionRules：从 config.permission 提取权限规则列表。
 * - buildPermissionConfig：将权限规则列表写回 config.permission 格式。
 *
 * 每条规则含 glob（glob 模式）+ mode（allow/deny/ask）。
 */
export type PermissionRule = { glob: string; mode: "allow" | "deny" | "ask" }

// 从 config.permission 提取权限规则列表。非合规条目被过滤。
export function extractPermissionRules(permissionConfig: unknown): PermissionRule[] {
  if (!Array.isArray(permissionConfig)) return []
  return permissionConfig
    .filter(
      (rule): rule is { glob: string; mode: string } =>
        typeof rule === "object" &&
        rule !== null &&
        typeof (rule as { glob?: unknown }).glob === "string" &&
        typeof (rule as { mode?: unknown }).mode === "string",
    )
    .map((rule) => ({
      glob: rule.glob,
      mode: rule.mode as "allow" | "deny" | "ask",
    }))
}

// 将权限规则列表写回 config.permission 格式。
// I1 修复：保留每条规则中的未知字段（如 description/comment 等）。
export function buildPermissionConfig(rules: PermissionRule[], origPermissionConfig?: unknown): unknown[] {
  const orig = Array.isArray(origPermissionConfig) ? (origPermissionConfig as unknown[]) : []
  return rules.map(({ glob, mode }, i) => {
    const origRule = typeof orig[i] === "object" && orig[i] !== null ? (orig[i] as Record<string, unknown>) : {}
    return { ...origRule, glob, mode }
  })
}

/**
 * 工单 12 次 seam：.opencode/ 目录节点标签格式化。
 *
 * - 未展开：只显示目录名 + 斜杠（如 `agents/`）。
 * - 展开：显示目录名 + 文件数（如 `agents/（3）`），N = 目录内条目数。
 *
 * 文件数仅在展开后显示——展开前 entries 未加载，避免无数据闪烁。
 * 全角括号与现有中文 UI 风格一致（launcher.tsx 中"空目录"等均为硬编码中文）。
 */
export function formatSubdirNodeLabel(name: string, expanded: boolean, entriesCount: number): string {
  if (!expanded) return `${name}/`
  return `${name}/（${entriesCount}）`
}
