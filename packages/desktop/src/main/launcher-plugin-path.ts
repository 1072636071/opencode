// 工单 09：omos-jx 打包分发 — 启动时探测 dev 相对路径 vs 打包 resources 路径（ADR-032）。
// 纯逻辑模块，不依赖 electron，便于单元测试（对齐 launcher-plugin-loads / launcher-tools 的 seam）。
//
// 双场景：
//   - dev：沿用 fork 内预置配置 + monorepo 相对路径 `../oh-my-opencode-slim`（工单 08）。
//   - 打包：electron-builder extraResources 把 omos-jx dist 打进安装包 `resources/omos-jx`，
//     打包后从应用内 resources 路径加载。
// 两套路径由启动时探测（是否存在 resources 内插件 / 是否存在 dev 相对路径）区分。

import { existsSync } from "node:fs"
import { join } from "node:path"

/** extraResources 中 omos-jx dist 的 `to` 目标目录名（安装包 `resources/omos-jx`）。 */
export const OMOS_JX_RESOURCES_DIR = "omos-jx"

/** dev 场景 fork 预置配置（工单 08）里相对配置文件目录的插件相对路径。 */
export const OMOS_JX_DEV_RELATIVE_PATH = "../oh-my-opencode-slim"

export type OmosJxPluginResolution = {
  /** 解析出的插件路径。任何场景都找不到时返回 null。 */
  pluginPath: string | null
  /** 命中打包 resources 场景（`resources/omos-jx` 存在）。 */
  viaResources: boolean
  /** 命中 dev 相对路径场景。 */
  viaDev: boolean
}

/**
 * 解析 omos-jx 插件应加载的路径。
 *
 * 优先级：
 *   1. 打包场景（isPackaged 且 `resourcesPath/omos-jx` 存在）→ 返回该绝对路径（viaResources）。
 *   2. dev 场景（非打包 且 devPluginPath 存在）→ 返回该路径（viaDev）。
 *   3. 均不满足 → null。
 */
export function resolveOmosJxPluginPath(opts: {
  isPackaged: boolean
  resourcesPath: string
  devPluginPath: string
  existsSyncFn?: (p: string) => boolean
}): OmosJxPluginResolution {
  const exists = opts.existsSyncFn ?? existsSync

  if (opts.isPackaged) {
    const resources = join(opts.resourcesPath, OMOS_JX_RESOURCES_DIR)
    if (exists(resources)) return { pluginPath: resources, viaResources: true, viaDev: false }
    // 打包场景下 monorepo 相对路径不存在，不回落 dev 路径。
    return { pluginPath: null, viaResources: false, viaDev: false }
  }

  if (exists(opts.devPluginPath)) return { pluginPath: opts.devPluginPath, viaResources: false, viaDev: true }
  return { pluginPath: null, viaResources: false, viaDev: false }
}
