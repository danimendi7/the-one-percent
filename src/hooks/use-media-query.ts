"use client"

import { useCallback, useSyncExternalStore } from "react"

/** SSR-safe media query. Returns `fallback` on the server and before hydration. */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", cb)
      return () => mql.removeEventListener("change", cb)
    },
    [query]
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => fallback
  )
}
