/**
 * Launcher "LLM API" form → payload mapping (Seam D).
 *
 * Pure, synchronous, no Electron dependency. Tested by `llm-api-form.test.ts`.
 *
 * Mirrors the main app's `dialog-custom-provider-form.ts` config shape so the
 * saved provider is recognised by `isConfigCustom` in the settings page:
 *   { npm: "@ai-sdk/openai-compatible", name, options: { baseURL }, models: { [id]: { name } } }
 */

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

export type LlmApiFormState = {
  providerID: string
  baseURL: string
  apiKey: string
  modelName: string
}

export type LlmApiFormErrors = {
  providerID?: string
  baseURL?: string
  apiKey?: string
  modelName?: string
}

export type LlmApiPayload = {
  providerID: string
  /** Value to merge into `opencode.json` under `provider.<id>`. */
  providerConfig: Record<string, unknown>
  /** Value to write into `auth.json` under `<providerID>`, or null to skip. */
  authKey: string | null
}

export type LlmApiFormResult = {
  errors: LlmApiFormErrors
  result?: LlmApiPayload
}

export function validateLlmApiForm(form: LlmApiFormState): LlmApiFormResult {
  const providerID = form.providerID.trim()
  const baseURL = form.baseURL.trim()
  const apiKey = form.apiKey.trim()
  const modelName = form.modelName.trim()

  const errors: LlmApiFormErrors = {}

  if (!providerID) {
    errors.providerID = "厂商 ID 必填"
  } else if (!PROVIDER_ID.test(providerID)) {
    errors.providerID = "厂商 ID 只能包含小写字母、数字、连字符和下划线"
  }

  if (!baseURL) {
    errors.baseURL = "Base URL 必填"
  } else if (!/^https?:\/\//.test(baseURL)) {
    errors.baseURL = "Base URL 必须以 http:// 或 https:// 开头"
  }

  if (!apiKey) {
    errors.apiKey = "API Key 必填"
  }

  if (!modelName) {
    errors.modelName = "模型名必填"
  }

  if (Object.keys(errors).length > 0) return { errors }

  const providerConfig: Record<string, unknown> = {
    npm: OPENAI_COMPATIBLE,
    name: providerID,
    options: { baseURL },
    models: { [modelName]: { name: modelName } },
  }

  return {
    errors: {},
    result: {
      providerID,
      providerConfig,
      authKey: apiKey,
    },
  }
}

/**
 * Merge a provider config into an existing opencode.json config object.
 * Preserves all existing keys; only `provider.<id>` is set/overwritten.
 */
export function mergeProviderConfig(
  config: Record<string, unknown> | null,
  providerID: string,
  providerConfig: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config }
  const existing = (next.provider as Record<string, unknown> | undefined) ?? {}
  next.provider = { ...existing, [providerID]: providerConfig }
  return next
}
