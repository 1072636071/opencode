// Allowlist of app names the open-path IPC handler may invoke via execFile.
// Mirrors the openWith values from OPEN_APPS in packages/app (session-header/open-in-app).
// The renderer must never pass an arbitrary executable; validate against this set to prevent RCE.
export const ALLOWED_OPEN_APPS = new Set([
  "Visual Studio Code",
  "Cursor",
  "Zed",
  "TextMate",
  "Antigravity",
  "Terminal",
  "iTerm",
  "Ghostty",
  "Warp",
  "Xcode",
  "Android Studio",
  "Sublime Text",
  "code",
  "cursor",
  "zed",
  "powershell",
])

// Pure decision function for the open-path IPC handler. Extracted so the allowlist
// gate is unit-testable without spinning up Electron IPC or node:sqlite. Three outcomes:
//   - shell:  no app requested → handler falls back to shell.openPath
//   - exec:   app is on the allowlist → handler invokes execFile
//   - reject: app is off the allowlist → handler throws (RCE guard)
export function resolveOpenApp(app?: string) {
  if (!app) return { kind: "shell", app: undefined } as const
  if (ALLOWED_OPEN_APPS.has(app)) return { kind: "exec", app } as const
  return { kind: "reject", app } as const
}
