import { describe, expect, test } from "bun:test"
import {
  groupConfigFilesByGroup,
  togglePath,
  openFileHandler,
  CREATE_LOCATIONS,
  CREATE_TYPES,
  locationLabel,
  detectConfigFileKind,
  pickFormFields,
  pickMiscFields,
  mergeConfigField,
  isAuthKeyForm,
  isSourceOnlyForm,
  extractAgentBindings,
  buildAgentConfig,
  extractMcpServers,
  buildMcpConfig,
  extractPermissionRules,
  buildPermissionConfig,
  formatSubdirNodeLabel,
  type AgentBinding,
  type McpServerEntry,
  type PermissionRule,
} from "./launcher-config-groups"
import type { LauncherConfigFileInfo } from "../preload/types"

// 工单 01 次 seam 单测：面板渲染已发现文件清单按来源分组。
// 工单 02 次 seam 单测：打开源文件按钮 + 展开/折叠。
// 工单 03 次 seam 单测：表单只显示该文件实际有的字段；保存只改对应字段。
// 工单 05 次 seam 单测：新建配置文件对话框位置/类型。

function makeFile(path: string, group: LauncherConfigFileInfo["group"], name: string): LauncherConfigFileInfo {
  return { path, group, name }
}

describe("groupConfigFilesByGroup（工单 01 面板按来源分组）", () => {
  test("按 global/project/opencode/home/env 顺序分组", () => {
    const files = [
      makeFile("/home/.opencode/opencode.jsonc", "home", "opencode.jsonc"),
      makeFile("/project/.opencode/opencode.json", "opencode", "opencode.json"),
      makeFile("/appdata/opencode/config.json", "global", "config.json"),
      makeFile("/custom/tui.json", "env", "tui.json"),
      makeFile("/project/opencode.json", "project", "opencode.json"),
    ]

    const grouped = groupConfigFilesByGroup(files)
    expect(grouped.map((g) => g.group)).toEqual(["global", "project", "opencode", "home", "env"])
  })

  test("每个分组包含正确的文件", () => {
    const files = [
      makeFile("/appdata/opencode/opencode.jsonc", "global", "opencode.jsonc"),
      makeFile("/appdata/opencode/tui.json", "global", "tui.json"),
      makeFile("/project/opencode.json", "project", "opencode.json"),
      makeFile("/project/.opencode/opencode.jsonc", "opencode", "opencode.jsonc"),
      makeFile("/home/.opencode/opencode.json", "home", "opencode.json"),
      makeFile("/custom/auth.json", "env", "auth.json"),
    ]

    const grouped = groupConfigFilesByGroup(files)
    const byGroup = Object.fromEntries(grouped.map((g) => [g.group, g.files]))

    expect(byGroup.global.map((f) => f.name)).toEqual(["opencode.jsonc", "tui.json"])
    expect(byGroup.project.map((f) => f.name)).toEqual(["opencode.json"])
    expect(byGroup.opencode.map((f) => f.name)).toEqual(["opencode.jsonc"])
    expect(byGroup.home.map((f) => f.name)).toEqual(["opencode.json"])
    expect(byGroup.env.map((f) => f.name)).toEqual(["auth.json"])
  })

  test("空分组的条目不出现", () => {
    const files = [
      makeFile("/appdata/opencode/opencode.jsonc", "global", "opencode.jsonc"),
      makeFile("/project/.opencode/opencode.jsonc", "opencode", "opencode.jsonc"),
    ]

    const grouped = groupConfigFilesByGroup(files)
    expect(grouped.map((g) => g.group)).toEqual(["global", "opencode"])
  })

  test("空输入返回空数组", () => {
    expect(groupConfigFilesByGroup([])).toEqual([])
  })

  test("分组标签为中文", () => {
    const files = [makeFile("/appdata/opencode/opencode.jsonc", "global", "opencode.jsonc")]
    const grouped = groupConfigFilesByGroup(files)
    expect(grouped[0].label).toBe("全局配置")
  })

  test("同一分组多个文件保持输入顺序", () => {
    const files = [
      makeFile("/a", "global", "opencode.jsonc"),
      makeFile("/b", "global", "opencode.json"),
      makeFile("/c", "global", "config.json"),
    ]

    const grouped = groupConfigFilesByGroup(files)
    expect(grouped[0].files.map((f) => f.path)).toEqual(["/a", "/b", "/c"])
  })
})

