/**
 * E8 · Web push on each device (PRD §5.3). Pure decisions with no browser API: what this device can
 * do, how it is named in the list of devices, and the checks a subscription must pass before it is
 * stored or used. The browser side is in ../push/push-client.ts and the sender in ../push/server.ts.
 */

/**
 * Only real push services: Chrome and Android (FCM), Firefox, Safari and iOS (Apple) and Edge (WNS).
 * The server never posts anywhere else. Mirrors the check of `push_subscriptions.endpoint`.
 */
const PUSH_SERVICE = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)\//
const KEY = /^[A-Za-z0-9_-]{80,100}={0,2}$/
const SECRET = /^[A-Za-z0-9_-]{16,32}={0,2}$/

export function isPushEndpoint(url: unknown): url is string {
  return typeof url === "string" && url.length <= 2048 && PUSH_SERVICE.test(url)
}

/** A base64url public key of the size of a P-256 point (65 bytes), as VAPID and browsers use. */
export function isServerKey(key: unknown): key is string {
  return typeof key === "string" && KEY.test(key)
}

export interface SubscriptionJson {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** The `toJSON()` of a browser subscription, checked like the database does; null if anything is off. */
export function parseSubscription(v: unknown): SubscriptionJson | null {
  if (!v || typeof v !== "object") return null
  const o = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null }
  const p256dh = o.keys?.p256dh
  const auth = o.keys?.auth
  if (!isPushEndpoint(o.endpoint) || typeof p256dh !== "string" || !KEY.test(p256dh) || typeof auth !== "string" || !SECRET.test(auth)) return null
  return { endpoint: o.endpoint, keys: { p256dh, auth } }
}

export interface PushEnvironment {
  /** The local demo: there is no account to register a device to. */
  demo: boolean
  /** The server has a public VAPID key. */
  configured: boolean
  serviceWorker: boolean
  pushManager: boolean
  notification: boolean
  ios: boolean
  /** Opened from the home screen (installed PWA). */
  standalone: boolean
}

/**
 * - demo: nothing is registered without an account.
 * - unconfigured: this server has no VAPID keys yet, so no device can subscribe.
 * - install: iPhone or iPad in a Safari tab; push needs the app added to the home screen.
 * - unsupported: this browser has no web push.
 * - available: the person can turn it on here.
 * In every case except `available` the reminders still reach the in-app inbox.
 */
export type PushAvailability = "demo" | "unconfigured" | "install" | "unsupported" | "available"

export function pushAvailability(env: PushEnvironment): PushAvailability {
  if (env.demo) return "demo"
  if (!env.configured) return "unconfigured"
  const capable = env.serviceWorker && env.pushManager && env.notification
  if (env.ios && !env.standalone && !capable) return "install"
  return capable ? "available" : "unsupported"
}

/** iPadOS reports itself as a Mac; a Mac has no touch points. */
export function isIOS(ua: string, platform = "", maxTouchPoints = 0): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1)
}

/** «iPhone · Safari», «Android · Chrome»… how a device appears in the list. Never includes an id. */
export function deviceLabel(ua: string, platform = "", maxTouchPoints = 0): string {
  const os = /iPhone|iPod/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /Macintosh|Mac OS X/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : "Dispositivo"
  const browser = /Edg(A|iOS)?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\/|Chromium\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Navegador"
  return `${os} · ${browser}`
}

export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64Url(bytes: ArrayBuffer | ArrayBufferView): string {
  const u8 = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let bin = ""
  for (const b of u8) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Whether a browser subscription was made with this server key (after a key change it no longer works). */
export function sameServerKey(applicationServerKey: ArrayBuffer | ArrayBufferView | null | undefined, key: string): boolean {
  if (!applicationServerKey) return false
  return bytesToBase64Url(applicationServerKey) === key.replace(/=+$/, "")
}

/** The only notification this version sends: no personal data, so it can show on a lock screen. */
export const TEST_NOTIFICATION = {
  title: "THE ONE PERCENT",
  body: "Notificación de prueba: este dispositivo recibe avisos.",
  url: "/settings/notifications",
  tag: "top-test",
} as const

export interface PushDevice {
  id: string
  label: string
  createdAt: string
  /** The row of the endpoint this device has right now. */
  current: boolean
}

/** The answer of `push_devices`, keeping only well-formed rows. */
export function parseDevices(v: unknown): PushDevice[] {
  if (!Array.isArray(v)) return []
  const out: PushDevice[] = []
  for (const r of v) {
    if (!r || typeof r !== "object") continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== "string" || typeof o.label !== "string" || typeof o.created_at !== "string") continue
    out.push({ id: o.id, label: o.label, createdAt: o.created_at, current: o.current === true })
  }
  return out
}
