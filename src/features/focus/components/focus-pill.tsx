"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Pause, Timer } from "lucide-react"
import { cn } from "@/lib/utils"
import { activeMs, clock } from "../domain/time"
import { useFocusModel, useNow } from "../use-focus"

export function FocusPill(props: { className?: string; rail?: boolean }) {
  // usePathname needs a boundary on routes with runtime params (e.g. /goals/[id]).
  return (
    <Suspense fallback={null}>
      <Pill {...props} />
    </Suspense>
  )
}

/**
 * While a session is active (on this or another device) a pill in the app bar leads back to
 * it: «En foco · 32:10». Hidden on the Focus screen itself.
 */
function Pill({ className, rail = false }: { className?: string; rail?: boolean }) {
  const fm = useFocusModel()
  const pathname = usePathname()
  const session = fm?.active ?? null
  const running = session?.state === "running"
  const now = useNow(!!running, fm?.api.clockNow ?? Date.now, 1000)
  if (!fm || !session || pathname === "/focus") return null
  const left = session.plannedMinutes * 60_000 - activeMs(session.segments, now)
  const text = left >= 0 ? clock(left) : `+${clock(-left)}`
  return (
    <Link
      href="/focus"
      className={cn(
        "relative inline-flex h-10 items-center gap-2 rounded-full whitespace-nowrap border px-3 text-xs font-medium after:absolute after:-inset-1 after:content-[''] md:h-9",
        running ? "border-signal/40 bg-signal/10 text-signal" : "border-warning/40 bg-warning/10 text-warning",
        className
      )}
    >
      {running ? <Timer className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
      <span className={cn(rail ? "sr-only lg:not-sr-only" : "sr-only sm:not-sr-only")}>{running ? "En foco" : "En pausa"}</span>
      <span className={cn("num", rail && "hidden lg:inline")} aria-hidden>
        {text}
      </span>
      <span className="sr-only">. Volver al bloque</span>
    </Link>
  )
}
