import { createEffect, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { createMediaQuery } from "@solid-primitives/media"
import { JiangxiaoCharacterSidebar } from "@/components/jiangxiao-character-sidebar"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const [state, setState] = createStore({ debugTools: true })
  // 桌面端媒体查询仅用于主内容区避让 padding；角色悬浮窗全断点常驻（ADR-007：窄屏缩小不隐藏）
  const isDesktop = createMediaQuery("(min-width: 768px)")

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <main
        class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict"
        style={{ "padding-inline-start": isDesktop() ? "72px" : "0px" }}
      >
        <Suspense>{props.children}</Suspense>
      </main>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
      {/* 姜晓角色透明悬浮窗（ADR-007：fixed 左下、透明无底、全页面常驻、窄屏缩小不隐藏；z-index:40 低于 dialog/toast） */}
      <JiangxiaoCharacterSidebar />
    </div>
  )
}
