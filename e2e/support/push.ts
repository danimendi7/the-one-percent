import type { BrowserContext } from "@playwright/test"

/**
 * E8 · A browser of the test run cannot subscribe at a real push service (it has no Google, Mozilla
 * or Apple account to talk to), so the page's PushManager is replaced by one that behaves like the
 * browser's: one subscription per browser profile, kept across reloads, with the server key the app
 * asked for. Each browser context is one device. The app, the server and the database are real.
 *
 * It also counts the permission prompts the app opens (`__permissionRequests`), and grants the
 * permission as a person tapping «Permitir» would.
 */
export async function fakePushDevice(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["notifications"])
  await context.addInitScript(() => {
    const KEY = "e2e:push-subscription"
    // Shapes of a real subscription's keys (65-byte point, 16-byte secret), base64url.
    const P256DH = "BMvEjgb5ntOXJI244QmBG0AWhMPPFnUp2np-PoRDO4sTSNboeeBNXgNGNutTdjUvx6Yjh17qINcUgm_Xe9T-26I"
    const AUTH = "tBHItJI5svbpez7KI4CCXg"
    type Raw = { endpoint: string; serverKey: number[] }
    const load = (): Raw | null => JSON.parse(localStorage.getItem(KEY) ?? "null")
    const make = (raw: Raw) => ({
      endpoint: raw.endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: new Uint8Array(raw.serverKey).buffer },
      toJSON: () => ({ endpoint: raw.endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }),
      getKey: () => null,
      unsubscribe: async () => {
        localStorage.removeItem(KEY)
        return true
      },
    })
    PushManager.prototype.getSubscription = async function () {
      const raw = load()
      return (raw ? make(raw) : null) as unknown as PushSubscription
    }
    PushManager.prototype.subscribe = async function (opts?: PushSubscriptionOptionsInit) {
      const key = opts?.applicationServerKey
      const bytes = key instanceof ArrayBuffer ? new Uint8Array(key) : ArrayBuffer.isView(key) ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength) : new Uint8Array()
      const raw: Raw = { endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`, serverKey: [...bytes] }
      localStorage.setItem(KEY, JSON.stringify(raw))
      return make(raw) as unknown as PushSubscription
    }
    const w = window as unknown as { __permissionRequests: number }
    w.__permissionRequests = 0
    const request = Notification.requestPermission.bind(Notification)
    Notification.requestPermission = (async () => {
      w.__permissionRequests++
      return request()
    }) as typeof Notification.requestPermission
  })
}

/** The endpoint this browser holds right now, or null. */
export async function deviceEndpoint(context: BrowserContext): Promise<string | null> {
  const page = context.pages()[0]
  return page.evaluate(() => (JSON.parse(localStorage.getItem("e2e:push-subscription") ?? "null") as { endpoint: string } | null)?.endpoint ?? null)
}

export const permissionRequests = (context: BrowserContext) => context.pages()[0].evaluate(() => (window as unknown as { __permissionRequests: number }).__permissionRequests)
