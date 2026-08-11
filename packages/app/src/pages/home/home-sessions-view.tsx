import type { Session } from "@opencode-ai/sdk/v2/client"
import { type Accessor, createMemo, For, Show, Suspense } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { useLanguage } from "@/context/language"
import type { ServerConnection } from "@/context/server"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { shouldOpenSessionInBackground } from "../home-session-open"

import {
  homeSessionSearchKey,
  type HomeSessionGroup,
  type HomeSessionRecord,
  type OpenSessionOptions,
} from "./home-sessions-controller"
import { JiangxiaoIcon } from "@/components/jiangxiao-icons"
import { formatSessionTime } from "./time-utils"

const HOME_SESSION_SEARCH_RESULTS_ID = "home-session-search-results"

// Middle-click or Cmd+click on macOS (Ctrl+click elsewhere) opens a session
// tab in the background without navigating, matching browser conventions.
function isBackgroundOpen(event: MouseEvent) {
  return shouldOpenSessionInBackground({
    button: event.button,
    mac: typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
}

export type HomeSessionsViewProps = {
  language: ReturnType<typeof useLanguage>
  groups: Accessor<HomeSessionGroup[]>
  showProjectName: Accessor<boolean>
  canCreateSession: Accessor<boolean>
  server: Accessor<ServerConnection.Key>
  searchValue: Accessor<string>
  searchPlaceholder: Accessor<string>
  searchOpen: Accessor<boolean>
  searchLoading: Accessor<boolean>
  searchResults: Accessor<HomeSessionRecord[]>
  searchActive: Accessor<string>
  searchNoResultsLabel: Accessor<string>
  isOpenTab: (record: HomeSessionRecord) => boolean
  onCreateSession: () => void
  onOpenSession: (session: Session, options?: OpenSessionOptions) => void
  onArchiveSession: (session: Session) => Promise<void>
  onSetSearchRoot: (element: HTMLDivElement) => void
  onSetSearchInput: (element: HTMLInputElement) => void
  onSetSearchList: (element: HTMLDivElement) => void
  onSearchFocus: () => void
  onSearchInput: (value: string) => void
  onSearchClose: () => void
  onSearchMove: (delta: number) => void
  onSearchSelectActive: () => void
  onSearchHighlight: (record: HomeSessionRecord) => void
  onSearchSelect: (record: HomeSessionRecord, options?: OpenSessionOptions) => void
}

// Inline 唐风线描 leaf SVG (matches preview i-leaf symbol).


export function HomeSessionsView(props: HomeSessionsViewProps) {
  // 工单 08：扁平会话列表（去掉 group header），按 preview 单列展示。
  const flatSessions = createMemo(() => props.groups().flatMap((group) => group.sessions))
  // 当前会话：已打开的 tab 优先；否则取最近一条（保证 preview「首行 busy」视觉）。
  const activeId = createMemo(() => {
    const list = flatSessions()
    const open = list.find((record) => props.isOpenTab(record))
    if (open) return open.session.id
    return list[0]?.session.id
  })
  const isActive = (record: HomeSessionRecord) => record.session.id === activeId()

  return (
    <section class="jx-sessions-body" aria-label={props.language.t("sidebar.project.recentSessions")}>
      <div class="jx-home-sessions-head">
        <HomeSessionSearch {...props} />
        <Show when={props.canCreateSession()}>
          <button
            type="button"
            class="jx-gold-btn"
            data-action="home-new-session"
            onClick={props.onCreateSession}
          >
            <Icon name="plus" />
            {props.language.t("command.session.new")}
          </button>
        </Show>
      </div>
      <Suspense
        fallback={
          <div class="pt-3">
            <HomeSessionSkeleton label={props.language.t("common.loading")} />
          </div>
        }
      >
        <Show
          when={flatSessions().length > 0}
          fallback={
            <HomeSessionsEmpty
              onNewSession={props.canCreateSession() ? props.onCreateSession : undefined}
              language={props.language}
            />
          }
        >
          <For each={flatSessions()}>
            {(record) => (
              <HomeSessionRow
                {...props}
                record={record}
                active={isActive(record)}
              />
            )}
          </For>
        </Show>
      </Suspense>
    </section>
  )
}

function HomeSessionSearch(props: HomeSessionsViewProps) {
  return (
    <div class="jx-search-wrap" ref={props.onSetSearchRoot} data-component="home-session-search">
      <Show when={props.searchOpen()}>
        <div
          data-component="home-session-search-panel"
          class="jx-search-dropdown absolute z-30 flex flex-col overflow-hidden rounded-[12px] shadow-[var(--v2-elevation-floating)]"
          style={{ top: "-6px", left: "-6px", width: "calc(100% + 12px)" }}
        >
          <div class="flex flex-col pt-9">
            <div id={HOME_SESSION_SEARCH_RESULTS_ID} role="listbox" class="flex flex-col gap-4 pt-4">
              <Show
                when={!props.searchLoading()}
                fallback={
                  <div class="flex items-center justify-center px-4 py-3 text-v2-text-text-muted [font-weight:440]">
                    <Spinner class="size-4" />
                  </div>
                }
              >
                <Show
                  when={props.searchResults().length > 0}
                  fallback={
                    <p class="my-1.5 px-4 pb-2 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]">
                      {props.searchNoResultsLabel()}
                    </p>
                  }
                >
                  <div class="flex flex-col">
                    <p class="my-1.5 pl-[18px] pr-6 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]">
                      {props.language.t("home.sessions.search.sessions")}
                    </p>
                    <ScrollView class="max-h-80" viewportRef={props.onSetSearchList}>
                      <div class="flex flex-col gap-px pb-2">
                        <For each={props.searchResults()}>
                          {(record) => (
                            <HomeSessionSearchResultRow
                              {...props}
                              record={record}
                              selected={props.searchActive() === homeSessionSearchKey(record)}
                            />
                          )}
                        </For>
                      </div>
                    </ScrollView>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </Show>
      <label class="relative z-20 block">
        <Icon name="magnifying-glass" class="jx-search-icon" />
        <input
          ref={props.onSetSearchInput}
          class="jx-search-input"
          value={props.searchValue()}
          placeholder={props.searchPlaceholder()}
          aria-label={props.searchPlaceholder()}
          aria-expanded={props.searchOpen()}
          aria-controls={HOME_SESSION_SEARCH_RESULTS_ID}
          aria-autocomplete="list"
          aria-activedescendant={
            props.searchActive() && props.searchOpen()
              ? `home-session-search-option-${props.searchActive()}`
              : undefined
          }
          onFocus={props.onSearchFocus}
          onInput={(event) => props.onSearchInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              props.onSearchClose()
              event.currentTarget.blur()
              return
            }
            if (!props.searchOpen() || props.searchResults().length === 0) return
            if (event.altKey || event.metaKey) return
            if (event.key === "ArrowDown") {
              event.preventDefault()
              props.onSearchMove(1)
              return
            }
            if (event.key === "ArrowUp") {
              event.preventDefault()
              props.onSearchMove(-1)
              return
            }
            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault()
              props.onSearchSelectActive()
            }
          }}
        />
        <Show when={props.searchValue()}>
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="small"
            class="absolute top-1/2 right-1 z-20 -translate-y-1/2"
            icon={<Icon name="close" size="large" class="text-v2-icon-icon-muted" />}
            aria-label={props.searchPlaceholder()}
            onClick={() => {
              props.onSearchClose()
              props.onSearchFocus()
            }}
          />
        </Show>
      </label>
    </div>
  )
}