describe("openFileHandler（工单 02 打开源文件按钮接缝）", () => {
  test("对已列出文件触发 openLocalFile 调用", () => {
    const calls: string[] = []
    const openLocalFile = (path: string) => {
      calls.push(path)
    }
    const handler = openFileHandler(openLocalFile, "/config/opencode.json")
    handler()
    expect(calls).toEqual(["/config/opencode.json"])
  })

  test("每个文件的 handler 独立绑定各自路径", () => {
    const calls: string[] = []
    const openLocalFile = (path: string) => {
      calls.push(path)
    }
    const files = [
      makeFile("/a/opencode.json", "global", "opencode.json"),
      makeFile("/b/tui.json", "global", "tui.json"),
    ]
    for (const file of files) {
      openFileHandler(openLocalFile, file.path)()
    }
    expect(calls).toEqual(["/a/opencode.json", "/b/tui.json"])
  })

  test("handler 未调用时 openLocalFile 不执行", () => {
    let called = false
    const openLocalFile = () => {
      called = true
    }
    const handler = openFileHandler(openLocalFile, "/x")
    expect(called).toBe(false)
    handler()
    expect(called).toBe(true)
  })

  // 工单 02：锁定 opener 接缝兼容 Promise 返回（caller 传 window.api.openPath，返回 Promise<void>）。
  // 防止未来回退到 openLocalFile（要求 file:// URL，普通路径静默失败）。
  test("opener 返回 Promise 也兼容（openPath 接缝）", async () => {
    const calls: string[] = []
    const opener = (path: string) => {
      calls.push(path)
      return Promise.resolve()
    }
    const handler = openFileHandler(opener, "/config/auth.json")
    handler()
    expect(calls).toEqual(["/config/auth.json"])
  })
})

describe("togglePath（工单 02 展开/折叠切换）", () => {
  test("展开：空 Set 加入路径", () => {
    const next = togglePath(new Set(), "/a/opencode.json")
    expect(next.has("/a/opencode.json")).toBe(true)
  })

  test("折叠：已展开路径移除", () => {
    const next = togglePath(new Set(["/a/opencode.json"]), "/a/opencode.json")
    expect(next.has("/a/opencode.json")).toBe(false)
  })

  test("不修改原 Set（不可变）", () => {
    const original = new Set<string>(["/a"])
    togglePath(original, "/b")
    expect(original.has("/b")).toBe(false)
  })

  test("切换其他路径不影响已展开路径", () => {
    const next = togglePath(new Set(["/a"]), "/b")
    expect(next.has("/a")).toBe(true)
    expect(next.has("/b")).toBe(true)
  })
})

describe("新建配置文件对话框常量与标签（工单 05）", () => {
  test("CREATE_LOCATIONS 含全局/项目/.opencode 三选一", () => {
    expect(CREATE_LOCATIONS).toEqual(["global", "project", "opencode"])
  })

  test("CREATE_TYPES 含 opencode.json/tui.json/auth.json 三选一", () => {
    expect(CREATE_TYPES).toEqual(["opencode.json", "tui.json", "auth.json"])
  })

  test("locationLabel 返回中文标签", () => {
    expect(locationLabel("global")).toBe("全局")
    expect(locationLabel("project")).toBe("项目")
    expect(locationLabel("opencode")).toBe(".opencode")
  })
})

describe("detectConfigFileKind（工单 03 按文件名判断表单类型）", () => {
  test("auth.json → auth", () => {
    expect(detectConfigFileKind("auth.json")).toBe("auth")
  })

  test("tui.json → tui", () => {
    expect(detectConfigFileKind("tui.json")).toBe("tui")
  })

  test("opencode.json → opencode", () => {
    expect(detectConfigFileKind("opencode.json")).toBe("opencode")
  })

  test("opencode.jsonc → opencode", () => {
    expect(detectConfigFileKind("opencode.jsonc")).toBe("opencode")
  })

  test("config.json → opencode", () => {
    expect(detectConfigFileKind("config.json")).toBe("opencode")
  })

  test("其他文件名 → unknown", () => {
    expect(detectConfigFileKind("package.json")).toBe("unknown")
    expect(detectConfigFileKind("README.md")).toBe("unknown")
  })
})

