import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { OMOS_JX_RESOURCES_DIR, resolveOmosJxPluginPath } from "./launcher-plugin-path"

describe("resolveOmosJxPluginPath（工单 09 dev/打包双路径探测）", () => {
  const resourcesPath = "C:\\app\\resources"
  const devPluginPath = join("D:\\repo\\opencode", "..", "oh-my-opencode-slim")

  test("打包场景：resources/omos-jx 存在 → 返回该绝对路径（viaResources）", () => {
    const exists = (p: string) => p === join(resourcesPath, OMOS_JX_RESOURCES_DIR)
    const res = resolveOmosJxPluginPath({
      isPackaged: true,
      resourcesPath,
      devPluginPath,
      existsSyncFn: exists,
    })
    expect(res).toEqual({
      pluginPath: join(resourcesPath, OMOS_JX_RESOURCES_DIR),
      viaResources: true,
      viaDev: false,
    })
  })

  test("打包场景：resources/omos-jx 不存在 → 返回 null，不回落 dev 路径", () => {
    const res = resolveOmosJxPluginPath({
      isPackaged: true,
      resourcesPath,
      devPluginPath,
      // 即使 dev 相对路径存在，打包场景也只认 resources/omos-jx。
      existsSyncFn: () => false,
    })
    expect(res).toEqual({ pluginPath: null, viaResources: false, viaDev: false })
  })

  test("dev 场景：dev 相对路径存在 → 返回该路径（viaDev），不查 resources", () => {
    const res = resolveOmosJxPluginPath({
      isPackaged: false,
      resourcesPath,
      devPluginPath,
      existsSyncFn: (p) => p === devPluginPath,
    })
    expect(res).toEqual({ pluginPath: devPluginPath, viaResources: false, viaDev: true })
  })

  test("dev 场景：dev 相对路径缺失 → 返回 null", () => {
    const res = resolveOmosJxPluginPath({
      isPackaged: false,
      resourcesPath,
      devPluginPath,
      existsSyncFn: () => false,
    })
    expect(res).toEqual({ pluginPath: null, viaResources: false, viaDev: false })
  })
})