function HomeSessionSearchResultRow(
  props: HomeSessionsViewProps & {
    record: HomeSessionRecord
    selected: boolean
  },
) {
  const title = () => props.record.session.title || props.record.session.id
  const showProjectName = () => props.showProjectName() && props.record.projectName
  const key = () => homeSessionSearchKey(props.record)

  return (
    <button
      type="button"
      id={`home-session-search-option-${key()}`}
      data-key={key()}
      data-component="home-session-search-row"
      role="option"
      aria-selected={props.selected}
      class="flex h-10 w-full shrink-0 cursor-default items-center gap-2 border-0 py-3 pl-[18px] pr-6 text-left transition-[background-color] duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
      classList={{
        "bg-v2-overlay-simple-overlay-hover": props.selected,
        group: !!showProjectName(),
      }}
      onMouseEnter={() => props.onSearchHighlight(props.record)}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
      onClick={(event) => props.onSearchSelect(props.record, { background: isBackgroundOpen(event) })}
      onAuxClick={(event) => {
        if (!isBackgroundOpen(event)) return
        event.preventDefault()
        props.onSearchSelect(props.record, { background: true })
      }}
    >
      <span class="jx-sess-avatar">
        <JiangxiaoIcon name="leaf" size={13} />
      </span>
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <span class="jx-sess-title text-[13px] leading-4 tracking-[-0.04px]">{title()}</span>
        <Show when={showProjectName()}>
          <span class="jx-sess-snip text-[13px] leading-4 tracking-[-0.04px]">{props.record.projectName}</span>
        </Show>
      </div>
    </button>
  )
}