describe("pickFormFields（工单 03 表单只显示该文件实际有的字段）", () => {
  test("null config 返回全 false", () => {
    const fields = pickFormFields(null)
    expect(fields.model).toBe(false)
    expect(fields.plugins).toBe(false)
    expect(fields.provider).toBe(false)
    expect(fields.agent).toBe(false)
    expect(fields.mcp).toBe(false)
    expect(fields.permission).toBe(false)
    expect(fields.instructions).toBe(false)
    expect(fields.theme).toBe(false)
  })

  test("只有 model 字段 → 只 model 为 true", () => {
    const fields = pickFormFields({ model: "deepseek-chat" })
    expect(fields.model).toBe(true)
    expect(fields.plugins).toBe(false)
    expect(fields.provider).toBe(false)
  })

  test("只有 plugins 字段 → 只 plugins 为 true", () => {
    const fields = pickFormFields({ plugins: ["@opencode-ai/plugin-x"] })
    expect(fields.plugins).toBe(true)
    expect(fields.model).toBe(false)
  })

  test("model + plugins + provider 都有 → 都为 true", () => {
    const fields = pickFormFields({
      model: "deepseek-chat",
      plugins: [],
      provider: { deepseek: {} },
    })
    expect(fields.model).toBe(true)
    expect(fields.plugins).toBe(true)
    expect(fields.provider).toBe(true)
  })

  test("instructions/theme 字段也被识别（保留其他字段提示用）", () => {
    const fields = pickFormFields({ instructions: "abc", theme: "dark" })
    expect(fields.instructions).toBe(true)
    expect(fields.theme).toBe(true)
    expect(fields.model).toBe(false)
  })

  test("不发明新字段——$schema 等非表单字段不识别", () => {
    const fields = pickFormFields({ $schema: "https://opencode.ai/config.json" })
    expect(fields.model).toBe(false)
    expect(fields.plugins).toBe(false)
    expect(fields.provider).toBe(false)
    expect(fields.agent).toBe(false)
    expect(fields.mcp).toBe(false)
    expect(fields.permission).toBe(false)
  })
})

describe("pickMiscFields（工单 03 杂项字段走打开源文件）", () => {
  test("null config 返回空数组", () => {
    expect(pickMiscFields(null)).toEqual([])
  })

  test("small_model 字段被识别", () => {
    expect(pickMiscFields({ small_model: "gpt-4o-mini" })).toEqual(["small_model"])
  })

  test("instructions 字段被识别", () => {
    expect(pickMiscFields({ instructions: "你是助手" })).toEqual(["instructions"])
  })

  test("theme 字段被识别", () => {
    expect(pickMiscFields({ theme: "dark" })).toEqual(["theme"])
  })

  test("keybinds 字段被识别", () => {
    expect(pickMiscFields({ keybinds: { "ctrl+c": "quit" } })).toEqual(["keybinds"])
  })

  test("多个杂项字段按 MISC_FIELD_NAMES 顺序返回", () => {
    const config = {
      keybinds: {},
      theme: "dark",
      small_model: "gpt-4o-mini",
      instructions: "abc",
    }
    expect(pickMiscFields(config)).toEqual(["small_model", "instructions", "theme", "keybinds"])
  })

  test("表单字段（model/plugins/provider 等）不被识别为杂项", () => {
    expect(pickMiscFields({ model: "deepseek-chat", plugins: [], provider: {} })).toEqual([])
  })

  test("$schema 等非杂项字段不被识别", () => {
    expect(pickMiscFields({ $schema: "https://opencode.ai/config.json" })).toEqual([])
  })

  test("空对象返回空数组", () => {
    expect(pickMiscFields({})).toEqual([])
  })
})

