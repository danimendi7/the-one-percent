import { createServerClient } from "@supabase/ssr"
import type { NextRequest } from "next/server"
import { AUTH_COOKIE_NAME, SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env"

/**
 * Who is calling, verified by the Auth server (`getUser()` checks the token there; the cookie is
 * never trusted on its own). The demo cookie plays no part: a demo visitor has no Supabase user,
 * so it is anonymous here. Cookies are read from the request and never written: refreshing the
 * session is the proxy's job (src/proxy.ts).
 */
export type Caller = { kind: "user"; id: string } | { kind: "anonymous" } | { kind: "unavailable" }

export interface AuthConfig {
  url: string
  key: string
  cookieName: string
}

export const defaultAuthConfig: AuthConfig = { url: SUPABASE_URL, key: SUPABASE_KEY, cookieName: AUTH_COOKIE_NAME }

export async function callerOf(request: Pick<NextRequest, "cookies">, cfg: AuthConfig = defaultAuthConfig): Promise<Caller> {
  // Demo-only build (no Supabase): nobody can be verified, so nobody reaches the providers.
  if (!cfg.url || !cfg.key) return { kind: "unavailable" }
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith(cfg.cookieName))
  if (!hasSession) return { kind: "anonymous" }
  const supabase = createServerClient(cfg.url, cfg.key, {
    cookieOptions: { name: cfg.cookieName },
    cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} },
  })
  try {
    const { data, error } = await supabase.auth.getUser()
    if (data.user?.id) return { kind: "user", id: data.user.id }
    // An Auth server that cannot answer is not a verdict on the caller.
    return error && (error.status === undefined || error.status >= 500) ? { kind: "unavailable" } : { kind: "anonymous" }
  } catch {
    return { kind: "unavailable" }
  }
}
