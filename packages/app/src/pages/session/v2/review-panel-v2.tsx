import { createMemo, createResource, For, Show, type JSX } from "solid-js"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { normalize, type ViewDiff } from "@opencode-ai/session-ui/session-diff"
import type { SessionReviewFocus } from "@opencode-ai/session-ui/session-review"
import { JiangxiaoIcon } from "@/components/jiangxiao-icons"
import { useLanguage } from "@/context/language"

import {
  filterRenderableDiff,
  filterReviewFiles,
  reviewDiffNeedsLoad,
  type RenderDiff,
} from "@/pages/session/v2/review-diff-kinds"
import type { ReviewPanelV2State } from "@/pages/session/v2/review-panel-v2-state"
import { highlightDiffRows } from "@/pages/session/v2/review-diff-highlight"

type ReviewDiff = FileDiffInfo | SnapshotFileDiff | VcsFileDiff

export type ReviewPanelV2Props = {
  title?: JSX.Element
  empty?: JSX.Element
  diffs: () => ReviewDiff[]
  diffsReady: () => boolean
  diffVersion?: number
  loadDiff?: (path: string, version?: number) => Promise<RenderDiff | undefined>
  activeFile?: string
  onSelectFile: (path: string) => void
  onCollapse: () => void
  state: ReviewPanelV2State
  focusedComment?: SessionReviewFocus | null
}

/**
 * dl 行块（基准 `.dl.add / .dl.del / .dl.ctx`）：
 * 行号 + 符号 + 代码三列，样式见 jiangxiao.css 工单 09 段。
 * 数据由上游 normalize() 解析真实 patch 得到（复用上游数据解析，只换视觉）。
 */
export type ReviewDlRow = {
  kind: "add" | "del" | "ctx"
  oldNo: string
  newNo: string
  sign: string
  code: string
}

export function diffToDlRows(view: ViewDiff): ReviewDlRow[] {
  const rows: ReviewDlRow[] = []
  const fileDiff = view.fileDiff
  for (const hunk of fileDiff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let i = 0; i < content.lines; i++) {
          const oldNo = hunk.deletionStart + content.deletionLineIndex - hunk.deletionLineIndex + i
          const newNo = hunk.additionStart + content.additionLineIndex - hunk.additionLineIndex + i
          rows.push({
            kind: "ctx",
            oldNo: String(oldNo),
            newNo: String(newNo),
            sign: " ",
            code: fileDiff.deletionLines[content.deletionLineIndex + i] ?? "",
          })
        }
        continue
      }
      for (let i = 0; i < content.deletions; i++) {
        const oldNo = hunk.deletionStart + content.deletionLineIndex - hunk.deletionLineIndex + i
        rows.push({
          kind: "del",
          oldNo: String(oldNo),
          newNo: "",
          sign: "-",
          code: fileDiff.deletionLines[content.deletionLineIndex + i] ?? "",
        })
      }
      for (let i = 0; i < content.additions; i++) {
        const newNo = hunk.additionStart + content.additionLineIndex - hunk.additionLineIndex + i
        rows.push({
          kind: "add",
          oldNo: "",
          newNo: String(newNo),
          sign: "+",
          code: fileDiff.additionLines[content.additionLineIndex + i] ?? "",
        })
      }
    }
  }
  return rows
}

