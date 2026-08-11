import { describe, expect, test } from "bun:test"
import {
  OMO_BUILTIN_AGENT_NAMES,
  buildBindPayload,
  buildOmoConfigEdits,
  buildOpenCodeGlobalPatch,
  isOmoBuiltinAgent,
  modelSpec,
  resolveAgentModelSource,
  toAgentModelRows,
} from "./agent-model-controllers"

describe("agent model controllers (来源识别 + 写入路由 + 两态 payload)", () => {
  test("identifies OMO builtin agents and routes them to omo source", () => {
    for (const name of OMO_BUILTIN_AGENT_NAMES) {
      expect(isOmoBuiltinAgent(name)).toBe(true)
      expect(resolveAgentModelSource(name)).toBe("omo")
    }
  })

  test("routes every non-OMO agent name to opencode source", () => {
    expect(resolveAgentModelSource("build")).toBe("opencode")
    expect(resolveAgentModelSource("plan")).toBe("opencode")
    expect(resolveAgentModelSource("姜小晓")).toBe("opencode")
    expect(resolveAgentModelSource("姜小晓·自动")).toBe("opencode")
    expect(resolveAgentModelSource("江二妞")).toBe("opencode")
    expect(resolveAgentModelSource("江小查")).toBe("opencode")
  })

  test("normalizes a specified model to providerID/modelID", () => {
    expect(modelSpec("openai", "gpt-5.6-sol")).toBe("openai/gpt-5.6-sol")
  })

  describe("OpenCode global write payload", () => {
    test("specified model writes agent.<name>.model", () => {
      expect(buildOpenCodeGlobalPatch("江二妞", { providerID: "openai", modelID: "gpt-5" })).toEqual({
        agent: { 江二妞: { model: "openai/gpt-5" } },
      })
    })

    test("auto marks model as undefined so patchJsonc deletes it", () => {
      expect(buildOpenCodeGlobalPatch("江二妞", undefined)).toEqual({
        agent: { 江二妞: { model: undefined } },
      })
    })
  })

  describe("OMO config edits", () => {
    test("specified model writes agents.<name>.model", () => {
      expect(buildOmoConfigEdits("sisyphus", { providerID: "anthropic", modelID: "claude-opus-5" })).toEqual([
        { path: ["agents", "sisyphus", "model"], value: "anthropic/claude-opus-5" },
      ])
    })

    test("auto uses undefined value so updateOmoConfig deletes the field", () => {
      expect(buildOmoConfigEdits("oracle", undefined)).toEqual([
        { path: ["agents", "oracle", "model"], value: undefined },
      ])
    })
  })

  describe("dual-path bind payload", () => {
    test("routes an OMO agent bind to both payload shapes", () => {
      const { source, openCodePatch, omoEdits } = buildBindPayload({
        source: "omo",
        name: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus-5" },
      })
      expect(source).toBe("omo")
      expect(openCodePatch).toEqual({ agent: { sisyphus: { model: "anthropic/claude-opus-5" } } })
      expect(omoEdits).toEqual([{ path: ["agents", "sisyphus", "model"], value: "anthropic/claude-opus-5" }])
    })

    test("routes an opencode agent bind to both payload shapes with auto", () => {
      const { source, openCodePatch, omoEdits } = buildBindPayload({
        source: "opencode",
        name: "江二妞",
        model: undefined,
      })
      expect(source).toBe("opencode")
      expect(openCodePatch).toEqual({ agent: { 江二妞: { model: undefined } } })
      expect(omoEdits).toEqual([{ path: ["agents", "江二妞", "model"], value: undefined }])
    })
  })

  describe("agent list normalization", () => {
    test("drops hidden internal agents and keeps everything else", () => {
      const rows = toAgentModelRows([
        { name: "build" },
        { name: "江二妞", model: { providerID: "openai", modelID: "gpt-5" } },
        { name: "sisyphus" },
        { name: "compaction" },
        { name: "title" },
        { name: "summary" },
      ])
      expect(rows.map((r) => r.name)).toEqual(["build", "江二妞", "sisyphus"])
    })
  })
})
