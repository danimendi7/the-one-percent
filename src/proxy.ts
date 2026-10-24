import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { AUTH_COOKIE_NAME, DEMO_COOKIE, isSupabaseConfigured, SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env"

const PUBLIC_PATHS = ["/login", "/auth/"]

/**
 * Refreshes the Supabase session cookie and keeps the app private: without a
 * session (or an explicit choice to explore the demo) every page goes to /login.
 * When Supabase is not configured the app is demo-only, as in M1.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next()

  let response = NextResponse.next({ request })
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of list) response.cookies.set(name, value, options)
      },
    },
  })

  // getUser() validates the token with the Auth server (do not trust the cookie alone).
  const hasSessionCookie = request.cookies.getAll().some((c) => c.name.startsWith(AUTH_COOKIE_NAME))
  let userId: string | null = null
  let authUnreachable = false
  try {
    const { data, error } = await supabase.auth.getUser()
    userId = data.user?.id ?? null
    authUnreachable = !!error && hasSessionCookie && (error.status === undefined || error.status >= 500)
  } catch {
    authUnreachable = hasSessionCookie
  }

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p))
  const demo = request.cookies.get(DEMO_COOKIE)?.value === "demo"

  // If Auth is unreachable but a session exists, let the client work from its local cache.
  if (!userId && !demo && !isPublic && !authUnreachable) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    return NextResponse.redirect(url)
  }
  if (userId && path === "/login") {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }
  return response
}

export const config = {
  matcher: [
    // Everything except static assets, PWA files and icons.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|icons/).*)",
  ],
}