describe("mergeConfigField（工单 03 保存只改对应字段，保留其他字段）", () => {
  test("改 model 保留其他字段", () => {
    const orig = {
      model: "old-model",
      plugins: ["@opencode-ai/plugin-x"],
      instructions: "保留我",
      theme: "dark",
    }
    const merged = mergeConfigField(orig, "model", "new-model")
    expect(merged.model).toBe("new-model")
    expect(merged.plugins).toEqual(["@opencode-ai/plugin-x"])
    expect(merged.instructions).toBe("保留我")
    expect(merged.theme).toBe("dark")
  })

  test("改 plugins 保留 model 和其他字段", () => {
    const orig = { model: "deepseek-chat", instructions: "保留我" }
    const merged = mergeConfigField(orig, "plugins", ["@opencode-ai/plugin-y"])
    expect(merged.model).toBe("deepseek-chat")
    expect(merged.plugins).toEqual(["@opencode-ai/plugin-y"])
    expect(merged.instructions).toBe("保留我")
  })

  test("null orig → 新建对象只含传入字段", () => {
    const merged = mergeConfigField(null, "model", "new-model")
    expect(merged.model).toBe("new-model")
    expect(Object.keys(merged)).toEqual(["model"])
  })

  test("不修改原对象（不可变）", () => {
    const orig = { model: "old", instructions: "保留" }
    mergeConfigField(orig, "model", "new")
    expect(orig.model).toBe("old")
    expect(orig.instructions).toBe("保留")
  })

  test("改 model 不碰其他文件（单文件视角）", () => {
    // 此单测验证 mergeConfigField 只在传入的 orig 上改字段，
    // 不影响其他文件——其他文件的保留由调用方读全量保证。
    const fileA = { model: "model-a", instructions: "instr-a" }
    const fileB = { model: "model-b", theme: "theme-b" }
    const mergedA = mergeConfigField(fileA, "model", "new-model-a")
    // fileB 不受影响
    expect(fileB.model).toBe("model-b")
    expect(fileB.theme).toBe("theme-b")
    // mergedA 只改了 model，保留 instructions
    expect(mergedA.model).toBe("new-model-a")
    expect(mergedA.instructions).toBe("instr-a")
  })
})

describe("isAuthKeyForm / isSourceOnlyForm（工单 03 表单类型判定）", () => {
  test("isAuthKeyForm：只有 auth.json 是 API key 表单", () => {
    expect(isAuthKeyForm("auth")).toBe(true)
    expect(isAuthKeyForm("opencode")).toBe(false)
    expect(isAuthKeyForm("tui")).toBe(false)
    expect(isAuthKeyForm("unknown")).toBe(false)
  })

  test("isSourceOnlyForm：tui.json 走打开源文件", () => {
    expect(isSourceOnlyForm("tui")).toBe(true)
    expect(isSourceOnlyForm("opencode")).toBe(false)
    expect(isSourceOnlyForm("auth")).toBe(false)
    expect(isSourceOnlyForm("unknown")).toBe(false)
  })
})

describe("extractAgentBindings / buildAgentConfig（工单 06 agent 模型绑定）", () => {
  test("从 config.agent 提取 agent 列表，按名称字典序排序", () => {
    const agentConfig = {
      build: { model: "claude-sonnet-4" },
      plan: { model: "auto" },
      audit: { model: "gpt-5" },
    }
    const bindings = extractAgentBindings(agentConfig)
    expect(bindings.map((b) => b.name)).toEqual(["audit", "build", "plan"])
    expect(bindings[0]).toEqual({ name: "audit", model: "gpt-5" })
    expect(bindings[1]).toEqual({ name: "build", model: "claude-sonnet-4" })
    expect(bindings[2]).toEqual({ name: "plan", model: "auto" })
  })

  test("agent 值非对象时 model 默认为 auto", () => {
    const agentConfig = { weird: "string-value", another: 42 }
    const bindings = extractAgentBindings(agentConfig)
    expect(bindings[0]).toEqual({ name: "another", model: "auto" })
    expect(bindings[1]).toEqual({ name: "weird", model: "auto" })
  })

  test("agent 对象缺 model 字段时默认为 auto", () => {
    const agentConfig = { build: { other: "field" } }
    const bindings = extractAgentBindings(agentConfig)
    expect(bindings[0]).toEqual({ name: "build", model: "auto" })
  })

  test("null/非对象输入返回空数组", () => {
    expect(extractAgentBindings(null)).toEqual([])
    expect(extractAgentBindings(undefined)).toEqual([])
    expect(extractAgentBindings("string")).toEqual([])
    expect(extractAgentBindings(42)).toEqual([])
  })

  test("buildAgentConfig 写回 config.agent 格式", () => {
    const bindings: AgentBinding[] = [
      { name: "build", model: "claude-sonnet-4" },
      { name: "plan", model: "auto" },
    ]
    const config = buildAgentConfig(bindings)
    expect(config).toEqual({
      build: { model: "claude-sonnet-4" },
      plan: { model: "auto" },
    })
  })

  test("buildAgentConfig 空 model 视为自动", () => {
    const bindings: AgentBinding[] = [{ name: "build", model: "" }]
    expect(buildAgentConfig(bindings)).toEqual({ build: { model: "auto" } })
  })

  test("往返：extract → build 保留 model 绑定", () => {
    const orig = {
      build: { model: "claude-sonnet-4" },
      plan: { model: "auto" },
    }
    const rebuilt = buildAgentConfig(extractAgentBindings(orig))
    expect(rebuilt).toEqual(orig)
  })
})

