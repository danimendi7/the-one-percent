import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { AUTH_COOKIE_NAME, SUPABASE_KEY, SUPABASE_URL } from "./env"

/** Server-side client bound to the request cookies (route handlers only). */
export async function getSupabaseServer() {
  const store = await cookies()
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) store.set(name, value, options)
      },
    },
  })
}
