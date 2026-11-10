"use client"

import Link from "next/link"
import { useMemo } from "react"
import { CheckCheck } from "lucide-react"
import { todayProgress } from "@/features/habits/domain/metrics"
import { activeHabits } from "@/features/habits/domain/ops"
import { useHabits } from "@/features/habits/store/habit-store"
import { FocusPill } from "@/features/focus/components/focus-pill"
import { BrandMark } from "./brand-mark"
import { SyncStatus } from "./sync-status"
import { InboxButton } from "@/features/notifications/inbox/inbox-button"

/** Mobile top bar: brand, persistent shortcut to today's checklist, data status. */
export function MobileHeader() {
  const snap = useHabits()
  const progress = useMemo(() => {
    if (!snap) return null
    return todayProgress(activeHabits(snap.state, snap.today), {
      entries: snap.state.entries,
      restDays: new Set(snap.state.restDays),
      today: snap.today,
    })
  }, [snap])

  return (
    <header className="pt-safe sticky top-0 z-(--z-header) border-b border-border/70 bg-background/85 backdrop-blur-xl md:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <Link href="/" aria-label="The One Percent, inicio" className="-m-2 rounded-xl p-2">
          <BrandMark className="size-7" />
        </Link>
        <div className="flex items-center gap-2">
          <FocusPill />
          <Link
            href="/habits"
            className="relative inline-flex h-10 items-center gap-2 rounded-full border border-border bg-surface pr-3.5 pl-3 text-xs font-medium text-foreground after:absolute after:-inset-1 after:content-['']"
          >
            <CheckCheck className="size-4 text-signal" aria-hidden />
            <span>Hoy</span>
            <span className="num text-text-secondary" aria-hidden>
              {progress ? `${progress.done}/${progress.total}` : "-/-"}
            </span>
            <span className="sr-only">{progress ? `: ${progress.done} de ${progress.total} hábitos hechos` : ""}</span>
          </Link>
          <InboxButton />
          <SyncStatus compact />
        </div>
      </div>
    </header>
  )
}
