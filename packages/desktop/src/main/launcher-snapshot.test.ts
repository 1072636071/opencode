import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"
import { Global } from "@opencode-ai/core/global"
import {
  findConfigFilesGrouped,
  createConfigFile,
  readConfigFileAtPath,
  saveConfigFileAtPath,
  listDirectoryEntries,
  findOpencodeSubdirs,
  isConfigPathAllowed,
  isDirectoryPathAllowed,
  createSnapshot,
  exportBundle,
  restoreSnapshotConfig,
  importBundle,
  migrateRedactOldSnapshots,
  setSnapshotNote,
  listSnapshots,
  tagSnapshot,
  getSnapshot,
  REDACTED_PLACEHOLDER,
} from "./launcher-snapshot"

// 工单 01 主 seam 单测：配置发现对齐本体 Global.Path.config（ADR-028）。
// 验证 findConfigFilesGrouped 覆盖 xdg 全局目录（= Global.Path.config）/ findUp `.opencode` / `~/.opencode` / OPENCODE_CONFIG_DIR，
// 候选名含 tui.json / auth.json。
// 工单 03 主 seam 单测：readConfigFileAtPath / saveConfigFileAtPath 按文件分别读写。
// 工单 04 主 seam 单测：findOpencodeSubdirs / listDirectoryEntries 目录节点展开。
// 工单 05 主 seam 单测：createConfigFile 在指定位置创建文件，不覆盖已存在文件。

const roots: string[] = []
const envBackup: Record<string, string | undefined> = {}

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "opencode-launcher-snapshot-"))
  roots.push(root)
  return root
}

function setEnv(key: string, value: string | undefined) {
  if (!(key in envBackup)) envBackup[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const key of Object.keys(envBackup)) delete envBackup[key]
})

async function touch(path: string) {
  await mkdir(path, { recursive: true })
}

describe("findConfigFilesGrouped（工单 01 配置发现对齐本体）", () => {
  test("发现 projectPath 下 `.opencode` 目录的 opencode.jsonc（group=opencode）", async () => {
    const projectPath = await tempRoot()
    await touch(join(projectPath, ".opencode"))
    await writeFile(join(projectPath, ".opencode", "opencode.jsonc"), "{}")

    // 将全局配置/数据目录指向空目录，避免干扰
    const emptyConfig = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const files = findConfigFilesGrouped(projectPath)
    const opencodeFile = files.find((f) => f.group === "opencode")
    expect(opencodeFile).toBeDefined()
    expect(opencodeFile?.name).toBe("opencode.jsonc")
    expect(opencodeFile?.path).toBe(join(projectPath, ".opencode", "opencode.jsonc"))
  })

  test("findUp：从子目录向上查找祖先 `.opencode` 目录", async () => {
    const projectRoot = await tempRoot()
    const deepDir = join(projectRoot, "packages", "desktop")
    await touch(deepDir)
    await touch(join(projectRoot, ".opencode"))
    await writeFile(join(projectRoot, ".opencode", "opencode.json"), "{}")

    const emptyConfig = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const files = findConfigFilesGrouped(deepDir)
    const opencodeFile = files.find((f) => f.group === "opencode")
    expect(opencodeFile).toBeDefined()
    expect(opencodeFile?.path).toBe(join(projectRoot, ".opencode", "opencode.json"))
  })

  test("发现 OPENCODE_CONFIG_DIR 下的配置文件（group=global）", async () => {
    const configDir = await tempRoot()
    await writeFile(join(configDir, "opencode.jsonc"), "{}")
    await writeFile(join(configDir, "tui.json"), "{}")

    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const files = findConfigFilesGrouped(undefined)
    const paths = files.map((f) => f.path)
    expect(paths).toContain(join(configDir, "opencode.jsonc"))
    expect(paths).toContain(join(configDir, "tui.json"))
    const globalFiles = files.filter((f) => f.group === "global")
    expect(globalFiles.some((f) => f.name === "opencode.jsonc")).toBe(true)
    expect(globalFiles.some((f) => f.name === "tui.json")).toBe(true)
  })

  test("发现 auth.json 在数据目录（group=global）", async () => {
    const dataDir = await tempRoot()
    await writeFile(join(dataDir, "auth.json"), "{}")

    const emptyConfig = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const files = findConfigFilesGrouped(undefined)
    const authFile = files.find((f) => f.name === "auth.json")
    expect(authFile).toBeDefined()
    expect(authFile?.path).toBe(join(dataDir, "auth.json"))
    expect(authFile?.group).toBe("global")
  })

  test("候选名含 tui.json，不只 opencode.jsonc/opencode.json/config.json", async () => {
    const configDir = await tempRoot()
    await writeFile(join(configDir, "tui.json"), "{}")

    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const files = findConfigFilesGrouped(undefined)
    expect(files.some((f) => f.name === "tui.json")).toBe(true)
  })

  test("不设 OPENCODE_CONFIG_DIR 时 global 分组路径对齐本体 Global.Path.config（ADR-028）", async () => {
    // ADR-028：Launcher 配置发现复用本体 Global.Path.config（xdg-basedir），
    // 不再自行用 APPDATA。不设 OPENCODE_CONFIG_DIR 时 opencodeConfigDir() === Global.Path.config。
    setEnv("OPENCODE_CONFIG_DIR", undefined)
    setEnv("OPENCODE_DATA_DIR", undefined)

    const files = findConfigFilesGrouped(undefined)
    const globalFiles = files.filter((f) => f.group === "global" && f.name !== "auth.json")
    // global 分组的非 auth 文件都应位于 Global.Path.config 下
    for (const f of globalFiles) {
      expect(f.path.startsWith(Global.Path.config)).toBe(true)
    }
    // 反向断言：不再用旧的 APPDATA 路径（Windows bug 源）
    for (const f of globalFiles) {
      expect(f.path).not.toContain("AppData\\Roaming")
      expect(f.path).not.toContain("AppData/Roaming")
    }
  })

  test("发现 `~/.opencode` 目录下的配置文件（group=home）", async () => {
    // 在真实 home 目录下创建 `.opencode/opencode.jsonc`，测试后清理
    const homeOpencode = join(homedir(), ".opencode")
    const configFile = join(homeOpencode, "opencode.jsonc")
    const created: string[] = []
    try {
      await touch(homeOpencode)
      await writeFile(configFile, "{}")
      created.push(configFile)

      const emptyConfig = await tempRoot()
      const emptyData = await tempRoot()
      setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
      setEnv("OPENCODE_DATA_DIR", emptyData)

      const files = findConfigFilesGrouped(undefined)
      const homeFile = files.find((f) => f.group === "home" && f.name === "opencode.jsonc")
      expect(homeFile).toBeDefined()
      expect(homeFile?.path).toBe(configFile)
    } finally {
      await Promise.all(created.map((f) => rm(f, { force: true })))
    }
  })

  test("projectPath 根目录直接放置的配置被发现（group=project，向后兼容）", async () => {
    const projectPath = await tempRoot()
    await writeFile(join(projectPath, "opencode.json"), "{}")

    const emptyConfig = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const files = findConfigFilesGrouped(projectPath)
    const projectFile = files.find((f) => f.group === "project")
    expect(projectFile).toBeDefined()
    expect(projectFile?.name).toBe("opencode.json")
    expect(projectFile?.path).toBe(join(projectPath, "opencode.json"))
  })

  test("无 projectPath 直接配置时 project 分组为空", async () => {
    const projectPath = await tempRoot()
    const emptyConfig = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    // project 分组只检查 projectPath 根目录直接放置的配置文件
    const files = findConfigFilesGrouped(projectPath)
    const projectFiles = files.filter((f) => f.group === "project")
    expect(projectFiles).toHaveLength(0)
  })

  test("去重：同一路径不重复出现", async () => {
    const configDir = await tempRoot()
    await writeFile(join(configDir, "opencode.jsonc"), "{}")

    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const files = findConfigFilesGrouped(undefined)
    const paths = files.map((f) => f.path)
    const uniquePaths = new Set(paths)
    expect(paths.length).toBe(uniquePaths.size)
  })
})

