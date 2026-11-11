import { localDateInZone, type LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import { localMinutesInZone } from "./inbox"
import { evaluate, type Nudge, type RuleId, type SentNudge } from "./motivation"
import { isPushEndpoint, isServerKey } from "./push"

/**
 * E9 · Scheduled push (PRD §5.2). Pure decisions of the sender: who is considered, what the Motivation
 * Engine says for them right now (the same evaluation as the in-app inbox, at send time, with the
 * server's record of deliveries for the cap, the gap and «at most once per key»), what each
 * notification says on a lock screen and how a delivery ended. The I/O is in ../push/dispatch.ts.
 */
export interface DispatchDevice {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  vapidKey: string
}

export interface DispatchUser {
  userId: string
  timezone: string
  sent: SentNudge[]
  devices: DispatchDevice[]
}

const RULES: RuleId[] = ["morning", "due", "late", "allDone", "review", "recall", "focus"]
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

function parseSent(v: unknown): SentNudge | null {
  if (!isObject(v) || typeof v.key !== "string" || !RULES.includes(v.rule as RuleId) || typeof v.at !== "string") return null
  if (typeof v.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.localDate) || typeof v.minutes !== "number") return null
  return { key: v.key, rule: v.rule as RuleId, at: v.at, localDate: v.localDate as LocalDate, minutes: v.minutes }
}

function parseDevice(v: unknown): DispatchDevice | null {
  if (!isObject(v) || !isUuid(v.id) || !isPushEndpoint(v.endpoint) || typeof v.p256dh !== "string" || typeof v.auth !== "string" || !isServerKey(v.vapid_key)) return null
  return { id: v.id, endpoint: v.endpoint, p256dh: v.p256dh, auth: v.auth, vapidKey: v.vapid_key }
}

/** The answer of `push_dispatch_users`, checked; anything malformed is left out rather than guessed. */
export function parseDispatchUsers(raw: unknown): DispatchUser[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((u) => {
    if (!isObject(u) || !isUuid(u.user_id)) return []
    const devices = (Array.isArray(u.devices) ? u.devices : []).map(parseDevice).filter((d): d is DispatchDevice => d !== null)
    const sent = (Array.isArray(u.sent) ? u.sent : []).map(parseSent).filter((s): s is SentNudge => s !== null)
    return [{ userId: u.user_id, timezone: typeof u.timezone === "string" && u.timezone ? u.timezone : "Europe/Madrid", sent, devices }]
  })
}

/** Devices that can receive from this server: subscribed with its current public key. */
export const reachable = (devices: readonly DispatchDevice[], publicKey: string) => devices.filter((d) => d.vapidKey === publicKey)

export interface Plan {
  today: LocalDate
  minutes: number
  nudges: Nudge[]
}

/** What is due for this person now, in their timezone. Silence, cap, spacing and days off included. */
export function planFor(user: DispatchUser, state: HabitsState, now: Date): Plan {
  const zone = state.timezone || user.timezone
  const today = localDateInZone(now, zone)
  const minutes = localMinutesInZone(now, zone)
  const { nudges } = evaluate({ state, today, minutes, settings: state.motivation, sent: user.sent })
  return { today, minutes, nudges }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const URL_OF: Record<RuleId, string> = {
  morning: "/",
  due: "/",
  late: "/",
  allDone: "/",
  review: "/reviews",
  recall: "/knowledge/brain/repaso",
  focus: "/focus",
}

export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
}

/**
 * What the notification shows. A lock screen is seen by anyone nearby: habit names stay inside the
 * app (the in-app inbox keeps the full text); the push only says how many are pending.
 */
export function pushPayload(n: Nudge): PushPayload {
  const count = n.habitIds?.length ?? 0
  const h = `${count} ${plural(count, "hábito", "hábitos")}`
  const body =
    n.rule === "morning"
      ? `Hoy tienes ${h} ${plural(count, "programado", "programados")}.`
      : n.rule === "due"
        ? `${plural(count, "Queda", "Quedan")} ${h} por hoy.`
        : n.rule === "late"
          ? `Aún ${plural(count, "queda", "quedan")} ${h} por hoy.`
          : n.body
  return { title: n.title, body, url: URL_OF[n.rule], tag: `top-${n.rule}` }
}

export type DeviceResult = "ok" | "gone" | "failed"
export type DeliveryStatus = "sent" | "failed" | "none"

/** How a delivery ended: sent if any device accepted it. */
export function deliveryOutcome(results: readonly DeviceResult[]): { status: DeliveryStatus; ok: number; failed: number; gone: number } {
  const ok = results.filter((r) => r === "ok").length
  const failed = results.filter((r) => r === "failed").length
  const gone = results.filter((r) => r === "gone").length
  return { status: ok > 0 ? "sent" : failed > 0 ? "failed" : "none", ok, failed, gone }
}

/** A push service's answer: 404 and 410 mean the address no longer exists. */
export function deviceResult(statusCode: number | undefined): DeviceResult {
  if (statusCode === 404 || statusCode === 410) return "gone"
  return statusCode !== undefined && statusCode >= 200 && statusCode < 300 ? "ok" : "failed"
}
