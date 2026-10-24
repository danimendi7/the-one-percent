"use client"

import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import { AUTH_COOKIE_NAME, isSupabaseConfigured, resolveSupabaseUrl, SUPABASE_KEY } from "./env"

let client: SupabaseClient | null = null

/** Browser Supabase client (session stored in cookies, shared with the proxy). */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (!isSupabaseConfigured || typeof window === "undefined") return null
  client ??= createBrowserClient(resolveSupabaseUrl(window.location.hostname), SUPABASE_KEY, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
  })
  return client
}
