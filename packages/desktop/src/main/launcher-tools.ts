import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import { applyEdits, modify, type FormattingOptions, type ModificationOptions } from "jsonc-parser"
import { opencodeConfigDir, stripBom, getConfigFilePath } from "./launcher-snapshot"

/**
 * 内置工具一键安装（ADR-033）。
 *
 * RTK 与 codebase-memory-mcp 均为外部二进制，不随安装包分发（不进 extraResources）。
 * 启动器「扩展/工具」页提供一键安装入口：
 *  - RTK：装二进制 + 写入 `$PROFILE` shell hook（`Invoke-Expression (&{rtk hook powershell})`）
 *    + 提供手动管道用法说明。接受「对 agent 命令输出不一定生效」的 shell hook 局限。
 *  - codebase-memory-mcp：装二进制 + 写入 opencode 原生 mcp 配置 `{type:"local", command:[...]}`。
 *
 * 纯函数不碰文件系统，便于单测（对齐 `omo-config.ts` / `launcher-snapshot.ts` 的既有 seam）。
 */

const execFileAsync = promisify(execFile)

export type ToolStatus = {
  name: string
  displayName: string
  present: boolean
  version: string | null
  binaryPath: string
}

/** RTK 二进制绝对路径。CONTEXT 记录位置：`~/.local/bin/rtk.exe`。 */
export function rtkBinaryPath(): string {
  return join(homedir(), ".local", "bin", "rtk.exe")
}

/** codebase-memory-mcp 二进制绝对路径。CONTEXT 记录位置：`%LOCALAPPDATA%\Programs\codebase-memory-mcp\`。 */
export function codemapBinaryPath(): string {
  const localAppData =
    process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
  return join(localAppData, "Programs", "codebase-memory-mcp", "codebase-memory-mcp.exe")
}

/** 从中取 `$PROFILE` 对应路径：PowerShell 7 用 Documents/PowerShell，Windows PowerShell 5.1 用 Documents/WindowsPowerShell。 */
export function powershellProfilePath(): string {
  const docs = join(homedir(), "Documents")
  // 优先 PowerShell 7 的 profile；不存在则回退到 Windows PowerShell 5.1。
  const ps7 = join(docs, "PowerShell", "Microsoft.PowerShell_profile.ps1")
  if (existsSync(ps7)) return ps7
  return join(docs, "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1")
}

/**
 * RTK 写进 `$PROFILE` 的 hook 行。对齐 `docs/rtk-codebase-memory-setup.md` 的官方写法。
 * 对 opencode 的 bash 工具不保证生效（非交互式调用不加载 profile），仅对用户手动跑命令生效（ADR-033）。
 */
export function buildRtkProfileHookLine(): string {
  return "Invoke-Expression (&{rtk hook powershell})"
}

/** 手动管道用法说明文案（写进 / 展示给用户的注释行）。 */
export function buildRtkManualUsage(): string {
  return [
    "# RTK 手动管道用法（已写入 $PROFILE 自动 hook）：",
    "#   git status | rtk",
    "#   npm test 2>&1 | rtk",
  ].join("\n")
}

/** codebase-memory-mcp 的 opencode 原生 mcp local 配置对象。 */
export function buildMcpLocalConfig(binaryPath: string): {
  type: "local"
  command: string[]
  enabled: boolean
} {
  return { type: "local", command: [binaryPath], enabled: true }
}

/** 解析 `--version` 输出首行，提取版本串。返回 null 若无法解析。 */
export function parseVersion(output: string): string | null {
  const first = output.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
  if (!first) return null
  // 形如 "rtk 0.5.2" / "0.5.2" / "codebase-memory-mcp v1.2.3"。
  const m = first.match(/(?:v?)(\d+(?:\.\d+){1,})/)
  return m ? m[1] : null
}

const formattingOptions: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" }
const modifyOptions: ModificationOptions = { formattingOptions }

/**
 * 纯函数：对 opencode.jsonc 文本设置 `mcp.<name>`，保留注释与其它字段（jsonc-parser modify）。
 * 复用 `omo-config.ts` 的 jsonc 编辑 seam。返回新文本。
 */
export function applyMcpConfigEdit(
  text: string,
  name: string,
  config: { type: "local"; command: string[]; enabled: boolean },
): string {
  const edits = modify(text, ["mcp", name], config, modifyOptions)
  return applyEdits(text, edits)
}

/**
 * 读 opencode 配置文件文本。不存在或读取失败返回 null（此时视为空配置文本）。
 * 复用 `launcher-snapshot` 的 config 路径 seam。
 */
export async function readConfigText(): Promise<string | null> {
  const path = getConfigFilePath()
  if (!path) return null
  try {
    return await readFile(path, "utf8")
  } catch {
    return null
  }
}

/**
 * 写 mcp 配置到 opencode 配置文件（不存在则创建 opencode.json）。
 * 返回写入后的文件路径。
 */
export async function writeMcpConfig(
  name: string,
  config: { type: "local"; command: string[]; enabled: boolean },
): Promise<string> {
  const path = getConfigFilePath() ?? join(opencodeConfigDir(), "opencode.json")
  const current = (await readConfigText().catch(() => null)) ?? "{}"
  const next = applyMcpConfigEdit(stripBom(current), name, config)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, next, "utf8")
  return path
}