describe("createConfigFile（工单 05 新建配置文件）", () => {
  test("global + opencode.json 在全局配置目录创建，内容含 $schema", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const path = await createConfigFile({ location: "global", type: "opencode.json" })
    expect(path).toBe(join(configDir, "opencode.json"))
    expect(existsSync(path)).toBe(true)
    const content = await readFile(path, "utf8")
    expect(content).toContain("$schema")
  })

  test("global + tui.json 在全局配置目录创建", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const path = await createConfigFile({ location: "global", type: "tui.json" })
    expect(path).toBe(join(configDir, "tui.json"))
    expect(existsSync(path)).toBe(true)
  })

  test("global + auth.json 在数据目录创建，内容为 {}", async () => {
    const emptyConfig = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const path = await createConfigFile({ location: "global", type: "auth.json" })
    expect(path).toBe(join(dataDir, "auth.json"))
    expect(existsSync(path)).toBe(true)
    const content = await readFile(path, "utf8")
    expect(content).toBe("{}")
  })

  test("project + opencode.json 在项目根目录创建", async () => {
    const projectPath = await tempRoot()
    const emptyConfig = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const path = await createConfigFile({ location: "project", type: "opencode.json", projectPath })
    expect(path).toBe(join(projectPath, "opencode.json"))
    expect(existsSync(path)).toBe(true)
  })

  test("opencode + opencode.json 在 .opencode 子目录创建", async () => {
    const projectPath = await tempRoot()
    const emptyConfig = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const path = await createConfigFile({ location: "opencode", type: "opencode.json", projectPath })
    expect(path).toBe(join(projectPath, ".opencode", "opencode.json"))
    expect(existsSync(path)).toBe(true)
  })

  test("不覆盖已存在文件", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const existingContent = '{\n  "existing": true\n}\n'
    await writeFile(join(configDir, "opencode.json"), existingContent, "utf8")

    const path = await createConfigFile({ location: "global", type: "opencode.json" })
    const content = await readFile(path, "utf8")
    expect(content).toBe(existingContent)
  })

  test("创建后 findConfigFilesGrouped 能发现（global + opencode.json）", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await createConfigFile({ location: "global", type: "opencode.json" })
    const files = findConfigFilesGrouped(undefined)
    expect(files.some((f) => f.name === "opencode.json" && f.group === "global")).toBe(true)
  })

  test("创建后 findConfigFilesGrouped 能发现（global + auth.json）", async () => {
    const emptyConfig = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    await createConfigFile({ location: "global", type: "auth.json" })
    const files = findConfigFilesGrouped(undefined)
    expect(files.some((f) => f.name === "auth.json")).toBe(true)
  })

  test("创建后 findConfigFilesGrouped 能发现（project + opencode.json）", async () => {
    const projectPath = await tempRoot()
    const emptyConfig = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await createConfigFile({ location: "project", type: "opencode.json", projectPath })
    const files = findConfigFilesGrouped(projectPath)
    expect(files.some((f) => f.name === "opencode.json" && f.group === "project")).toBe(true)
  })

  test("创建后 findConfigFilesGrouped 能发现（opencode + opencode.json）", async () => {
    const projectPath = await tempRoot()
    const emptyConfig = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", emptyConfig)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await createConfigFile({ location: "opencode", type: "opencode.json", projectPath })
    const files = findConfigFilesGrouped(projectPath)
    expect(files.some((f) => f.name === "opencode.json" && f.group === "opencode")).toBe(true)
  })
})

