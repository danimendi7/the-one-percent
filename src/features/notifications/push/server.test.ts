import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"
import { TEST_NOTIFICATION, type SubscriptionJson } from "../domain/push"
import { createPushRoutes, TEST_LIMIT, vapidFromEnv, type PushCaller, type Vapid } from "./server"

// A real P-256 public key whose private key was discarded; the private key below is random bytes.
const PUBLIC = "BMvEjgb5ntOXJI244QmBG0AWhMPPFnUp2np-PoRDO4sTSNboeeBNXgNGNutTdjUvx6Yjh17qINcUgm_Xe9T-26I"
const VAPID: Vapid = { subject: "mailto:avisos@example.com", publicKey: PUBLIC, privateKey: "x".repeat(43) }
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/device-1", expirationTime: null, keys: { p256dh: PUBLIC, auth: "tBHItJI5svbpez7KI4CCXg" } }

const req = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new NextRequest("http://localhost:3000/api/push/test", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) })
const read = async (r: Response) => ({ status: r.status, body: await r.json(), cache: r.headers.get("cache-control") })

function setup(opts: { caller?: PushCaller["kind"]; registered?: boolean; send?: () => Promise<{ statusCode: number }>; vapid?: Vapid | null; rpcError?: boolean } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const sent: { sub: SubscriptionJson; payload: string }[] = []
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (opts.rpcError) return { data: null, error: { message: "down" } }
      if (fn === "push_devices") return { data: [{ id: "d1", label: "Mac · Chrome", created_at: "2026-11-10T08:00:00Z", current: opts.registered ?? true }], error: null }
      return { data: true, error: null }
    },
  }
  const kind = opts.caller ?? "user"
  const routes = createPushRoutes({
    vapid: () => (opts.vapid === undefined ? VAPID : opts.vapid),
    caller: async () => (kind === "user" ? { kind, id: "u1", db } : { kind }),
    send: async (sub, payload) => {
      sent.push({ sub, payload })
      return (opts.send ?? (async () => ({ statusCode: 201 })))()
    },
    now: () => 0,
  })
  return { routes, calls, sent }
}

describe("POST /api/push/test", () => {
  it("sends the fixed test text to the device that asks, once it is registered to the caller", async () => {
    const { routes, calls, sent } = setup()
    const r = await read(await routes.test(req(SUB)))
    expect(r).toEqual({ status: 200, body: { ok: true, data: { status: "accepted" } }, cache: "private, no-store" })
    expect(calls).toEqual([{ fn: "push_devices", args: { p_endpoint: SUB.endpoint } }])
    expect(sent).toEqual([{ sub: { endpoint: SUB.endpoint, keys: SUB.keys }, payload: JSON.stringify(TEST_NOTIFICATION) }])
  })

  it("without server keys: 503 before checking anyone", async () => {
    const { routes, calls, sent } = setup({ vapid: null })
    expect(await read(await routes.test(req(SUB)))).toMatchObject({ status: 503, body: { error: { code: "not_configured" } } })
    expect([calls, sent]).toEqual([[], []])
  })

  it("anonymous or unverifiable callers send nothing", async () => {
    for (const [caller, status] of [["anonymous", 401], ["unavailable", 503]] as const) {
      const { routes, sent } = setup({ caller })
      expect((await routes.test(req(SUB))).status).toBe(status)
      expect(sent).toEqual([])
    }
  })

  it("refuses other origins and anything that is not JSON (no cross-site posts)", async () => {
    const { routes, sent } = setup()
    expect((await routes.test(req(SUB, { "content-type": "application/json", origin: "https://evil.example" }))).status).toBe(403)
    expect((await routes.test(req(SUB, { "content-type": "text/plain" }))).status).toBe(415)
    expect((await routes.test(req(SUB, { "content-type": "application/json", origin: "http://localhost:3000" }))).status).toBe(200)
    expect(sent).toHaveLength(1)
  })

  it("never posts to an address that is not a push service, nor to a device of someone else", async () => {
    const { routes, sent } = setup()
    for (const bad of [{ ...SUB, endpoint: "https://169.254.169.254/latest" }, { ...SUB, endpoint: "http://localhost:3000/api" }, { endpoint: SUB.endpoint }, "not json", "x".repeat(5000)])
      expect((await routes.test(req(bad))).status).toBe(400)
    const other = setup({ registered: false })
    expect(await read(await other.routes.test(req(SUB)))).toMatchObject({ status: 404, body: { error: { code: "not_registered" } } })
    expect([sent, other.sent]).toEqual([[], []])
  })

  it("forgets the device when its push service says the address is gone", async () => {
    const { routes, calls } = setup({ send: () => Promise.reject(Object.assign(new Error("Gone"), { statusCode: 410 })) })
    expect(await read(await routes.test(req(SUB)))).toMatchObject({ status: 410, body: { error: { code: "gone" } } })
    expect(calls.map((c) => c.fn)).toEqual(["push_devices", "push_forget"])
    expect(calls[1].args).toEqual({ p_endpoint: SUB.endpoint })
  })

  it("reports other refusals without forgetting the device", async () => {
    const { routes, calls } = setup({ send: () => Promise.reject(Object.assign(new Error("Bad"), { statusCode: 403 })) })
    expect((await routes.test(req(SUB))).status).toBe(502)
    const timeout = setup({ send: () => Promise.reject(new Error("Socket timeout")) })
    expect((await timeout.routes.test(req(SUB))).status).toBe(502)
    expect(calls.map((c) => c.fn)).toEqual(["push_devices"])
  })

  it("the database not answering is not a verdict on the device", async () => {
    const { routes, sent } = setup({ rpcError: true })
    expect((await routes.test(req(SUB))).status).toBe(503)
    expect(sent).toEqual([])
  })

  it("limits each person to a few tests a minute", async () => {
    const { routes } = setup()
    for (let i = 0; i < TEST_LIMIT.capacity; i++) expect((await routes.test(req(SUB))).status).toBe(200)
    expect(await read(await routes.test(req(SUB)))).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } })
  })
})

describe("server keys", () => {
  it("are used only when the three values are present and well formed", () => {
    const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: PUBLIC, VAPID_PRIVATE_KEY: "x".repeat(43), VAPID_SUBJECT: "mailto:avisos@example.com" }
    expect(vapidFromEnv(env)).toEqual({ subject: "mailto:avisos@example.com", publicKey: PUBLIC, privateKey: "x".repeat(43) })
    expect(vapidFromEnv({ ...env, VAPID_SUBJECT: "https://example.com/contacto" })).not.toBeNull()
    expect(vapidFromEnv({ ...env, VAPID_SUBJECT: "mailto:" })).toBeNull()
    expect(vapidFromEnv({ ...env, VAPID_PRIVATE_KEY: "" })).toBeNull()
    expect(vapidFromEnv({ ...env, NEXT_PUBLIC_VAPID_PUBLIC_KEY: "short" })).toBeNull()
    expect(vapidFromEnv({})).toBeNull()
  })
})
