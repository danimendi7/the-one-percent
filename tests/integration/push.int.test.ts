import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { anonClient, createTestUser, db, deleteTestUser, type TestUser } from "./setup"

/** E8 · Push subscriptions per device, against real PostgreSQL. LOCAL stack only. */
// A real P-256 public key whose private key was discarded: nothing can be sent with it.
const KEY = "BMvEjgb5ntOXJI244QmBG0AWhMPPFnUp2np-PoRDO4sTSNboeeBNXgNGNutTdjUvx6Yjh17qINcUgm_Xe9T-26I"
const AUTH = "tBHItJI5svbpez7KI4CCXg"
let a: TestUser
let b: TestUser

const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/it-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
type Device = { id: string; label: string; created_at: string; updated_at: string; current: boolean }

async function subscribe(u: TestUser, ep: string, label = "Mac · Chrome", over: Record<string, unknown> = {}) {
  return u.client.rpc("push_subscribe", { p_endpoint: ep, p_p256dh: KEY, p_auth: AUTH, p_vapid_key: KEY, p_label: label, ...over })
}
async function devices(u: TestUser, current: string | null = null): Promise<Device[]> {
  const { data, error } = await u.client.rpc("push_devices", { p_endpoint: current })
  if (error) throw error
  return data as Device[]
}

beforeAll(async () => {
  a = await createTestUser("pa")
  b = await createTestUser("pb")
})
afterAll(async () => {
  await deleteTestUser(a)
  await deleteTestUser(b)
})

