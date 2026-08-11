import { For, Show, createResource, type Component } from "solid-js"
import type { CommandInfo } from "@opencode-ai/client/promise"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings, toggleHiddenSkill } from "@/context/settings"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

// 全局技能列表（ADR-010 / 工单 05）：设置弹窗经 Portal 渲染，逃逸目录级
// SDKProvider 范围，禁止 useSDK()/useSync()（ADR-015）。改用 server 级
// useServerSDK() 调全局 app.skills()（/skill 端点，directory 可选），
// Home 页（无 session/draft 上下文）与 session 页显示一致。name 与
// skill 注册为 command 的 name 同源（opencode/src/command/index.ts:134-152）。
export const SettingsSkillsV2: Component = () => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const settings = useSettings()

  const [skills] = createResource(
    () => serverSdk()?.client,
    async (client) => {
      if (!client) return [] as CommandInfo[]
      const res = await client.app.skills()
      return (res.data ?? []).map(
        (skill): CommandInfo => ({
          name: skill.name,
          template: skill.content,
          description: skill.description,
        }),
      )
    },
    { initialValue: [] as CommandInfo[] },
  )

  const commands = () => skills() ?? []

  return (
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked">
        <h2 class="settings-v2-tab-title">{language.t("settings.skills.title")}</h2>
      </div>

      <div class="settings-v2-tab-body settings-v2-skills">
        <SettingsListV2>
          <Show when={commands().length > 0}>
            <For each={commands()}>
              {(cmd) => (
                <SettingsRowV2 title={cmd.name} description={cmd.description ?? ""}>
                  <div data-action={`settings-skill-visibility-${cmd.name}`}>
                    <Switch
                      checked={!settings.general.hiddenSkills().includes(cmd.name)}
                      onChange={(checked) =>
                        settings.general.setHiddenSkills(
                          toggleHiddenSkill(settings.general.hiddenSkills(), cmd.name, checked),
                        )
                      }
                    />
                  </div>
                </SettingsRowV2>
              )}
            </For>
          </Show>
        </SettingsListV2>
      </div>
    </>
  )
}
