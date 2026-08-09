#!/usr/bin/env node
/**
 * verify-tokens.mjs — 主题令牌合规静态断言（回归门禁）
 *
 * 依据：根仓库 AGENTS.md「主题 CSS 一律 var(--jx-*) 引用令牌，禁止裸值字面量
 * （inline SVG data-URI 内无法 var() 者例外）、禁止发明色板/字号中间值」，
 * token 唯一源 = D:/work/space/open-code-mm/DESIGN.md §10。
 *
 * 扫描范围：jiangxiao 主题相关 + 今日修复涉及文件（T1/T2 产物），检查两类违规：
 *   1. 裸 hex 色值（#RGB/#RRGGBB/#RRGGBBAA）——排除：
 *      - var(--jx-*, <fallback>) 的 fallback（与 token 同值，允许）
 *      - inline SVG data-URI（url("data:image/svg+xml...")，%23 编码）
 *      - 注释（/* *\/ 与 //）
 *      - token 定义行（--jx-xxx:#...; 出现在 DESIGN.md §10 同步块内）
 *   2. 裸字号中间值（font-size 非 var() 引用且非 §10 已定义值）——§10 定义：
 *      display clamp(44px,4.5vw,64px)、h1 32、h2 24、h3 18、body 14、small 12、
 *      caption 11、icon-s 13、icon-m 16、icon-l 20。其余一律违规。
 *
 * 运行：node scripts/verify-tokens.mjs            （需在 opencode/ 根目录）
 * 退出码：0 = 合规；1 = 发现违规（列出文件:行:内容）
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const ROOT = process.cwd()
const APP_SRC = join(ROOT, "packages/app/src")

/** 扫描目标（显式清单，避免误扫上游通用文件） */
const TARGETS = [
  "jiangxiao.css",
  "components/jiangxiao-character-sidebar.tsx",
  "components/jiangxiao-icons.tsx",
  "components/jiangxiao-splash.tsx",
  "pages/layout.tsx",
  "pages/layout-new.tsx",
  "pages/home/home-projects.tsx",
  "pages/home/home-projects-controller.tsx",
  "pages/home/home-projects-view.tsx",
  "pages/home/home-sessions.tsx",
  "pages/home/home-sessions-controller.tsx",
  "pages/home/home-sessions-view.tsx",
  "pages/home/legacy-home.tsx",
  "pages/session/v2/review-panel-v2.tsx",
  "pages/session/v2/review-panel-v2-state.ts",
  "pages/session/v2/session-file-browser-tab.tsx",
  "pages/session/v2/session-file-list-v2.tsx",
]

/** §10 合法字号（px 数值集合） */
const ALLOWED_FONT_SIZES = new Set([11, 12, 13, 14, 16, 18, 20, 24, 32, 44, 64])

const hexRe = /#[0-9a-fA-F]{3,8}\b/g
const fontSizeRe = /font-size\s*:\s*([\d.]+)px/gi
const tokenDefLineRe = /--jx-[a-zA-Z0-9-]+\s*:/
const varFallbackRe = /var\(--jx-[a-zA-Z0-9-]+,\s*#[0-9a-fA-F]{3,8}\)/g

function stripComments(src) {
  // 块注释（CSS/TS 通用）——保留字符串字面量内的 // 不受影响（TSX 中内联 style 字符串仍会被 // 误伤，
  // 因此先剥块注释，再对行注释只在 CSS 文件剥离——见调用处参数）
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "")
  return out
}

function stripLineComments(src) {
  // 行注释 //：粗剥会误伤 url() 内协议（https://），故仅剥「行首空白后 //」形态
  return src.replace(/^\s*\/\/.*$/gm, "")
}

function stripDataUris(src) {
  return src.replace(/url\(["']?data:[^)]*\)/gi, "")
}

function stripVarFallbacks(src) {
  return src.replace(varFallbackRe, "var(--jx-xxx)")
}

/** 移除 token 定义行（DESIGN.md §10 同步块：--jx-xxx:#value; 所在行） */
function stripTokenDefLines(src) {
  return src
    .split("\n")
    .map((line) => (tokenDefLineRe.test(line) ? "" : line))
    .join("\n")
}

const violations = []

function scanFile(file) {
  const abs = join(APP_SRC, file)
  const rel = relative(ROOT, abs)
  let src
  try {
    src = readFileSync(abs, "utf8")
  } catch {
    console.warn(`  (跳过，文件不存在: ${rel})`)
    return
  }

  let body = stripComments(src)
  if (file.endsWith(".css")) body = stripLineComments(body)
  body = stripDataUris(body)
  body = stripVarFallbacks(body)
  body = stripTokenDefLines(body)

  const lines = body.split("\n")
  lines.forEach((line, idx) => {
    const lineNo = idx + 1

    // 裸 hex（排除 var( 内部——stripVarFallbacks 已处理 fallback；var(--jx-x) 主引用本就不含 #）
    for (const m of line.matchAll(hexRe)) {
      // 跳过 var(--jx-...) 括号内的值（正则已剥 fallback；但如 var( 后紧跟 # 的异常形态也防一手）
      const before = line.slice(0, m.index)
      if (/var\(\s*--jx-[a-zA-Z0-9-]*\s*,\s*$/.test(before)) continue
      violations.push({ file: rel, line: lineNo, code: line.trim(), kind: "裸 hex" })
    }

    // 裸字号中间值
    for (const m of line.matchAll(fontSizeRe)) {
      const px = parseFloat(m[1])
      if (!ALLOWED_FONT_SIZES.has(px)) {
        violations.push({ file: rel, line: lineNo, code: line.trim(), kind: `字号 ${px}px 非 §10 定义` })
      }
    }
  })
}

for (const t of TARGETS) scanFile(t)

if (violations.length > 0) {
  console.error(`\n❌ 令牌合规检查失败：${violations.length} 处违规\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.kind}]  ${v.code}`)
  }
  console.error(`\n修复指引：主题 CSS/TSX 一律 var(--jx-*) 引用（DESIGN.md §10）；确需新值先扩展 §10。`)
  process.exit(1)
} else {
  console.log(`\n✅ 令牌合规检查通过（${TARGETS.length} 个文件，无裸 hex / 无裸字号中间值）`)
  process.exit(0)
}
