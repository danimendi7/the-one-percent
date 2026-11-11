import { createClient } from "@supabase/supabase-js"
import { sendNotification } from "web-push"
import { createDispatchRoute } from "@/features/notifications/push/dispatch"
import { vapidFromEnv } from "@/features/notifications/push/server"

/**
 * Scheduled push (E9). Called by pg_cron + pg_net with `Authorization: Bearer <PUSH_DISPATCH_SECRET>`.
 * Needs, on the server only: PUSH_DISPATCH_SECRET, SUPABASE_SECRET_KEY and the three VAPID variables.
 * Without any of them it answers 503 and sends nothing (docs/publicacion.md).
 */
export const maxDuration = 60

const route = createDispatchRoute({
  secret: () => {
    const s = process.env.PUSH_DISPATCH_SECRET?.trim() ?? ""
    return s.length >= 32 ? s : null
  },
  vapid: () => vapidFromEnv(),
  db: () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
    const key = process.env.SUPABASE_SECRET_KEY?.trim() ?? ""
    if (!url || !key) return null
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  },
  // A reminder that arrives hours late says the wrong thing: it expires after 30 minutes.
  send: (sub, payload, vapid) => sendNotification(sub, payload, { vapidDetails: vapid, TTL: 1800, urgency: "normal", timeout: 10_000 }),
  now: () => new Date(),
})

export function POST(request: Request) {
  return route(request)
}
