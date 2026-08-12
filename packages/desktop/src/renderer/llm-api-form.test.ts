import { describe, expect, test } from "bun:test"
import { mergeProviderConfig, validateLlmApiForm } from "./llm-api-form"

describe("validateLlmApiForm", () => {
  test("builds provider config and auth key from valid input", () => {
    const { errors, result } = validateLlmApiForm({
      providerID: "my-llm",
      baseURL: "https://api.example.com/v1",
      apiKey: "sk-test-key",
      modelName: "gpt-4o",
    })
    expect(errors).toEqual({})
    expect(result).toEqual({
      providerID: "my-llm",
      providerConfig: {
        npm: "@ai-sdk/openai-compatible",
        name: "my-llm",
        options: { baseURL: "https://api.example.com/v1" },
        models: { "gpt-4o": { name: "gpt-4o" } },
      },
      authKey: "sk-test-key",
    })
  })

  test("trims whitespace from all fields", () => {
    const { result } = validateLlmApiForm({
      providerID: "  my-llm  ",
      baseURL: "  https://api.example.com/v1  ",
      apiKey: "  sk-test  ",
      modelName: "  gpt-4o  ",
    })
    expect(result?.providerID).toBe("my-llm")
    expect(result?.providerConfig.options).toMatchObject({ baseURL: "https://api.example.com/v1" })
    expect(result?.authKey).toBe("sk-test")
    expect(result?.providerConfig.models).toMatchObject({ "gpt-4o": { name: "gpt-4o" } })
  })

  test("rejects empty providerID", () => {
    const { errors, result } = validateLlmApiForm({
      providerID: "",
      baseURL: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-4o",
    })
    expect(errors.providerID).toBeDefined()
    expect(result).toBeUndefined()
  })

  test("rejects invalid providerID format", () => {
    const { errors } = validateLlmApiForm({
      providerID: "My LLM!",
      baseURL: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-4o",
    })
    expect(errors.providerID).toBeDefined()
  })

  test("allows providerID with hyphens and underscores", () => {
    const { result } = validateLlmApiForm({
      providerID: "my_llm-v2",
      baseURL: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelName: "gpt-4o",
    })
    expect(result?.providerID).toBe("my_llm-v2")
  })

  test("rejects empty baseURL", () => {
    const { errors } = validateLlmApiForm({
      providerID: "my-llm",
      baseURL: "",
      apiKey: "sk-test",
      modelName: "gpt-4o",
    })
    expect(errors.baseURL).toBeDefined()
  })

  test("rejects non-http baseURL", () => {
    const { errors } = validateLlmApiForm({
      providerID: "my-llm",
      baseURL: "ftp://example.com",
      apiKey: "sk-test",
      modelName: "gpt-4o",
    })
    expect(errors.baseURL).toBeDefined()
  })

  test("rejects empty apiKey", () => {
    const { errors } = validateLlmApiForm({
      providerID: "my-llm",
      baseURL: "https://api.example.com/v1",
      apiKey: "",
      modelName: "gpt-4o",
    })
    expect(errors.apiKey).toBeDefined()
  })

  test("rejects empty modelName", () => {
    const { errors } = validateLlmApiForm({
      providerID: "my-llm",
      baseURL: "https://api.example.com/v1",
      apiKey: "sk-test",
      modelName: "",
    })
    expect(errors.modelName).toBeDefined()
  })

  test("collects all errors at once", () => {
    const { errors } = validateLlmApiForm({
      providerID: "",
      baseURL: "",
      apiKey: "",
      modelName: "",
    })
    expect(Object.keys(errors)).toEqual(["providerID", "baseURL", "apiKey", "modelName"])
  })
})

describe("mergeProviderConfig", () => {
  test("merges provider into empty config", () => {
    const result = mergeProviderConfig(null, "my-llm", { npm: "@ai-sdk/openai-compatible" })
    expect(result).toEqual({
      provider: { "my-llm": { npm: "@ai-sdk/openai-compatible" } },
    })
  })

  test("preserves existing config keys", () => {
    const result = mergeProviderConfig(
      { model: "claude-sonnet-4", plugins: ["foo"] },
      "my-llm",
      { npm: "@ai-sdk/openai-compatible" },
    )
    expect(result).toEqual({
      model: "claude-sonnet-4",
      plugins: ["foo"],
      provider: { "my-llm": { npm: "@ai-sdk/openai-compatible" } },
    })
  })

  test("overwrites existing provider with same ID", () => {
    const result = mergeProviderConfig(
      { provider: { "my-llm": { old: true }, other: { keep: true } } },
      "my-llm",
      { npm: "@ai-sdk/openai-compatible", new: true },
    )
    expect(result.provider).toEqual({
      "my-llm": { npm: "@ai-sdk/openai-compatible", new: true },
      other: { keep: true },
    })
  })

  test("does not mutate the input config object", () => {
    const original = { model: "claude" }
    const result = mergeProviderConfig(original, "my-llm", { npm: "x" })
    expect(original).toEqual({ model: "claude" })
    expect(result).not.toBe(original)
  })
})
