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
  parseVersion,
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
