// character-position: 角色拖动位置计算的纯函数模块。
//
// 唯一 seam：clampPosition / isNarrowViewport / loadPosition / savePosition / resolvePosition。
// 无 DOM 依赖、无副作用——localStorage 访问通过传入的 Storage 接口，可在 bun:test 中独立测试。
// ADR-010：角色默认左下、可拖动移动位置、窄屏回默认。

/** 视口尺寸。 */
export type Viewport = { width: number; height: number }

/** 角色（含手柄）整体尺寸。 */
export type BoxSize = { width: number; height: number }

/** 位置（视口左上角为原点的坐标）。 */
export type Position = { x: number; y: number }

/** 窄屏断点（沿用 ADR-007）。 */
export const NARROW_VIEWPORT_WIDTH = 1024

/** localStorage key。 */
export const POSITION_STORAGE_KEY = "jiangxiao.character.position"

/** 位置 clamp 到视口内，保证角色+手柄整体不超出视口。 */
export function clampPosition(pos: Position, viewport: Viewport, size: BoxSize): Position {
  const maxX = Math.max(0, viewport.width - size.width)
  const maxY = Math.max(0, viewport.height - size.height)
  return {
    x: Math.min(Math.max(0, pos.x), maxX),
    y: Math.min(Math.max(0, pos.y), maxY),
  }
}

/** 窄屏判断（沿用 ADR-007 断点 <1024）。 */
export function isNarrowViewport(width: number): boolean {
  return width < NARROW_VIEWPORT_WIDTH
}

/** 读取存储的位置；无存储或解析失败返回 fallback。 */
export function loadPosition(storage: Storage, fallback: Position): Position {
  try {
    const raw = storage.getItem(POSITION_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return { x: parsed.x, y: parsed.y }
    return fallback
  } catch {
    return fallback
  }
}

/** 保存位置到存储；失败静默忽略。 */
export function savePosition(pos: Position, storage: Storage): void {
  try {
    storage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos))
  } catch {}
}

/** 清空存储的位置（重置回默认时使用）；失败静默忽略。 */
export function clearPosition(storage: Storage): void {
  try {
    storage.removeItem(POSITION_STORAGE_KEY)
  } catch {}
}

/** 综合判定最终位置：窄屏回 fallback，否则 clamp 存储位置。fallback 由调用方提供（CSS 默认位置）。 */
export function resolvePosition(stored: Position, fallback: Position, viewport: Viewport, size: BoxSize): Position {
  if (isNarrowViewport(viewport.width)) return fallback
  return clampPosition(stored, viewport, size)
}