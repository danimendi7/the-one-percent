"use client"

import Link from "next/link"
import { GraduationCap } from "lucide-react"
import { useHabits } from "@/features/habits/store/habit-store"
import { noteRecallSummary } from "../domain/stats"
import { intervalLabel } from "../domain/session"

/** Under an idea in Cerebro: it has cards in the review, and when they come back. */
export function NoteRecallChip({ noteId }: { noteId: string }) {
  const snap = useHabits()
  const s = snap ? noteRecallSummary(snap.state.recall, noteId, snap.today) : null
  if (!s) return null
  return (
    <Link href="/knowledge/brain/repaso" className="inline-flex min-h-11 items-center gap-1 text-xs text-text-secondary underline-offset-2 hover:underline md:min-h-10" data-testid="note-recall">
      <GraduationCap className="size-3.5" aria-hidden />
      {s.dueNow ? "Repaso pendiente hoy" : `Repaso ${intervalLabel(s.daysToNext)}`}
    </Link>
  )
}
