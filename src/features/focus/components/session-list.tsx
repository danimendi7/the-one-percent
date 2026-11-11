"use client"

import { ChevronRight } from "lucide-react"
import { capitalize, formatDate, type LocalDate } from "@/features/habits/domain/dates"
import type { Habit } from "@/features/habits/domain/types"
import { activeSeconds, endedAt, hhmm, minutesOf } from "../domain/time"
import type { FocusSession } from "../domain/types"
import { minutesLabel, NO_PROJECT_LABEL, RatingStars } from "./focus-ui"

/** Finished sessions grouped by day, newest first. Each row opens the edit sheet. */
export function SessionList({
  sessions,
  habits,
  timezone,
  today,
  onOpen,
}: {
  sessions: FocusSession[]
  habits: Habit[]
  timezone: string
  today: LocalDate
  onOpen?: (s: FocusSession) => void
}) {
  const byDay = new Map<LocalDate, FocusSession[]>()
  for (const s of sessions) byDay.set(s.localDate, [...(byDay.get(s.localDate) ?? []), s])
  const names = new Map(habits.map((h) => [h.id, h.name]))
  return (
    <div className="space-y-4">
      {[...byDay].map(([day, list]) => {
        const total = minutesOf(list.reduce((a, s) => a + activeSeconds(s.segments), 0))
        return (
          <section key={day} aria-label={day === today ? "Hoy" : capitalize(formatDate(day, { weekday: "long", day: "numeric", month: "long" }))}>
            <h3 className="mb-1.5 flex items-baseline justify-between px-1 text-xs font-medium text-text-tertiary">
              <span>{day === today ? "Hoy" : capitalize(formatDate(day, { weekday: "long", day: "numeric", month: "short" }))}</span>
              <span className="num">{minutesLabel(total)}</span>
            </h3>
            <ul className="panel divide-y divide-border/70 overflow-hidden rounded-2xl">
              {list.map((s) => {
                const min = minutesOf(activeSeconds(s.segments))
                const end = endedAt(s)
                const body = (
                  <>
                    <span className="num w-[5.5rem] shrink-0 text-xs text-text-secondary">
                      {hhmm(s.segments[0].start, timezone)}–{end ? hhmm(end, timezone) : "…"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.project ?? NO_PROJECT_LABEL}</span>
                      <span className="block truncate text-xs text-text-tertiary">
                        {s.actualOutput ?? s.plannedOutput ?? (s.habitId && names.get(s.habitId) ? `Alimenta «${names.get(s.habitId)}»` : "Sin resultado anotado")}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="num text-sm font-semibold">{min} min</span>
                      <RatingStars value={s.rating} />
                      {(s.interruptions ?? null) !== null && <span className="text-xs text-text-tertiary">{s.interruptions === 1 ? "1 interrupción" : `${s.interruptions} interrupciones`}</span>}
                    </span>
                    {onOpen && (
                      <>
                        <ChevronRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                        <span className="sr-only">. Editar</span>
                      </>
                    )}
                  </>
                )
                return (
                  <li key={s.id}>
                    {onOpen ? (
                      <button
                        type="button"
                        onClick={() => onOpen(s)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-raised/50"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
