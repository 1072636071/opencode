import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import {
  applyMcpConfigEdit,
  appendHookToProfile,
  buildMcpLocalConfig,
  buildRtkManualUsage,
  buildRtkProfileHookLine,
  findInPath,
  mergeMcpConfig,
  parseVersion,
  readExistingMcpConfig,
} from "./launcher-tools"

const parse = (text: string): unknown => parseJsonc(text, undefined, { disallowComments: false })

describe("工单 10 内置工具一键安装 — 纯逻辑", () => {
  test("buildMcpLocalConfig 生成 opencode 原生 mcp local 配置", () => {
    const cfg = buildMcpLocalConfig("C:\\path\\codebase-memory-mcp.exe")
    expect(cfg).toEqual({
      type: "local",
      command: ["C:\\path\\codebase-memory-mcp.exe"],
      enabled: true,
    })
  })

  test("buildRtkProfileHookLine 生成 $PROFILE hook 行", () => {
    expect(buildRtkProfileHookLine()).toBe("Invoke-Expression (&{rtk hook powershell})")
  })

  test("buildRtkManualUsage 包含手动管道用法", () => {
    const usage = buildRtkManualUsage()
    expect(usage).toContain("git status | rtk")
    expect(usage).toContain("npm test 2>&1 | rtk")
  })

  test("parseVersion 解析版本号", () => {
    expect(parseVersion("rtk 0.5.2")).toBe("0.5.2")
    expect(parseVersion("0.5.2\n")).toBe("0.5.2")
    expect(parseVersion("codebase-memory-mcp v1.2.3")).toBe("1.2.3")
    expect(parseVersion("")).toBeNull()
    expect(parseVersion("not a version")).toBeNull()
  })

  test("applyMcpConfigEdit 写入 mcp 配置，保留注释与其它字段", () => {
    const input = `{
  "mcp": {
    "other": { "type": "local", "command": ["a"] }
  }
}`
    const out = applyMcpConfigEdit(input, "codebase-memory-mcp", buildMcpLocalConfig("C:\\bin\\cm.exe"))
    expect(parse(out)).toEqual({
      mcp: {
        other: { type: "local", command: ["a"] },
        "codebase-memory-mcp": { type: "local", command: ["C:\\bin\\cm.exe"], enabled: true },
      },
    })
  })

  test("applyMcpConfigEdit 无 mcp 字段时新建", () => {
    const out = applyMcpConfigEdit("{}", "codebase-memory-mcp", buildMcpLocalConfig("/usr/bin/cm"))
    expect(parse(out)).toEqual({
      mcp: {
        "codebase-memory-mcp": { type: "local", command: ["/usr/bin/cm"], enabled: true },
      },
    })
  })

  test("readExistingMcpConfig 读取现有同名项；不存在返回 undefined", () => {
    const text = `{
  "mcp": {
    "codebase-memory-mcp": { "type": "local", "command": ["C:\\\\old\\\\cm.exe"], "enabled": false }
  }
}`
    const existing = readExistingMcpConfig(text, "codebase-memory-mcp") as { enabled: boolean }
    expect(existing.enabled).toBe(false)
    expect(readExistingMcpConfig(text, "rtk")).toBeUndefined()
    expect(readExistingMcpConfig("{}", "codebase-memory-mcp")).toBeUndefined()
  })

  test("mergeMcpConfig 保留现有 enabled 与额外字段，仅对齐 command 路径", () => {
    const existing = { type: "local", command: ["C:\\old\\cm.exe"], enabled: false, extra: 42 }
    const merged = mergeMcpConfig(existing, buildMcpLocalConfig("C:\\new\\cm.exe"))
    expect(merged).toEqual({
      type: "local",
      command: ["C:\\new\\cm.exe"],
      enabled: false,
      extra: 42,
    })
  })

  test("mergeMcpConfig 现有值非对象时直接用期望配置", () => {
    const merged = mergeMcpConfig("string-value", buildMcpLocalConfig("/usr/bin/cm"))
    expect(merged).toEqual({ type: "local", command: ["/usr/bin/cm"], enabled: true })
  })

  test("applyMcpConfigEdit 合并现有同名项：enabled 不被静默覆盖", () => {
    const input = `{
  "mcp": {
    "codebase-memory-mcp": { "type": "local", "command": ["C:\\\\old\\\\cm.exe"], "enabled": false }
  }
}`
    const out = applyMcpConfigEdit(input, "codebase-memory-mcp", buildMcpLocalConfig("C:\\new\\cm.exe"))
    expect(parse(out)).toEqual({
      mcp: {
        "codebase-memory-mcp": { type: "local", command: ["C:\\new\\cm.exe"], enabled: false },
      },
    })
  })

  test("findInPath 固定路径缺失时命中 PATH 中的可执行文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "rtk-path-"))
    const binPath = join(dir, "rtk.exe")
    writeFileSync(binPath, "")
    try {
      // 固定路径目录里没有 rtk，但 PATH 目录里有 → 命中
      const found = findInPath("rtk", `C:\\nonexistent;${dir}`)
      expect(found).toBe(binPath)
      // PATH 里也没有 → null
      expect(findInPath("rtk", "C:\\nonexistent")).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("appendHookToProfile 幂等：已含 hook 行不重复追加", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rtk-hook-"))
    const profile = join(dir, "profile.ps1")
    const hook = buildRtkProfileHookLine()
    try {
      await appendHookToProfile(profile, hook)
      await appendHookToProfile(profile, hook)
      const content = await import("node:fs/promises").then((m) => m.readFile(profile, "utf8"))
      const matches = content.split(/\r?\n/).filter((l) => l.trim() === hook)
      expect(matches.length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("appendHookToProfile 空文件创建带注释的 hook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rtk-hook2-"))
    const profile = join(dir, "profile.ps1")
    const hook = buildRtkProfileHookLine()
    try {
      await appendHookToProfile(profile, hook)
      const content = await import("node:fs/promises").then((m) => m.readFile(profile, "utf8"))
      expect(content).toContain(hook)
      expect(content).toContain("# RTK hook")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
