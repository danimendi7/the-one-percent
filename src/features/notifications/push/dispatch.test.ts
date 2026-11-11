import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "../domain/motivation"
import { authorized, createDispatchRoute, runDispatch, type ServiceRpc } from "./dispatch"
import type { Vapid } from "./server"

const KEY = "BMvEjgb5ntOXJI244QmBG0AWhMPPFnUp2np-PoRDO4sTSNboeeBNXgNGNutTdjUvx6Yjh17qINcUgm_Xe9T-26I"
const VAPID: Vapid = { subject: "mailto:a@b.c", publicKey: KEY, privateKey: "k".repeat(43) }
const SECRET = "s".repeat(40)
const UID = "11111111-1111-4111-8111-111111111111"
const DEV = (n: number) => `22222222-2222-4222-8222-00000000000${n}`
const NOW = new Date("2026-11-10T18:30:00Z") // 19:30 in Madrid
const LATE_ONLY = { ...DEFAULT_SETTINGS, rules: { morning: false, due: false, late: true, allDone: false, review: false, recall: false, focus: false } }

const pull = (done: boolean) => ({
  server_today: "2026-11-10",
  full: true,
  profile: { timezone: "Europe/Madrid", locale: "es-ES", server_seq: 1, motivation: LATE_ONLY },
  dimensions: [],
  habits: [
    { id: "33333333-3333-4333-8333-333333333333", title: "Leer", icon: "book-open", dimension: "learn", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: "2026-10-01", archived_on: null, version: 1, created_at: "2026-10-01T00:00:00Z", server_seq: 1, versions: [{ valid_from: "2026-10-01", kind: "daily", weekdays: null, target_count: null }] },
  ],
  entries: done
    ? [{ habit_id: "33333333-3333-4333-8333-333333333333", local_date: "2026-11-10", value_bool: true, value_numeric: null, deleted: false, client_op_id: "x", client_updated_at: "2026-11-10T10:00:00Z", server_seq: 2 }]
    : [],
  rest_days: [],
  cursor: 2,
})

/** A database stand-in with the semantics of the SQL functions (one reservation per key). */
function fakeDb(opts: { done?: boolean; devices?: number } = {}) {
  const reserved = new Map<string, { id: string; status: string }>()
  const dropped: string[] = []
  const calls: string[] = []
  const db: ServiceRpc = {
    async rpc(fn, args = {}) {
      calls.push(fn)
      switch (fn) {
        case "push_dispatch_users":
          return {
            data: [
              {
                user_id: UID,
                timezone: "Europe/Madrid",
                sent: [],
                devices: Array.from({ length: opts.devices ?? 1 }, (_, i) => ({ id: DEV(i), endpoint: `https://fcm.googleapis.com/fcm/send/d${i}`, p256dh: KEY, auth: "a".repeat(22), vapid_key: KEY })).filter((d) => !dropped.includes(d.id)),
              },
            ],
            error: null,
          }
        case "push_dispatch_state":
          return { data: pull(!!opts.done), error: null }
        case "push_delivery_reserve": {
          const k = `${args.p_user}:${args.p_key}`
          if (reserved.has(k)) return { data: null, error: null }
          const id = `r${reserved.size}`
          reserved.set(k, { id, status: "reserved" })
          return { data: id, error: null }
        }
        case "push_delivery_finish": {
          const r = [...reserved.values()].find((x) => x.id === args.p_id)
          if (r) r.status = String(args.p_status)
          return { data: !!r, error: null }
        }
        case "push_subscription_drop":
          dropped.push(String(args.p_id))
          return { data: true, error: null }
      }
      return { data: null, error: { message: "unknown" } }
    },
  }
  return { db, reserved, dropped, calls }
}

describe("runDispatch", () => {
  it("sends a pending habit's reminder once; a second run sends nothing", async () => {
    const f = fakeDb()
    const sent: string[] = []
    const send = async (sub: { endpoint: string }, payload: string) => {
      sent.push(`${sub.endpoint} ${payload}`)
      return { statusCode: 201 }
    }
    const first = await runDispatch({ db: f.db, vapid: VAPID, send, now: () => NOW })
    expect(first).toMatchObject({ people: 1, reminders: 1, reserved: 1, sent: 1, errors: 0 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain("Aún queda 1 hábito por hoy.")
    expect(sent[0]).not.toContain("Leer")
    expect([...f.reserved.values()]).toEqual([{ id: "r0", status: "sent" }])

    const again = await runDispatch({ db: f.db, vapid: VAPID, send, now: () => NOW })
    expect(again).toMatchObject({ reserved: 0, sent: 0 })
    expect(sent).toHaveLength(1)
  })

  it("a habit already done gets nothing", async () => {
    const f = fakeDb({ done: true })
    let sends = 0
    const r = await runDispatch({ db: f.db, vapid: VAPID, send: async () => (sends++, { statusCode: 201 }), now: () => NOW })
    expect(r).toMatchObject({ reminders: 0, reserved: 0 })
    expect(sends).toBe(0)
    expect(f.calls).not.toContain("push_delivery_reserve")
  })

  it("a device the push service no longer knows is removed; the others still receive", async () => {
    const f = fakeDb({ devices: 2 })
    const send = async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("d0")) throw Object.assign(new Error("gone"), { statusCode: 410 })
      return { statusCode: 201 }
    }
    const r = await runDispatch({ db: f.db, vapid: VAPID, send, now: () => NOW })
    expect(r).toMatchObject({ sent: 1, gone: 1 })
    expect(f.dropped).toEqual([DEV(0)])
    expect([...f.reserved.values()][0].status).toBe("sent")
  })

  it("devices subscribed with another server key are not tried", async () => {
    const f = fakeDb()
    let sends = 0
    const r = await runDispatch({ db: f.db, vapid: { ...VAPID, publicKey: "B" + "y".repeat(86) }, send: async () => (sends++, { statusCode: 201 }), now: () => NOW })
    expect(r.people).toBe(0)
    expect(sends).toBe(0)
  })
})

describe("dispatch route", () => {
  const route = (over: Partial<Parameters<typeof createDispatchRoute>[0]> = {}) =>
    createDispatchRoute({ secret: () => SECRET, vapid: () => VAPID, db: () => fakeDb().db, send: async () => ({ statusCode: 201 }), now: () => NOW, ...over })
  const post = (auth?: string) => new Request("https://app.example/api/push/dispatch", { method: "POST", headers: auth ? { authorization: auth } : {} })

  it("answers only to the planner's secret", async () => {
    expect((await route()(post())).status).toBe(401)
    expect((await route()(post(`Bearer ${"x".repeat(40)}`))).status).toBe(401)
    const ok = await route()(post(`Bearer ${SECRET}`))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ ok: true, data: { sent: 1 } })
    expect(ok.headers.get("cache-control")).toBe("private, no-store")
  })

  it("does nothing until it is configured", async () => {
    expect((await route({ secret: () => null })(post(`Bearer ${SECRET}`))).status).toBe(503)
    expect((await route({ vapid: () => null })(post(`Bearer ${SECRET}`))).status).toBe(503)
    expect((await route({ db: () => null })(post(`Bearer ${SECRET}`))).status).toBe(503)
  })

  it("accepts only the exact secret as a Bearer token", () => {
    expect(authorized(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(authorized(SECRET, SECRET)).toBe(false)
    expect(authorized(null, SECRET)).toBe(false)
    expect(authorized(`Bearer ${SECRET}x`, SECRET)).toBe(false)
    expect(authorized(`Bearer ${"x".repeat(SECRET.length)}`, SECRET)).toBe(false) // same length, other value
  })
})