describe("readConfigFileAtPath / saveConfigFileAtPath（工单 03 按文件分别读写）", () => {
  test("readConfigFileAtPath 读取指定路径的配置文件", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    await writeFile(filePath, JSON.stringify({ model: "deepseek-chat", instructions: "保留我" }), "utf8")

    const result = await readConfigFileAtPath(filePath)
    expect(result.config).not.toBeNull()
    expect(result.error).toBeUndefined()
    expect(result.config?.model).toBe("deepseek-chat")
    expect(result.config?.instructions).toBe("保留我")
  })

  test("readConfigFileAtPath 去 BOM", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    await writeFile(filePath, `\uFEFF{"model": "deepseek-chat"}`, "utf8")

    const result = await readConfigFileAtPath(filePath)
    expect(result.config?.model).toBe("deepseek-chat")
  })

  test("readConfigFileAtPath 文件不存在返回 { config: null, error: 'not-found' }", async () => {
    const result = await readConfigFileAtPath("/nonexistent/path/opencode.json")
    expect(result.config).toBeNull()
    expect(result.error).toBe("not-found")
  })

  test("readConfigFileAtPath 解析失败返回 { config: null, error: 'parse-failed' }", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    await writeFile(filePath, "not json", "utf8")

    const result = await readConfigFileAtPath(filePath)
    expect(result.config).toBeNull()
    expect(result.error).toBe("parse-failed")
  })

  test("saveConfigFileAtPath 写入指定路径", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    await saveConfigFileAtPath(filePath, { model: "new-model" })

    const content = await readFile(filePath, "utf8")
    const parsed = JSON.parse(content)
    expect(parsed.model).toBe("new-model")
  })

  test("saveConfigFileAtPath 自动创建父目录", async () => {
    const root = await tempRoot()
    const filePath = join(root, "nested", "deep", "opencode.json")
    await saveConfigFileAtPath(filePath, { model: "new-model" })

    expect(existsSync(filePath)).toBe(true)
  })

  test("saveConfigFileAtPath 全量写入——保留传入的所有字段", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    const config = {
      model: "deepseek-chat",
      plugins: ["@opencode-ai/plugin-x"],
      instructions: "保留我",
      theme: "dark",
    }
    await saveConfigFileAtPath(filePath, config)

    const result = await readConfigFileAtPath(filePath)
    expect(result.config?.model).toBe("deepseek-chat")
    expect(result.config?.plugins).toEqual(["@opencode-ai/plugin-x"])
    expect(result.config?.instructions).toBe("保留我")
    expect(result.config?.theme).toBe("dark")
  })

  test("读全量 → 改字段 → 写全量：保留其他字段", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    // 初始文件含 model + instructions + theme
    await writeFile(filePath, JSON.stringify({ model: "old-model", instructions: "保留我", theme: "dark" }), "utf8")

    // 读全量
    const result = await readConfigFileAtPath(filePath)
    expect(result.config).not.toBeNull()
    // 改 model 字段，保留其他字段
    const merged = { ...(result.config as Record<string, unknown>), model: "new-model" }
    await saveConfigFileAtPath(filePath, merged)

    // 验证：model 改了，instructions/theme 保留
    const after = await readConfigFileAtPath(filePath)
    expect(after.config?.model).toBe("new-model")
    expect(after.config?.instructions).toBe("保留我")
    expect(after.config?.theme).toBe("dark")
  })

  test("改 model 不碰其他文件", async () => {
    const root = await tempRoot()
    const fileA = join(root, "opencode.json")
    const fileB = join(root, "tui.json")
    await writeFile(fileA, JSON.stringify({ model: "model-a" }), "utf8")
    await writeFile(fileB, JSON.stringify({ theme: "theme-b" }), "utf8")

    // 改 fileA 的 model
    const resultA = await readConfigFileAtPath(fileA)
    const mergedA = { ...(resultA.config as Record<string, unknown>), model: "new-model-a" }
    await saveConfigFileAtPath(fileA, mergedA)

    // fileB 不受影响
    const resultB = await readConfigFileAtPath(fileB)
    expect(resultB.config?.theme).toBe("theme-b")
    expect(resultB.config?.model).toBeUndefined()
  })
})

