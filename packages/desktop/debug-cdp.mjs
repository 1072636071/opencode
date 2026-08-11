import { spawn } from "node:child_process"

const target = "D:\\app\\opemCodeMM"
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const ps = spawn(`${target}\\electron.exe`, [".", "--remote-debugging-port=9224"], {
  cwd: target,
  env,
  stdio: ["ignore", "pipe", "pipe"],
})

let stderr = ""
ps.stderr.on("data", (d) => { stderr += d.toString() })

setTimeout(async () => {
  try {
    const resp = await fetch("http://localhost:9224/json")
    const targets = await resp.json()
    console.log("=== CDP targets ===")
    for (const t of targets) {
      console.log(`  ${t.type} | ${t.title} | ${t.url}`)
    }
    
    const page = targets.find(t => t.type === "page")
    if (page) {
      const wsResp = await fetch(`http://localhost:9224/json/protocol/${page.id}`)
      console.log("=== Page target found, fetching content via CDP ===")
      
      const cdp = await new Promise((resolve, reject) => {
        const WebSocket = require("node:ws") ?? globalThis.WebSocket
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        ws.on("open", () => resolve(ws))
        ws.on("error", reject)
      })
      
      let msgId = 1
      const send = (method, params) => new Promise((resolve) => {
        const id = msgId++
        cdp.on("message", function handler(data) {
          const msg = JSON.parse(data)
          if (msg.id === id) { cdp.off("message", handler); resolve(msg.result) }
        })
        cdp.send(JSON.stringify({ id, method, params }))
      })
      
      await send("Runtime.enable")
      const result = await send("Runtime.evaluate", {
        expression: "document.body.innerText.substring(0, 2000)",
        returnByValue: true
      })
      console.log("=== Page text content ===")
      console.log(result?.result?.value ?? "empty")
      
      const urlResult = await send("Runtime.evaluate", {
        expression: "location.href",
        returnByValue: true
      })
      console.log("=== Page URL ===")
      console.log(urlResult?.result?.value)
      
      cdp.close()
    } else {
      console.log("No page target found!")
    }
  } catch (e) {
    console.log("CDP error:", e.message)
  }
  
  if (!ps.killed) ps.kill("SIGKILL")
  if (stderr) { console.log("=== STDERR ==="); console.log(stderr.slice(-2000)) }
  process.exit(0)
}, 8000)