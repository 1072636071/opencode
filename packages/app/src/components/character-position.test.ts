import { beforeEach, describe, expect, test } from "bun:test"
import {
  POSITION_STORAGE_KEY,
  clampPosition,
  clearPosition,
  isNarrowViewport,
  loadPosition,
  resolvePosition,
  savePosition,
  type BoxSize,
  type Position,
  type Viewport,
} from "./character-position"

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  throwOn = {
    getItem: false,
    setItem: false,
    removeItem: false,
  }
  clear() {
    this.values.clear()
  }
  get length() {
    return this.values.size
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }
  getItem(key: string) {
    if (this.throwOn.getItem) throw new Error("getItem denied")
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.throwOn.setItem) throw new Error("setItem denied")
    this.values.set(key, value)
  }
  removeItem(key: string) {
    if (this.throwOn.removeItem) throw new Error("removeItem denied")
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()
const viewport: Viewport = { width: 1920, height: 1080 }
const size: BoxSize = { width: 200, height: 400 }
const fallback: Position = { x: 10, y: 670 }

beforeEach(() => storage.clear())

describe("clampPosition", () => {
  test("position already inside is unchanged", () => {
    expect(clampPosition({ x: 100, y: 200 }, viewport, size)).toEqual({ x: 100, y: 200 })
  })
  test("clamps left overflow to 0", () => {
    expect(clampPosition({ x: -50, y: 200 }, viewport, size)).toEqual({ x: 0, y: 200 })
  })
  test("clamps top overflow to 0", () => {
    expect(clampPosition({ x: 100, y: -30 }, viewport, size)).toEqual({ x: 100, y: 0 })
  })
  test("clamps right overflow to max", () => {
    expect(clampPosition({ x: 2000, y: 200 }, viewport, size)).toEqual({ x: 1720, y: 200 })
  })
  test("clamps bottom overflow to max", () => {
    expect(clampPosition({ x: 100, y: 2000 }, viewport, size)).toEqual({ x: 100, y: 680 })
  })
  test("character larger than viewport pins to origin", () => {
    const big: BoxSize = { width: 3000, height: 5000 }
    expect(clampPosition({ x: 999, y: 999 }, viewport, big)).toEqual({ x: 0, y: 0 })
  })
})

describe("isNarrowViewport", () => {
  test("1023 is narrow", () => {
    expect(isNarrowViewport(1023)).toBe(true)
  })
  test("1024 is not narrow", () => {
    expect(isNarrowViewport(1024)).toBe(false)
  })
  test("0 is narrow", () => {
    expect(isNarrowViewport(0)).toBe(true)
  })
  test("2000 is not narrow", () => {
    expect(isNarrowViewport(2000)).toBe(false)
  })
})

describe("loadPosition / savePosition", () => {
  test("save then load returns the same value", () => {
    savePosition({ x: 300, y: 500 }, storage)
    expect(loadPosition(storage, fallback)).toEqual({ x: 300, y: 500 })
  })
  test("no stored value returns fallback", () => {
    expect(loadPosition(storage, fallback)).toEqual(fallback)
  })
  test("corrupted data returns fallback", () => {
    storage.setItem(POSITION_STORAGE_KEY, "not-json")
    expect(loadPosition(storage, fallback)).toEqual(fallback)
  })
  test("partial data returns fallback", () => {
    storage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ x: 100 }))
    expect(loadPosition(storage, fallback)).toEqual(fallback)
  })
  test("getItem throwing returns fallback", () => {
    storage.throwOn.getItem = true
    expect(loadPosition(storage, fallback)).toEqual(fallback)
  })
  test("setItem throwing is silently ignored", () => {
    storage.throwOn.setItem = true
    expect(() => savePosition({ x: 1, y: 2 }, storage)).not.toThrow()
    expect(loadPosition(storage, fallback)).toEqual(fallback)
  })
  test("clearPosition removes stored value so load returns fallback", () => {
    savePosition({ x: 300, y: 500 }, storage)
    clearPosition(storage)
    expect(loadPosition(storage, fallback)).toEqual(fallback)
  })
  test("removeItem throwing is silently ignored", () => {
    storage.throwOn.removeItem = true
    expect(() => clearPosition(storage)).not.toThrow()
  })
})

describe("resolvePosition", () => {
  test("narrow viewport ignores stored and returns fallback", () => {
    const narrow: Viewport = { width: 800, height: 600 }
    expect(resolvePosition({ x: 300, y: 500 }, fallback, narrow, size)).toEqual(fallback)
  })
  test("wide viewport with in-bounds stored returns stored", () => {
    expect(resolvePosition({ x: 100, y: 200 }, fallback, viewport, size)).toEqual({ x: 100, y: 200 })
  })
  test("wide viewport with out-of-bounds stored clamps", () => {
    expect(resolvePosition({ x: 5000, y: 5000 }, fallback, viewport, size)).toEqual({ x: 1720, y: 680 })
  })
  test("wide viewport with fallback stored returns fallback", () => {
    expect(resolvePosition(fallback, fallback, viewport, size)).toEqual(fallback)
  })
})