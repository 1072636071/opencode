import { $ } from "bun"
import { downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`

// The v2 CLI binary is published to a private registry and is unavailable from
// the public npm registry in dev setups. It is only required for the v2
// sidecar (OPENCODE_SIDECAR_V2=1), so do not block `dev` when it is missing.
try {
  await downloadCliToResources()
} catch (error) {
  console.warn("[predev] Skipping bundled CLI download (only needed for OPENCODE_SIDECAR_V2=1):", error)
}
