"use client"

import { createStore, del, get, set } from "idb-keyval"
import type { PersistedSync, SyncStorage } from "./engine"

const store = typeof indexedDB !== "undefined" ? createStore("the-one-percent", "sync") : null

/** Durable per-user cache + operation queue in IndexedDB. */
export function idbStorage(userId: string): SyncStorage {
  const key = `v1:${userId}`
  return {
    async load() {
      if (!store) return null
      return ((await get(key, store)) as PersistedSync | undefined) ?? null
    },
    async save(data) {
      if (!store) throw new Error("IndexedDB unavailable")
      await set(key, data, store)
    },
  }
}

export async function clearUserCache(userId: string): Promise<void> {
  if (store) await del(`v1:${userId}`, store)
}

const DEVICE_KEY = "the-one-percent:device-id"

export function deviceId(generate: () => string): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = generate()
      window.localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return generate()
  }
}