describe("extractMcpServers / buildMcpConfig（工单 07 MCP 服务器）", () => {
  test("从 config.mcp 提取服务器列表（含 command + args + env）", () => {
    const mcpConfig = {
      "my-server": {
        command: "node",
        args: ["server.js", "--port", "3000"],
        env: { API_KEY: "xxx", DEBUG: "true" },
      },
    }
    const servers = extractMcpServers(mcpConfig)
    expect(servers).toHaveLength(1)
    expect(servers[0].name).toBe("my-server")
    expect(servers[0].command).toBe("node")
    expect(servers[0].args).toEqual(["server.js", "--port", "3000"])
    expect(servers[0].env).toEqual([
      { key: "API_KEY", value: "xxx" },
      { key: "DEBUG", value: "true" },
    ])
  })

  test("从 config.mcp 提取远程服务器（含 url）", () => {
    const mcpConfig = {
      "remote-server": { url: "https://example.com/mcp" },
    }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0].name).toBe("remote-server")
    expect(servers[0].url).toBe("https://example.com/mcp")
    expect(servers[0].command).toBeUndefined()
    expect(servers[0].args).toEqual([])
    expect(servers[0].env).toEqual([])
  })

  test("缺 args/env 时返回空数组", () => {
    const mcpConfig = { simple: { command: "node" } }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0].args).toEqual([])
    expect(servers[0].env).toEqual([])
  })

  test("args 非数组时返回空数组", () => {
    const mcpConfig = { bad: { command: "node", args: "not-array" } }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0].args).toEqual([])
  })

  test("env 非对象时返回空数组", () => {
    const mcpConfig = { bad: { command: "node", env: "not-object" } }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0].env).toEqual([])
  })

  test("null/非对象输入返回空数组", () => {
    expect(extractMcpServers(null)).toEqual([])
    expect(extractMcpServers(undefined)).toEqual([])
    expect(extractMcpServers("string")).toEqual([])
  })

  test("buildMcpConfig 写回 config.mcp 格式", () => {
    const servers: McpServerEntry[] = [
      {
        name: "my-server",
        command: "node",
        args: ["server.js"],
        env: [{ key: "API_KEY", value: "xxx" }],
      },
      { name: "remote", url: "https://example.com/mcp", args: [], env: [] },
    ]
    const config = buildMcpConfig(servers)
    expect(config).toEqual({
      "my-server": {
        command: "node",
        args: ["server.js"],
        env: { API_KEY: "xxx" },
      },
      remote: { url: "https://example.com/mcp" },
    })
  })

  test("buildMcpConfig 空 args/env 不写入", () => {
    const servers: McpServerEntry[] = [{ name: "simple", command: "node", args: [], env: [] }]
    expect(buildMcpConfig(servers)).toEqual({ simple: { command: "node" } })
  })

  test("buildMcpConfig 空 command/url 不写入", () => {
    const servers: McpServerEntry[] = [{ name: "empty", command: undefined, url: undefined, args: [], env: [] }]
    expect(buildMcpConfig(servers)).toEqual({ empty: {} })
  })

  test("往返：extract → build 保留 command + args + env", () => {
    const orig = {
      "my-server": {
        command: "node",
        args: ["server.js"],
        env: { API_KEY: "xxx" },
      },
      remote: { url: "https://example.com/mcp" },
    }
    const rebuilt = buildMcpConfig(extractMcpServers(orig))
    expect(rebuilt).toEqual(orig)
  })
})

