import { timingSafeEqual } from "node:crypto"
import type { HabitsState } from "@/features/habits/domain/types"
import { emptyCache, mergePull } from "@/features/sync/domain/merge"
import type { PullPayload } from "@/features/sync/domain/types"
import { deliveryOutcome, deviceResult, parseDispatchUsers, planFor, pushPayload, reachable, type DeviceResult, type DispatchUser } from "../domain/dispatch"
import type { SubscriptionJson } from "../domain/push"
import type { SendResult, Vapid } from "./server"

/**
 * POST /api/push/dispatch (E9, Orden 2 §2). Called every 5 minutes by pg_cron through pg_net, with
 * the secret stored in Vault. For each person with a subscribed device: their data as their app sees
 * it → the Motivation Engine now → each reminder reserved in `push_deliveries` (once per key; cap and
 * gap checked again under a lock) → sent to their devices → the outcome recorded. A device whose
 * push service says it no longer exists is removed. Nothing personal is logged or answered: the
 * response only carries counts.
 */

/** The service-role client, reduced to what the sender calls (only these functions; RLS keeps the rest closed). */
export interface ServiceRpc {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

export interface DispatchDeps {
  db: ServiceRpc
  vapid: Vapid
  send: (sub: SubscriptionJson, payload: string, vapid: Vapid) => Promise<SendResult>
  now: () => Date
}

export interface DispatchSummary {
  people: number
  reminders: number
  reserved: number
  sent: number
  failed: number
  gone: number
  errors: number
}

/** The state a person's app would build from a full pull. */
export function stateFromPull(pull: PullPayload): HabitsState {
  return mergePull(emptyCache(pull.server_today, pull.profile?.timezone ?? undefined), { ...pull, full: true }).state
}

async function call(db: ServiceRpc, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn} failed`)
  return data
}

async function sendTo(deps: DispatchDeps, user: DispatchUser, payload: string): Promise<DeviceResult[]> {
  const devices = reachable(user.devices, deps.vapid.publicKey)
  return Promise.all(
    devices.map(async (d) => {
      let result: DeviceResult
      try {
        result = deviceResult((await deps.send({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, deps.vapid)).statusCode)
      } catch (e) {
        const code = (e as { statusCode?: unknown }).statusCode
        result = deviceResult(typeof code === "number" ? code : undefined)
      }
      if (result === "gone") await call(deps.db, "push_subscription_drop", { p_id: d.id }).catch(() => undefined)
      return result
    })
  )
}

export async function runDispatch(deps: DispatchDeps): Promise<DispatchSummary> {
  const summary: DispatchSummary = { people: 0, reminders: 0, reserved: 0, sent: 0, failed: 0, gone: 0, errors: 0 }
  const users = parseDispatchUsers(await call(deps.db, "push_dispatch_users"))
  for (const user of users) {
    if (reachable(user.devices, deps.vapid.publicKey).length === 0) continue
    summary.people++
    try {
      const pull = (await call(deps.db, "push_dispatch_state", { p_user: user.userId })) as PullPayload | null
      if (!pull) continue
      const state = stateFromPull(pull)
      // Evaluated now, at send time: a habit done a minute ago is no longer pending (PRD §5.2).
      const plan = planFor(user, state, deps.now())
      summary.reminders += plan.nudges.length
      for (const nudge of plan.nudges) {
        const id = await call(deps.db, "push_delivery_reserve", {
          p_user: user.userId,
          p_key: nudge.key,
          p_rule: nudge.rule,
          p_local_date: plan.today,
          p_minutes: plan.minutes,
          p_cap: state.motivation.dailyCap,
          p_gap: state.motivation.minGapMinutes,
        })
        // Already sent (a retry or an overlapping run), or the cap or the gap: never twice.
        if (typeof id !== "string") continue
        summary.reserved++
        const results = await sendTo(deps, user, JSON.stringify(pushPayload(nudge)))
        const outcome = deliveryOutcome(results)
        summary.sent += outcome.ok
        summary.failed += outcome.failed
        summary.gone += outcome.gone
        await call(deps.db, "push_delivery_finish", { p_id: id, p_status: outcome.status, p_ok: outcome.ok, p_failed: outcome.failed, p_gone: outcome.gone })
      }
    } catch {
      // One person's failure does not stop the others; their reminder stays reserved, never resent.
      summary.errors++
    }
  }
  return summary
}

/** Constant-time comparison of the bearer token with the configured secret. */
export function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "")
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export interface DispatchRouteDeps {
  /** PUSH_DISPATCH_SECRET, 32+ characters. */
  secret: () => string | null
  vapid: () => Vapid | null
  db: () => ServiceRpc | null
  send: DispatchDeps["send"]
  now: () => Date
}

const HEADERS = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" }
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS })

export function createDispatchRoute(deps: DispatchRouteDeps) {
  let running = false
  return async function dispatch(request: Request): Promise<Response> {
    const secret = deps.secret()
    if (!secret) return answer(503, { ok: false, error: { code: "not_configured" } })
    if (!authorized(request.headers.get("authorization"), secret)) return answer(401, { ok: false, error: { code: "unauthorized" } })
    const vapid = deps.vapid()
    const db = deps.db()
    if (!vapid || !db) return answer(503, { ok: false, error: { code: "not_configured" } })
    // Two ticks reaching the same instance at once: the second waits for the next one. Across
    // instances the reservation in the database is what prevents a duplicate.
    if (running) return answer(202, { ok: true, data: { skipped: "running" } })
    running = true
    try {
      return answer(200, { ok: true, data: await runDispatch({ db, vapid, send: deps.send, now: deps.now }) })
    } catch {
      return answer(503, { ok: false, error: { code: "unavailable" } })
    } finally {
      running = false
    }
  }
}