describe("readConfigFileAtPath / saveConfigFileAtPath（工单 10 jsonc 容错解析 + 最小编辑写回）", () => {
  test("带行注释的 opencode.jsonc 可正常解析", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.jsonc")
    await writeFile(
      filePath,
      `{
  // 这是模型配置
  "model": "deepseek-chat",
  "instructions": "保留我"
}`,
      "utf8",
    )

    const result = await readConfigFileAtPath(filePath)
    expect(result.error).toBeUndefined()
    expect(result.config?.model).toBe("deepseek-chat")
    expect(result.config?.instructions).toBe("保留我")
  })

  test("带块注释的 opencode.jsonc 可正常解析", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.jsonc")
    await writeFile(
      filePath,
      `{
  /* 块注释
     多行 */
  "model": "deepseek-chat"
}`,
      "utf8",
    )

    const result = await readConfigFileAtPath(filePath)
    expect(result.error).toBeUndefined()
    expect(result.config?.model).toBe("deepseek-chat")
  })

  test("带尾逗号的 opencode.jsonc 可正常解析", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.jsonc")
    await writeFile(
      filePath,
      `{
  "model": "deepseek-chat",
  "instructions": "保留我",
}`,
      "utf8",
    )

    const result = await readConfigFileAtPath(filePath)
    expect(result.error).toBeUndefined()
    expect(result.config?.model).toBe("deepseek-chat")
  })

  test("保存后 .jsonc 行注释保留", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.jsonc")
    const original = `{
  // 模型注释
  "model": "old-model",
  "instructions": "保留我"
}`
    await writeFile(filePath, original, "utf8")

    const result = await readConfigFileAtPath(filePath)
    const merged = { ...(result.config as Record<string, unknown>), model: "new-model" }
    await saveConfigFileAtPath(filePath, merged)

    const written = await readFile(filePath, "utf8")
    expect(written).toContain("// 模型注释")
    expect(written).toContain('"model": "new-model"')
    expect(written).toContain('"instructions": "保留我"')
  })

  test("保存后 .jsonc 块注释保留", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.jsonc")
    const original = `{
  /* 顶部块注释 */
  "model": "old-model",
  "instructions": "保留我"
}`
    await writeFile(filePath, original, "utf8")

    const result = await readConfigFileAtPath(filePath)
    const merged = { ...(result.config as Record<string, unknown>), model: "new-model" }
    await saveConfigFileAtPath(filePath, merged)

    const written = await readFile(filePath, "utf8")
    expect(written).toContain("/* 顶部块注释 */")
    expect(written).toContain('"model": "new-model"')
  })

  test("保存后 .jsonc 字段顺序保留（$schema 仍在首位）", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.jsonc")
    const original = `{
  "$schema": "https://opencode.ai/config.json",
  "model": "old-model",
  "instructions": "保留我",
  "theme": "dark"
}`
    await writeFile(filePath, original, "utf8")

    const result = await readConfigFileAtPath(filePath)
    const merged = { ...(result.config as Record<string, unknown>), model: "new-model" }
    await saveConfigFileAtPath(filePath, merged)

    const written = await readFile(filePath, "utf8")
    const schemaIdx = written.indexOf("$schema")
    const modelIdx = written.indexOf('"model"')
    const instrIdx = written.indexOf('"instructions"')
    const themeIdx = written.indexOf('"theme"')
    expect(schemaIdx).toBeLessThan(modelIdx)
    expect(modelIdx).toBeLessThan(instrIdx)
    expect(instrIdx).toBeLessThan(themeIdx)
  })

  test("删除字段后 .jsonc 文件有效且其他字段保留", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.jsonc")
    const original = `{
  // 模型注释
  "model": "old-model",
  "instructions": "保留我"
}`
    await writeFile(filePath, original, "utf8")

    const result = await readConfigFileAtPath(filePath)
    const merged = { ...(result.config as Record<string, unknown>) }
    delete merged.model
    await saveConfigFileAtPath(filePath, merged)

    // 删除字段后文件仍可解析，其他字段值保留
    const after = await readConfigFileAtPath(filePath)
    expect(after.error).toBeUndefined()
    expect(after.config?.model).toBeUndefined()
    expect(after.config?.instructions).toBe("保留我")
  })

  test("新增字段时 .jsonc 原有注释保留", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.jsonc")
    const original = `{
  // 模型注释
  "model": "old-model"
}`
    await writeFile(filePath, original, "utf8")

    const result = await readConfigFileAtPath(filePath)
    const merged = { ...(result.config as Record<string, unknown>), instructions: "新增的" }
    await saveConfigFileAtPath(filePath, merged)

    const written = await readFile(filePath, "utf8")
    expect(written).toContain("// 模型注释")
    expect(written).toContain('"instructions": "新增的"')
  })

  test("readConfigFileAtPath 非对象（数组）返回 { config: null, error: 'not-object' }", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    await writeFile(filePath, "[1, 2, 3]", "utf8")

    const result = await readConfigFileAtPath(filePath)
    expect(result.config).toBeNull()
    expect(result.error).toBe("not-object")
  })

  test("readConfigFileAtPath 空文件返回 parse-failed", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    await writeFile(filePath, "", "utf8")

    const result = await readConfigFileAtPath(filePath)
    expect(result.config).toBeNull()
    expect(result.error).toBe("parse-failed")
  })

  test(".json 文件行为不回归——纯 json 正常解析", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    await writeFile(filePath, JSON.stringify({ model: "deepseek-chat", instructions: "保留我" }), "utf8")

    const result = await readConfigFileAtPath(filePath)
    expect(result.error).toBeUndefined()
    expect(result.config?.model).toBe("deepseek-chat")
    expect(result.config?.instructions).toBe("保留我")
  })

  test(".json 文件保存用整体 stringify（不回归）", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.json")
    await writeFile(filePath, JSON.stringify({ model: "old" }), "utf8")

    await saveConfigFileAtPath(filePath, { model: "new" })
    const written = await readFile(filePath, "utf8")
    expect(written).toBe(JSON.stringify({ model: "new" }, null, 2))
  })

  test(".jsonc 文件不存在时 saveConfigFileAtPath 整体写入", async () => {
    const root = await tempRoot()
    const filePath = join(root, "opencode.jsonc")
    await saveConfigFileAtPath(filePath, { model: "new-model" })

    const result = await readConfigFileAtPath(filePath)
    expect(result.config?.model).toBe("new-model")
  })
})

