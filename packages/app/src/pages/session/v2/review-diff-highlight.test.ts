import { describe, expect, test } from "bun:test"
import { normalize } from "@opencode-ai/session-ui/session-diff"
import { diffToDlRows } from "./review-panel-v2"
import { highlightDiffRows, inferLanguageFromPath } from "./review-diff-highlight"

// 直接从 before/after 生成 diff（等价于完整 patch 的解析结果）
function makeView(beforeLines: string[], afterLines: string[]) {
  const before = beforeLines.join("\n") + "\n"
  const after = afterLines.join("\n") + "\n"
  return normalize({
    file: "src/foo.ts",
    additions: 2,
    deletions: 1,
    before,
    after,
  })
}

describe("inferLanguageFromPath", () => {
  test("常见扩展名映射", () => {
    expect(inferLanguageFromPath("a/b.ts")).toBe("typescript")
    expect(inferLanguageFromPath("a/b.tsx")).toBe("tsx")
    expect(inferLanguageFromPath("a/b.py")).toBe("python")
    expect(inferLanguageFromPath("a/go.mod")).toBe("go")
    expect(inferLanguageFromPath("a/README.md")).toBe("markdown")
  })

  test("未知扩展名回退 text", () => {
    expect(inferLanguageFromPath("a/file.unknown")).toBe("text")
  })
})

describe("highlightDiffRows 行映射", () => {
  test("add/del 行各得一个 html，ctx 行不设", async () => {
    const view = makeView(["line1", "deleted line"], ["line1", "added line"])
    const rows = diffToDlRows(view)
    expect(rows.map((r) => r.kind)).toEqual(["ctx", "del", "add"])

    const highlighted = await highlightDiffRows(rows, view)
    expect(highlighted).toHaveLength(3)
    // ctx 行无 html
    expect(highlighted[0]?.html).toBeUndefined()
    // del 行有 html（shiki 输出 <span class="line"> 内含 token）
    expect(highlighted[1]?.html).toBeDefined()
    expect(highlighted[2]?.html).toBeDefined()
  })

  test("多行 add 组内行数与高亮行数一致", async () => {
    const view = makeView(["line1"], ["line1", "// block comment", "const a = 1", "const b = 2"])
    const rows = diffToDlRows(view)
    const highlighted = await highlightDiffRows(rows, view)
    const addRows = rows.filter((r) => r.kind === "add")
    const addHits = highlighted?.filter((h) => h?.row.kind === "add") ?? []
    expect(addRows).toHaveLength(3)
    expect(addHits).toHaveLength(3)
    for (const hit of addHits) expect(hit?.html).toBeDefined()
  })

  test("相邻同 kind 分组：del 组与 add 组交错", async () => {
    const view = makeView(
      ["line1", "old a", "old b", "line7"],
      ["line1", "new a", "new b", "new c", "line7"],
    )
    const rows = diffToDlRows(view)
    const highlighted = await highlightDiffRows(rows, view)
    const delHits = highlighted?.filter((h) => h?.row.kind === "del") ?? []
    const addHits = highlighted?.filter((h) => h?.row.kind === "add") ?? []
    expect(rows.filter((r) => r.kind === "del")).toHaveLength(2)
    expect(rows.filter((r) => r.kind === "add")).toHaveLength(3)
    expect(delHits).toHaveLength(2)
    expect(addHits).toHaveLength(3)
    for (const hit of delHits) expect(hit?.html).toBeDefined()
    for (const hit of addHits) expect(hit?.html).toBeDefined()
  })
})

describe("highlightDiffRows XSS 转义", () => {
  // shiki 会对代码做 HTML 转义，注入脚本/标签不得以原始形式出现在输出 HTML 中。
  // shiki 把 `<` 转义为数值实体 `&#x3C;`（等价于 `&lt;`），把 `>` 转义为 `&#x3E;`。
  // 核心保证：输出 html 中绝不出现原始标签/属性（无 `<script` / `<img` / `onerror=`），
  // 且存在转义实体（`&#x3C;` 代表 `<` 已落地）。
  test("add 行含 <script> 标签时被转义", async () => {
    const view = makeView(["line1"], ["line1", "<script>alert(1)</script>"])
    const rows = diffToDlRows(view)
    const highlighted = await highlightDiffRows(rows, view)
    const addHit = highlighted?.find((h) => h?.row.kind === "add")
    expect(addHit?.html).toBeDefined()
    const html = addHit?.html ?? ""
    // 原始标签绝不得出现（无论是否被行内 token span 包裹）
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toContain("</script>")
    // `<` 已被转义为实体 `&#x3C;`
    expect(html).toContain("&#x3C;")
  })

  test("add 行含 <img onerror=...> 时被转义", async () => {
    const view = makeView(["line1"], ["line1", '<img src=x onerror="alert(1)">'])
    const rows = diffToDlRows(view)
    const highlighted = await highlightDiffRows(rows, view)
    const addHit = highlighted?.find((h) => h?.row.kind === "add")
    expect(addHit?.html).toBeDefined()
    const html = addHit?.html ?? ""
    // 原始 `<img` / `onerror=` 属性绝不得出现
    expect(html).not.toMatch(/<img/i)
    expect(html).not.toContain("onerror=")
    // `<` 已被转义为实体 `&#x3C;`
    expect(html).toContain("&#x3C;")
  })
})
