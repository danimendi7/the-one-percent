import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  base64UrlToBytes,
  bytesToBase64Url,
  deviceLabel,
  isIOS,
  isPushEndpoint,
  isServerKey,
  parseDevices,
  parseSubscription,
  pushAvailability,
  sameServerKey,
  TEST_NOTIFICATION,
  type PushEnvironment,
} from "./push"

// A real P-256 public key whose private key was discarded: nothing can be sent with it.
const KEY = "BMvEjgb5ntOXJI244QmBG0AWhMPPFnUp2np-PoRDO4sTSNboeeBNXgNGNutTdjUvx6Yjh17qINcUgm_Xe9T-26I"
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc:123", expirationTime: null, keys: { p256dh: KEY, auth: "tBHItJI5svbpez7KI4CCXg" } }

describe("push endpoints", () => {
  it("accept only real push services over https", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ])
      expect(isPushEndpoint(ok), ok).toBe(true)
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evil.example/fcm.googleapis.com/",
      "https://localhost:3000/api/push",
      "https://169.254.169.254/latest/meta-data/",
      "https://evilfcm.googleapis.com.example/",
      `https://fcm.googleapis.com/${"a".repeat(2048)}`,
      null,
      42,
    ])
      expect(isPushEndpoint(bad), String(bad).slice(0, 60)).toBe(false)
  })

  it("use the same rule as the database", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261110120000_push_subscriptions.sql"), "utf8")
    expect(sql).toContain(String.raw`'^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/'`)
  })
})

describe("a browser subscription", () => {
  it("is kept only with a valid endpoint, key and secret", () => {
    expect(parseSubscription(SUB)).toEqual({ endpoint: SUB.endpoint, keys: SUB.keys })
    expect(parseSubscription({ ...SUB, endpoint: "https://evil.example/x" })).toBeNull()
    expect(parseSubscription({ ...SUB, keys: { ...SUB.keys, p256dh: "short" } })).toBeNull()
    expect(parseSubscription({ ...SUB, keys: { ...SUB.keys, auth: "has spaces in it!!" } })).toBeNull()
    expect(parseSubscription({ endpoint: SUB.endpoint })).toBeNull()
    expect(parseSubscription(null)).toBeNull()
    expect(parseSubscription("x")).toBeNull()
  })

  it("server keys are base64url P-256 points", () => {
    expect(isServerKey(KEY)).toBe(true)
    expect(isServerKey(`${KEY}=`)).toBe(true)
    expect(isServerKey("")).toBe(false)
    expect(isServerKey(undefined)).toBe(false)
    expect(base64UrlToBytes(KEY)).toHaveLength(65)
  })

  it("knows whether it was made with the current server key", () => {
    const bytes = base64UrlToBytes(KEY)
    expect(bytesToBase64Url(bytes)).toBe(KEY)
    expect(sameServerKey(bytes.buffer, KEY)).toBe(true)
    expect(sameServerKey(bytes, `${KEY}=`)).toBe(true)
    const other = new Uint8Array(bytes)
    other[10] ^= 1
    expect(sameServerKey(other.buffer, KEY)).toBe(false)
    expect(sameServerKey(null, KEY)).toBe(false)
  })
})

describe("what this device can do", () => {
  const env: PushEnvironment = { demo: false, configured: true, serviceWorker: true, pushManager: true, notification: true, ios: false, standalone: false }

  it("needs an account and a configured server before anything else", () => {
    expect(pushAvailability({ ...env, demo: true })).toBe("demo")
    expect(pushAvailability({ ...env, configured: false })).toBe("unconfigured")
    expect(pushAvailability(env)).toBe("available")
  })

  it("on an iPhone in a Safari tab, asks to install the app; installed, it can subscribe", () => {
    const tab = { ...env, ios: true, pushManager: false, notification: false }
    expect(pushAvailability(tab)).toBe("install")
    expect(pushAvailability({ ...tab, standalone: true })).toBe("unsupported")
    expect(pushAvailability({ ...env, ios: true, standalone: true })).toBe("available")
  })

  it("says so when the browser has no web push", () => {
    expect(pushAvailability({ ...env, serviceWorker: false })).toBe("unsupported")
    expect(pushAvailability({ ...env, pushManager: false })).toBe("unsupported")
    expect(pushAvailability({ ...env, notification: false })).toBe("unsupported")
  })

  it("recognises iPadOS, which reports itself as a Mac", () => {
    expect(isIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true)
    expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true)
    expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false)
  })
})

describe("device names", () => {
  it("say the system and the browser", () => {
    const cases: [string, string, string?, number?][] = [
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "iPhone · Safari"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "iPad · Safari", "MacIntel", 5],
      ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", "Android · Chrome"],
      ["Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36", "Android · Samsung Internet"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0", "Windows · Edge"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "Mac · Chrome", "MacIntel", 0],
      ["Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0", "Linux · Firefox"],
      ["Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", "ChromeOS · Chrome"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1", "iPhone · Chrome"],
      ["curl/8.0", "Dispositivo · Navegador"],
    ]
    for (const [ua, label, platform, touch] of cases) expect(deviceLabel(ua, platform, touch), ua.slice(0, 50)).toBe(label)
  })

  it("fit the 60 characters the database allows", () => {
    expect(deviceLabel("Android SamsungBrowser/1").length).toBeLessThanOrEqual(60)
  })
})

describe("the device list", () => {
  it("keeps only well-formed rows and marks this device", () => {
    const rows = [
      { id: "a", label: "iPhone · Safari", created_at: "2026-11-10T08:00:00Z", updated_at: "2026-11-10T08:00:00Z", current: false },
      { id: "b", label: "Mac · Chrome", created_at: "2026-11-10T09:00:00Z", current: true },
      { id: 3, label: "bad" },
      null,
    ]
    expect(parseDevices(rows)).toEqual([
      { id: "a", label: "iPhone · Safari", createdAt: "2026-11-10T08:00:00Z", current: false },
      { id: "b", label: "Mac · Chrome", createdAt: "2026-11-10T09:00:00Z", current: true },
    ])
    expect(parseDevices(null)).toEqual([])
  })
})

describe("the test notification", () => {
  it("carries no personal data and opens the settings", () => {
    expect(TEST_NOTIFICATION.url).toBe("/settings/notifications")
    expect(JSON.stringify(TEST_NOTIFICATION)).not.toMatch(/sueño|ánimo|estrés|energía|@/i)
  })
})
