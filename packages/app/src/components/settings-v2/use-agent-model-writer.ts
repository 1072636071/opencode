import { useServerSDK } from "@/context/server-sdk"
import {
  buildOmoConfigEdits,
  buildOpenCodeGlobalPatch,
  type AgentModelBind,
} from "./agent-model-controllers"

export type AgentModelWriteResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * 模型绑定写入的统一入口（双路径分发）。
 * - OMO 内置 agent → 桌面 IPC 写 `~/.omo/omo.jsonc`（window.api.omoConfigWrite）。
 * - 其余 → config.updateGlobal 写全局 opencode config 的 `agent.<name>.model`，
 *   随后触发 reload 使新配置生效。
 */
export function useAgentModelWriter() {
  const serverSdk = useServerSDK()

  const writeOpenCode = async (bind: AgentModelBind): Promise<AgentModelWriteResult> => {
    try {
      const patch = buildOpenCodeGlobalPatch(bind.name, bind.model)
      await serverSdk().client.global.config.update({ config: patch })
      await serverSdk().client.global.dispose()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const writeOmo = async (bind: AgentModelBind): Promise<AgentModelWriteResult> => {
    const edits = buildOmoConfigEdits(bind.name, bind.model)
    const target = edits[0]
    const api = typeof window !== "undefined" ? window.api : undefined
    if (!api?.omoConfigWrite) {
      return {
        ok: false,
        error: "OMO 配置写入通道不可用：桌面 IPC 未注入 omoConfigWrite。",
      }
    }
    try {
      // null 表示删除绑定（undefined 经 Electron IPC 不可靠序列化，显式用 null）
      const result = await api.omoConfigWrite(bind.name, target?.value ?? null)
      return result.ok ? { ok: true } : { ok: false, error: result.error ?? "OMO 配置写入失败" }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const write = async (bind: AgentModelBind): Promise<AgentModelWriteResult> => {
    if (bind.source === "omo") return writeOmo(bind)
    return writeOpenCode(bind)
  }

  return { write }
}
