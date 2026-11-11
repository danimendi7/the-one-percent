import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
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
  return (await verifiedSession(request, cfg)).caller
}

/**
 * The same check, plus a client that carries the caller's own session (RLS and auth.uid() apply),
 * for routes that also read or write the caller's rows (E8, /api/push/test). Null unless a user.
 */
export async function verifiedSession(
  request: Pick<NextRequest, "cookies">,
  cfg: AuthConfig = defaultAuthConfig
): Promise<{ caller: Caller; client: SupabaseClient | null }> {
  // Demo-only build (no Supabase): nobody can be verified, so nobody reaches the providers.
  if (!cfg.url || !cfg.key) return { caller: { kind: "unavailable" }, client: null }
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith(cfg.cookieName))
  if (!hasSession) return { caller: { kind: "anonymous" }, client: null }
  const supabase = createServerClient(cfg.url, cfg.key, {
    cookieOptions: { name: cfg.cookieName },
    cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} },
  })
  try {
    const { data, error } = await supabase.auth.getUser()
    if (data.user?.id) return { caller: { kind: "user", id: data.user.id }, client: supabase }
    // An Auth server that cannot answer is not a verdict on the caller.
    return { caller: error && (error.status === undefined || error.status >= 500) ? { kind: "unavailable" } : { kind: "anonymous" }, client: null }
  } catch {
    return { caller: { kind: "unavailable" }, client: null }
  }
}
