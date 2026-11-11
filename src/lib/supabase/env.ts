/**
 * Public Supabase configuration. The app only uses the URL and the publishable (anon) key; both
 * are safe to expose. The one exception is the scheduled push route (E9), which reads the secret
 * key on the server (src/app/api/push/dispatch/route.ts).
 * When unset, the app runs in local demo mode only (as in M1).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

export const isSupabaseConfigured = SUPABASE_URL !== "" && SUPABASE_KEY !== ""

/** Cookie that lets a visitor use the local demo without an account. */
export const DEMO_COOKIE = "top_mode"

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"])

/**
 * Local development convenience: when the configured API is on loopback but the
 * page was opened from another device on the LAN (http://192.168.x.x:3000),
 * reach the same local stack through the page's host. Never applies to a
 * remote (cloud) URL.
 */
export function resolveSupabaseUrl(pageHostname?: string): string {
  if (!SUPABASE_URL || !pageHostname) return SUPABASE_URL
  const url = new URL(SUPABASE_URL)
  if (LOOPBACK.has(url.hostname) && !LOOPBACK.has(pageHostname)) {
    url.hostname = pageHostname
    return url.toString().replace(/\/$/, "")
  }
  return SUPABASE_URL
}

/**
 * Fixed auth cookie name. By default it derives from the API host, which differs
 * between the browser (LAN IP) and the server (127.0.0.1) in local network use,
 * so the server would not see the session.
 */
export const AUTH_COOKIE_NAME = "sb-top-auth-token"