describe("findOpencodeSubdirs（工单 04 .opencode/ 下目录节点发现）", () => {
  test("返回固定子目录列表 agents/skills/plugins/themes/command", () => {
    const projectPath = "/nonexistent-project"
    const subdirs = findOpencodeSubdirs(projectPath)
    const names = subdirs.map((s) => s.name)
    expect(names).toEqual(["agents", "skills", "plugins", "themes", "command"])
  })

  test("存在的目录 exists=true，不存在的 exists=false", async () => {
    const projectPath = await tempRoot()
    await mkdir(join(projectPath, ".opencode", "agents"), { recursive: true })
    await mkdir(join(projectPath, ".opencode", "plugins"), { recursive: true })

    const subdirs = findOpencodeSubdirs(projectPath)
    const byName = Object.fromEntries(subdirs.map((s) => [s.name, s]))
    expect(byName.agents.exists).toBe(true)
    expect(byName.plugins.exists).toBe(true)
    expect(byName.skills.exists).toBe(false)
    expect(byName.themes.exists).toBe(false)
    expect(byName.command.exists).toBe(false)
  })

  test("path 拼接到 .opencode/ 下", () => {
    const projectPath = "/project"
    const subdirs = findOpencodeSubdirs(projectPath)
    const agentsDir = subdirs.find((s) => s.name === "agents")
    expect(agentsDir?.path).toBe(join("/project", ".opencode", "agents"))
  })

  test("无 projectPath 时用 xdg 全局配置目录", async () => {
    const configDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)

    const subdirs = findOpencodeSubdirs(undefined)
    const agentsDir = subdirs.find((s) => s.name === "agents")
    expect(agentsDir?.path).toBe(join(configDir, "agents"))
  })
})

describe("listDirectoryEntries（工单 04 目录节点展开列出文件）", () => {
  test("列出目录内文件和子目录", async () => {
    const root = await tempRoot()
    await writeFile(join(root, "file1.md"), "content1")
    await writeFile(join(root, "file2.ts"), "content2")
    await mkdir(join(root, "subdir"))

    const entries = await listDirectoryEntries(root)
    const names = entries.map((e) => e.name)
    expect(names).toContain("file1.md")
    expect(names).toContain("file2.ts")
    expect(names).toContain("subdir")
  })

  test("目录在前，文件在后", async () => {
    const root = await tempRoot()
    await writeFile(join(root, "z-file.md"), "content")
    await mkdir(join(root, "a-subdir"))

    const entries = await listDirectoryEntries(root)
    // a-subdir 应在 z-file 之前（目录优先）
    expect(entries[0].name).toBe("a-subdir")
    expect(entries[0].isDirectory).toBe(true)
    expect(entries[1].name).toBe("z-file.md")
    expect(entries[1].isDirectory).toBe(false)
  })

  test("isDirectory 标志正确", async () => {
    const root = await tempRoot()
    await writeFile(join(root, "file.md"), "content")
    await mkdir(join(root, "subdir"))

    const entries = await listDirectoryEntries(root)
    const fileEntry = entries.find((e) => e.name === "file.md")
    const dirEntry = entries.find((e) => e.name === "subdir")
    expect(fileEntry?.isDirectory).toBe(false)
    expect(dirEntry?.isDirectory).toBe(true)
  })

  test("path 拼接到完整路径", async () => {
    const root = await tempRoot()
    await writeFile(join(root, "file.md"), "content")

    const entries = await listDirectoryEntries(root)
    const fileEntry = entries.find((e) => e.name === "file.md")
    expect(fileEntry?.path).toBe(join(root, "file.md"))
  })

  test("隐藏点文件不列出", async () => {
    const root = await tempRoot()
    await writeFile(join(root, ".hidden"), "content")
    await writeFile(join(root, "visible.md"), "content")

    const entries = await listDirectoryEntries(root)
    const names = entries.map((e) => e.name)
    expect(names).not.toContain(".hidden")
    expect(names).toContain("visible.md")
  })

  test("目录不存在返回空数组", async () => {
    const entries = await listDirectoryEntries("/nonexistent/directory/path")
    expect(entries).toEqual([])
  })

  test("空目录返回空数组", async () => {
    const root = await tempRoot()
    const entries = await listDirectoryEntries(root)
    expect(entries).toEqual([])
  })

  test("同目录内按名称排序（目录间 + 文件间各自排序）", async () => {
    const root = await tempRoot()
    await mkdir(join(root, "b-dir"))
    await mkdir(join(root, "a-dir"))
    await writeFile(join(root, "z-file.md"), "content")
    await writeFile(join(root, "y-file.md"), "content")

    const entries = await listDirectoryEntries(root)
    // 目录在前，各自按名称排序
    expect(entries.map((e) => e.name)).toEqual(["a-dir", "b-dir", "y-file.md", "z-file.md"])
  })
})

