import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import * as http from "node:http"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, BrowserWindow, globalShortcut, ipcMain } from "electron"

// 必须在 app ready 之前（模块顶层同步执行）。
// 默认保留硬件加速；仅在已知崩溃环境（无 GPU / 虚拟化）按需降级：
//   1. 环境变量 OPENCODE_SOFTWARE_RENDER=1
//   2. 启动参数 --disable-gpu（Electron/Chromium 原生开关）
// 否则独立 GPU 进程反复初始化失败崩溃（GPU process isn't usable. Goodbye.），
// 降级为进程内软件渲染可保证稳定启动。
// 注意：不能加 disable-software-rasterizer / disable-gpu-compositing，
// 否则 renderer 无 GPU 且无法软件合成时会崩溃（ContextResult::kFatalFailure）。
if (process.env.OPENCODE_SOFTWARE_RENDER === "1" || app.commandLine.hasSwitch("disable-gpu")) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch("disable-gpu")
  app.commandLine.appendSwitch("in-process-gpu")
}

import { Deferred, Effect, Fiber } from "effect"
import contextMenu from "electron-context-menu"

import type { ServerReadyData } from "../preload/types"
import { checkAppExists, resolveAppPath } from "./apps"
import { CHANNEL } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { forwardInitializationFailure } from "./initialization"
import { exportDebugLogs, initCrashReporter, initLogging, startNetLog, write as writeLog } from "./logging"
import { createMenu } from "./menu"
import {
  finishFirstLaunchOnboarding,
  initializeOldLayoutEligibility,
  isFirstLaunchOnboardingPending,
  isOldLayoutEligible,
} from "./onboarding"
import {
  getDefaultServerUrl,
  preferAppEnv,
  setDefaultServerUrl,
  spawnLocalServer,
  type SidecarListener,
} from "./server"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
import { safeWebContentsURL } from "./window-state"
import {
  getLastFocusedWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  restoreMainWindows,
} from "./windows"
import { createLauncherWindow, getLauncherWindow } from "./launcher-window"
import {
  initLauncherController,
  startOpencode,
  stopOpencode,
  getOpencodeStatus,
  getLastError,
  onStatusChange as onOpencodeStatusChange,
  awaitServerData,
  rollbackToSnapshot,
  onRollbackProgress,
  getPluginLogs,
  onPluginLogs,
  getPluginLoads,
  onPluginLoads,
  getErrorSnippets,
  getDiagnosticsMeta,
} from "./launcher-controller"
import {
  createSnapshot,
  listSnapshots,
  tagSnapshot,
  untagSnapshot,
  readCurrentPlugins,
  getConfigFilePath,
  readConfigObject,
  saveConfigObject,
  installPlugin,
  uninstallPlugin,
  togglePlugin,
  exportBundle,
  importBundle,
} from "./launcher-snapshot"
import { createLauncherTray } from "./launcher-tray"
import { getLauncherSettings, setLauncherSettings } from "./launcher-settings"
import { createWslServersController } from "./wsl/servers"
import { registerWslIpcHandlers } from "./wsl/ipc"
import { spawnWslSidecar } from "./wsl/sidecar"
import { migrate } from "./migrate"
import { cleanupStoreFiles } from "./store-cleanup"
import { startBackgroundCli } from "./background-cli"
import { setNativeTranslations } from "./native-translations"

const APP_NAMES: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}
const TEST_ONBOARDING = process.env.OPENCODE_TEST_ONBOARDING === "1"
const SIDECAR_VERSION = process.env.OPENCODE_SIDECAR_V2 === "1" ? "v2" : "v1"
// launcher 模式：--launcher 参数或 OPENCODE_LAUNCHER=1 启动。只开 launcher 窗口，
// 不启动 sidecar、不开 renderer 主窗口。控制平面与数据平面分离（ADR-020）。
const isLauncherMode = app.commandLine.hasSwitch("launcher") || process.env.OPENCODE_LAUNCHER === "1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"

let logger: ReturnType<typeof initLogging>
let server: SidecarListener | null = null

const pendingDeepLinks: string[] = []

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  const win = getLastFocusedWindow()
  if (win) sendDeepLinks(win, urls)
}

