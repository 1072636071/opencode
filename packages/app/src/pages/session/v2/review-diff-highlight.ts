import type { ViewDiff } from "@opencode-ai/session-ui/session-diff"
import { OpenCodeTheme } from "@opencode-ai/ui/context/marked-theme"
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from "shiki"

/** 与 review-panel-v2 的 ReviewDlRow 结构一致（结构类型，避免循环依赖）。 */
export type HighlightRow = {
  kind: "add" | "del" | "ctx"
  code: string
}

type Highlighted = { row: HighlightRow; html?: string }

let highlighterPromise: Promise<Highlighter> | undefined

function getHighlighter() {
  return (highlighterPromise ??= createHighlighter({
    themes: [OpenCodeTheme],
    langs: [],
  }))
}

/** 常见文件名 → shiki 语言 id（覆盖大多数仓库场景；未命中回退 plain text）。 */
const LANG_BY_FILE: Record<string, BundledLanguage | "text"> = {
  // JS / TS 族
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  // 配置文件
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  html: "html",
  htm: "html",
  svg: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  // 后端
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  // 前端
  vue: "vue",
  svelte: "svelte",
  // 脚本 / Shell
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  bat: "batch",
  cmd: "batch",
  // 数据库 / 基础设施
  sql: "sql",
  tf: "hcl",
  // 数据
  csv: "csv",
  // Diff 自身
  diff: "diff",
  patch: "diff",
}

const FILE_BASENAMES: Record<string, BundledLanguage | "text"> = {
  dockerfile: "docker",
  makefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  "go.mod": "go",
  "cargo.toml": "toml",
  "package.json": "json",
  "tsconfig.json": "jsonc",
  "pyproject.toml": "toml",
}

export function inferLanguageFromPath(file: string): BundledLanguage | "text" {
  const base = file.split(/[\\/]/).pop() ?? file
  const lower = base.toLowerCase()
  if (lower in FILE_BASENAMES) return FILE_BASENAMES[lower]
  const dot = lower.lastIndexOf(".")
  const ext = dot >= 0 ? lower.slice(dot + 1) : lower
  return LANG_BY_FILE[ext] ?? "text"
}

/** 整段高亮 → 按行拆分，返回每行的 token HTML（空行返回 undefined）。 */
async function highlightToLines(code: string, lang: BundledLanguage | "text"): Promise<string[]> {
  if (!code) return []
  const highlighter = await getHighlighter()
  let name: BundledLanguage | "text" = lang
  if (name !== "text" && !(name in bundledLanguages)) name = "text"
  if (name !== "text" && !highlighter.getLoadedLanguages().includes(name)) {
    try {
      await highlighter.loadLanguage(bundledLanguages[name])
    } catch {
      name = "text"
    }
  }
  const html = await highlighter.codeToHtml(code, { lang: name, theme: "OpenCode", tabindex: false })
  // shiki 输出 `<pre class="shiki"><code><span class="line">...</span>...</code></pre>`
  const lines: string[] = []
  const lineRe = /<span class="line">([\s\S]*?)<\/span>/g
  let m: RegExpExecArray | null
  while ((m = lineRe.exec(html))) lines.push(m[1])
  return lines
}

/**
 * 对 diff 的 add/del 行做整段语法高亮并拆行回填。
 * - add 行用 additionLines 拼成整段（保留换行）再按行拆分，保证多行 token 完整；
 * - del 行同理用 deletionLines；
 * - ctx 行不高亮（保持原样）。
 * 返回与 rows 等长的数组（顺序一致，add/del 行附 html）。
 *
 * 注意：本函数不做结果缓存。缓存由调用方（review-panel-v2 的 createResource）负责，
 * 其 source 以 {value, rows} memo 为 key，view 变化即重新执行，避免"同文件同行数但内容不同"
 * 命中旧高亮的问题。
 */
export function highlightDiffRows(
  rows: HighlightRow[],
  view: ViewDiff,
): Promise<(Highlighted | undefined)[]> {
  return (async () => {
    const lang = inferLanguageFromPath(view.file)
    const out: (Highlighted | undefined)[] = new Array(rows.length)

    // 按 kind 聚合 add/del 的连续行索引
    const groups: { kind: "add" | "del"; indices: number[] }[] = []
    for (let i = 0; i < rows.length; i++) {
      const kind = rows[i].kind
      if (kind === "ctx") continue
      const last = groups[groups.length - 1]
      if (last && last.kind === kind && last.indices[last.indices.length - 1] === i - 1) {
        last.indices.push(i)
      } else {
        groups.push({ kind, indices: [i] })
      }
    }

    for (const group of groups) {
      // 从原始 rows 中取该组对应的行；由于 diffToDlRows 顺序与 addition/deletionLines 索引对应，
      // 组内行号即 additionLines/deletionLines 的连续切片。行尾可能有 "\n"（fileDiff 行格式），
      // join 前去掉，避免整段拼出多余空行。
      const code = group.indices
        .map((i) => rows[i].code.replace(/\n$/, ""))
        .join("\n")
      const lines = await highlightToLines(code, lang)
      group.indices.forEach((rowIdx, lineIdx) => {
        out[rowIdx] = { row: rows[rowIdx], html: lines[lineIdx] }
      })
    }

    return out
  })()
}

export type { Highlighted }
