import { existsSync } from "node:fs"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import os from "node:os"
import { applyEdits, format, modify, type ModificationOptions } from "jsonc-parser"

/**
 * OMO 全局配置写入（~/.omo/omo.jsonc）。
 *
 * 承载「模型绑定面板」中 OMO 内置 agent 的写路径。与 OMO 插件的
 * updateOmoConfig（基于 jsonc-parser modify）语义一致：写 `agents.<name>.model`
 * 保留注释与格式；value 为 undefined 时删该字段（modify 对 undefined 走删除）。
 */

export type OmoConfigEdit = {
  path: readonly string[]
  value?: string
}

export type EditResult = { ok: boolean; error?: string }

const OMO_CONFIG_PATH = () => join(os.homedir(), ".omo", "omo.jsonc")

const modifyOptions: ModificationOptions = {
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
}

/**
 * 纯函数：对 jsonc 文本做 `agents.<name>.model` 的设置或删除（value 为 undefined 时删）。
 * 返回新文本。此函数不碰文件系统，便于单测。
 */
export function applyAgentModelEdit(
  text: string,
  name: string,
  value: string | undefined,
): string {
  const path = ["agents", name, "model"]
  // value 为 undefined 时删除该属性
  const edits = modify(text, path, value, {
    ...modifyOptions,
  })
  const patched = applyEdits(text, edits)
  // 删除后可能残留多余空行/缩进，格式化一次（保留顶层注释）。
  return applyEdits(patched, format(patched, undefined, modifyOptions.formattingOptions))
}

/** 读取 omo.jsonc（不存在则返回空对象文本）。 */
async function readOmoConfig(): Promise<string> {
  const file = OMO_CONFIG_PATH()
  if (!existsSync(file)) return "{}"
  return readFile(file, "utf8")
}

/** 写入（或删除）某 OMO 内置 agent 的 model 绑定。写失败返回错误信息。 */
export async function writeOmoAgentModel(name: string, model: string | undefined): Promise<EditResult> {
  const file = OMO_CONFIG_PATH()
  try {
    const text = await readOmoConfig()
    const next = applyAgentModelEdit(text, name, model)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, next, "utf8")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export type { OmoConfigEdit }