describe("isConfigPathAllowed / isDirectoryPathAllowed（C1 路径遍历防护）", () => {
  test("允许配置目录内的路径", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    expect(isConfigPathAllowed(join(configDir, "opencode.json"))).toBe(true)
    expect(isConfigPathAllowed(join(dataDir, "auth.json"))).toBe(true)
    expect(isDirectoryPathAllowed(configDir)).toBe(true)
    expect(isDirectoryPathAllowed(dataDir)).toBe(true)
  })

  test("允许当前工作目录及其 .opencode 子目录", () => {
    const cwd = process.cwd()
    expect(isConfigPathAllowed(join(cwd, "opencode.json"))).toBe(true)
    expect(isConfigPathAllowed(join(cwd, ".opencode", "opencode.json"))).toBe(true)
    expect(isDirectoryPathAllowed(join(cwd, ".opencode"))).toBe(true)
  })

  test("允许 home/.opencode 目录内的路径", () => {
    expect(isConfigPathAllowed(join(homedir(), ".opencode", "opencode.json"))).toBe(true)
    expect(isDirectoryPathAllowed(join(homedir(), ".opencode"))).toBe(true)
  })

  test("拒绝路径遍历——跳出配置目录的 ../etc/passwd", async () => {
    const configDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)

    // 构造遍历路径：configDir/../../etc/passwd
    const traversalPath = join(configDir, "..", "..", "etc", "passwd")
    expect(isConfigPathAllowed(traversalPath)).toBe(false)
  })

  test("拒绝绝对路径遍历——直接指向系统敏感路径", () => {
    // /etc/passwd 或 C:\Windows\System32 不在允许的根目录内
    const sensitivePath = process.platform === "win32" ? "C:\\Windows\\System32\\config.sys" : "/etc/passwd"
    expect(isConfigPathAllowed(sensitivePath)).toBe(false)
    expect(isDirectoryPathAllowed(sensitivePath)).toBe(false)
  })

  test("拒绝任意用户主目录下的路径（只允许 ~/.opencode 子树）", () => {
    // ~/.ssh 不在允许的根目录内
    const sshPath = join(homedir(), ".ssh", "id_rsa")
    expect(isConfigPathAllowed(sshPath)).toBe(false)
    expect(isDirectoryPathAllowed(sshPath)).toBe(false)
  })

  test("允许根目录本身（边界条件）", async () => {
    const configDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)

    expect(isDirectoryPathAllowed(configDir)).toBe(true)
  })
})

describe("createConfigFile 枚举校验（C2 路径遍历防护）", () => {
  test("合法 type + location 正常创建", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    const path = await createConfigFile({ location: "global", type: "opencode.json" })
    expect(existsSync(path)).toBe(true)
  })

  test("拒绝未知的 type", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    // 使用 as 绕过编译期类型检查，模拟 IPC 传入恶意 type
    await expect(createConfigFile({ location: "global", type: "malicious.json" as "opencode.json" })).rejects.toThrow(
      "不支持的配置文件类型",
    )
  })

  test("拒绝未知的 location", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    // 使用 as 绕过编译期类型检查，模拟 IPC 传入恶意 location
    await expect(createConfigFile({ location: "/etc" as "global", type: "opencode.json" })).rejects.toThrow(
      "不支持的位置",
    )
  })

  test("拒绝 type 含路径分隔符的遍历尝试", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await expect(
      createConfigFile({ location: "global", type: "../../../etc/passwd" as "opencode.json" }),
    ).rejects.toThrow("不支持的配置文件类型")
  })
})

describe("createSnapshot / exportBundle / restoreSnapshotConfig（工单 09 auth.json 脱敏 + 快照 0600）", () => {
  test("createSnapshot 对 auth.json 脱敏——快照内容是占位，不含明文 key", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const authPath = join(dataDir, "auth.json")
    const secretKey = "sk-secret-12345"
    await writeFile(authPath, JSON.stringify({ openai: { type: "api", key: secretKey } }), "utf8")
    await writeFile(join(configDir, "opencode.json"), JSON.stringify({ model: "x" }), "utf8")

    const snap = await createSnapshot({ type: "auto" })

    // 快照中 auth.json 内容是占位，不是明文
    expect(snap.configContents[authPath]).toBe(REDACTED_PLACEHOLDER)
    // 快照整体 JSON 不含明文 key
    expect(JSON.stringify(snap)).not.toContain(secretKey)
  })

  test("快照文件权限 0o600（非 Windows 平台）", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    await writeFile(join(dataDir, "auth.json"), "{}", "utf8")
    await writeFile(join(configDir, "opencode.json"), "{}", "utf8")

    const snap = await createSnapshot({ type: "auto" })
    const snapFile = join(configDir, "launcher", "snapshots", `${snap.id}.json`)
    expect(existsSync(snapFile)).toBe(true)

    // Windows 不支持 Unix 权限位，仅非 Windows 断言 0o600
    if (process.platform !== "win32") {
      const s = await stat(snapFile)
      expect(s.mode & 0o777).toBe(0o600)
    }
  })

  test("exportBundle 对 auth.json 脱敏——bundle 不含明文 key", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const secretKey = "sk-export-secret-67890"
    await writeFile(join(dataDir, "auth.json"), JSON.stringify({ openai: { type: "api", key: secretKey } }), "utf8")
    await writeFile(join(configDir, "opencode.json"), JSON.stringify({ model: "x" }), "utf8")

    const snap = await createSnapshot({ type: "auto" })
    const bundleJson = await exportBundle(snap.id)

    expect(bundleJson).not.toContain(secretKey)
    const bundle = JSON.parse(bundleJson) as { configContents: Record<string, string> }
    expect(bundle.configContents["auth.json"]).toBe(REDACTED_PLACEHOLDER)
  })

  test("restoreSnapshotConfig 不覆盖现有 auth.json", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const authPath = join(dataDir, "auth.json")
    await writeFile(authPath, JSON.stringify({ openai: { type: "api", key: "sk-old-key" } }), "utf8")
    await writeFile(join(configDir, "opencode.json"), JSON.stringify({ model: "x" }), "utf8")

    const snap = await createSnapshot({ type: "auto" })

    // 用户后来改了 auth.json
    const newAuthContent = JSON.stringify({ openai: { type: "api", key: "sk-new-key" } })
    await writeFile(authPath, newAuthContent, "utf8")

    // 恢复快照——不应覆盖 auth.json（占位跳过）
    await restoreSnapshotConfig(snap)

    const after = await readFile(authPath, "utf8")
    expect(after).toBe(newAuthContent)
  })

  test("importBundle 跳过 auth.json 占位——不覆盖现有 auth.json，不在 configDir 创建 auth.json", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const authPath = join(dataDir, "auth.json")
    await writeFile(authPath, JSON.stringify({ openai: { type: "api", key: "sk-old-key" } }), "utf8")
    await writeFile(join(configDir, "opencode.json"), JSON.stringify({ model: "x" }), "utf8")
    // 预置 package.json 避免 importBundle 触发 npm init
    await writeFile(join(configDir, "package.json"), '{"name":"test"}', "utf8")

    const snap = await createSnapshot({ type: "auto" })
    const bundleJson = await exportBundle(snap.id)

    // 用户后来改了 auth.json
    const newAuthContent = JSON.stringify({ openai: { type: "api", key: "sk-new-key" } })
    await writeFile(authPath, newAuthContent, "utf8")

    // 导入 bundle——不应覆盖 dataDir 的 auth.json，也不应在 configDir 创建 auth.json
    await importBundle(bundleJson)

    const after = await readFile(authPath, "utf8")
    expect(after).toBe(newAuthContent)
    expect(existsSync(join(configDir, "auth.json"))).toBe(false)
  })
})

