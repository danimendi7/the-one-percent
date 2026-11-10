"use client"

import { useHabits } from "@/features/habits/store/habit-store"
import { dailyQueue } from "../domain/schedule"

/** How many cards are waiting today, for the «Repaso» tab of Cerebro. */
export function RecallCount() {
  const snap = useHabits()
  if (!snap) return null
  const n = dailyQueue(Object.values(snap.state.recall.cards), snap.today).queue.length
  if (n === 0) return null
  return (
    <span className="num rounded-full bg-signal/15 px-1.5 text-[0.6875rem] font-semibold text-signal" data-testid="recall-tab-count">
      {n}
    </span>
  )
}
