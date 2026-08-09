import { describe, expect, test } from "bun:test"
import { filterHiddenCommands } from "./filter-hidden-commands"

type Cmd = { type: "custom" | "builtin"; trigger: string; title?: string }

const custom = (trigger: string): Cmd => ({ type: "custom", trigger })
const builtin = (trigger: string): Cmd => ({ type: "builtin", trigger })

describe("filterHiddenCommands", () => {
  test("returns the list unchanged when the hidden set is empty", () => {
    const commands = [custom("skill-a"), builtin("clear")]
    expect(filterHiddenCommands(commands, [])).toBe(commands)
  })

  test("removes custom commands whose trigger is in the hidden set", () => {
    const commands = [custom("skill-a"), custom("skill-b"), builtin("clear")]
    expect(filterHiddenCommands(commands, ["skill-a"])).toEqual([custom("skill-b"), builtin("clear")])
  })

  test("removes every matching custom command and keeps the rest", () => {
    const commands = [custom("skill-a"), custom("skill-b"), custom("skill-c"), builtin("compact")]
    expect(filterHiddenCommands(commands, ["skill-a", "skill-c"])).toEqual([custom("skill-b"), builtin("compact")])
  })

  test("leaves builtin commands untouched even when their trigger matches the hidden set", () => {
    const commands = [builtin("clear"), custom("clear")]
    expect(filterHiddenCommands(commands, ["clear"])).toEqual([builtin("clear")])
  })

  test("ignores hidden names that do not match any command", () => {
    const commands = [custom("skill-a")]
    expect(filterHiddenCommands(commands, ["does-not-exist"])).toEqual([custom("skill-a")])
  })

  test("returns an empty list when given an empty list", () => {
    expect(filterHiddenCommands<Cmd>([], ["skill-a"])).toEqual([])
  })
})