import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { ElectronAPI, WslServersEvent, LauncherPluginLogEntry, LauncherPluginLoadEntry } from "./types"
import type { UpdaterState } from "@opencode-ai/app/updater"

const updaterCallbacks = new Set<(state: UpdaterState) => void>()
let updaterState: UpdaterState | undefined
let updaterSubscription: Promise<void> | undefined
const updaterHandler = (_: unknown, state: UpdaterState) => {
  updaterState = state
  updaterCallbacks.forEach((callback) => callback(state))
}

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: () => ipcRenderer.invoke("await-initialization"),
  wslServers: {
    getState: () => ipcRenderer.invoke("wsl-servers-get-state"),
    subscribe: (cb) => {
      const handler = (_: unknown, event: WslServersEvent) => cb(event)
      ipcRenderer.on("wsl-servers-event", handler)
      void ipcRenderer.invoke("wsl-servers-subscribe")
      return () => {
        ipcRenderer.removeListener("wsl-servers-event", handler)
        void ipcRenderer.invoke("wsl-servers-unsubscribe")
      }
    },
    probeRuntime: () => ipcRenderer.invoke("wsl-servers-probe-runtime"),
    refreshDistros: () => ipcRenderer.invoke("wsl-servers-refresh-distros"),
    installWsl: () => ipcRenderer.invoke("wsl-servers-install-wsl"),
    installDistro: (name) => ipcRenderer.invoke("wsl-servers-install-distro", name),
    probeAddable: (distros) => ipcRenderer.invoke("wsl-servers-probe-addable", distros),
    installOpencode: (name) => ipcRenderer.invoke("wsl-servers-install-opencode", name),
    openTerminal: (name) => ipcRenderer.invoke("wsl-servers-open-terminal", name),
    addServer: (distro) => ipcRenderer.invoke("wsl-servers-add", distro),
    removeServer: (id) => ipcRenderer.invoke("wsl-servers-remove", id),
    startServer: (id) => ipcRenderer.invoke("wsl-servers-start", id),
  },
  updater: {
    subscribe: async (cb) => {
      updaterCallbacks.add(cb)
      if (updaterState) cb(updaterState)
      if (!updaterSubscription) {
        ipcRenderer.on("updater-state", updaterHandler)
        updaterSubscription = ipcRenderer.invoke("updater-subscribe")
      }
      await updaterSubscription
      return () => {
        updaterCallbacks.delete(cb)
        if (updaterCallbacks.size > 0) return
        ipcRenderer.removeListener("updater-state", updaterHandler)
        updaterSubscription = undefined
        void ipcRenderer.invoke("updater-unsubscribe")
      }
    },
    check: () => ipcRenderer.invoke("updater-check"),
    install: () => ipcRenderer.invoke("updater-install"),
  },
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  isFirstLaunchOnboardingPending: () => ipcRenderer.invoke("is-first-launch-onboarding-pending"),
  finishFirstLaunchOnboarding: (createDefaultProject) =>
    ipcRenderer.invoke("finish-first-launch-onboarding", createDefaultProject),
  isOldLayoutEligible: () => ipcRenderer.invoke("is-old-layout-eligible"),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),
  draftGet: (key) => ipcRenderer.invoke("draft-get", key),
  draftSet: (key, value) => ipcRenderer.invoke("draft-set", key, value),
  draftDelete: (key) => ipcRenderer.invoke("draft-delete", key),
  draftBlobPut: (data) => ipcRenderer.invoke("draft-blob-put", data),
  draftBlobGet: (id) => ipcRenderer.invoke("draft-blob-get", id),
  omoConfigWrite: (name, model) => ipcRenderer.invoke("omo-config-write", name, model),
  openLauncher: () => ipcRenderer.invoke("launcher:open-window"),
  launcherMinimize: () => ipcRenderer.invoke("launcher:minimize"),
  launcherClose: () => ipcRenderer.invoke("launcher:close"),
  launcherStart: (opts) => ipcRenderer.invoke("launcher:start-opencode", opts),
  launcherStop: () => ipcRenderer.invoke("launcher:stop-opencode"),
  launcherGetStatus: () => ipcRenderer.invoke("launcher:get-status"),
  onLauncherStatusChange: (cb) => {
    const handler = (_: unknown, payload: { status: string; error?: string }) =>
      cb(payload.status as never, payload.error)
    ipcRenderer.on("launcher:status-changed", handler)
    return () => ipcRenderer.removeListener("launcher:status-changed", handler)
  },
  launcherManualSnapshot: () => ipcRenderer.invoke("launcher:manual-snapshot"),
  launcherListSnapshots: () => ipcRenderer.invoke("launcher:list-snapshots"),
  launcherTagSnapshot: (id, tag) => ipcRenderer.invoke("launcher:tag-snapshot", id, tag),
  launcherUntagSnapshot: (id) => ipcRenderer.invoke("launcher:untag-snapshot", id),
  launcherSetSnapshotNote: (id, note) => ipcRenderer.invoke("launcher:set-snapshot-note", id, note),
  launcherRollbackSnapshot: (id) => ipcRenderer.invoke("launcher:rollback-snapshot", id),
  onLauncherRollbackProgress: (cb) => {
    const handler = (_: unknown, payload: { phase: string; failedPlugins?: string[]; error?: string }) =>
      cb(payload as never)
    ipcRenderer.on("launcher:rollback-progress", handler)
    return () => ipcRenderer.removeListener("launcher:rollback-progress", handler)
  },
  launcherGetSettings: () => ipcRenderer.invoke("launcher:get-settings"),
  launcherSetSettings: (s) => ipcRenderer.invoke("launcher:set-settings", s),
  launcherListPlugins: () => ipcRenderer.invoke("launcher:list-plugins"),
  launcherGetPluginLogs: () => ipcRenderer.invoke("launcher:get-plugin-logs"),
  onLauncherPluginLogs: (cb) => {
    const handler = (_: unknown, payload: LauncherPluginLogEntry[]) => cb(payload)
    ipcRenderer.on("launcher:plugin-logs", handler)
    return () => ipcRenderer.removeListener("launcher:plugin-logs", handler)
  },
  launcherGetPluginLoads: () => ipcRenderer.invoke("launcher:get-plugin-loads"),
  onLauncherPluginLoads: (cb) => {
    const handler = (_: unknown, payload: LauncherPluginLoadEntry[]) => cb(payload)
    ipcRenderer.on("launcher:plugin-loads", handler)
    return () => ipcRenderer.removeListener("launcher:plugin-loads", handler)
  },
  launcherGetDiagnosticsMeta: () => ipcRenderer.invoke("launcher:get-diagnostics-meta"),
  launcherGetErrorSnippets: () => ipcRenderer.invoke("launcher:get-error-snippets"),
  launcherInstallUpdate: () => ipcRenderer.invoke("launcher:install-update"),
  launcherExportLogs: (path, content) => ipcRenderer.invoke("launcher:export-logs", path, content),
  launcherGetConfigPath: () => ipcRenderer.invoke("launcher:get-config-path"),
  launcherReadConfig: () => ipcRenderer.invoke("launcher:read-config"),
  launcherListConfigFiles: () => ipcRenderer.invoke("launcher:list-config-files"),
  launcherCreateConfigFile: (opts) => ipcRenderer.invoke("launcher:create-config-file", opts),
  launcherSaveConfig: (config) => ipcRenderer.invoke("launcher:save-config", config),
  launcherSaveAuthKey: (providerID, key) => ipcRenderer.invoke("launcher:save-auth-key", providerID, key),
  launcherReadConfigFile: (path) => ipcRenderer.invoke("launcher:read-config-file", path),
  launcherSaveConfigFile: (path, config) => ipcRenderer.invoke("launcher:save-config-file", path, config),
  launcherListOpencodeSubdirs: () => ipcRenderer.invoke("launcher:list-opencode-subdirs"),
  launcherListDirectoryEntries: (dirPath) => ipcRenderer.invoke("launcher:list-directory-entries", dirPath),
  launcherListExtensionResources: (kind) => ipcRenderer.invoke("launcher:list-extension-resources", kind),
  launcherReadExtensionResource: (path) => ipcRenderer.invoke("launcher:read-extension-resource", path),
  launcherCreateExtensionResource: (opts) => ipcRenderer.invoke("launcher:create-extension-resource", opts),
  launcherDeleteExtensionResource: (path) => ipcRenderer.invoke("launcher:delete-extension-resource", path),
  launcherImportSkillUrl: (url) => ipcRenderer.invoke("launcher:import-skill-url", url),
  launcherRemoveSkillUrl: (url) => ipcRenderer.invoke("launcher:remove-skill-url", url),
  launcherListSkillUrls: () => ipcRenderer.invoke("launcher:list-skill-urls"),
  launcherSwitchTheme: (themeName) => ipcRenderer.invoke("launcher:switch-theme", themeName),
  launcherReadCurrentTheme: () => ipcRenderer.invoke("launcher:read-current-theme"),
  launcherInstallPlugin: (spec) => ipcRenderer.invoke("launcher:install-plugin", spec),
  launcherUninstallPlugin: (spec) => ipcRenderer.invoke("launcher:uninstall-plugin", spec),
  launcherTogglePlugin: (spec, enabled) => ipcRenderer.invoke("launcher:toggle-plugin", spec, enabled),
  launcherExportBundle: (id) => ipcRenderer.invoke("launcher:export-bundle", id),
  launcherImportBundle: (content) => ipcRenderer.invoke("launcher:import-bundle", content),
  onLauncherImportProgress: (cb) => {
    const handler = (_: unknown, phase: string) => cb(phase)
    ipcRenderer.on("launcher:import-progress", handler)
    return () => ipcRenderer.removeListener("launcher:import-progress", handler)
  },

  getWindowID: () => ipcRenderer.invoke("get-window-id"),
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  readPickedFile: (token, path) => ipcRenderer.invoke("read-picked-file", token, path),
  releasePickedFiles: (token) => ipcRenderer.invoke("release-picked-files", token),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  openLocalFile: (url) => ipcRenderer.send("open-local-file", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  revealPath: (path) => ipcRenderer.invoke("reveal-path", path),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  getWindowFullscreen: () => ipcRenderer.invoke("get-window-fullscreen"),
  onWindowFullscreenChanged: (cb) => {
    const handler = (_: unknown, fullscreen: boolean) => cb(fullscreen)
    ipcRenderer.on("window-fullscreen-changed", handler)
    return () => ipcRenderer.removeListener("window-fullscreen-changed", handler)
  },
  getWindowMaximized: () => ipcRenderer.invoke("get-window-maximized"),
  onWindowMaximizedChanged: (cb) => {
    const handler = (_: unknown, maximized: boolean) => cb(maximized)
    ipcRenderer.on("window-maximized-changed", handler)
    return () => ipcRenderer.removeListener("window-maximized-changed", handler)
  },
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  getPinchZoomEnabled: () => ipcRenderer.invoke("get-pinch-zoom-enabled"),
  setPinchZoomEnabled: (enabled) => ipcRenderer.invoke("set-pinch-zoom-enabled", enabled),
  onPinchZoomEnabledChanged: (cb) => {
    const handler = (_: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on("pinch-zoom-enabled-changed", handler)
    return () => ipcRenderer.removeListener("pinch-zoom-enabled-changed", handler)
  },
  onZoomFactorChanged: (cb) => {
    const handler = (_: unknown, factor: number) => cb(factor)
    ipcRenderer.on("zoom-factor-changed", handler)
    return () => ipcRenderer.removeListener("zoom-factor-changed", handler)
  },
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  runDesktopMenuAction: (action) => ipcRenderer.invoke("run-desktop-menu-action", action),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  exportDebugLogs: () => ipcRenderer.invoke("export-debug-logs"),
  setForceFocus: (enabled) => ipcRenderer.invoke("set-force-focus", enabled),
  recordFatalRendererError: (error) => ipcRenderer.invoke("record-fatal-renderer-error", error),
  setNativeTranslations: (bundle) => ipcRenderer.invoke("set-native-translations", bundle),
}

contextBridge.exposeInMainWorld("api", api)
