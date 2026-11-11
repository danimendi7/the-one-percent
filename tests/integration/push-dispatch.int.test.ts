import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { localDateInZone } from "@/features/habits/domain/dates"
import { DEFAULT_SETTINGS, type MotivationSettings } from "@/features/notifications/domain/motivation"
import { runDispatch } from "@/features/notifications/push/dispatch"
import type { SubscriptionJson } from "@/features/notifications/domain/push"
import { adminClient, createTestUser, db, deleteTestUser, opId, type TestUser } from "./setup"

/**
 * E9b · The scheduled push sender end to end against real PostgreSQL, with the service role and
 * only the push service replaced (it records what would be sent). LOCAL stack only.
 * Other test files may have subscribed users too: every check looks only at this file's devices.
 */
// A real P-256 public key whose private key was discarded: nothing can be sent with it.
const KEY = "BMvEjgb5ntOXJI244QmBG0AWhMPPFnUp2np-PoRDO4sTSNboeeBNXgNGNutTdjUvx6Yjh17qINcUgm_Xe9T-26I"
const AUTH = "tBHItJI5svbpez7KI4CCXg"
const VAPID = { subject: "mailto:it@theonepercent.local", publicKey: KEY, privateKey: "k".repeat(43) }
// Always due: the evening reminder from 00:00, no quiet hours, no gap.
const ALWAYS_LATE: MotivationSettings = {
  ...DEFAULT_SETTINGS,
  quietStart: "00:00",
  quietEnd: "00:00",
  minGapMinutes: 0,
  rules: { morning: false, due: false, late: true, allDone: false, review: false, recall: false, focus: false },
  times: { ...DEFAULT_SETTINGS.times, late: "00:00" },
}

/**
 * Quiet hours from an hour ago to an hour from now (Madrid, the test users' zone), so the run is
 * always inside them. A fixed 00:00–23:59 left 23:59 outside and failed one minute a day.
 */
function quietAroundNow(): Pick<MotivationSettings, "quietStart" | "quietEnd"> {
  const hhmm = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms)
  const now = Date.now()
  return { quietStart: hhmm(now - 3_600_000), quietEnd: hhmm(now + 3_600_000) }
}

let pending: TestUser
let done: TestUser
let quiet: TestUser
const endpoints = new Map<string, string>()

async function apply(u: TestUser, ops: unknown[]) {
  const { data, error } = await u.client.rpc("apply_ops", { p_device_id: "it-dispatch", p_ops: ops })
  if (error) throw error
  for (const r of (data as { results: { status: string }[] }).results) expect(r.status).toBe("applied")
}

async function prepare(u: TestUser, label: string, settings: MotivationSettings, markDone: boolean) {
  const habit = randomUUID()
  const today = localDateInZone(new Date(), "Europe/Madrid")
  await apply(u, [
    { type: "profile.motivation", op_id: opId("pm"), settings },
    {
      type: "habit.create",
      op_id: opId("hc"),
      habit: { id: habit, title: `Hábito ${label}`, icon: "check", dimension: "body", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: "2026-01-01" },
      versions: [{ valid_from: "2026-01-01", rule: { kind: "daily" } }],
    },
  ])
  if (markDone) await apply(u, [{ type: "entry.set", op_id: opId("es"), habit_id: habit, local_date: today, value: true, client_updated_at: new Date().toISOString(), base_seq: null }])
  const endpoint = `https://fcm.googleapis.com/fcm/send/it-dispatch-${label}-${Date.now()}`
  const { error } = await u.client.rpc("push_subscribe", { p_endpoint: endpoint, p_p256dh: KEY, p_auth: AUTH, p_vapid_key: KEY, p_label: `Prueba ${label}` })
  if (error) throw error
  endpoints.set(endpoint, u.id)
}

/**
 * Runs the sender with a push service stand-in; returns what reached this file's devices. `goneFor`:
 * the push service answers 410 for that person's devices only (never for another file's).
 */
async function dispatch(goneFor?: string) {
  const sent: { userId: string; payload: string }[] = []
  const send = async (sub: SubscriptionJson, payload: string) => {
    const userId = endpoints.get(sub.endpoint)
    if (userId) sent.push({ userId, payload })
    if (userId && userId === goneFor) throw Object.assign(new Error("push service"), { statusCode: 410 })
    return { statusCode: 201 }
  }
  const summary = await runDispatch({ db: adminClient(), vapid: VAPID, send, now: () => new Date() })
  return { sent, summary }
}

const deliveries = (u: TestUser) =>
  db((c) => c.query("select nudge_key, rule, status, devices_ok from public.push_deliveries where user_id = $1 order by created_at", [u.id])).then((r) => r.rows)

beforeAll(async () => {
  pending = await createTestUser("dp")
  done = await createTestUser("dd")
  quiet = await createTestUser("dq")
  await prepare(pending, "pending", ALWAYS_LATE, false)
  await prepare(done, "done", ALWAYS_LATE, true)
  await prepare(quiet, "quiet", { ...ALWAYS_LATE, ...quietAroundNow() }, false)
})
afterAll(async () => {
  for (const u of [pending, done, quiet]) await deleteTestUser(u)
})

describe("scheduled push sender", () => {
  it("a pending habit gets one reminder; a habit already done and quiet hours get none", async () => {
    const { sent, summary } = await dispatch()
    expect(summary.errors).toBe(0)
    expect(sent.map((s) => s.userId)).toEqual([pending.id])
    const payload = JSON.parse(sent[0].payload)
    expect(payload).toMatchObject({ title: "Antes de que acabe el día", body: "Aún queda 1 hábito por hoy.", url: "/" })
    expect(sent[0].payload).not.toContain("Hábito pending")

    const today = localDateInZone(new Date(), "Europe/Madrid")
    expect(await deliveries(pending)).toEqual([{ nudge_key: `late:${today}`, rule: "late", status: "sent", devices_ok: 1 }])
    expect(await deliveries(done)).toEqual([])
    expect(await deliveries(quiet)).toEqual([])
  })

  it("a retry does not send it again", async () => {
    const { sent } = await dispatch()
    expect(sent).toEqual([])
    expect(await deliveries(pending)).toHaveLength(1)
  })

  it("a device the push service no longer knows is removed", async () => {
    const gone = await createTestUser("dg")
    try {
      await prepare(gone, "gone", ALWAYS_LATE, false)
      const { sent } = await dispatch(gone.id)
      expect(sent.map((s) => s.userId)).toEqual([gone.id])
      expect(await deliveries(gone)).toMatchObject([{ status: "none", devices_ok: 0 }])
      const left = await db((c) => c.query("select count(*)::int n from public.push_subscriptions where user_id = $1", [gone.id]))
      expect(left.rows[0].n).toBe(0)
    } finally {
      await deleteTestUser(gone)
    }
  })
})
