import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { opencodeConfigDir } from "./launcher-snapshot"

export type LauncherSettings = {
  autoStart: boolean
}

const DEFAULT: LauncherSettings = { autoStart: true }

function settingsFile(): string {
  return join(opencodeConfigDir(), "launcher", "settings.json")
}

export async function getLauncherSettings(): Promise<LauncherSettings> {
  try {
    if (!existsSync(settingsFile())) return DEFAULT
    const raw = await readFile(settingsFile(), "utf8")
    return { ...DEFAULT, ...JSON.parse(raw) }
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
