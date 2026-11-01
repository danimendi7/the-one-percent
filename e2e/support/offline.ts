import type { BrowserContext, Page } from "@playwright/test"
import { localStatus } from "../../tests/integration/setup"

/**
 * No connection, made sure three times (M4-H1). Around the full reload that opening a page offline
 * causes, a request to Supabase sometimes reached the server unseen by Playwright: with `setOffline`
 * alone (3 of 6 runs on Windows) and still with every Supabase request routed to an abort (3 of 8 runs
 * on Linux, run 41312439556). So the page refuses it too: an init script, in every document before
 * the app's code, makes `fetch` to the local Supabase fail as a browser without network does while
 * the test is offline. A device with no network has no such gap. Only Supabase is refused this way:
 * IndexedDB, the service worker and the app's own pages behave as they would.
 */
const OFFLINE_KEY = "e2e:offline"
let cut = false

/** Before signing in: the abort route and the page guard, both idle until `setConnection(page, false)`. */
export async function strictOffline(context: BrowserContext) {
  cut = false
  const supabase = new URL(localStatus().API_URL).port
  await context.route((u) => u.port === supabase, (r) => (cut ? r.abort("internetdisconnected") : r.fallback()))
  await context.addInitScript(
    ([key, port]) => {
      const real = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href)
        if (url.port === port && localStorage.getItem(key) === "1") return Promise.reject(new TypeError("Failed to fetch"))
        return real(input, init)
      }
    },
    [OFFLINE_KEY, supabase] as const
  )
}

export async function setConnection(page: Page, online: boolean) {
  cut = !online
  await page.evaluate(([key, off]) => (off ? localStorage.setItem(key, "1") : localStorage.removeItem(key)), [OFFLINE_KEY, !online] as const)
  await page.context().setOffline(!online)
}