/** 检测二进制存在 + 版本（`<bin> --version`）。文件缺失时 present=false 且版本 null。 */
export async function detectTool(binaryPath: string): Promise<{ present: boolean; version: string | null }> {
  if (!existsSync(binaryPath)) return { present: false, version: null }
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], { timeout: 10_000 })
    return { present: true, version: parseVersion(stdout) }
  } catch {
    // 二进制存在但 --version 失败：标记为存在，版本未知（不阻断安装/展示）。
    return { present: true, version: null }
  }
}

export type InstallRtkResult = {
  ok: boolean
  binaryPath: string
  present: boolean
  version: string | null
  profilePath: string
  hookLine: string
  manualUsage: string
  error?: string
}

/**
 * RTK 一键安装 = 装二进制 + 写 `$PROFILE` hook。
 * 「装二进制」= 检测二进制存在 + 版本；若缺失返回失败并给出安装指引（下载方式见 docs，不随包分发）。
 * hook 写入幂等：已包含该行则跳过追加。
 */
export async function installRtk(): Promise<InstallRtkResult> {
  const binaryPath = rtkBinaryPath()
  const detection = await detectTool(binaryPath)
  const hookLine = buildRtkProfileHookLine()
  const profilePath = powershellProfilePath()
  if (!detection.present) {
    return {
      ok: false,
      binaryPath,
      present: false,
      version: null,
      profilePath,
      hookLine,
      manualUsage: buildRtkManualUsage(),
      error: `未找到 ${binaryPath}。RTK 不随安装包分发，请先手动安装（见 docs/rtk-codebase-memory-setup.md）后重试。`,
    }
  }
  try {
    await appendHookToProfile(profilePath, hookLine)
  } catch (err) {
    return {
      ok: false,
      binaryPath,
      present: true,
      version: detection.version,
      profilePath,
      hookLine,
      manualUsage: buildRtkManualUsage(),
      error: `写入 $PROFILE 失败: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return {
    ok: true,
    binaryPath,
    present: true,
    version: detection.version,
    profilePath,
    hookLine,
    manualUsage: buildRtkManualUsage(),
  }
}

/** 追加 hook 行到 profile 文件（创建父目录与文件）。已含该行则不改动（幂等）。 */
export async function appendHookToProfile(profilePath: string, hookLine: string): Promise<void> {
  let current = ""
  try {
    if (existsSync(profilePath)) current = await readFile(profilePath, "utf8")
  } catch {
    current = ""
  }
  if (current.split(/\r?\n/).some((line) => line.trim() === hookLine)) return
  const separator = current.endsWith("\n") || current === "" ? "" : "\n"
  const append = current ? `${separator}# RTK hook (jiangxiao 一键安装)\n${hookLine}\n` : `# RTK hook (jiangxiao 一键安装)\n${hookLine}\n`
  await mkdir(dirname(profilePath), { recursive: true })
  await writeFile(profilePath, current + append, "utf8")
}

export type InstallCodemapResult = {
  ok: boolean
  binaryPath: string
  present: boolean
  version: string | null
  mcpName: string
  configPath: string | null
  error?: string
}

/** codebase-memory-mcp 一键安装 = 装二进制 + 写入 opencode mcp 配置。 */
export async function installCodemap(): Promise<InstallCodemapResult> {
  const binaryPath = codemapBinaryPath()
  const detection = await detectTool(binaryPath)
  if (!detection.present) {
    return {
      ok: false,
      binaryPath,
      present: false,
      version: null,
      mcpName: "codebase-memory-mcp",
      configPath: getConfigFilePath(),
      error: `未找到 ${binaryPath}。codebase-memory-mcp 不随安装包分发，请先手动安装（见 docs/rtk-codebase-memory-setup.md）后重试。`,
    }
  }
  const config = buildMcpLocalConfig(binaryPath)
  try {
    const configPath = await writeMcpConfig("codebase-memory-mcp", config)
    return {
      ok: true,
      binaryPath,
      present: true,
      version: detection.version,
      mcpName: "codebase-memory-mcp",
      configPath,
    }
  } catch (err) {
    return {
      ok: false,
      binaryPath,
      present: true,
      version: detection.version,
      mcpName: "codebase-memory-mcp",
      configPath: getConfigFilePath(),
      error: `写入 mcp 配置失败: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** 返回两个工具的检测状态（存在 + 版本），供「扩展/工具」页展示安装入口。 */
export async function getToolStatuses(): Promise<ToolStatus[]> {
  const rtk = await detectTool(rtkBinaryPath())
  const codemap = await detectTool(codemapBinaryPath())
  return [
    {
      name: "rtk",
      displayName: "RTK",
      present: rtk.present,
      version: rtk.version,
      binaryPath: rtkBinaryPath(),
    },
    {
      name: "codebase-memory-mcp",
      displayName: "codebase-memory-mcp",
      present: codemap.present,
      version: codemap.version,
      binaryPath: codemapBinaryPath(),
    },
  ]
}
