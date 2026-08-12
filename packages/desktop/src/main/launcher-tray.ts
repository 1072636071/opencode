import { app, Menu, Tray, nativeImage } from "electron"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createLauncherWindow, getLauncherWindow } from "./launcher-window"

const root = dirname(fileURLToPath(import.meta.url))

let tray: Tray | null = null

function iconsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons")
}

function trayIconPath(): string {
  if (process.platform === "win32") return join(iconsDir(), "icon.ico")
  return join(iconsDir(), "icon.png")
}

export function createLauncherTray(): Tray {
  if (tray && !tray.isDestroyed()) return tray
  const image = nativeImage.createFromPath(trayIconPath())
  tray = new Tray(image)
  tray.setToolTip("OpenCode Launcher")
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示启动器",
        click: () => {
          const win = createLauncherWindow()
          win.show()
          win.focus()
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          setAppQuittingTray()
          app.quit()
        },
      },
    ]),
  )
  tray.on("click", () => {
    const win = getLauncherWindow() ?? createLauncherWindow()
    win.show()
    win.focus()
  })
  return tray
}

function setAppQuittingTray() {
  // 托盘退出时标记 quitting，避免窗口关闭触发 relaunch
  app.exit(0)
}
