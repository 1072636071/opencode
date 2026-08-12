import { describe, expect, test } from "bun:test"
import { createPluginLoadTracker, parsePathAndLine } from "./launcher-plugin-loads"

describe("plugin load tracker（工单 07 加载阶段状态机）", () => {
  test("start → loaded 记录四阶段起始 + 总耗时", () => {
    const tracker = createPluginLoadTracker()
    tracker.apply({ event: "start", spec: "@x/plugin", ts: 1000 })
    tracker.apply({ event: "loaded", spec: "@x/plugin", ts: 2500 })

    const [entry] = tracker.get()
    expect(entry.spec).toBe("@x/plugin")
    expect(entry.status).toBe("loaded")
    expect(entry.stages).toHaveLength(1)
    expect(entry.stages[0].stage).toBe("install")
    expect(entry.stages[0].durationMs).toBe(1500)
    expect(entry.error).toBeUndefined()
  })

  test("start → error(entry) 标记失败插件 + 失败阶段 + 错误消息", () => {
    const tracker = createPluginLoadTracker()
    tracker.apply({ event: "start", spec: "@x/broken", ts: 1000 })
    tracker.apply({ event: "error", spec: "@x/broken", stage: "entry", message: "Cannot find module", ts: 1800 })

    const [entry] = tracker.get()
    expect(entry.status).toBe("failed")
    expect(entry.error).toBe("Cannot find module")
    expect(entry.stages[1]).toMatchObject({
      stage: "entry",
      durationMs: 800,
      error: "Cannot find module",
    })
  })

  test("start → error(compatibility) 标注兼容性失败", () => {
    const tracker = createPluginLoadTracker()
    tracker.apply({ event: "start", spec: "@x/old", ts: 0 })
    tracker.apply({ event: "error", spec: "@x/old", stage: "compatibility", message: "requires opencode >= 2", ts: 50 })

    const [entry] = tracker.get()
    expect(entry.status).toBe("failed")
    expect(entry.stages[entry.stages.length - 1].stage).toBe("compatibility")
  })

  test("start → missing 标记无入口插件", () => {
    const tracker = createPluginLoadTracker()
    tracker.apply({ event: "start", spec: "@x/none", ts: 0 })
    tracker.apply({ event: "missing", spec: "@x/none", message: "does not expose server entrypoint", ts: 100 })

    const [entry] = tracker.get()
    expect(entry.status).toBe("failed")
    expect(entry.error).toBe("does not expose server entrypoint")
  })

  test("加载顺序按事件到达排序（order）", () => {
    const tracker = createPluginLoadTracker()
    tracker.apply({ event: "start", spec: "b", ts: 0 })
    tracker.apply({ event: "start", spec: "a", ts: 10 })
    tracker.apply({ event: "loaded", spec: "a", ts: 20 })
    tracker.apply({ event: "loaded", spec: "b", ts: 30 })

    const entries = tracker.get()
    expect(entries.map((e) => e.spec)).toEqual(["b", "a"])
    expect(entries[0].order).toBeLessThan(entries[1].order)
  })

  test("clear 重置状态", () => {
    const tracker = createPluginLoadTracker()
    tracker.apply({ event: "start", spec: "x", ts: 0 })
    tracker.clear()
    expect(tracker.get()).toHaveLength(0)
  })

  test("subscribe 收到更新快照", () => {
    const tracker = createPluginLoadTracker()
    const seen: number[] = []
    tracker.subscribe((entries) => seen.push(entries.length))
    tracker.apply({ event: "start", spec: "x", ts: 0 })
    tracker.apply({ event: "loaded", spec: "x", ts: 10 })
    expect(seen).toContain(1)
    expect(seen[seen.length - 1]).toBe(1)
  })
})

describe("parsePathAndLine（工单 08 错误片段提取辅助）", () => {
  test("解析 posix 路径:行号", () => {
    expect(parsePathAndLine("Error at /home/u/opencode/packages/plugin/loader.ts:94 foo")).toMatchObject({
      path: "/home/u/opencode/packages/plugin/loader.ts",
      line: 94,
    })
  })

  test("解析 windows 路径:行号", () => {
    expect(parsePathAndLine("at C:\\dev\\opencode\\packages\\plugin\\loader.ts:42 bar")).toMatchObject({
      path: "C:\\dev\\opencode\\packages\\plugin\\loader.ts",
      line: 42,
    })
  })

  test("无路径时返回 null", () => {
    expect(parsePathAndLine("just an error message")).toEqual({ path: null, line: null })
  })
})
