"use client"

import { Pause, Play, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProgressRing } from "@/components/common/progress-ring"
import { HabitIcon } from "@/features/habits/components/habit-icon"
import { activeMs, clock } from "../domain/time"
import type { FocusSession } from "../domain/types"
import type { FocusModel } from "../use-focus"
import { useNow } from "../use-focus"

/** «En foco» / «En pausa». Everything shown is computed from the session's timestamps. */
export function TimerPanel({ fm, session, onFinish }: { fm: FocusModel; session: FocusSession; onFinish: () => void }) {
  const running = session.state === "running"
  const now = useNow(running, fm.api.clockNow)
  const elapsed = activeMs(session.segments, now)
  const total = session.plannedMinutes * 60_000
  const over = elapsed >= total
  const remaining = Math.max(0, total - elapsed)
  const last = session.segments[session.segments.length - 1]
  const pausedFor = !running && last.end ? Math.max(0, now - Date.parse(last.end)) : 0
  const habit = session.habitId ? fm.state.habits.find((h) => h.id === session.habitId) : null
  const status = running ? (over ? "Bloque completado · tiempo extra" : "En foco") : "En pausa"

  return (
    <div className="flex w-full flex-col items-center">
      {/* State changes only, never every second. */}
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
      <ProgressRing
        value={Math.min(1, elapsed / total)}
        size={256}
        stroke={10}
        className="motion-reduce:[&_circle]:transition-none"
        label={over ? `Bloque de ${session.plannedMinutes} minutos completado; ${clock(elapsed - total)} de tiempo extra` : `Quedan ${clock(remaining)} de ${session.plannedMinutes} minutos`}
      >
        <div className="px-6 text-center">
          <p className="num text-[3.25rem] leading-none font-semibold tracking-tight" aria-hidden data-testid="focus-clock">
            {over ? `+${clock(elapsed - total)}` : clock(remaining)}
          </p>
          <p className={`mt-2 text-sm ${running ? (over ? "text-signal" : "text-text-secondary") : "text-warning"}`}>{status}</p>
          {!running && <p className="num mt-0.5 text-xs text-text-tertiary">Pausa {clock(pausedFor)}</p>}
        </div>
      </ProgressRing>

      <div className="mt-5 max-w-sm space-y-1 text-center">
        {session.project && <p className="text-sm font-medium">{session.project}</p>}
        {session.plannedOutput && <p className="text-sm text-text-secondary">{session.plannedOutput}</p>}
        <p className="num text-xs text-text-tertiary">
          {clock(elapsed)} efectivos de {session.plannedMinutes} min
        </p>
        {habit && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-text-tertiary">
            <HabitIcon icon={habit.icon} dimensionId={habit.dimensionId} size="sm" />
            Alimenta «{habit.name}»
          </p>
        )}
      </div>

      <div className="mt-6 flex w-full max-w-sm gap-3">
        {running ? (
          <Button size="lg" variant="secondary" className="h-12 flex-1" onClick={() => fm.api.pauseFocus(session.id)}>
            <Pause /> Pausar
          </Button>
        ) : (
          <Button size="lg" className="h-12 flex-1" onClick={() => fm.api.resumeFocus(session.id)}>
            <Play /> Reanudar
          </Button>
        )}
        <Button size="lg" variant="outline" className="h-12 flex-1" onClick={onFinish}>
          <Square /> Terminar
        </Button>
      </div>
    </div>
  )
}
