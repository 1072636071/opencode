import { spawn } from "node:child_process"

const target = "D:\\app\\opemCodeMM"
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.ELECTRON_ENABLE_LOGGING = "1"

const ps = spawn(`${target}\\electron.exe`, [".", "--enable-logging", "--v=1"], {
  cwd: target,
  env,
  stdio: ["ignore", "pipe", "pipe"],
})

let stdout = ""
let stderr = ""

ps.stdout.on("data", (d) => { stdout += d.toString() })
ps.stderr.on("data", (d) => { stderr += d.toString() })

setTimeout(() => {
  if (!ps.killed) {
    ps.kill("SIGKILL")
    console.log("=== Process was still running, killed ===")
  }
  console.log("=== STDOUT ===")
  console.log(stdout.slice(-3000))
  console.log("=== STDERR ===")
  console.log(stderr.slice(-3000))
  process.exit(0)
}, 10000)