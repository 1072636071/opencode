import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { createMemo, createResource, For, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"
import {
  modelSpec,
  resolveAgentModelSource,
  toAgentModelRows,
  type AgentModelRow,
} from "./agent-model-controllers"
import { useAgentModelWriter } from "./use-agent-model-writer"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type ModelOption = { value: string; label: string }

export const SettingsAgentsV2: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const models = useModels()
  const { write } = useAgentModelWriter()
  const AUTO_OPTION = (): ModelOption => ({ value: "auto", label: language.t("settings.agents.model.placeholder") })

  const [agents] = createResource(async () => {
    const response = await serverSdk().client.app.agents()
    const list = Array.isArray(response.data) ? response.data : []
    const rows: AgentModelRow[] = list.map((a) => ({
      name: a.name,
      description: a.description,
      model: a.model,
    }))
    return toAgentModelRows(rows)
  })

  const modelOptions = createMemo<ModelOption[]>(() => {
    const opts = models
      .list()
      .map((m) => ({ value: modelSpec(m.provider.id, m.id), label: `${m.provider.name} · ${m.name}` }))
    return [AUTO_OPTION(), ...opts]
  })

  const optionFor = (row: AgentModelRow): ModelOption => {
    if (!row.model) return AUTO_OPTION()
    const value = modelSpec(row.model.providerID, row.model.modelID)
    return modelOptions().find((o) => o.value === value) ?? { value, label: value }
  }

  const handleSelect = async (row: AgentModelRow, value: string | null) => {
    const source = resolveAgentModelSource(row.name)
    const auto = value === null || value === "auto"
    const model = auto ? undefined : (() => {
      const [providerID, ...rest] = value.split("/")
      return { providerID, modelID: rest.join("/") }
    })()
    const result = await write({ source, name: row.name, model })
    if (result.ok) {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.agents.toast.saved.title", { name: row.name }),
      })
    } else {
      showToast({ variant: "error", title: language.t("common.requestFailed"), description: result.error })
    }
  }

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked">
        <h2 class="settings-v2-tab-title">{language.t("settings.agents.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-agents">
        <SettingsListV2>
          <For each={agents()}>
            {(row) => (
              <SettingsRowV2 title={row.name} description={row.description ?? ""}>
                <SelectV2<ModelOption>
                  appearance="inline"
                  placeholder={language.t("settings.agents.model.placeholder")}
                  options={modelOptions()}
                  current={optionFor(row)}
                  value={(o) => o.value}
                  label={(o) => o.label}
                  onSelect={(value) => void handleSelect(row, value?.value ?? null)}
                />
              </SettingsRowV2>
            )}
          </For>
        </SettingsListV2>
      </div>
    </>
  )
}
