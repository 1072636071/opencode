#!/usr/bin/env bun
/**
 * 姜晓主题双通道一致性校验（ADR-019 / DESIGN.md §10）
 *
 * 问题背景：主题有两个值源——
 *   ① opencode/packages/app/src/jiangxiao.css 的 §10 token 块（运行时权威）
 *   ② opencode/packages/ui/src/theme/themes/jiangxiao.json（主题引擎声明）
 * 两者曾漂移（如 dark neutral #0d0b08 vs surface-0 #0b090d），且运行时 CSS
 * 后加载覆盖 JSON，导致"改 JSON 不生效"。本脚本以 CSS token 块为唯一值源，
 * 校验 JSON 中的对应键值一致，防止再次漂移。
 *
 * 用法：bun run script/check-jiangxiao-theme.ts
 * 退出码：0 = 一致；1 = 存在漂移（输出明细）。
 */

import { fileURLToPath } from "node:url"
import { join } from "node:path"

const root = fileURLToPath(new URL("..", import.meta.url))
// 拆包后：深色 token 块在 tokens.css，浅色 token 块在 light.css
const darkCssPath = join(root, "packages/app/src/jiangxiao/tokens.css")
const lightCssPath = join(root, "packages/app/src/jiangxiao/light.css")
const jsonPath = join(root, "packages/ui/src/theme/themes/jiangxiao.json")

const darkCss = await Bun.file(darkCssPath).text()
const lightCss = await Bun.file(lightCssPath).text()
const json = (await Bun.file(jsonPath).json()) as Record<
  "light" | "dark",
  { palette: Record<string, string>; overrides: Record<string, string> }
>

/** 从指定 CSS 文本的指定作用域块中提取 token 值 */
function extractTokens(css: string, scopeSelector: string): Record<string, string> {
  const start = css.indexOf(scopeSelector)
  if (start === -1) throw new Error(`CSS 中找不到作用域 ${scopeSelector}`)
  const open = css.indexOf("{", start)
  // 简单配对花括号（token 块内无嵌套规则）
  let depth = 0
  let end = open
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++
    else if (css[end] === "}") {
      depth--
      if (depth === 0) break
    }
  }
  const block = css.slice(open, end)
  const tokens: Record<string, string> = {}
  for (const m of block.matchAll(/(--jx-[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[m[1]] = m[2].toLowerCase()
  }
  return tokens
}

const dark = extractTokens(darkCss, '[data-theme="jiangxiao"] {')
const light = extractTokens(lightCss, '[data-theme="jiangxiao"][data-color-scheme="light"] {')

/** JSON 键 → CSS token 映射（palette/overrides 同表，深色为基准） */
const MAPPING: Record<string, string> = {
  "palette.neutral": "--jx-surface-0",
  "palette.ink": "--jx-text-strong",
  "palette.primary": "--jx-gold",
  "palette.accent": "--jx-gold-deep",
  "palette.success": "--jx-success",
  "palette.warning": "--jx-warn",
  "palette.error": "--jx-error",
  "overrides.text-strong": "--jx-text-strong",
  "overrides.text-base": "--jx-text-base",
  "overrides.text-weak": "--jx-text-weak",
  "overrides.text-weaker": "--jx-text-faint",
  "overrides.surface-base": "--jx-surface-1",
  "overrides.surface-raised-base": "--jx-surface-2",
  "overrides.surface-raised-base-hover": "--jx-surface-3",
}

/** 浅色语义差异：品牌主色取印章梅红而非金族；surface 阶整体下移一级（surface-0 即页面底） */
const LIGHT_MAPPING: Record<string, string> = {
  ...MAPPING,
  "palette.primary": "--jx-seal",
  "palette.accent": "--jx-seal-bright",
  "overrides.surface-base": "--jx-surface-0",
  "overrides.surface-raised-base": "--jx-surface-1",
  "overrides.surface-raised-base-hover": "--jx-surface-2",
}

/** 有意偏离白名单（必须附原因，否则视同漂移） */
const ALLOWED_DIVERGENCE: Record<string, string> = {
  // 浅色 text-weaker 若取 text-faint(#b3a296) 仅 2.2:1，AA 严重失败；加深至 #7a6a60(≈4.5:1)
  "light:overrides.text-weaker": "#7a6a60",
}

let drift = 0
for (const scheme of ["light", "dark"] as const) {
  const tokens = scheme === "dark" ? dark : light
  const mapping = scheme === "dark" ? MAPPING : LIGHT_MAPPING
  for (const [key, token] of Object.entries(mapping)) {
    const [group, name] = key.split(".") as ["palette" | "overrides", string]
    const actual = json[scheme]?.[group]?.[name]?.toLowerCase()
    const expected = tokens[token]
    if (!expected) {
      console.error(`✗ ${scheme}:${key} 映射的 ${token} 在 CSS token 块中不存在`)
      drift++
      continue
    }
    if (actual === expected) continue
    const allowed = ALLOWED_DIVERGENCE[`${scheme}:${key}`]
    if (allowed && actual === allowed.toLowerCase()) continue
    console.error(`✗ ${scheme}:${key} = ${actual ?? "(缺失)"}，期望 ${expected}（${token}）`)
    drift++
  }
}

/** 裸色值守卫（DESIGN.md：主题 CSS 一律 var(--jx-*) 引用令牌，禁止裸值字面量）
 *  规则：jiangxiao/ 分包内，hex 字面量只允许出现在 token 定义行（--jx-*: #xxx;）。
 *  豁免：inline SVG data-URI（无法引用 var()，规矩见 tokens.css 头注释）。 */
const HEX = /#[0-9a-fA-F]{3,8}\b/g
const pkgDir = join(root, "packages/app/src/jiangxiao")
for (const file of ["tokens.css", "chrome.css", "session.css", "home.css", "character.css", "light.css"]) {
  const text = await Bun.file(join(pkgDir, file)).text()
  // 注释中的色值引用（如「金族 #b8860b」）不构成违规：抹掉块注释内容但保留换行以维持行号
  const code = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
  const lines = code.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/url\("data:[^"]*"\)/g, "")
    if (/^\s*--jx-[\w-]+\s*:/.test(line)) continue
    for (const m of line.matchAll(HEX)) {
      console.error(`✗ ${file}:${i + 1} 裸色值 ${m[0]}（token 定义行外禁止 hex 字面量）`)
      drift++
    }
  }
}

if (drift > 0) {
  console.error(`\n共 ${drift} 处漂移。请以 jiangxiao/tokens.css §10 token 块为准修正。`)
  process.exit(1)
}
console.log(`✓ jiangxiao.json 与 §10 token 块一致（${Object.keys(MAPPING).length} 键 × 2 scheme），分包无裸色值`)
