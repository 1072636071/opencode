import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { app } from "electron"
import { opencodeConfigDir, stripBom } from "./launcher-snapshot"

export type LauncherSettings = {
  autoStart: boolean
}

// 工单 10 日常形态：打包后默认自动启动 sidecar+renderer 并最小化到托盘；
// dev 模式默认 false 防"一闪而过"（经验文档坑3：launcher 窗口闪一下就 hide）。
const DEFAULT: LauncherSettings = { autoStart: app.isPackaged }

function settingsFile(): string {
  return join(opencodeConfigDir(), "launcher", "settings.json")
}

export async function getLauncherSettings(): Promise<LauncherSettings> {
  try {
    if (!existsSync(settingsFile())) return DEFAULT
    const raw = await readFile(settingsFile(), "utf8")
    // Strip UTF-8 BOM — PowerShell Set-Content -Encoding UTF8 and some editors
    // prepend \uFEFF, which causes JSON.parse to throw SyntaxError silently.
    return { ...DEFAULT, ...JSON.parse(stripBom(raw)) }
  } catch {
    return DEFAULT
  }
}

export async function setLauncherSettings(s: Partial<LauncherSettings>): Promise<LauncherSettings> {
  const current = await getLauncherSettings()
  const next = { ...current, ...s }
  await mkdir(dirname(settingsFile()), { recursive: true })
  await writeFile(settingsFile(), JSON.stringify(next, null, 2), "utf8")
  return next
}
