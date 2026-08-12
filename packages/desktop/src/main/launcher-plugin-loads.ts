// 插件加载状态机（ADR-020 D7，工单 07）。
// 纯逻辑模块，不依赖 electron，便于单元测试（Seam B）。
// 事件来源：server 端 plugin/index.ts 的 report 回调 → sidecar console hook → main。

export type PluginStageName = "install" | "entry" | "compatibility" | "load"

export type PluginStageState = {
  spec: string
  stage: PluginStageName
  startedAt: number
  durationMs?: number
  error?: string
}

export type PluginLoadEntry = {
  spec: string
  status: "pending" | "loading" | "loaded" | "failed"
  stages: PluginStageState[]
  order: number
  error?: string
}

export type PluginStageEvent = {
  event: "start" | "loaded" | "error" | "missing"
  spec: string
  stage?: string
  message?: string
  ts: number
}

export type PluginLoadListener = (entries: PluginLoadEntry[]) => void

export function createPluginLoadTracker() {
  const entries = new Map<string, PluginLoadEntry>()
  const listeners = new Set<PluginLoadListener>()
  let order = 0

  function snapshot(): PluginLoadEntry[] {
    return [...entries.values()].sort((a, b) => a.order - b.order)
  }

  function notify() {
    const copy = snapshot()
    for (const cb of listeners) cb(copy)
  }

  function apply(event: PluginStageEvent) {
    const { event: kind, spec, stage, message, ts } = event
    let entry = entries.get(spec)
    if (!entry) {
      entry = { spec, status: "pending", stages: [], order: order++ }
      entries.set(spec, entry)
    }
    if (kind === "start") {
      entry.status = "loading"
      // 记录整体开始时间（首个 stage 以 start 时间作为起点）
      if (entry.stages.length === 0) {
        entry.stages.push({ spec, stage: "install", startedAt: ts })
      }
    } else if (kind === "loaded") {
      entry.status = "loaded"
      entry.error = undefined
      closeLastStage(entry, ts)
    } else if (kind === "error") {
      entry.status = "failed"
      entry.error = message ?? "unknown error"
      const name = stage as PluginStageName
      if (isStageName(name)) {
        const last = entry.stages[entry.stages.length - 1]
        const startedAt = last?.startedAt ?? ts
        if (last && last.durationMs === undefined) last.durationMs = ts - last.startedAt
        entry.stages.push({ spec, stage: name, startedAt, durationMs: ts - startedAt, error: message })
      }
    } else if (kind === "missing") {
      entry.status = "failed"
      entry.error = message ?? "missing entrypoint"
      closeLastStage(entry, ts)
    }
    notify()
  }

  function closeLastStage(entry: PluginLoadEntry, ts: number) {
    const last = entry.stages[entry.stages.length - 1]
    if (last && last.durationMs === undefined) last.durationMs = ts - last.startedAt
  }

  function clear() {
    entries.clear()
    order = 0
    notify()
  }

  return {
    apply,
    clear,
    subscribe(listener: PluginLoadListener) {
      listeners.add(listener)
      listener(snapshot())
      return () => listeners.delete(listener)
    },
    get(): PluginLoadEntry[] {
      return snapshot()
    },
  }
}

export type PluginLoadTracker = ReturnType<typeof createPluginLoadTracker>

function isStageName(value: string | undefined): value is PluginStageName {
  return value === "install" || value === "entry" || value === "compatibility" || value === "load"
}

// 从错误文本中尽力提取 `路径:行号`（支持 win 与 posix 路径）。
export function parsePathAndLine(text: string): { path: string | null; line: number | null } {
  const match = text.match(/([A-Za-z]:[\\/][^\s:)]+|(?:\/[^\s:)]+){2,})(?::(\d+))?/)
  if (!match) return { path: null, line: null }
  const line = match[2] ? Number.parseInt(match[2], 10) : null
  return { path: match[1], line: Number.isFinite(line ?? NaN) ? line : null }
}
