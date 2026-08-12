/**
 * 启动器 renderer 运行时验收基座（PRD Seam A）。
 *
 * 形态：dev server 单独 serve launcher.html；无头 Edge (CDP) 加载 + 注入 window.api stub +
 *      DOM 断言 + 三视口截图（960×680 / 720×480 / 1920×1080）。
 *
 * 用法：
 *   1. 启动 dev server：`bun run dev`（在 packages/desktop 下），记下 ELECTRON_RENDERER_URL
 *      或直接用 `electron-vite dev` 起的 renderer 地址（通常 http://localhost:5173/launcher.html）
 *   2. 启动无头 Edge 带 --remote-debugging-port=9222：
 *      `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --remote-debugging-port=9222 --disable-gpu`
 *   3. 运行：`node scripts/launcher-acceptance.mjs <launcher-url> <output-dir>`
 *      例：`node scripts/launcher-acceptance.mjs http://localhost:5173/launcher.html ./out/launcher-acceptance`
 *
 * 产物：
 *   - screenshot-{viewport}.png 三视口截图
 *   - assertions.json DOM 断言结果
 *   - api-calls.json window.api stub 调用记录
 *
 * 不依赖任何 npm 包——只用 Node 内置 fetch + WebSocket（Node 22+ 内置）。
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

const launcherUrl = process.argv[2] ?? "http://localhost:5173/launcher.html"
const outDir = resolve(process.argv[3] ?? join(__dirname, "../out/launcher-acceptance"))
const cdpPort = parseInt(process.env.CDP_PORT ?? "9222", 10)

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

const VIEWPORTS = [
  { name: "default-960x680", width: 960, height: 680 },
  { name: "min-720x480", width: 720, height: 480 },
  { name: "large-1920x1080", width: 1920, height: 1080 },
]

// window.api stub：记录每次调用的 name + args，供断言读取。
// 覆盖 PRD「实现决策」列出的全部 IPC 名，零改动契约。
const STUB_SOURCE = `
  const __apiCalls = [];
  function __record(name, args) { __apiCalls.push({ name, args: JSON.parse(JSON.stringify(args ?? [])), ts: Date.now() }); }
  window.__apiCalls = __apiCalls;
  function __asyncNoop(name) { return (...args) => { __record(name, args); return Promise.resolve(); }; }
  function __syncNoop(name) { return (...args) => { __record(name, args); }; }
  window.api = {
    launcherMinimize: __syncNoop("launcherMinimize"),
    launcherClose: __syncNoop("launcherClose"),
    launcherStart: __asyncNoop("launcherStart"),
    launcherStop: __asyncNoop("launcherStop"),
    launcherGetStatus: () => { __record("launcherGetStatus", []); return Promise.resolve({ status: "idle" }); },
    onLauncherStatusChange: () => () => {},
    launcherManualSnapshot: () => { __record("launcherManualSnapshot", []); return Promise.resolve({ id: "stub", timestamp: Date.now(), type: "manual", tag: null, pluginCount: 0 }); },
    launcherListSnapshots: () => { __record("launcherListSnapshots", []); return Promise.resolve([]); },
    launcherTagSnapshot: __asyncNoop("launcherTagSnapshot"),
    launcherUntagSnapshot: __asyncNoop("launcherUntagSnapshot"),
    launcherRollbackSnapshot: __asyncNoop("launcherRollbackSnapshot"),
    onLauncherRollbackProgress: () => () => {},
    launcherGetSettings: () => { __record("launcherGetSettings", []); return Promise.resolve({ autoStart: true }); },
    launcherSetSettings: (s) => { __record("launcherSetSettings", [s]); return Promise.resolve(s); },
    launcherListPlugins: () => { __record("launcherListPlugins", []); return Promise.resolve([]); },
    launcherGetPluginLogs: () => { __record("launcherGetPluginLogs", []); return Promise.resolve([]); },
    onLauncherPluginLogs: () => () => {},
    launcherGetPluginLoads: () => { __record("launcherGetPluginLoads", []); return Promise.resolve([]); },
    onLauncherPluginLoads: () => () => {},
    launcherGetDiagnosticsMeta: () => { __record("launcherGetDiagnosticsMeta", []); return Promise.resolve({ generatedAt: new Date().toISOString(), launcherVersion: "v0.1.0", opencodeVersion: "unknown" }); },
    launcherGetErrorSnippets: () => { __record("launcherGetErrorSnippets", []); return Promise.resolve([]); },
    launcherInstallUpdate: __asyncNoop("launcherInstallUpdate"),
    launcherExportLogs: __asyncNoop("launcherExportLogs"),
    launcherGetConfigPath: () => { __record("launcherGetConfigPath", []); return Promise.resolve(null); },
    launcherReadConfig: () => { __record("launcherReadConfig", []); return Promise.resolve(null); },
    launcherSaveConfig: __asyncNoop("launcherSaveConfig"),
    launcherSaveAuthKey: __asyncNoop("launcherSaveAuthKey"),
    launcherInstallPlugin: __asyncNoop("launcherInstallPlugin"),
    launcherUninstallPlugin: __asyncNoop("launcherUninstallPlugin"),
    launcherTogglePlugin: __asyncNoop("launcherTogglePlugin"),
    launcherExportBundle: __asyncNoop("launcherExportBundle"),
    launcherImportBundle: __asyncNoop("launcherImportBundle"),
    onLauncherImportProgress: () => () => {},
    openLauncher: __asyncNoop("openLauncher"),
    runDesktopMenuAction: __asyncNoop("runDesktopMenuAction"),
    openExternal: __syncNoop("openExternal"),
    openLocalFile: __syncNoop("openLocalFile"),
    openFilePicker: () => { __record("openFilePicker", []); return Promise.resolve(null); },
    saveFilePicker: () => { __record("saveFilePicker", []); return Promise.resolve(null); },
    readPickedFile: __asyncNoop("readPickedFile"),
    releasePickedFiles: __asyncNoop("releasePickedFiles"),
    updater: { check: () => { __record("updater.check", []); return Promise.resolve({ status: "up-to-date" }); } },
  };
  console.log("[stub] window.api installed");
`

// DOM 断言：在页面内执行，返回 { name, pass, detail }[]。
const ASSERTIONS_SOURCE = `
  const A = [];
  function assert(name, cond, detail) { A.push({ name, pass: !!cond, detail: detail ?? "" }); }

  // 令牌定义
  const root = getComputedStyle(document.documentElement);
  assert("--jx-surface-0 defined", root.getPropertyValue("--jx-surface-0").trim() !== "");
  assert("--jx-gold-bright defined", root.getPropertyValue("--jx-gold-bright").trim() !== "");
  assert("--jx-gold-foil defined", root.getPropertyValue("--jx-gold-foil").trim() !== "");
  assert("--jx-mist defined", root.getPropertyValue("--jx-mist").trim() !== "");
  assert("--jx-moon-glow defined", root.getPropertyValue("--jx-moon-glow").trim() !== "");
  assert("--jx-radius-seal defined", root.getPropertyValue("--jx-radius-seal").trim() !== "");
  assert("--jx-breathe defined", root.getPropertyValue("--jx-breathe").trim() !== "");
  assert("--jx-z-fx defined", root.getPropertyValue("--jx-z-fx").trim() !== "");

  // 氛围层
  const atm = document.querySelector(".launcher-atmosphere");
  assert("atmosphere layer exists", !!atm);
  if (atm) {
    assert("atmosphere pointer-events none", getComputedStyle(atm).pointerEvents === "none");
    assert("mountains layer exists", !!atm.querySelector(".launcher-atmosphere__mountains"));
    assert("moon layer exists", !!atm.querySelector(".launcher-atmosphere__moon"));
    assert("particles layer exists", !!atm.querySelector(".launcher-atmosphere__particles"));
    const particles = atm.querySelectorAll(".launcher-atmosphere__particle");
    assert("particles count == 12", particles.length === 12, "got " + particles.length);
  }

  // 侧边导航 6 入口
  const navItems = document.querySelectorAll(".launcher-nav__item");
  assert("nav items count == 6", navItems.length === 6, "got " + navItems.length);
  const navLabels = Array.from(navItems).map((b) => b.querySelector(".launcher-nav__label")?.textContent ?? "");
  assert("nav has 启动控制", navLabels.includes("启动控制"));
  assert("nav has 偏好设置", navLabels.includes("偏好设置"));
  assert("nav has 安全模式", navLabels.includes("安全模式"));
  assert("nav has 配置", navLabels.includes("配置"));
  assert("nav has 快照", navLabels.includes("快照"));
  assert("nav has 插件", navLabels.includes("插件"));

  // 导航图标按钮均有 aria-label
  const navNoLabel = Array.from(navItems).filter((b) => !b.getAttribute("aria-label"));
  assert("nav items all have aria-label", navNoLabel.length === 0);

  // 当前页 aria-current
  const current = document.querySelector('.launcher-nav__item[aria-current="page"]');
  assert("current nav item has aria-current=page", !!current);

  // 主舞台圆环
  const ring = document.querySelector(".launcher-stage__ring");
  assert("stage ring exists", !!ring);
  if (ring) {
    const cls = ring.className;
    assert("ring has state class", /launcher-stage__ring--(idle|starting|running|failed)/.test(cls), cls);
  }

  // 按钮无单字中文：所有 button 文本内容 trim 后长度不为 1 的中文字符
  const cjkRe = /^[\\u4e00-\\u9fff]$/;
  const singleCharBtns = Array.from(document.querySelectorAll("button"))
    .map((b) => (b.textContent ?? "").trim())
    .filter((t) => cjkRe.test(t));
  assert("no single-char CJK button", singleCharBtns.length === 0, JSON.stringify(singleCharBtns));

  // 图标按钮（无文本）有 aria-label
  const iconBtns = Array.from(document.querySelectorAll("button"))
    .filter((b) => (b.textContent ?? "").trim() === "")
    .filter((b) => !b.getAttribute("aria-label"));
  assert("icon buttons all have aria-label", iconBtns.length === 0);

  // hash 路由初始页
  assert("initial hash is #control", location.hash === "#control" || location.hash === "", "got " + location.hash);

  JSON.stringify(A);
`

async function main() {
  console.log(`[acceptance] launcher url: ${launcherUrl}`)
  console.log(`[acceptance] output dir: ${outDir}`)
  console.log(`[acceptance] cdp port: ${cdpPort}`)

  const res = await fetch(`http://127.0.0.1:${cdpPort}/json`)
  const tabs = await res.json()
  const target = tabs.find((t) => t.type === "page")
  if (!target) {
    console.error("[acceptance] no page target; is headless Edge running with --remote-debugging-port?")
    process.exit(1)
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  function send(method, params = {}) {
    return new Promise((resolve) => {
      const myId = ++id
      pending.set(myId, resolve)
      ws.send(JSON.stringify({ id: myId, method, params }))
    })
  }
  await new Promise((r) => ws.addEventListener("open", r, { once: true }))

  await send("Page.enable")
  await send("Runtime.enable")

  // 注入 stub 后导航
  await send("Page.addScriptToEvaluateOnNewDocument", { source: STUB_SOURCE })
  await send("Page.navigate", { url: launcherUrl })
  await new Promise((r) => setTimeout(r, 1500)) // 等 SolidJS mount

  const assertionsResult = await send("Runtime.evaluate", {
    expression: ASSERTIONS_SOURCE,
    returnByValue: true,
  })
  const assertions = JSON.parse(assertionsResult.result?.result?.value ?? assertionsResult.result?.value ?? "[]")
  writeFileSync(join(outDir, "assertions.json"), JSON.stringify(assertions, null, 2))

  const apiCallsResult = await send("Runtime.evaluate", {
    expression: "JSON.stringify(window.__apiCalls ?? [])",
    returnByValue: true,
  })
  const apiCalls = JSON.parse(apiCallsResult.result?.result?.value ?? apiCallsResult.result?.value ?? "[]")
  writeFileSync(join(outDir, "api-calls.json"), JSON.stringify(apiCalls, null, 2))

  // 三视口截图
  for (const vp of VIEWPORTS) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await new Promise((r) => setTimeout(r, 600))
    const shot = await send("Page.captureScreenshot", { format: "png" })
    const data = shot.result?.result?.data ?? shot.result?.data
    const buffer = Buffer.from(data, "base64")
    const outPath = join(outDir, `screenshot-${vp.name}.png`)
    writeFileSync(outPath, buffer)
    console.log(`[acceptance] screenshot saved: ${outPath}`)
  }

  // 汇总
  const passed = assertions.filter((a) => a.pass).length
  const failed = assertions.filter((a) => !a.pass).length
  console.log(`[acceptance] assertions: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.log("[acceptance] FAILED assertions:")
    for (const a of assertions.filter((a) => !a.pass)) console.log(`  - ${a.name}: ${a.detail}`)
  }
  console.log(`[acceptance] api calls recorded: ${apiCalls.length}`)

  ws.close()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})