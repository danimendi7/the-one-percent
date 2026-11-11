import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adminClient, createTestUser, db, deleteTestUser, type TestUser } from "./setup"

/**
 * E9a · Planner of the scheduled push (Orden 2 §2), against real PostgreSQL with pg_cron, pg_net
 * and Vault. LOCAL stack only. Vault secrets and queued requests are written inside transactions
 * that are rolled back: pg_net only sends committed requests, so nothing leaves the machine.
 */
// A real P-256 public key whose private key was discarded: nothing can be sent with it.
const KEY = "BMvEjgb5ntOXJI244QmBG0AWhMPPFnUp2np-PoRDO4sTSNboeeBNXgNGNutTdjUvx6Yjh17qINcUgm_Xe9T-26I"
const AUTH = "tBHItJI5svbpez7KI4CCXg"
let a: TestUser
let b: TestUser

const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/it-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function subscribe(u: TestUser, label = "Mac · Chrome") {
  const { error } = await u.client.rpc("push_subscribe", { p_endpoint: endpoint(label.slice(0, 3)), p_p256dh: KEY, p_auth: AUTH, p_vapid_key: KEY, p_label: label })
  if (error) throw error
}

const reserve = (user: string, key: string, minutes: number, cap = 4, gap = 0, date = "2026-11-11") =>
  adminClient().rpc("push_delivery_reserve", { p_user: user, p_key: key, p_rule: key.split(":")[0], p_local_date: date, p_minutes: minutes, p_cap: cap, p_gap: gap })

beforeAll(async () => {
  a = await createTestUser("sa")
  b = await createTestUser("sb")
  await subscribe(a)
})
afterAll(async () => {
  await deleteTestUser(a)
  await deleteTestUser(b)
})

describe("push planner", () => {
  it("pg_cron runs the tick every 5 minutes", async () => {
    const job = await db((c) => c.query("select schedule, command, active from cron.job where jobname = 'the-one-percent-push-dispatch'"))
    expect(job.rows).toEqual([{ schedule: "*/5 * * * *", command: "select private.push_dispatch_tick()", active: true }])
  })

  it("without a destination in Vault the tick calls nothing", async () => {
    const out = await db(async (c) => {
      await c.query("begin")
      try {
        const before = await c.query("select count(*)::int n from net.http_request_queue")
        const tick = await c.query("select private.push_dispatch_tick() id")
        const after = await c.query("select count(*)::int n from net.http_request_queue")
        return { id: tick.rows[0].id, added: after.rows[0].n - before.rows[0].n }
      } finally {
        await c.query("rollback")
      }
    })
    expect(out).toEqual({ id: null, added: 0 })
  })

  it("with a destination it queues one POST carrying the secret (and the preview bypass, if set)", async () => {
    const out = await db(async (c) => {
      await c.query("begin")
      try {
        await c.query("select vault.create_secret('https://example.invalid/api/push/dispatch', 'push_dispatch_url')")
        await c.query("select vault.create_secret($1, 'push_dispatch_secret')", ["s".repeat(40)])
        await c.query("select vault.create_secret('bypass-value', 'push_dispatch_bypass')")
        const tick = await c.query("select private.push_dispatch_tick() id")
        const req = await c.query("select url, method, headers from net.http_request_queue where id = $1", [tick.rows[0].id])
        return req.rows[0]
      } finally {
        await c.query("rollback")
      }
    })
    expect(out.url).toBe("https://example.invalid/api/push/dispatch")
    expect(out.method).toBe("POST")
    expect(out.headers).toMatchObject({ Authorization: `Bearer ${"s".repeat(40)}`, "x-vercel-protection-bypass": "bypass-value" })
  })

  it("refuses a destination that is not https or a secret too short", async () => {
    const tickWith = (url: string, secret: string) =>
      db(async (c) => {
        await c.query("begin")
        try {
          await c.query("select vault.create_secret($1, 'push_dispatch_url')", [url])
          await c.query("select vault.create_secret($1, 'push_dispatch_secret')", [secret])
          return (await c.query("select private.push_dispatch_tick() id")).rows[0].id
        } finally {
          await c.query("rollback")
        }
      })
    expect(await tickWith("http://example.invalid/api/push/dispatch", "s".repeat(40))).toBeNull()
    expect(await tickWith("https://example.invalid/api/push/dispatch", "short")).toBeNull()
  })
})

describe("push deliveries", () => {
  it("lists only people with a device, with their devices and recent deliveries", async () => {
    const { data, error } = await adminClient().rpc("push_dispatch_users")
    expect(error).toBeNull()
    const mine = (data as { user_id: string; timezone: string; devices: { endpoint: string }[] }[]).filter((u) => [a.id, b.id].includes(u.user_id))
    expect(mine.map((u) => u.user_id)).toEqual([a.id])
    expect(mine[0].devices).toHaveLength(1)
    expect(mine[0].timezone).toBe("Europe/Madrid")
  })

  it("reads a person's data as their own app does, without leaving the claims behind", async () => {
    const { data, error } = await adminClient().rpc("push_dispatch_state", { p_user: a.id })
    expect(error).toBeNull()
    expect(data).toMatchObject({ full: true, profile: { timezone: "Europe/Madrid" }, habits: [] })
  })

  it("a reminder is reserved once: a retry, the cap and the minimum gap are refused", async () => {
    const first = await reserve(a.id, "late:2026-11-11", 1170, 2, 0)
    expect(first.error).toBeNull()
    expect(first.data).toEqual(expect.any(String))
    expect((await reserve(a.id, "late:2026-11-11", 1175, 2, 0)).data).toBeNull() // retry
    expect((await reserve(a.id, "review:2026-11-09", 1176, 2, 60)).data).toBeNull() // gap
    expect((await reserve(a.id, "review:2026-11-09", 1176, 2, 0)).data).toEqual(expect.any(String))
    expect((await reserve(a.id, "recall:2026-11-11", 1177, 2, 0)).data).toBeNull() // cap of 2
    expect((await reserve(a.id, "recall:2026-11-12", 10, 2, 0, "2026-11-12")).data).toEqual(expect.any(String)) // next day

    // Two runs at once: exactly one reservation.
    const both = await Promise.all([reserve(b.id, "due:2026-11-11", 800), reserve(b.id, "due:2026-11-11", 800)])
    expect(both.filter((r) => r.data).length).toBe(1)

    const finish = (status: string) => adminClient().rpc("push_delivery_finish", { p_id: first.data, p_status: status, p_ok: 1, p_failed: 0, p_gone: 0 })
    expect((await finish("sent")).data).toBe(true)
    expect((await finish("failed")).data).toBe(false) // finished once
  })

  it("nobody else can read deliveries or call the dispatch functions", async () => {
    const read = await a.client.from("push_deliveries").select("*")
    expect(read.error?.code).toBe("42501")
    for (const [fn, args] of [
      ["push_dispatch_users", {}],
      ["push_dispatch_state", { p_user: a.id }],
      ["push_delivery_reserve", { p_user: a.id, p_key: "x:1", p_rule: "late", p_local_date: "2026-11-11", p_minutes: 1, p_cap: 4, p_gap: 0 }],
      ["push_subscription_drop", { p_id: a.id }],
    ] as const) {
      const { error } = await a.client.rpc(fn, args)
      expect(error?.code, fn).toBe("42501")
    }
  })
})
