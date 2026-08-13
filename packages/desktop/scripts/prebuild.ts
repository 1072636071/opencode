#!/usr/bin/env bun
import { $ } from "bun"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`

// 工单 09：构建 omos-jx 插件 dist，供 extraResources 打进安装包（resources/omos-jx，ADR-032）。
// dist 已在 oh-my-opencode-slim submodule 内提交；构建失败不阻断（降级用已提交 dist，
// 与下方 CLI 下载的守卫一致）。
try {
  await $`cd ../../oh-my-opencode-slim && bun run build`
} catch (error) {
  console.warn("[prebuild] omos-jx plugin build skipped (using committed dist):", error)
}

// The v2 CLI binary is published to a private registry and is unavailable from
// the public npm registry in dev setups. It is only required for the v2
// sidecar (OPENCODE_SIDECAR_V2=1), so do not block `build` when it is missing.
if (channel === "dev") {
  try {
    await downloadCliToResources()
  } catch (error) {
    console.warn("[prebuild] Skipping bundled CLI download (only needed for OPENCODE_SIDECAR_V2=1):", error)
  }
}
