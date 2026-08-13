import { describe, expect, test } from "bun:test"
import { ALLOWED_OPEN_APPS, resolveOpenApp } from "./open-app-allowlist"

describe("resolveOpenApp (open-path allowlist gate)", () => {
  test("falls back to shell.openPath when no app is requested", () => {
    expect(resolveOpenApp(undefined)).toEqual({ kind: "shell", app: undefined })
    expect(resolveOpenApp("")).toEqual({ kind: "shell", app: undefined })
  })

  test("approves apps on the allowlist", () => {
    expect(resolveOpenApp("code")).toEqual({ kind: "exec", app: "code" })
    expect(resolveOpenApp("Visual Studio Code")).toEqual({ kind: "exec", app: "Visual Studio Code" })
    expect(resolveOpenApp("cursor")).toEqual({ kind: "exec", app: "cursor" })
  })

  test("rejects arbitrary executables to prevent RCE", () => {
    expect(resolveOpenApp("malware.exe")).toEqual({ kind: "reject", app: "malware.exe" })
    expect(resolveOpenApp("/bin/sh")).toEqual({ kind: "reject", app: "/bin/sh" })
    expect(resolveOpenApp("rm -rf /")).toEqual({ kind: "reject", app: "rm -rf /" })
  })

  test("approves every entry in the allowlist", () => {
    for (const app of ALLOWED_OPEN_APPS) {
      expect(resolveOpenApp(app)).toEqual({ kind: "exec", app })
    }
  })

  test("keeps the allowlist at 16 entries (regression guard)", () => {
    expect(ALLOWED_OPEN_APPS.size).toBe(16)
  })
})
