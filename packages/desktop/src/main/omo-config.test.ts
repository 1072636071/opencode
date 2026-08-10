import { describe, expect, test } from "bun:test"
import { parse as parseJsonc } from "jsonc-parser"
import { applyAgentModelEdit } from "./omo-config"

const parse = (text: string): unknown => parseJsonc(text, undefined, { disallowComments: false })

describe("applyAgentModelEdit (OMO 内置 agent model 写入, jsonc 保留注释)", () => {
  test("sets model for an existing agent in existing agents object", () => {
    const input = `{
  "agents": {
    "sisyphus": {
      // keep this comment
      "model": "old/provider/model"
    },
    "oracle": {
      "temperature": 0
    }
  }
}`
    const out = applyAgentModelEdit(input, "sisyphus", "anthropic/claude-opus-5")
    expect(out).toContain("// keep this comment")
    expect(out).toContain('"model": "anthropic/claude-opus-5"')
    expect(out).not.toContain("old/provider/model")
    expect(parse(out)).toEqual({
      agents: {
        sisyphus: { model: "anthropic/claude-opus-5" },
        oracle: { temperature: 0 },
      },
    })
  })

  test("deletes model (value undefined) but keeps sibling keys and comments", () => {
    const input = `{
  "agents": {
    "sisyphus": {
      "model": "old/provider/model",
      "temperature": 0.7
    }
  }
}`
    const out = applyAgentModelEdit(input, "sisyphus", undefined)
    expect(out).not.toContain("old/provider/model")
    expect(parse(out)).toEqual({
      agents: {
        sisyphus: { temperature: 0.7 },
      },
    })
  })

  test("inserts a new agent into existing agents object", () => {
    const input = `{
  "agents": {
    "oracle": {}
  }
}`
    const out = applyAgentModelEdit(input, "sisyphus", "anthropic/claude-opus-5")
    expect(parse(out)).toEqual({
      agents: {
        oracle: {},
        sisyphus: { model: "anthropic/claude-opus-5" },
      },
    })
  })

  test("creates agents object when absent", () => {
    const input = `{
  "provider": {
    "openai": { "npm": "@ai-sdk/openai" }
  }
}`
    const out = applyAgentModelEdit(input, "sisyphus", "anthropic/claude-opus-5")
    expect(parse(out)).toEqual({
      provider: { openai: { npm: "@ai-sdk/openai" } },
      agents: { sisyphus: { model: "anthropic/claude-opus-5" } },
    })
  })

  test("handles an empty/blank file (no agents object)", () => {
    const out = applyAgentModelEdit("", "sisyphus", "anthropic/claude-opus-5")
    expect(parse(out)).toEqual({
      agents: { sisyphus: { model: "anthropic/claude-opus-5" } },
    })
  })
})
