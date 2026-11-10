import type { LocalDate } from "@/features/habits/domain/dates"
import type { Nudge, SentNudge } from "./motivation"

/**
 * The in-app inbox (E7, PRD §5.3 «graceful fallback to in-app notifications»). It is also the log
 * of what was delivered on this device, which the Motivation Engine reads to respect the daily cap,
 * the gap and «at most once per key». Dismissing hides an item but keeps it in the log.
 */
export interface InboxItem extends SentNudge {
  title: string
  body: string
  read: boolean
  dismissed: boolean
}

export const INBOX_MAX = 50

export function deliver(items: readonly InboxItem[], nudges: readonly Nudge[], now: { localDate: LocalDate; minutes: number; at: string }): InboxItem[] {
  const known = new Set(items.map((i) => i.key))
  const fresh = nudges.filter((n) => !known.has(n.key))
  if (fresh.length === 0) return items as InboxItem[]
  const added = fresh.map((n) => ({ key: n.key, rule: n.rule, title: n.title, body: n.body, at: now.at, localDate: now.localDate, minutes: now.minutes, read: false, dismissed: false }))
  return [...added, ...items].slice(0, INBOX_MAX)
}

export const toSent = (items: readonly InboxItem[]): SentNudge[] => items.map(({ key, rule, at, localDate, minutes }) => ({ key, rule, at, localDate, minutes }))
export const visible = (items: readonly InboxItem[]) => items.filter((i) => !i.dismissed)
export const unread = (items: readonly InboxItem[]) => items.filter((i) => !i.read && !i.dismissed).length
export const markAllRead = (items: readonly InboxItem[]) => items.map((i) => (i.read ? i : { ...i, read: true }))
export const dismiss = (items: readonly InboxItem[], key: string) => items.map((i) => (i.key === key ? { ...i, dismissed: true, read: true } : i))

/** Minutes since midnight in a timezone (the profile's, not the device's). */
export function localMinutesInZone(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return get("hour") * 60 + get("minute")
}
