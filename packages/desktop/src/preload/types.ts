import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { WslServersPlatform } from "@opencode-ai/app/wsl/types"
import type { UpdaterState } from "@opencode-ai/app/updater"
import type { DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"
export type {
  WslDistroProbe,
  WslInstalledDistro,
  WslJob,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "@opencode-ai/app/wsl/types"

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type OpencodeStatus = "idle" | "starting" | "running" | "stopping" | "failed"

export type LauncherSnapshotMeta = {
  id: string
  timestamp: number
  type: "auto" | "manual"
  tag: string | null
  projectHash: string | null
  pluginCount: number
  configFiles: string[]
}

export type RollbackPhase = "idle" | "stopping" | "restoring" | "reinstalling" | "restarting" | "done" | "failed"

export type RollbackProgress = {
  phase: RollbackPhase
  failedPlugins?: string[]
  error?: string
}

export type LauncherSettings = {
  autoStart: boolean
}

export type LauncherStartOptions = {
  safeMode?: boolean
  disabledPlugins?: string[]
}

export type LauncherPluginInfo = {
  spec: string
  source: "npm" | "file" | "unknown"
  version?: string
}

export type LauncherPluginLogEntry = {
  line: string
  level: "log" | "warn" | "error"
  ts: number
}

export type LauncherPluginStageName = "install" | "entry" | "compatibility" | "load"

export type LauncherPluginStageState = {
  spec: string
  stage: LauncherPluginStageName
  startedAt: number
  durationMs?: number
  error?: string
}

export type LauncherPluginLoadEntry = {
  spec: string
  status: "pending" | "loading" | "loaded" | "failed"
  stages: LauncherPluginStageState[]
  order: number
  error?: string
}

export type LauncherDiagnosticsMeta = {
  launcherVersion: string
  opencodeVersion: string
  generatedAt: string
}

export type LauncherErrorSnippet = {
  path: string | null
  line: number | null
  message: string
  spec?: string
  stage?: string
  ts: number
}

export type LauncherToolStatus = {
  name: string
  displayName: string
  present: boolean
  version: string | null
  binaryPath: string
}

export type LauncherInstallRtkResult = {
  ok: boolean
  binaryPath: string
  present: boolean
  version: string | null
  profilePath: string
  hookLine: string
  manualUsage: string
  error?: string
}

export type LauncherInstallCodemapResult = {
  ok: boolean
  binaryPath: string
  present: boolean
  version: string | null
  mcpName: string
  configPath: string | null
  error?: string
}

export type WslServersAPI = WslServersPlatform
export type UpdaterAPI = {
  subscribe: (cb: (state: UpdaterState) => void) => Promise<() => void>
  check: () => Promise<UpdaterState>
  install: () => Promise<void>
}

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
  scheme?: "system" | "light" | "dark"
}
export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: () => Promise<ServerReadyData>
  wslServers: WslServersAPI
  updater: UpdaterAPI
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  isFirstLaunchOnboardingPending: () => Promise<boolean>
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null>
  isOldLayoutEligible: () => Promise<boolean>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  checkAppExists: (appName: string) => Promise<boolean>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>
  draftGet: (key: string) => Promise<string | null>
  draftSet: (key: string, value: string) => Promise<void>
  draftDelete: (key: string) => Promise<void>
  draftBlobPut: (data: ArrayBuffer) => Promise<string>
  draftBlobGet: (id: string) => Promise<ArrayBuffer | null>
  omoConfigWrite: (name: string, model: string | null) => Promise<{ ok: boolean; error?: string }>
  openLauncher: () => Promise<boolean>
  launcherMinimize: () => Promise<void>
  launcherClose: () => Promise<void>
  launcherStart: (opts?: LauncherStartOptions) => Promise<void>
  launcherStop: () => Promise<void>
  launcherGetStatus: () => Promise<{ status: OpencodeStatus; error?: string }>
  onLauncherStatusChange: (cb: (status: OpencodeStatus, error?: string) => void) => () => void
  launcherManualSnapshot: () => Promise<LauncherSnapshotMeta>
  launcherListSnapshots: () => Promise<LauncherSnapshotMeta[]>
  launcherTagSnapshot: (id: string, tag: string) => Promise<void>
  launcherUntagSnapshot: (id: string) => Promise<void>
  launcherRollbackSnapshot: (id: string) => Promise<{ failedPlugins: string[] }>
  onLauncherRollbackProgress: (cb: (p: RollbackProgress) => void) => () => void
  launcherGetSettings: () => Promise<LauncherSettings>
  launcherSetSettings: (s: Partial<LauncherSettings>) => Promise<LauncherSettings>
  launcherListPlugins: () => Promise<LauncherPluginInfo[]>
  launcherGetPluginLogs: () => Promise<LauncherPluginLogEntry[]>
  onLauncherPluginLogs: (cb: (logs: LauncherPluginLogEntry[]) => void) => () => void
  launcherGetPluginLoads: () => Promise<LauncherPluginLoadEntry[]>
  onLauncherPluginLoads: (cb: (entries: LauncherPluginLoadEntry[]) => void) => () => void
  launcherGetDiagnosticsMeta: () => Promise<LauncherDiagnosticsMeta>
  launcherGetErrorSnippets: () => Promise<LauncherErrorSnippet[]>
  launcherInstallUpdate: () => Promise<void>
  launcherExportLogs: (path: string, content: string) => Promise<void>
  launcherGetConfigPath: () => Promise<string | null>
  launcherReadConfig: () => Promise<Record<string, unknown> | null>
  launcherSaveConfig: (config: Record<string, unknown>) => Promise<string>
  launcherSaveAuthKey: (providerID: string, key: string | null) => Promise<string>
  launcherInstallPlugin: (spec: string) => Promise<void>
  launcherUninstallPlugin: (spec: string) => Promise<void>
  launcherTogglePlugin: (spec: string, enabled: boolean) => Promise<void>
  launcherExportBundle: (id: string) => Promise<string>
  launcherImportBundle: (content: string) => Promise<{ failedPlugins: string[] }>
  onLauncherImportProgress: (cb: (phase: string) => void) => () => void
  launcherGetTools: () => Promise<LauncherToolStatus[]>
  launcherInstallRtk: () => Promise<LauncherInstallRtkResult>
  launcherInstallCodemap: () => Promise<LauncherInstallCodemapResult>

  getWindowID: () => Promise<string>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    extensions?: string[]
  }) => Promise<{ token: string; files: { path: string; name: string; size: number }[] } | null>
  readPickedFile: (token: string, path: string) => Promise<ArrayBuffer>
  releasePickedFiles: (token: string) => Promise<void>
  getPathForFile: (file: File) => string
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openExternal: (url: string) => void
  openLocalFile: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  revealPath: (path: string) => Promise<boolean>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  getWindowFocused: () => Promise<boolean>
  getWindowFullscreen: () => Promise<boolean>
  onWindowFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  getWindowMaximized: () => Promise<boolean>
  onWindowMaximizedChanged: (cb: (maximized: boolean) => void) => () => void
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  setForceFocus: (enabled: boolean) => Promise<void>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void>
  setNativeTranslations: (bundle: DesktopNativeBundle) => Promise<void>
}