describe("migrateRedactOldSnapshots（M2 旧快照迁移脱敏 + 收紧 0600）", () => {
  test("旧快照含 auth.json 明文——迁移后脱敏为占位 + 权限 0o600", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const authPath = join(dataDir, "auth.json")
    const secretKey = "sk-old-plaintext-key-12345"

    // 手动构造旧快照（工单09 前的格式：含 auth.json 明文，默认权限）
    const oldSnap = {
      id: "snap-old-001",
      timestamp: Date.now(),
      type: "auto",
      tag: null,
      projectHash: null,
      pluginCount: 0,
      configFiles: [authPath],
      configContents: {
        [authPath]: JSON.stringify({ openai: { type: "api", key: secretKey } }),
      },
      plugins: [],
    }
    const snapshotsDir = join(configDir, "launcher", "snapshots")
    await mkdir(snapshotsDir, { recursive: true })
    const snapFile = join(snapshotsDir, `${oldSnap.id}.json`)
    // 默认权限写入（不传 mode）——模拟旧快照未收紧
    await writeFile(snapFile, JSON.stringify(oldSnap, null, 2), "utf8")

    const migrated = await migrateRedactOldSnapshots()
    expect(migrated).toBe(1)

    const after = await readFile(snapFile, "utf8")
    expect(after).not.toContain(secretKey)
    const afterSnap = JSON.parse(after) as { configContents: Record<string, string> }
    expect(afterSnap.configContents[authPath]).toBe(REDACTED_PLACEHOLDER)

    // 非 Windows 断言权限 0o600
    if (process.platform !== "win32") {
      const s = await stat(snapFile)
      expect(s.mode & 0o777).toBe(0o600)
    }
  })

  test("已是脱敏 + 0o600 的快照——不重写，返回 0", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const authPath = join(dataDir, "auth.json")
    const cleanSnap = {
      id: "snap-clean-001",
      timestamp: Date.now(),
      type: "auto",
      tag: null,
      projectHash: null,
      pluginCount: 0,
      configFiles: [authPath],
      configContents: { [authPath]: REDACTED_PLACEHOLDER },
      plugins: [],
    }
    const snapshotsDir = join(configDir, "launcher", "snapshots")
    await mkdir(snapshotsDir, { recursive: true })
    const snapFile = join(snapshotsDir, `${cleanSnap.id}.json`)
    await writeFile(snapFile, JSON.stringify(cleanSnap, null, 2), { encoding: "utf8", mode: 0o600 })

    const migrated = await migrateRedactOldSnapshots()
    expect(migrated).toBe(0)
  })

  test("无快照时返回 0", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const migrated = await migrateRedactOldSnapshots()
    expect(migrated).toBe(0)
  })

  test("损坏的快照文件跳过——不抛异常，返回 0", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const snapshotsDir = join(configDir, "launcher", "snapshots")
    await mkdir(snapshotsDir, { recursive: true })
    await writeFile(join(snapshotsDir, "snap-broken-001.json"), "not json", "utf8")

    const migrated = await migrateRedactOldSnapshots()
    expect(migrated).toBe(0)
  })

  test("多个快照——只迁移含明文的，已脱敏的不动", async () => {
    const configDir = await tempRoot()
    const dataDir = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", dataDir)

    const authPath = join(dataDir, "auth.json")
    const secretKey = "sk-multi-migrate-key"
    const snapshotsDir = join(configDir, "launcher", "snapshots")
    await mkdir(snapshotsDir, { recursive: true })

    // 旧快照 1：含明文
    const oldSnap1 = {
      id: "snap-multi-old-1",
      timestamp: Date.now(),
      type: "auto",
      tag: null,
      projectHash: null,
      pluginCount: 0,
      configFiles: [authPath],
      configContents: { [authPath]: JSON.stringify({ openai: { type: "api", key: secretKey } }) },
      plugins: [],
    }
    await writeFile(join(snapshotsDir, `${oldSnap1.id}.json`), JSON.stringify(oldSnap1, null, 2), "utf8")

    // 旧快照 2：含明文
    const oldSnap2 = {
      id: "snap-multi-old-2",
      timestamp: Date.now(),
      type: "auto",
      tag: null,
      projectHash: null,
      pluginCount: 0,
      configFiles: [authPath],
      configContents: { [authPath]: JSON.stringify({ anthropic: { type: "api", key: secretKey } }) },
      plugins: [],
    }
    await writeFile(join(snapshotsDir, `${oldSnap2.id}.json`), JSON.stringify(oldSnap2, null, 2), "utf8")

    // 干净快照：已脱敏 + 0o600
    const cleanSnap = {
      id: "snap-multi-clean",
      timestamp: Date.now(),
      type: "auto",
      tag: null,
      projectHash: null,
      pluginCount: 0,
      configFiles: [authPath],
      configContents: { [authPath]: REDACTED_PLACEHOLDER },
      plugins: [],
    }
    await writeFile(join(snapshotsDir, `${cleanSnap.id}.json`), JSON.stringify(cleanSnap, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    })

    const migrated = await migrateRedactOldSnapshots()
    expect(migrated).toBe(2)

    // 两个旧快照都脱敏了
    const after1 = JSON.parse(await readFile(join(snapshotsDir, `${oldSnap1.id}.json`), "utf8")) as {
      configContents: Record<string, string>
    }
    const after2 = JSON.parse(await readFile(join(snapshotsDir, `${oldSnap2.id}.json`), "utf8")) as {
      configContents: Record<string, string>
    }
    expect(after1.configContents[authPath]).toBe(REDACTED_PLACEHOLDER)
    expect(after2.configContents[authPath]).toBe(REDACTED_PLACEHOLDER)
  })
})

