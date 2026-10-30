"use client"

import { useEffect } from "react"

/**
 * Registers the service worker (public/sw.js, M4f · P17) in production builds only, then asks it to
 * prepare the offline shell once the app has started with a connection. It never receives or stores
 * user data: only the static pages and files of this version.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0"
    let cancelled = false
    const warm = (reg: ServiceWorkerRegistration) => {
      if (!navigator.onLine) return
      ;(reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "top:warm" })
    }
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (cancelled) return
        // Leave the first seconds to the app itself; the shell is prepared after.
        setTimeout(() => !cancelled && warm(reg), 3000)
      })
      .catch(() => {
        // No service worker (private mode, unsupported): the app works online as before.
      })
    return () => {
      cancelled = true
    }
  }, [])
  return null
}
