import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.OPENCODE_MODELS_URL || "https://models.dev"
const cache = path.resolve(dir, "..", "..", "models-dev-api.json")

async function download() {
  try {
    const text = await fetch(`${modelsUrl}/api.json`, { signal: AbortSignal.timeout(10_000) }).then((x) => {
      if (!x.ok) throw new Error(`Failed to fetch ${modelsUrl}/api.json: ${x.status} ${x.statusText}`)
      return x.text()
    })
    JSON.parse(text)
    await Bun.write(cache, text)
    return text
  } catch (error) {
    if (await Bun.file(cache).exists()) {
      console.warn(`[generate] Unable to reach ${modelsUrl}, using cached snapshot: ${cache}`)
      return await Bun.file(cache).text()
    }
    throw error
  }
}

export const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await download()
console.log("Loaded models.dev snapshot")
