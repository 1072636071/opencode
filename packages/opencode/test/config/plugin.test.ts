import { test, expect, describe } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { ConfigPlugin } from "@/config/plugin"
import { loadPluginConfig } from "../../../../../oh-my-opencode-slim/src/config/loader"

// Locate the fork root (opencode/) and the monorepo plugin dir it must point to.
const forkRoot = path.resolve(__dirname, "../../../..") // test/config -> packages/opencode -> packages -> opencode/
const monorepoRoot = path.resolve(forkRoot, "..")
const pluginDir = path.join(monorepoRoot, "oh-my-opencode-slim")

describe("fork preset default plugin (dev scenario)", () => {
  test("opencode.json declares the omos-jx plugin via relative path", async () => {
    const configFile = path.join(forkRoot, "opencode.json")
    // The opencode project config at the fork root declares the plugin.
    const raw = await import("fs/promises").then((fs) => fs.readFile(configFile, "utf-8"))
    const parsed = JSON.parse(raw)
    expect(Array.isArray(parsed.plugin)).toBe(true)
    expect(parsed.plugin[0]).toBe("../oh-my-opencode-slim")
  })

  test("relative plugin path resolves to the monorepo plugin directory", async () => {
    const configFile = path.join(forkRoot, "opencode.json")
    const hit = await ConfigPlugin.resolvePluginSpec("../oh-my-opencode-slim", configFile)
    expect(ConfigPlugin.pluginSpecifier(hit)).toBe(pathToFileURL(pluginDir).href)
  })

  test("plugin directory is a loadable package (has dist entry)", async () => {
    const fs = await import("fs/promises")
    const pkg = JSON.parse(await fs.readFile(path.join(pluginDir, "package.json"), "utf-8"))
    expect(pkg.name).toBe("omos-jx")
    expect(pkg.main).toBe("dist/index.js")
    const entry = path.join(pluginDir, pkg.main)
    const stat = await fs.stat(entry).catch(() => null)
    expect(stat?.isFile()).toBe(true)
  })

  test("plugin project config enables the opencode-go preset by default", () => {
    // loadPluginConfig(directory) reads <directory>/.opencode/omos-jx.json and applies preset.
    const config = loadPluginConfig(forkRoot, { silent: true })
    expect(config.preset).toBe("opencode-go")
    expect(config.presets?.["opencode-go"]).toBeDefined()
    expect(config.presets?.["opencode-go"]?.orchestrator?.model).toBe("opencode-go/minimax-m3")
    expect(config.disabled_agents).toEqual([])
    // Preset must be merged into root agents so it actually takes effect.
    expect(config.agents?.orchestrator?.model).toBe("opencode-go/minimax-m3")
  })
})
