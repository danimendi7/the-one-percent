"use client"

import { useSyncExternalStore } from "react"
import type { InboxItem } from "../domain/inbox"

/** The inbox of this device, per data source (the demo, or each account), in localStorage. */
const listeners = new Set<() => void>()
const cache = new Map<string, { raw: string | null; items: InboxItem[] }>()
const EMPTY: InboxItem[] = []
const key = (scope: string) => `the-one-percent:inbox:${scope}`

function parse(raw: string | null): InboxItem[] {
  if (!raw) return EMPTY
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? (v.filter((i) => i && typeof i.key === "string" && typeof i.title === "string") as InboxItem[]) : EMPTY
  } catch {
    return EMPTY
  }
}

export function readInbox(scope: string): InboxItem[] {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(key(scope))
  } catch {
    // storage unavailable: an empty inbox
  }
  const hit = cache.get(scope)
  if (hit && hit.raw === raw) return hit.items
  const items = parse(raw)
  cache.set(scope, { raw, items })
  return items
}

export function writeInbox(scope: string, items: InboxItem[]): void {
  try {
    window.localStorage.setItem(key(scope), JSON.stringify(items))
  } catch {
    // storage unavailable: nothing to keep
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => e.key?.startsWith("the-one-percent:inbox:") && listener()
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function useInbox(scope: string | null): InboxItem[] {
  return useSyncExternalStore(
    subscribe,
    () => (scope ? readInbox(scope) : EMPTY),
    () => EMPTY
  )
}
