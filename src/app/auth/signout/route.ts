import { NextResponse, type NextRequest } from "next/server"
import { DEMO_COOKIE } from "@/lib/supabase/env"
import { getSupabaseServer } from "@/lib/supabase/server"

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServer()
  await supabase.auth.signOut()
  const res = NextResponse.redirect(new URL("/login", request.url), { status: 303 })
  res.cookies.delete(DEMO_COOKIE)
  return res
}
