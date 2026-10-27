import type { EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"
import { DEMO_COOKIE } from "@/lib/supabase/env"
import { getSupabaseServer } from "@/lib/supabase/server"

const ALLOWED_TYPES: EmailOtpType[] = ["email", "magiclink", "signup"]

/**
 * Email landing. Two flows:
 * - token_hash (our templates): works on any device, no PKCE verifier needed.
 * - code (Supabase's default {{ .ConfirmationURL }}): PKCE exchange, only in the
 *   browser that requested the email, because the verifier lives in its cookie.
 * Either way the session is written to the auth cookies before redirecting home.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const tokenHash = url.searchParams.get("token_hash")
  const type = url.searchParams.get("type") as EmailOtpType | null
  const code = url.searchParams.get("code")

  const fail = NextResponse.redirect(new URL("/login?error=link", request.url))
  // Auth redirects here with ?error=… when the link was expired or already used.
  if (url.searchParams.has("error")) return fail

  const supabase = await getSupabaseServer({ secure: url.protocol === "https:" })
  let ok = false
  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error
  }
  if (!ok) return fail

  const res = NextResponse.redirect(new URL("/", request.url))
  res.cookies.delete(DEMO_COOKIE)
  return res
}
