"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight, NotebookPen } from "lucide-react"
import type { LocalDate } from "@/features/habits/domain/dates"
import { periodLabel } from "../domain/periods"
import { dueReview, historyStart, type DueReview } from "../domain/overview"
import type { ReviewKind } from "../domain/types"
import { useReviewsModel } from "../use-reviews"
import { KIND_LABEL, reviewHref } from "./review-ui"

const SNOOZE_KEY = "the-one-percent:review-snooze"

function snoozedOn(kind: ReviewKind, start: LocalDate): string | null {
  try {
    return window.localStorage.getItem(`${SNOOZE_KEY}:${kind}:${start}`)
  } catch {
    return null
  }
}

/**
 * Resumen (plan §6.1): «Tu revisión semanal está lista» from the end of the week until it is
 * closed; the monthly one likewise. It can be put off until tomorrow (this device only). Nothing
 * shows without any data to review, or while an account cannot save reviews yet.
 */
export function ReviewCard() {
  const m = useReviewsModel()
  const [, setTick] = useState(0)
  if (!m || (m.source === "account" && !m.serverSaves)) return null
  const first = historyStart(m.state)
  if (!first) return null
  const due = (["month", "week"] as const)
    .map((k) => dueReview(m.state.reviews, k, m.today))
    .filter((d) => d.phase !== "closed" && first <= d.period.to && snoozedOn(d.period.kind, d.period.from) !== m.today)
  if (due.length === 0) return null
  const snooze = (d: DueReview) => {
    try {
      window.localStorage.setItem(`${SNOOZE_KEY}:${d.period.kind}:${d.period.from}`, m.today)
    } catch {
      // ignore: the card simply stays
    }
    setTick((t) => t + 1)
  }
  return (
    <div className="space-y-3">
      {due.map((d) => (
        <div key={d.period.kind} className="panel flex min-h-16 items-center gap-3.5 rounded-2xl border-signal/30 py-2 pr-2 pl-4" data-testid={`overview-review-${d.period.kind}`}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-raised">
            <NotebookPen className="size-4 text-signal" aria-hidden />
          </span>
          <Link href={reviewHref(d.period.kind, d.period.from)} className="group min-w-0 flex-1 py-1">
            <span className="block text-sm font-semibold">
              {d.phase === "draft" ? `Continúa tu ${KIND_LABEL[d.period.kind].title.toLowerCase()}` : `Tu ${KIND_LABEL[d.period.kind].title.toLowerCase()} está lista`}
            </span>
            <span className="block truncate text-xs text-text-tertiary">{periodLabel(d.period)}</span>
          </Link>
          <button type="button" onClick={() => snooze(d)} aria-label={`Posponer hasta mañana: ${periodLabel(d.period)}`} className="min-h-11 shrink-0 rounded-lg px-2.5 text-xs text-text-tertiary hover:bg-surface-raised hover:text-foreground">
            Mañana
          </button>
          <Link href={reviewHref(d.period.kind, d.period.from)} aria-label={`Abrir: ${periodLabel(d.period)}`} className="grid size-11 shrink-0 place-items-center rounded-lg text-text-tertiary hover:bg-surface-raised hover:text-foreground">
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      ))}
    </div>
  )
}