describe("extractPermissionRules / buildPermissionConfig（工单 08 权限规则）", () => {
  test("从 config.permission 提取规则列表", () => {
    const permissionConfig = [
      { glob: "src/**", mode: "allow" },
      { glob: "secrets/**", mode: "deny" },
      { glob: "temp/**", mode: "ask" },
    ]
    const rules = extractPermissionRules(permissionConfig)
    expect(rules).toEqual([
      { glob: "src/**", mode: "allow" },
      { glob: "secrets/**", mode: "deny" },
      { glob: "temp/**", mode: "ask" },
    ])
  })

  test("非合规条目被过滤（缺 glob 或 mode）", () => {
    const permissionConfig = [
      { glob: "src/**", mode: "allow" },
      { glob: "no-mode" },
      { mode: "deny" },
      null,
      "string",
      42,
    ]
    const rules = extractPermissionRules(permissionConfig)
    expect(rules).toEqual([{ glob: "src/**", mode: "allow" }])
  })

  test("非数组输入返回空数组", () => {
    expect(extractPermissionRules(null)).toEqual([])
    expect(extractPermissionRules(undefined)).toEqual([])
    expect(extractPermissionRules({})).toEqual([])
    expect(extractPermissionRules("string")).toEqual([])
  })

  test("buildPermissionConfig 写回 config.permission 格式", () => {
    const rules: PermissionRule[] = [
      { glob: "src/**", mode: "allow" },
      { glob: "secrets/**", mode: "deny" },
    ]
    expect(buildPermissionConfig(rules)).toEqual([
      { glob: "src/**", mode: "allow" },
      { glob: "secrets/**", mode: "deny" },
    ])
  })

  test("往返：extract → build 保留规则", () => {
    const orig = [
      { glob: "src/**", mode: "allow" },
      { glob: "secrets/**", mode: "deny" },
      { glob: "temp/**", mode: "ask" },
    ]
    const rebuilt = buildPermissionConfig(extractPermissionRules(orig))
    expect(rebuilt).toEqual(orig)
  })

  test("空数组往返", () => {
    expect(buildPermissionConfig(extractPermissionRules([]))).toEqual([])
  })
})

// I1 修复测试：buildAgentConfig/buildMcpConfig/buildPermissionConfig 保留嵌套非表单字段。
describe("I1: buildAgentConfig 保留嵌套字段", () => {
  test("保留 agent 下的非 model 字段（如 description/tools/prompt）", () => {
    const orig = {
      build: { model: "old-model", description: "构建 agent", tools: ["bash", "fs"] },
      plan: { model: "auto", prompt: "规划提示词" },
    }
    const bindings = extractAgentBindings(orig)
    const rebuilt = buildAgentConfig(bindings, orig)
    expect(rebuilt.build).toEqual({
      model: "old-model",
      description: "构建 agent",
      tools: ["bash", "fs"],
    })
    expect(rebuilt.plan).toEqual({ model: "auto", prompt: "规划提示词" })
  })

  test("保留原 config 中不在 bindings 里的 agent", () => {
    const orig = {
      build: { model: "claude-sonnet-4" },
      custom: { model: "gpt-5", customField: "保留" },
    }
    // bindings 只含 build，不含 custom
    const bindings: AgentBinding[] = [{ name: "build", model: "claude-sonnet-4" }]
    const rebuilt = buildAgentConfig(bindings, orig)
    expect(rebuilt.custom).toEqual({ model: "gpt-5", customField: "保留" })
  })

  test("更新 model 时保留其他字段", () => {
    const orig = {
      build: { model: "old", description: "保留我" },
    }
    const bindings: AgentBinding[] = [{ name: "build", model: "new" }]
    const rebuilt = buildAgentConfig(bindings, orig)
    expect(rebuilt.build).toEqual({ model: "new", description: "保留我" })
  })

  test("无 orig 时行为与之前一致", () => {
    const bindings: AgentBinding[] = [{ name: "build", model: "claude-sonnet-4" }]
    const rebuilt = buildAgentConfig(bindings)
    expect(rebuilt).toEqual({ build: { model: "claude-sonnet-4" } })
  })
})

