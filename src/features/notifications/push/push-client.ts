"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  base64UrlToBytes,
  deviceLabel,
  isIOS,
  isServerKey,
  parseDevices,
  parseSubscription,
  sameServerKey,
  type PushDevice,
  type PushEnvironment,
} from "../domain/push"

/**
 * E8 · The browser side of push on this device. Each device subscribes and unsubscribes on its own:
 * the browser keeps its subscription, the server keeps one row per subscription, and nothing here
 * touches another device's row except an explicit «Quitar» from the list.
 *
 * The permission prompt is only ever opened by `enable`, which the settings call from a tap.
 */

/** Public key of this deployment (inlined at build time); empty when push is not configured. */
export const SERVER_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim()
export const pushConfigured = isServerKey(SERVER_KEY)

export function readEnvironment(demo: boolean): PushEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean }
  return {
    demo,
    configured: pushConfigured,
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    ios: isIOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    standalone: nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
  }
}

export class PushError extends Error {
  constructor(readonly code: "no_worker" | "denied" | "dismissed" | "subscribe_failed" | "server" | "device_limit" | "offline") {
    super(code)
  }
}

/** The service worker registration, waiting a little for it (it registers just after load). */
async function registration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ])
  if (!reg) throw new PushError("no_worker")
  return reg
}

/** This browser's current subscription, if any (no prompt, no network). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration("/")
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** Registered devices of the account, marking this one. */
export async function listDevices(sb: SupabaseClient): Promise<PushDevice[]> {
  const sub = await currentSubscription().catch(() => null)
  const { data, error } = await sb.rpc("push_devices", { p_endpoint: sub?.endpoint ?? null })
  if (error) throw new PushError(navigator.onLine ? "server" : "offline")
  return parseDevices(data)
}

async function register(sb: SupabaseClient, sub: PushSubscription): Promise<"registered" | "taken"> {
  const json = parseSubscription(sub.toJSON())
  if (!json) throw new PushError("subscribe_failed")
  const { data, error } = await sb.rpc("push_subscribe", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_vapid_key: SERVER_KEY,
    p_label: deviceLabel(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
  })
  if (error) throw new PushError(/device_limit/.test(error.message ?? "") ? "device_limit" : navigator.onLine ? "server" : "offline")
  return (data as { status?: string } | null)?.status === "taken" ? "taken" : "registered"
}

async function subscribe(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  try {
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(SERVER_KEY) })
  } catch {
    throw new PushError("subscribe_failed")
  }
}

/**
 * Turns push on for this device, from a tap: asks for permission, subscribes the browser with this
 * server's key and registers the subscription to the account.
 */
export async function enable(sb: SupabaseClient): Promise<void> {
  if (!navigator.onLine) throw new PushError("offline")
  const permission = await Notification.requestPermission()
  if (permission !== "granted") throw new PushError(permission === "denied" ? "denied" : "dismissed")
  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  // Made with another server key (keys changed): it no longer works, so it is replaced.
  if (sub && !sameServerKey(sub.options.applicationServerKey, SERVER_KEY)) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  sub ??= await subscribe(reg)
  if ((await register(sb, sub)) === "registered") return
  // The browser kept an address that belongs to another account: ask it for a new one.
  await sub.unsubscribe().catch(() => false)
  if ((await register(sb, await subscribe(reg))) !== "registered") throw new PushError("server")
}

/**
 * Turns push off for this device only: first the server forgets it (so nothing more is sent even
 * if the browser fails to unsubscribe), then the browser drops the subscription.
 */
export async function disable(sb: SupabaseClient): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const { error } = await sb.rpc("push_forget", { p_endpoint: sub.endpoint })
  if (error) throw new PushError(navigator.onLine ? "server" : "offline")
  await sub.unsubscribe().catch(() => false)
}

/** Removes another device from the list (a lost phone). That device stops receiving pushes. */
export async function removeDevice(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("push_remove", { p_id: id })
  if (error) throw new PushError(navigator.onLine ? "server" : "offline")
}

export type TestResult = "accepted" | "gone" | "not_registered" | "not_configured" | "rate_limited" | "failed"

/** Asks the server to send the test notification to this device. */
export async function sendTest(): Promise<TestResult> {
  const sub = await currentSubscription()
  if (!sub) return "not_registered"
  try {
    const res = await fetch("/api/push/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()), credentials: "same-origin" })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { code?: string } } | null
    if (res.ok && body?.ok) return "accepted"
    const code = body?.error?.code
    return code === "gone" || code === "not_registered" || code === "not_configured" || code === "rate_limited" ? code : "failed"
  } catch {
    return "failed"
  }
}

/**
 * On sign-out: the next person using this browser must not get this account's notifications. The
 * server forgets the device and the browser drops the subscription, both at once and best effort:
 * it never holds the sign-out for more than `timeoutMs`.
 */
export async function forgetThisDevice(sb: SupabaseClient | null, timeoutMs = 3000): Promise<void> {
  const work = (async () => {
    const sub = await currentSubscription()
    if (!sub) return
    await Promise.allSettled([sb ? sb.rpc("push_forget", { p_endpoint: sub.endpoint }) : null, sub.unsubscribe()])
  })().catch(() => {})
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}
