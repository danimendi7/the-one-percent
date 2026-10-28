"use client"

import Link from "next/link"
import { ArrowRight, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { useNow } from "@/features/focus/use-focus"
import { checkinDate, checkinFor, defaultPhase } from "../domain/ops"
import { useMindModel } from "../use-mind"
import { checkinSummary, phaseTitle } from "./mind-ui"

/**
 * Resumen: only the check-in that is due now. Pending: one tap opens it. Done: a one-line summary.
 * No streaks, no guilt; hidden while an account cannot save check-ins yet.
 */
export function CheckinCard() {
  const m = useMindModel()
  const t = useNow(false, m?.clockNow ?? Date.now)
  if (!m || !m.saved) return null
  const phase = defaultPhase(t, m.timezone)
  const c = checkinFor(m.state, checkinDate(t, phase, m.timezone), phase)
  const Icon = phase === "am" ? Sun : Moon
  return (
    <Link
      href={c ? "/mind" : `/mind?checkin=${phase}`}
      data-testid="overview-checkin"
      className={cn(
        "panel group flex min-h-16 items-center gap-3.5 rounded-2xl px-4 py-3 transition-colors hover:bg-surface-raised",
        !c && "border-dim-mind/40"
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-raised">
        <Icon className="size-4 text-dim-mind" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{phaseTitle(phase)}</span>
        <span className="num block truncate text-xs text-text-tertiary">{c ? checkinSummary(c) : "Unos segundos · 3 toques"}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
    </Link>
  )
}
