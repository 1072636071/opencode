import windowState from "electron-window-state"
import { app, BrowserWindow } from "electron"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { write as writeLog } from "./logging"
import { safeWindowURL } from "./window-state"

const root = dirname(fileURLToPath(import.meta.url))
const rendererProtocol = "oc"
const rendererHost = "renderer"

// 对应 --jx-surface-0（姜晓深色主题最底层 #0b090d）。main 进程 BrowserWindow
// 只接受 hex 字符串，无法引用 CSS 变量；此处与 DESIGN.md §10 令牌保持同值。
const launcherBackground = "#0b090d"

let launcherWindow: BrowserWindow | null = null

function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function iconPath() {
  const ext = process.platform === "win32" ? "ico" : "png"
  return join(iconsDir(), `icon.${ext}`)
}

export function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.show()
    launcherWindow.focus()
    return launcherWindow
  }

  const state = windowState({
    file: "launcher-window-state.json",
    defaultWidth: 960,
    defaultHeight: 680,
  })

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: "OpenCode Launcher",
    icon: iconPath(),
    backgroundColor: launcherBackground,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    ...(process.platform === "win32" ? { frame: false, titleBarStyle: "hidden" as const } : {}),
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  state.manage(win)
  loadLauncher(win)

  win.once("ready-to-show", () => win.show())

  win.webContents.on("render-process-gone", (_event, details) => {
    writeLog("launcher", "render process gone", { url: safeWindowURL(win), details }, "error")
  })

  win.on("closed", () => {
    launcherWindow = null
  })

  launcherWindow = win
  return win
}

export function getLauncherWindow(): BrowserWindow | null {
  return launcherWindow && !launcherWindow.isDestroyed() ? launcherWindow : null
}

function loadLauncher(win: BrowserWindow) {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL("launcher.html", devUrl)
    void win.loadURL(url.toString())
    return
  }
  void win.loadURL(`${rendererProtocol}://${rendererHost}/launcher.html`)
}
