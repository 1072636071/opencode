import { DateTime } from "luxon"

/**
 * 最近时间格式化：今天显示 HH:mm，昨天显示 yesterdayLabel，更早显示 MM-dd。
 * home-sessions-view（会话时间）与 legacy-home（项目时间）共享同一逻辑。
 * yesterdayLabel 为必填参数，调用方传入 i18n key。
 */
export function formatSessionTime(ms: number, yesterdayLabel: string): string {
  const dt = DateTime.fromMillis(ms)
  const now = DateTime.local()
  if (dt.hasSame(now, "day")) return dt.toFormat("HH:mm")
  const yesterday = now.minus({ days: 1 })
  if (dt.hasSame(yesterday, "day")) return yesterdayLabel
  return dt.toFormat("MM-dd")
}
