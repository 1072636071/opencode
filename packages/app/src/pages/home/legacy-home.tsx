import { DialogSelectServer } from "@/components/dialog-select-server"
import { useSettingsCommand } from "@/components/settings-dialog"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { Logo } from "@opencode-ai/ui/logo"
import { useNavigate } from "@solidjs/router"
import { For, Show, Switch, Match, createMemo } from "solid-js"
import { JiangxiaoIcon } from "@/components/jiangxiao-icons"
import { formatSessionTime } from "./time-utils"

export function LegacyHome() {
  const sync = useServerSync()
  const pickDirectory = useDirectoryPicker()
  const dialog = useDialog()
  const navigate = useNavigate()
  const global = useGlobal()
  const server = useServer()
  const tabs = useTabs()
  const language = useLanguage()
  const platform = usePlatform()
  const openSettings = useSettingsCommand()
  const homedir = createMemo(() => sync().data.path.home)
  const serverUnreachable = createMemo(() => global.servers.health[server.key]?.healthy === false)
  const recent = createMemo(() => {
    return sync()
      .data.project.slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })
  const featured = createMemo(() => recent()[0])
  const featuredPath = createMemo(() => {
    const project = featured()
    if (!project) return ""
    const home = homedir()
    if (home && (project.worktree === home || project.worktree.startsWith(`${home}/`)))
      return `~${project.worktree.slice(home.length)}`
    return project.worktree
  })
  const serverDotClass = createMemo(() => {
    const healthy = global.servers.health[server.key]?.healthy
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function openProject(conn: ServerConnection.Any, directory: string) {
    const serverCtx = global.ensureServerCtx(conn)
    serverCtx.projects.open(directory)
    serverCtx.projects.touch(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  function chooseProject() {
    if (serverUnreachable()) return
    const conn = server.current
    if (!conn) return

    const resolve = (result: string | string[] | null) => {
      if (Array.isArray(result)) {
        result.forEach((directory) => openProject(conn, directory))
        return
      }
      if (result) openProject(conn, result)
    }

    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: resolve,
    })
  }

  function newSession() {
    const conn = server.current
    const project = featured()
    if (!conn || !project) return
    void tabs.newDraft({ server: ServerConnection.key(conn), directory: project.worktree })
  }

  return (
    <div class="jx-home-grid">
      <aside class="jx-projects-aside">
        <Show when={featured()}>
          {(project) => (
            <div class="jx-proj-card" data-component="legacy-home-proj-card">
              <span class="jx-proj-avatar">
                <JiangxiaoIcon name="leaf" size={20} />
              </span>
              <span class="jx-proj-meta">
                <span class="jx-proj-name">{project().worktree.split(/[\\/]/).pop() ?? project().worktree}</span>
                <span class="jx-proj-path" title={project().worktree}>{featuredPath()}</span>
              </span>
            </div>
          )}
        </Show>
        <div class="flex h-7 min-w-0 shrink-0 items-center justify-between pl-1.5 pr-3">
          <div class="text-v2-text-text-muted [font-weight:530]">{language.t("home.projects")}</div>
          <Button
            size="normal"
            variant="ghost"
            icon="folder-add-left"
            class="pl-2 pr-3"
            disabled={serverUnreachable()}
            onClick={chooseProject}
          >
            {language.t("command.project.open")}
          </Button>
        </div>
        <ul class="jx-projects-aside-list" data-component="legacy-home-projects">
          <For each={recent()}>
            {(project) => {
              const display = project.worktree.split(/[\\/]/).pop() ?? project.worktree
              const path = (() => {
                const home = homedir()
                if (home && (project.worktree === home || project.worktree.startsWith(`${home}/`)))
                  return `~${project.worktree.slice(home.length)}`
                return project.worktree
              })()
              return (
                <li>
                  <button
                    type="button"
                    class="jx-proj-item"
                    data-component="legacy-home-proj-item"
                    onClick={() => server.current && openProject(server.current, project.worktree)}
                  >
                    <span class="jx-proj-item-label">{display}</span>
                    <span class="jx-sess-time">{formatSessionTime(project.time.updated ?? project.time.created, language.t("time.yesterday"))}</span>
                  </button>
                </li>
              )
            }}
          </For>
        </ul>
        <div class="jx-utility-nav flex">
          <Button
            size="normal"
            variant="ghost"
            class="px-2"
            onClick={() => dialog.show(() => <DialogSelectServer />)}
          >
            <div
              classList={{
                "size-2 rounded-full": true,
                [serverDotClass()]: true,
              }}
            />
            {server.name}
          </Button>
          <button type="button" class="jx-ghost-btn" onClick={openSettings}>
            <Icon name="settings-gear" size="small" />
            <span>{language.t("sidebar.settings")}</span>
          </button>
          <button
            type="button"
            class="jx-ghost-btn"
            onClick={() => platform.openExternal("https://opencode.ai/desktop-feedback")}
          >
            <Icon name="help" size="small" />
            <span>{language.t("sidebar.help")}</span>
          </button>
        </div>
      </aside>
      <main>
        <Logo class="md:w-xl opacity-12" />
        <div class="jx-home-sessions-head">
          <div class="jx-search-wrap">
            <Icon name="magnifying-glass" class="jx-search-icon" />
            <input
              class="jx-search-input"
              placeholder={language.t("home.sessions.search.placeholder") ?? "搜索会话…"}
              disabled
              aria-label={language.t("home.sessions.search.placeholder") ?? "搜索会话"}
            />
          </div>
          <button
            type="button"
            class="jx-gold-btn"
            data-action="home-new-session"
            onClick={newSession}
            disabled={serverUnreachable()}
          >
            <Icon name="plus" />
            {language.t("command.session.new")}
          </button>
        </div>
        <Switch>
          <Match when={recent().length > 0}>
            <div class="jx-sessions-body" data-component="legacy-home-sessions">
              <For each={recent()}>
                {(project) => {
                  const display = project.worktree.split(/[\\/]/).pop() ?? project.worktree
                  const path = (() => {
                    const home = homedir()
                    if (home && (project.worktree === home || project.worktree.startsWith(`${home}/`)))
                      return `~${project.worktree.slice(home.length)}`
                    return project.worktree
                  })()
                  return (
                    <button
                      type="button"
                      class="jx-sess-row"
                      data-component="legacy-home-sess-row"
                      onClick={() => server.current && openProject(server.current, project.worktree)}
                    >
                      <span class="jx-sess-avatar">
                        <JiangxiaoIcon name="leaf" size={13} />
                      </span>
                      <span class="jx-sess-text">
                        <span class="jx-sess-title">{display}</span>
                        <span class="jx-sess-snip">{path}</span>
                      </span>
                      <span class="jx-sess-time">{formatSessionTime(project.time.updated ?? project.time.created, language.t("time.yesterday"))}</span>
                    </button>
                  )
                }}
              </For>
            </div>
          </Match>
          <Match when={!sync().ready}>
            <div class="mt-30 mx-auto flex flex-col items-center gap-3">
              <div class="text-12-regular text-text-weak">{language.t("common.loading")}</div>
              <Button class="px-3" disabled={serverUnreachable()} onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
          </Match>
          <Match when={true}>
            <div class="mt-30 mx-auto flex flex-col items-center gap-3">
              <Icon name="folder-add-left" size="large" />
              <div class="flex flex-col gap-1 items-center justify-center">
                <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
                <div class="text-12-regular text-text-weak">{language.t("home.empty.description")}</div>
              </div>
              <Button class="px-3 mt-1" disabled={serverUnreachable()} onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
          </Match>
        </Switch>
      </main>
    </div>
  )
}