function HomeSessionRow(props: HomeSessionsViewProps & { record: HomeSessionRecord; active: boolean }) {
  const title = () => props.record.session.title || props.record.session.id
  const time = createMemo(() =>
    formatSessionTime(
      props.record.session.time.updated ?? props.record.session.time.created,
      props.language.t("time.yesterday"),
    ),
  )
  const snip = () => props.record.projectName
  const avatar = useSessionTabAvatarState(
    props.server,
    () => props.record.session.directory,
    () => props.record.session.id,
  )

  return (
    <button
      type="button"
      data-component="home-session-row"
      class="jx-sess-row"
      classList={{ on: props.active }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
      onClick={(event) => props.onOpenSession(props.record.session, { background: isBackgroundOpen(event) })}
      onAuxClick={(event) => {
        if (!isBackgroundOpen(event)) return
        event.preventDefault()
        props.onOpenSession(props.record.session, { background: true })
      }}
    >
      <Show
        when={avatar.loading()}
        fallback={
          <span class="jx-sess-avatar">
            <JiangxiaoIcon name="leaf" size={13} />
          </span>
        }
      >
        <span class="jx-busy-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </Show>
      <span class="jx-sess-text">
        <span class="jx-sess-title">{title()}</span>
        <Show when={snip()}>
          <span class="jx-sess-snip">{snip()}</span>
        </Show>
      </span>
      <span class="jx-sess-time">{time()}</span>
    </button>
  )
}

function HomeSessionsEmpty(props: { onNewSession?: () => void; language: ReturnType<typeof useLanguage> }) {
  return (
    <div class="flex flex-1 flex-col items-center gap-4 px-6 pt-[52px] text-center">
      <div class="shrink-0 text-[13px] leading-[13px] tracking-[-0.04px] text-v2-text-text-base [font-weight:530]">
        {props.language.t("home.sessions.empty")}
      </div>
      <p class="mb-1 text-center text-[13px] leading-5 tracking-[-0.04px] text-v2-text-text-muted [font-weight:440]">
        {props.language.t("home.sessions.empty.description")}
      </p>
      <Show when={props.onNewSession}>
        {(onNewSession) => (
          <button type="button" class="jx-gold-btn" data-action="home-new-session" onClick={onNewSession()}>
            <Icon name="plus" />
            {props.language.t("command.session.new")}
          </button>
        )}
      </Show>
    </div>
  )
}

function HomeSessionSkeleton(props: { label: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-4">
      <div class="flex h-7 min-w-0 items-center justify-between px-4">
        <div class="text-v2-text-text-muted [font-weight:440]">{props.label}</div>
      </div>
      <div class="flex min-w-0 flex-col gap-px" aria-hidden="true">
        <For each={[0, 1, 2, 3]}>{() => <div class="h-10 rounded-[6px] bg-v2-background-bg-deep opacity-70" />}</For>
      </div>
    </div>
  )
}