export function ReviewPanelV2(props: ReviewPanelV2Props) {
  const language = useLanguage()


  const diffs = createMemo(() => props.diffs().filter(filterRenderableDiff))
  const filteredFiles = createMemo(() =>
    filterReviewFiles(
      diffs().map((diff) => diff.file),
      props.state.filter(),
    ),
  )
  const activeDiff = createMemo(() => {
    // A focused comment takes over the preview until the preview applies it and
    // clears the focus; the owner then persists the file as the active selection.
    const focus = props.focusedComment
    if (focus && diffs().some((diff) => diff.file === focus.file)) return focus.file
    const active = props.activeFile
    const files = filteredFiles()
    if (active && files.includes(active)) return active
    return files[0]
  })
  const sourceActiveItem = createMemo(() => diffs().find((diff) => diff.file === activeDiff()))
  const detailSource = createMemo(() => {
    const diff = sourceActiveItem()
    const load = props.loadDiff
    if (!diff || !load || !reviewDiffNeedsLoad(diff)) return
    return { diff, load, version: props.diffVersion }
  })
  const [loadedDiff] = createResource(detailSource, async ({ diff, load, version }) => {
    const value = await load(diff.file, version)
    if (value?.file !== diff.file) return
    return { source: diff, version, value }
  })

  const activeItem = createMemo(() => {
    const source = sourceActiveItem()
    if (loadedDiff.state !== "ready") return source
    const loaded = loadedDiff()
    if (loaded && loaded.source === source && loaded.version === props.diffVersion) return loaded.value
    return source
  })

  const view = createMemo(() => {
    const item = activeItem()
    if (!item) return undefined
    return normalize(item)
  })
  const dlRows = createMemo(() => {
    const value = view()
    if (!value) return []
    return diffToDlRows(value)
  })

  // 异步语法高亮（工单 10）：整段高亮 add/del 后按行拆分，ctx 行不高亮。
  // key 用文件 + 行数快照，避免同文件切换时命中旧缓存；高亮未就绪前 fallback 纯文本。
  const highlightSource = createMemo(() => {
    const value = view()
    if (!value) return undefined
    return { value, rows: dlRows() }
  })
  const [highlighted] = createResource(highlightSource, async ({ value, rows }) => {
    if (!rows.length) return undefined
    // ReviewDlRow 为 HighlightRow 的结构超集（多 oldNo/newNo/sign 字段），可直接赋值。
    return highlightDiffRows(rows, value)
  })
  const activeLoading = createMemo(() => {
    const source = sourceActiveItem()
    if (!source || !props.loadDiff || !reviewDiffNeedsLoad(source)) return false
    return loadedDiff.state !== "ready"
  })

  const collapsePanel = () => props.onCollapse()

  return (
    <aside data-component="review-panel" class="h-full min-h-0">
      <div class="rv-head">
        <span class="rv-t">
          <JiangxiaoIcon name="eye" size={16} />
          <Show when={props.title}>
            <span class="rv-title">{props.title}</span>
          </Show>
        </span>
        <button
          id="btn-rv-close"
          type="button"
          title={language.t("session.review.collapse")}
          aria-label={language.t("session.review.collapse.ariaLabel")}
          onClick={collapsePanel}
        >
          <JiangxiaoIcon name="x" size={13} />
        </button>
      </div>

      <div class="rv-files" data-component="file-tree-v2">
        <Show
          when={props.diffsReady()}
          fallback={
            <div class="rv-placeholder">
              {language.t("common.loading")}
              {language.t("common.loading.ellipsis")}
            </div>
          }
        >
          <Show when={filteredFiles().length > 0} fallback={<div class="rv-placeholder">{props.empty}</div>}>
            <For each={filteredFiles()}>
              {(file) => {
                const diff = diffs().find((item) => item.file === file)
                return (
                  <button
                    type="button"
                    class="ft-row"
                    classList={{ on: file === activeDiff() }}
                    onClick={() => props.onSelectFile(file)}
                  >
                    <JiangxiaoIcon name="file" size={13} />
                    <span class="nm">{file}</span>
                    <span class="dc-add">+{diff?.additions ?? 0}</span>
                    <span class="dc-del">-{diff?.deletions ?? 0}</span>
                  </button>
                )
              }}
            </For>
          </Show>
        </Show>
      </div>

      <div class="rv-diff">
        <Show when={activeDiff() && filteredFiles().length > 0} fallback={<div class="rv-placeholder">{props.empty}</div>}>
          <Show when={!activeLoading()} fallback={<div class="rv-placeholder">{language.t("common.loading")}{language.t("common.loading.ellipsis")}</div>}>
            <Show when={dlRows().length > 0} fallback={<div class="rv-placeholder">{language.t("ui.fileMedia.binary.title")}</div>}>
              <For each={dlRows()}>
                {(row, index) => {
                  const hit = () => {
                    const rows = highlighted()
                    return rows?.[index()]?.html
                  }
                  return (
                    <div classList={{ dl: true, [row.kind]: true }}>
                      <span class="no">{row.oldNo}</span>
                      <span class="no">{row.newNo}</span>
                      <span class="sg">{row.sign}</span>
                      {/* 高亮 token 已就绪时用 innerHTML 渲染（shiki 输出安全）；否则纯文本 */}
                      <Show when={hit()} fallback={<span class="code">{row.code}</span>}>
                        {(html) => <span class="code" innerHTML={html()} />}
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </aside>
  )
}