describe("setSnapshotNote / listSnapshots（工单 05 备注字段）", () => {
  test("createSnapshot 初始 note 为 null", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await writeFile(join(configDir, "opencode.json"), "{}", "utf8")
    const snap = await createSnapshot({ type: "manual" })
    expect(snap.note).toBeNull()

    const metas = await listSnapshots()
    const meta = metas.find((m) => m.id === snap.id)
    expect(meta?.note).toBeNull()
  })

  test("setSnapshotNote 设置备注后可读回", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await writeFile(join(configDir, "opencode.json"), "{}", "utf8")
    const snap = await createSnapshot({ type: "manual" })

    await setSnapshotNote(snap.id, "发布前回滚点")
    const after = await getSnapshot(snap.id)
    expect(after?.note).toBe("发布前回滚点")

    const metas = await listSnapshots()
    const meta = metas.find((m) => m.id === snap.id)
    expect(meta?.note).toBe("发布前回滚点")
  })

  test("setSnapshotNote 传 null 清除备注", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await writeFile(join(configDir, "opencode.json"), "{}", "utf8")
    const snap = await createSnapshot({ type: "manual" })
    await setSnapshotNote(snap.id, "临时备注")
    await setSnapshotNote(snap.id, null)

    const after = await getSnapshot(snap.id)
    expect(after?.note).toBeNull()
  })

  test("setSnapshotNote 不存在的快照抛异常", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await expect(setSnapshotNote("snap-nonexistent", "x")).rejects.toThrow("snapshot not found")
  })

  test("备注与 tag 独立——设置备注不影响 tag", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await writeFile(join(configDir, "opencode.json"), "{}", "utf8")
    const snap = await createSnapshot({ type: "manual" })
    await tagSnapshot(snap.id, "v1.0")
    await setSnapshotNote(snap.id, "发布版本")

    const after = await getSnapshot(snap.id)
    expect(after?.tag).toBe("v1.0")
    expect(after?.note).toBe("发布版本")
  })

  test("旧快照无 note 字段——listSnapshots 向后兼容补 null", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    // 手动构造旧快照（无 note 字段，模拟工单 05 前的格式）
    const oldSnap = {
      id: "snap-old-no-note",
      timestamp: Date.now(),
      type: "auto",
      tag: null,
      projectHash: null,
      pluginCount: 0,
      configFiles: [],
      configContents: {},
      plugins: [],
    }
    const snapshotsDir = join(configDir, "launcher", "snapshots")
    await mkdir(snapshotsDir, { recursive: true })
    await writeFile(join(snapshotsDir, `${oldSnap.id}.json`), JSON.stringify(oldSnap, null, 2), "utf8")

    const metas = await listSnapshots()
    const meta = metas.find((m) => m.id === oldSnap.id)
    expect(meta?.note).toBeNull()
  })

  test("备注可含中文/长文本", async () => {
    const configDir = await tempRoot()
    const emptyData = await tempRoot()
    setEnv("OPENCODE_CONFIG_DIR", configDir)
    setEnv("OPENCODE_DATA_DIR", emptyData)

    await writeFile(join(configDir, "opencode.json"), "{}", "utf8")
    const snap = await createSnapshot({ type: "manual" })
    const longNote = "这是一段较长的中文备注，描述此次配置变更的原因与影响范围，供后续回滚时参考。"
    await setSnapshotNote(snap.id, longNote)

    const after = await getSnapshot(snap.id)
    expect(after?.note).toBe(longNote)
  })
})