describe("I1: buildMcpConfig 保留嵌套字段", () => {
  test("保留服务器下的未知字段（如 enabled/timeout/type）", () => {
    const orig = {
      "my-server": {
        command: "node",
        args: ["server.js"],
        enabled: true,
        timeout: 30000,
        type: "stdio",
      },
    }
    const servers = extractMcpServers(orig)
    const rebuilt = buildMcpConfig(servers, orig)
    expect(rebuilt["my-server"]).toEqual({
      command: "node",
      args: ["server.js"],
      enabled: true,
      timeout: 30000,
      type: "stdio",
    })
  })

  test("保留原 config 中不在 servers 里的条目", () => {
    const orig = {
      "my-server": { command: "node", args: ["server.js"] },
      "legacy-server": { command: "python", custom: "保留" },
    }
    const servers: McpServerEntry[] = [{ name: "my-server", command: "node", args: ["server.js"], env: [] }]
    const rebuilt = buildMcpConfig(servers, orig)
    expect(rebuilt["legacy-server"]).toEqual({ command: "python", custom: "保留" })
  })

  test("清空 command 时从 entry 删除 command 字段", () => {
    const orig = { "my-server": { command: "node", custom: "保留" } }
    const servers: McpServerEntry[] = [{ name: "my-server", command: undefined, args: [], env: [] }]
    const rebuilt = buildMcpConfig(servers, orig)
    expect(rebuilt["my-server"]).toEqual({ custom: "保留" })
    expect("command" in (rebuilt["my-server"] as Record<string, unknown>)).toBe(false)
  })

  test("无 orig 时行为与之前一致", () => {
    const servers: McpServerEntry[] = [{ name: "simple", command: "node", args: [], env: [] }]
    expect(buildMcpConfig(servers)).toEqual({ simple: { command: "node" } })
  })
})

describe("I1: buildPermissionConfig 保留嵌套字段", () => {
  test("保留每条规则中的未知字段（如 description/comment）", () => {
    const orig = [
      { glob: "src/**", mode: "allow", description: "允许源码" },
      { glob: "secrets/**", mode: "deny", comment: "禁止密钥" },
    ]
    const rules = extractPermissionRules(orig)
    const rebuilt = buildPermissionConfig(rules, orig)
    expect(rebuilt[0]).toEqual({ glob: "src/**", mode: "allow", description: "允许源码" })
    expect(rebuilt[1]).toEqual({ glob: "secrets/**", mode: "deny", comment: "禁止密钥" })
  })

  test("无 orig 时行为与之前一致", () => {
    const rules: PermissionRule[] = [{ glob: "src/**", mode: "allow" }]
    expect(buildPermissionConfig(rules)).toEqual([{ glob: "src/**", mode: "allow" }])
  })
})

// S1 修复测试：extractAgentBindings 的 model 类型断言安全。
describe("S1: extractAgentBindings model 类型安全", () => {
  test("model 为非 string（数字）时回退 auto", () => {
    const agentConfig = { build: { model: 42 } }
    const bindings = extractAgentBindings(agentConfig)
    expect(bindings[0]).toEqual({ name: "build", model: "auto" })
  })

  test("model 为 null 时回退 auto", () => {
    const agentConfig = { build: { model: null } }
    const bindings = extractAgentBindings(agentConfig)
    expect(bindings[0]).toEqual({ name: "build", model: "auto" })
  })

  test("model 为对象时回退 auto", () => {
    const agentConfig = { build: { model: { nested: "object" } } }
    const bindings = extractAgentBindings(agentConfig)
    expect(bindings[0]).toEqual({ name: "build", model: "auto" })
  })

  test("model 为数组时回退 auto", () => {
    const agentConfig = { build: { model: ["array"] } }
    const bindings = extractAgentBindings(agentConfig)
    expect(bindings[0]).toEqual({ name: "build", model: "auto" })
  })

  test("model 为 string 时正常提取", () => {
    const agentConfig = { build: { model: "claude-sonnet-4" } }
    const bindings = extractAgentBindings(agentConfig)
    expect(bindings[0]).toEqual({ name: "build", model: "claude-sonnet-4" })
  })
})