async function killSidecar() {
  if (!server) return
  const current = server
  server = null
  await current.stop()
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENCODE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "OpenCode Dev")
  app.setAppUserModelId(appId)
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  initializeOldLayoutEligibility(app.getPath("userData"))
  logger = initLogging()
  initCrashReporter()

  const wslServers = createWslServersController(
    app.getVersion(),
    async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    {
      logger: {
        log: (message, meta) => logger.log(message, meta),
        error: (message, meta) => logger.error(message, meta),
      },
    },
  )
  const stopSidecars = async () => {
    await killSidecar()
    wslServers.stopAll()
  }
  const relaunch = () => {
    setAppQuitting()
    void stopSidecars().finally(() => {
      app.relaunch()
      app.quit()
    })
  }

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port", "9222")

  if (!app.requestSingleInstanceLock()) {
    // 旧实例残留（持有锁/9222/5173）时新实例会在这里秒退，之前无任何日志，极难排查。
    logger.warn("another instance holds the single-instance lock; exiting")
    app.quit()
    return
  }

  const shellEnv = preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    setAppQuitting()
    void stopSidecars()
  })

  app.on("will-quit", () => {
    setAppQuitting()
    void stopSidecars()
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: safeWebContentsURL(webContents), details }, "error")
  })

  setRelaunchHandler(() => {
    relaunch()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      setAppQuitting()
      void stopSidecars().finally(() => app.quit())
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  initLauncherController({ logger, shellEnv })

  yield* Effect.promise(() => app.whenReady())

  if (!TEST_ONBOARDING) migrate()
  yield* Effect.promise(() => cleanupStoreFiles(app.getPath("userData"))).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.deleted.length === 0) return
        logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to clean scoped store files", error)
      }),
    ),
  )
  app.setAsDefaultProtocolClient("opencode")
  registerRendererProtocol()
  setDockIcon()
  const updater = setupAutoUpdater(stopSidecars)
  const menuDeps = {
    trigger: (id: string) => {
      const win = getLastFocusedWindow()
      if (win) sendMenuCommand(win, id)
    },
    checkForUpdates: () => void showUpdaterDialog(updater, true),
    relaunch,
  }
  registerIpcHandlers({
    killSidecar: () => killSidecar(),
    relaunch,
    awaitInitialization: isLauncherMode
      ? () => awaitServerData()
      : Effect.fnUntraced(
          function* () {
            logger.log("awaiting server ready")
            const res = yield* Deferred.await(serverReady)
            logger.log("server ready", { url: res.url })
            return res
          },
          (e) => Effect.runPromise(e),
        ),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    isOldLayoutEligible,
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    checkAppExists: (appName) => checkAppExists(appName),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    updater,
    showUpdater: () => showUpdaterDialog(updater, true),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    setNativeTranslations: (bundle) => {
      if (setNativeTranslations(bundle)) createMenu(menuDeps)
    },
  })
  registerWslIpcHandlers(wslServers)
  ipcMain.handle("launcher:open-window", () => {
    createLauncherWindow()
    return true
  })
  ipcMain.handle("launcher:minimize", () => getLauncherWindow()?.minimize())
  ipcMain.handle("launcher:close", () => getLauncherWindow()?.close())
  ipcMain.handle("launcher:start-opencode", (_event, opts?: { safeMode?: boolean; disabledPlugins?: string[] }) =>
    startOpencode(opts),
  )
  ipcMain.handle("launcher:stop-opencode", () => stopOpencode())
  ipcMain.handle("launcher:get-status", () => ({ status: getOpencodeStatus(), error: getLastError() }))
  ipcMain.handle("launcher:manual-snapshot", async () => {
    const snap = await createSnapshot({ type: "manual" })
    return {
      id: snap.id,
      timestamp: snap.timestamp,
      type: snap.type,
      tag: snap.tag,
      pluginCount: snap.pluginCount,
      configFiles: snap.configFiles,
    }
  })
  ipcMain.handle("launcher:list-snapshots", () => listSnapshots())
  ipcMain.handle("launcher:tag-snapshot", (_event, id: string, tag: string) => tagSnapshot(id, tag))
  ipcMain.handle("launcher:untag-snapshot", (_event, id: string) => untagSnapshot(id))
  ipcMain.handle("launcher:rollback-snapshot", (_event, id: string) => rollbackToSnapshot(id))
  onRollbackProgress((p) => {
    getLauncherWindow()?.webContents.send("launcher:rollback-progress", p)
  })
  ipcMain.handle("launcher:get-settings", () => getLauncherSettings())
  ipcMain.handle("launcher:set-settings", (_event, s: { autoStart?: boolean }) => setLauncherSettings(s))
  ipcMain.handle("launcher:list-plugins", () => readCurrentPlugins())
  ipcMain.handle("launcher:get-plugin-logs", () => getPluginLogs())
  ipcMain.handle("launcher:export-logs", async (_event, path: string, content: string) => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, content, "utf8")
  })
  ipcMain.handle("launcher:get-config-path", () => getConfigFilePath())
  ipcMain.handle("launcher:read-config", () => readConfigObject())
  ipcMain.handle("launcher:save-config", async (_event, config: Record<string, unknown>) => {
    const path = await saveConfigObject(config)
    await createSnapshot({ type: "auto" }).catch((err) => console.warn("post-save snapshot failed", err))
    return path
  })
  ipcMain.handle("launcher:install-plugin", (_event, spec: string) => installPlugin(spec))
  ipcMain.handle("launcher:uninstall-plugin", (_event, spec: string) => uninstallPlugin(spec))
  ipcMain.handle("launcher:toggle-plugin", (_event, spec: string, enabled: boolean) => togglePlugin(spec, enabled))
  ipcMain.handle("launcher:export-bundle", (_event, id: string) => exportBundle(id))
  ipcMain.handle("launcher:import-bundle", async (_event, content: string) => {
    const launcher = getLauncherWindow()
    return importBundle(content, (phase) => {
      launcher?.webContents.send("launcher:import-progress", phase)
    })
  })
  onPluginLogs((logs) => {
    getLauncherWindow()?.webContents.send("launcher:plugin-logs", logs)
  })
  onPluginLoads((entries) => {
    getLauncherWindow()?.webContents.send("launcher:plugin-loads", entries)
  })
  ipcMain.handle("launcher:get-plugin-loads", () => getPluginLoads())
  ipcMain.handle("launcher:get-error-snippets", () => getErrorSnippets())
  ipcMain.handle("launcher:get-diagnostics-meta", () => getDiagnosticsMeta())
  // 更新前强制自动 snapshot（ADR-023 D13）：main 端保证，更新后起不来可一键回滚到更新前。
  ipcMain.handle("launcher:install-update", async () => {
    await createSnapshot({ type: "auto" }).catch((err) => {
      logger.warn("pre-update snapshot failed", { error: String(err) })
    })
    return updater.install()
  })
  onOpencodeStatusChange((s, error) => {
    getLauncherWindow()?.webContents.send("launcher:status-changed", { status: s, error })
  })
  void updater.start()
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))
  yield* Effect.promise(() => startNetLog()).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start net log", error)
      }),
    ),
  )

  // 全局快捷键 CommandOrControl+Shift+L 打开 launcher 窗口（正常模式下切到控制平面）。
  globalShortcut.register("CommandOrControl+Shift+L", () => createLauncherWindow())
  app.once("will-quit", () => globalShortcut.unregister("CommandOrControl+Shift+L"))

  // launcher 模式：只开 launcher 窗口，不启动 sidecar、不开 renderer。
  // main 进程不加载插件，sidecar 是 worker——launcher 在 OpenCode 起不来时仍存活（ADR-020）。
  if (isLauncherMode) {
    logger.log("launcher mode")
    createLauncherWindow()
    createMenu(menuDeps)
    createLauncherTray()
    const settings = yield* Effect.promise(() => getLauncherSettings())
    if (settings.autoStart) {
      void startOpencode().then(() => getLauncherWindow()?.hide())
    }
    return
  }

  const loadingTask = yield* Effect.gen(function* () {
    logger.log("sidecar connection started", { version: SIDECAR_VERSION })

    ensureLoopbackNoProxy()
    useEnvProxy()

    if (SIDECAR_VERSION === "v2") {
      logger.log("spawning v2 sidecar")
      const sidecar = yield* Effect.promise(() => startBackgroundCli(logger, shellEnv?.XDG_STATE_HOME))
      yield* Deferred.succeed(serverReady, {
        url: sidecar.url,
        username: sidecar.username,
        password: sidecar.password,
      })

      if (process.platform === "win32") {
        void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
      }

      logger.log("loading task finished")
      return
    }

    const port = yield* Effect.gen(function* () {
      const fromEnv = process.env.OPENCODE_PORT
      if (fromEnv) {
        const parsed = Number.parseInt(fromEnv, 10)
        if (!Number.isNaN(parsed)) return parsed
      }

      const res = yield* Deferred.make<number, unknown>()
      const socket = createServer()
      socket.on("error", (e) => Deferred.failSync(res, () => e))
      socket.listen(0, "127.0.0.1", () => {
        const address = socket.address()
        if (typeof address !== "object" || !address) {
          socket.close()
          Deferred.failSync(res, () => new Error("Failed to get port"))
          return
        }
        const port = address.port
        socket.close(() => Effect.runSync(Deferred.succeed(res, port)))
      })

      return yield* Deferred.await(res)
    })
    const hostname = "127.0.0.1"
    const url = `http://${hostname}:${port}`
    const password = randomUUID()

    logger.log("spawning sidecar", { url })
    const { listener, health } = yield* Effect.promise(() =>
      spawnLocalServer(hostname, port, password, {
        userDataPath: app.getPath("userData"),
        onStdout: (message) => writeLog("server", "stdout", { message }),
        onStderr: (message) => writeLog("server", "stderr", { message }, "warn"),
        onExit: (code) => writeLog("utility", "sidecar exited", { code }, "warn"),
      }),
    )
    server = listener

    if (process.platform === "win32") {
      void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
    }

    // 先等 health check 通过再向 renderer 暴露连接凭据，否则 renderer 会在插件
    // 加载完成前发起请求（启动竞态，表现为 ClientError: Transport）。
    yield* Effect.promise(() => health.wait).pipe(
      Effect.timeout("30 seconds"),
      Effect.tap(() =>
        Deferred.succeed(serverReady, {
          url,
          username: "opencode",
          password,
        }),
      ),
      Effect.catch((e) =>
        Effect.sync(() => {
          logger.error("sidecar health check failed", e.toString())
          Deferred.failSync(serverReady, () => e)
        }),
      ),
    )

    logger.log("loading task finished")
  }).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)

  yield* Fiber.await(loadingTask)

  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    restoreMainWindows()
  })

  const windows = restoreMainWindows()
  if (windows.length) createMenu(menuDeps)
})

Effect.runFork(main)
