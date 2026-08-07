#!/usr/bin/env bun
import { $ } from "bun"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`

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