// S2 修复测试：extractMcpServers 的 args 元素类型校验。
describe("S2: extractMcpServers args 元素类型校验", () => {
  test("args 含非 string 元素时被过滤", () => {
    const mcpConfig = {
      "my-server": {
        command: "node",
        args: ["valid", 42, null, { obj: true }, "also-valid"],
      },
    }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0].args).toEqual(["valid", "also-valid"])
  })

  test("args 全为 string 时正常提取", () => {
    const mcpConfig = {
      "my-server": { command: "node", args: ["a", "b", "c"] },
    }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0].args).toEqual(["a", "b", "c"])
  })

  test("args 为空数组时返回空数组", () => {
    const mcpConfig = { "my-server": { command: "node", args: [] } }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0].args).toEqual([])
  })
})

// S7 修复测试：extractMcpServers 校验 val 为对象。
describe("S7: extractMcpServers val 对象校验", () => {
  test("val 为 string 时返回空 args/env", () => {
    const mcpConfig = { bad: "string-value" }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0]).toEqual({ name: "bad", args: [], env: [] })
  })

  test("val 为数字时返回空 args/env", () => {
    const mcpConfig = { bad: 42 }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0]).toEqual({ name: "bad", args: [], env: [] })
  })

  test("val 为 null 时返回空 args/env", () => {
    const mcpConfig = { bad: null }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0]).toEqual({ name: "bad", args: [], env: [] })
  })

  test("val 为数组时返回空 args/env", () => {
    const mcpConfig = { bad: [1, 2, 3] }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0]).toEqual({ name: "bad", args: [], env: [] })
  })

  test("val 为对象时正常提取", () => {
    const mcpConfig = { good: { command: "node", args: ["server.js"] } }
    const servers = extractMcpServers(mcpConfig)
    expect(servers[0].command).toBe("node")
    expect(servers[0].args).toEqual(["server.js"])
  })
})

// 工单 12 次 seam 单测：.opencode/ 目录节点标签含文件数。
describe("formatSubdirNodeLabel（工单 12 目录节点标签含文件数）", () => {
  test("未展开：只显示目录名 + 斜杠", () => {
    expect(formatSubdirNodeLabel("agents", false, 0)).toBe("agents/")
    expect(formatSubdirNodeLabel("skills", false, 5)).toBe("skills/")
  })

  test("展开后：显示目录名 + 文件数", () => {
    expect(formatSubdirNodeLabel("agents", true, 3)).toBe("agents/（3）")
    expect(formatSubdirNodeLabel("plugins", true, 12)).toBe("plugins/（12）")
  })

  test("展开后空目录：显示文件数 0", () => {
    expect(formatSubdirNodeLabel("themes", true, 0)).toBe("themes/（0）")
  })

  test("文件数来自 entries 长度——与 listDirectoryEntries 返回条目数一致", () => {
    // 模拟 listDirectoryEntries 返回 3 个条目
    const entries = [
      { name: "a.md", path: "/.opencode/agents/a.md", isDirectory: false },
      { name: "b.md", path: "/.opencode/agents/b.md", isDirectory: false },
      { name: "sub", path: "/.opencode/agents/sub", isDirectory: true },
    ]
    expect(formatSubdirNodeLabel("agents", true, entries.length)).toBe("agents/（3）")
  })

  test("展开/收起切换：同一目录标签随 expanded 变化", () => {
    expect(formatSubdirNodeLabel("agents", false, 3)).toBe("agents/")
    expect(formatSubdirNodeLabel("agents", true, 3)).toBe("agents/（3）")
    expect(formatSubdirNodeLabel("agents", false, 3)).toBe("agents/")
  })
})