describe("push subscriptions", () => {
  it("each device subscribes and unsubscribes on its own", async () => {
    const phone = endpoint("phone")
    const laptop = endpoint("laptop")
    expect((await subscribe(a, phone, "iPhone · Safari")).data).toMatchObject({ status: "registered" })
    expect((await subscribe(a, laptop, "Mac · Chrome")).data).toMatchObject({ status: "registered" })

    const fromPhone = await devices(a, phone)
    expect(fromPhone.map((d) => [d.label, d.current])).toEqual([
      ["iPhone · Safari", true],
      ["Mac · Chrome", false],
    ])

    // The laptop turns itself off: the phone stays subscribed.
    expect((await a.client.rpc("push_forget", { p_endpoint: laptop })).data).toBe(true)
    expect((await devices(a, phone)).map((d) => [d.label, d.current])).toEqual([["iPhone · Safari", true]])
    // And back on, independently.
    expect((await subscribe(a, laptop)).data).toMatchObject({ status: "registered" })
    expect(await devices(a)).toHaveLength(2)

    // Removing one from the list leaves the other.
    const phoneId = (await devices(a, phone)).find((d) => d.current)!.id
    expect((await a.client.rpc("push_remove", { p_id: phoneId })).data).toBe(true)
    expect((await devices(a, laptop)).map((d) => [d.label, d.current])).toEqual([["Mac · Chrome", true]])
    await a.client.rpc("push_forget", { p_endpoint: laptop })
  })

  it("subscribing again refreshes the same row instead of adding one", async () => {
    const ep = endpoint("again")
    const first = (await subscribe(a, ep, "Mac · Chrome")).data as { id: string }
    const again = (await subscribe(a, ep, "  Mac · Chrome  ", { p_auth: "AAAAAAAAAAAAAAAAAAAAAA" })).data as { id: string }
    expect(again.id).toBe(first.id)
    const rows = await db(async (c) => (await c.query("select label, auth from public.push_subscriptions where endpoint = $1", [ep])).rows)
    expect(rows).toEqual([{ label: "Mac · Chrome", auth: "AAAAAAAAAAAAAAAAAAAAAA" }])
    await a.client.rpc("push_forget", { p_endpoint: ep })
  })

  it("an address that belongs to another account is never handed over", async () => {
    const ep = endpoint("shared-browser")
    await subscribe(a, ep)
    expect((await subscribe(b, ep)).data).toEqual({ status: "taken" })
    expect(await devices(b, ep)).toEqual([])
    expect((await devices(a, ep)).filter((d) => d.current)).toHaveLength(1)
    // Nor can the other account remove or forget it.
    const id = (await devices(a, ep)).find((d) => d.current)!.id
    expect((await b.client.rpc("push_remove", { p_id: id })).data).toBe(false)
    expect((await b.client.rpc("push_forget", { p_endpoint: ep })).data).toBe(false)
    expect(await db(async (c) => (await c.query("select count(*)::int n from public.push_subscriptions where endpoint = $1", [ep])).rows[0].n)).toBe(1)
    await a.client.rpc("push_forget", { p_endpoint: ep })
  })

  it("no API client can read or write the table, and nothing returns an endpoint or a key", async () => {
    const ep = endpoint("private")
    await subscribe(a, ep)
    const read = await a.client.from("push_subscriptions").select("endpoint, p256dh, auth")
    expect(read.error).not.toBeNull()
    const write = await a.client.from("push_subscriptions").insert({ user_id: a.id, endpoint: endpoint("forged"), p256dh: KEY, auth: AUTH, vapid_key: KEY, label: "x" })
    expect(write.error).not.toBeNull()
    expect((await a.client.from("push_subscriptions").delete().eq("endpoint", ep)).error).not.toBeNull()
    expect(JSON.stringify(await devices(a, ep))).not.toMatch(/fcm\.googleapis|BMvEjgb5|tBHItJI5/)
    const anon = anonClient()
    expect((await anon.rpc("push_devices", { p_endpoint: null })).error).not.toBeNull()
    expect((await anon.rpc("push_subscribe", { p_endpoint: endpoint("anon"), p_p256dh: KEY, p_auth: AUTH, p_vapid_key: KEY, p_label: "x" })).error).not.toBeNull()
    await a.client.rpc("push_forget", { p_endpoint: ep })
  })

  it("refuses addresses that are not push services and malformed keys", async () => {
    for (const [over, what] of [
      [{ p_endpoint: "https://evil.example/fcm" }, "endpoint"],
      [{ p_endpoint: "http://fcm.googleapis.com/fcm/send/x" }, "http"],
      [{ p_p256dh: "short" }, "key"],
      [{ p_auth: "not a secret!" }, "auth"],
      [{ p_vapid_key: "" }, "server key"],
      [{ p_label: "   " }, "label"],
      [{ p_label: "x".repeat(61) }, "long label"],
    ] as const) {
      const r = await subscribe(a, endpoint("bad"), "Mac · Chrome", over)
      expect(r.error?.message, what).toMatch(/invalid_value/)
    }
    expect(await devices(a)).toEqual([])
  })

  it("keeps at most 20 devices per account", async () => {
    const eps = Array.from({ length: 20 }, (_, i) => endpoint(`lim${i}`))
    for (const ep of eps) expect((await subscribe(b, ep)).data).toMatchObject({ status: "registered" })
    expect((await subscribe(b, endpoint("lim20"))).error?.message).toMatch(/device_limit/)
    // An already registered device still refreshes.
    expect((await subscribe(b, eps[0])).data).toMatchObject({ status: "registered" })
    for (const ep of eps) await b.client.rpc("push_forget", { p_endpoint: ep })
    expect(await devices(b)).toEqual([])
  })

  it("subscribing and unsubscribing are audited without the address", async () => {
    const rows = await db(async (c) => (await c.query("select action, metadata_json from public.audit_logs where user_id = $1 and entity_type = 'push_subscription'", [a.id])).rows)
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(["create", "delete"]))
    expect(JSON.stringify(rows)).not.toMatch(/fcm\.googleapis/)
  })

  it("leave nothing behind when the account is deleted", async () => {
    const c = await createTestUser("pc")
    await subscribe(c, endpoint("gone"))
    await deleteTestUser(c)
    expect(await db(async (q) => (await q.query("select count(*)::int n from public.push_subscriptions where user_id = $1", [c.id])).rows[0].n)).toBe(0)
  })
})
