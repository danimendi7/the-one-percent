import type { EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"
import { DEMO_COOKIE } from "@/lib/supabase/env"
import { getSupabaseServer } from "@/lib/supabase/server"

const ALLOWED_TYPES: EmailOtpType[] = ["email", "magiclink"]

/**
 * Magic-link landing. Uses the token-hash flow, so a link requested on one
 * device can be opened on another (no PKCE verifier needed).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const tokenHash = url.searchParams.get("token_hash")
  const type = url.searchParams.get("type") as EmailOtpType | null

  const fail = NextResponse.redirect(new URL("/login?error=link", request.url))
  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) return fail

  const supabase = await getSupabaseServer()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) return fail

  const res = NextResponse.redirect(new URL("/", request.url))
  res.cookies.delete(DEMO_COOKIE)
  return res
}
