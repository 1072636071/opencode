import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import jiangxiaoThemeJson from "./themes/jiangxiao.json"
import { DEFAULT_THEMES } from "./default-themes"
import { normalize } from "./context"

describe("jiangxiao theme", () => {
  test("light variant carries meihua palette key colors", () => {
    const light = jiangxiaoThemeJson.light
    expect(light.palette.primary).toBe("#b24a5c")
    expect(light.palette.accent).toBe("#d97a8e")
  })

  test("dark variant retains black-gold primary", () => {
    expect(jiangxiaoThemeJson.dark.palette.primary).toBe("#d6b34a")
  })

  test("both variants have palette/overrides/v2Overrides sections", () => {
    for (const variant of [jiangxiaoThemeJson.light, jiangxiaoThemeJson.dark]) {
      expect(variant.palette).toBeTruthy()
      expect(variant.overrides).toBeTruthy()
      expect(variant.v2Overrides).toBeTruthy()
    }
  })
})

describe("meihua theme removal", () => {
  test("meihua.json file no longer exists", () => {
    const meihuaPath = resolve(import.meta.dirname, "themes", "meihua.json")
    expect(existsSync(meihuaPath)).toBe(false)
  })

  test("DEFAULT_THEMES has no meihua key", () => {
    expect("meihua" in DEFAULT_THEMES).toBe(false)
  })
})

describe("theme id migration", () => {
  test("normalize maps meihua to jiangxiao", () => {
    expect(normalize("meihua")).toBe("jiangxiao")
  })

  test("normalize still maps oc-1 to oc-2", () => {
    expect(normalize("oc-1")).toBe("oc-2")
  })
})
