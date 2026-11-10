import type { NextRequest } from "next/server"
import { sendNotification } from "web-push"
import { verifiedSession } from "@/features/library/metadata/server/auth"
import { KeyedLimiter, type Clock } from "@/features/library/metadata/server/limits"
import { isServerKey, parseDevices, parseSubscription, TEST_NOTIFICATION, type SubscriptionJson } from "../domain/push"

/**
 * POST /api/push/test (E8): sends the test notification to the device that asks, and only to it.
 * Order of checks, each one before any outside call: same origin and JSON → server keys configured
 * → verified user → per-user quota → a valid subscription → registered to that user → send. The
 * push service only receives the fixed test text (no personal data) and nothing is logged.
 * Answers are `{ ok, data | error }`, private and never stored by caches.
 */
export interface Vapid {
  subject: string
  publicKey: string
  privateKey: string
}

/** What the route needs from Supabase, with the caller's own session (RLS and auth.uid() apply). */
export interface UserRpc {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}
export type PushCaller = { kind: "user"; id: string; db: UserRpc } | { kind: "anonymous" } | { kind: "unavailable" }

export type SendResult = { statusCode: number }
export interface PushRouteDeps {
  vapid: () => Vapid | null
  caller: (request: NextRequest) => Promise<PushCaller>
  send: (sub: SubscriptionJson, payload: string, vapid: Vapid) => Promise<SendResult>
  now: Clock
}

export type PushErrorCode = "forbidden" | "unsupported_media" | "not_configured" | "unavailable" | "unauthorized" | "rate_limited" | "bad_request" | "not_registered" | "gone" | "rejected"
const STATUS: Record<PushErrorCode, number> = {
  forbidden: 403,
  unsupported_media: 415,
  not_configured: 503,
  unavailable: 503,
  unauthorized: 401,
  rate_limited: 429,
  bad_request: 400,
  not_registered: 404,
  gone: 410,
  rejected: 502,
}
const HEADERS = { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" }
const fail = (code: PushErrorCode) => new Response(JSON.stringify({ ok: false, error: { code } }), { status: STATUS[code], headers: HEADERS })
const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: HEADERS })

/** A person checking that notifications arrive taps a few times, not dozens. */
export const TEST_LIMIT = { capacity: 5, perMinute: 5 }
const MAX_BODY = 4096

/** The server keys, only when all three are present and well formed. */
export function vapidFromEnv(env: Record<string, string | undefined> = process.env): Vapid | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? ""
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? ""
  const subject = env.VAPID_SUBJECT?.trim() ?? ""
  if (!isServerKey(publicKey) || !/^[A-Za-z0-9_-]{40,50}={0,2}$/.test(privateKey)) return null
  if (!/^mailto:[^@\s]+@[^@\s]+$/.test(subject) && !/^https:\/\/\S+$/.test(subject)) return null
  return { subject, publicKey, privateKey }
}

export function createPushRoutes(deps: PushRouteDeps) {
  const perUser = new KeyedLimiter(TEST_LIMIT.capacity, TEST_LIMIT.perMinute, deps.now)

  async function test(request: NextRequest): Promise<Response> {
    const origin = request.headers.get("origin")
    if (origin && origin !== request.nextUrl.origin) return fail("forbidden")
    if (!(request.headers.get("content-type") ?? "").includes("application/json")) return fail("unsupported_media")
    const vapid = deps.vapid()
    if (!vapid) return fail("not_configured")
    const caller = await deps.caller(request)
    if (caller.kind === "unavailable") return fail("unavailable")
    if (caller.kind !== "user") return fail("unauthorized")
    if (!perUser.take(caller.id).ok) return fail("rate_limited")

    let sub: SubscriptionJson | null = null
    try {
      const text = await request.text()
      if (text.length <= MAX_BODY) sub = parseSubscription(JSON.parse(text))
    } catch {
      sub = null
    }
    if (!sub) return fail("bad_request")

    const devices = await caller.db.rpc("push_devices", { p_endpoint: sub.endpoint })
    if (devices.error) return fail("unavailable")
    if (!parseDevices(devices.data).some((d) => d.current)) return fail("not_registered")

    try {
      await deps.send(sub, JSON.stringify(TEST_NOTIFICATION), vapid)
      return ok({ status: "accepted" })
    } catch (e) {
      const code = (e as { statusCode?: unknown }).statusCode
      // The push service says the address no longer exists: this device is no longer subscribed.
      if (code === 404 || code === 410) {
        await caller.db.rpc("push_forget", { p_endpoint: sub.endpoint })
        return fail("gone")
      }
      return fail("rejected")
    }
  }

  return { test }
}

/** The caller, verified by the Auth server, with a client that carries their own session. */
async function callerOf(request: NextRequest): Promise<PushCaller> {
  const { caller, client } = await verifiedSession(request)
  return caller.kind === "user" && client ? { ...caller, db: client } : caller.kind === "user" ? { kind: "unavailable" } : caller
}

let routes: ReturnType<typeof createPushRoutes> | null = null
export function pushRoutes() {
  routes ??= createPushRoutes({
    vapid: () => vapidFromEnv(),
    caller: callerOf,
    // A short TTL: a test that arrives an hour later says nothing about the device.
    send: (sub, payload, vapid) => sendNotification(sub, payload, { vapidDetails: vapid, TTL: 60, urgency: "normal", timeout: 10_000 }),
    now: Date.now,
  })
  return routes
}
