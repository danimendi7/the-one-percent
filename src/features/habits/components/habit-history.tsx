"use client"

import { useMemo, useState } from "react"
import { ChevronRight, History, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HABIT_HISTORY_LIMIT } from "@/features/sync/habit-history"
import { buildHabitHistory, type AuditRow } from "../domain/history"
import { habitActions, useHabits } from "../store/habit-store"

const PAGE = 20

type Load = { status: "idle" | "loading" | "error" } | { status: "ready"; rows: AuditRow[] }

/** «Historial de cambios» of a habit, read from the cloud only when opened. */
export function HabitHistory({ habitId }: { habitId: string }) {
  const snap = useHabits()
  const [load, setLoad] = useState<Load>({ status: "idle" })
  const [shown, setShown] = useState(PAGE)
  const demo = snap?.source !== "account"

  async function fetchRows() {
    setLoad({ status: "loading" })
    try {
      setLoad({ status: "ready", rows: await habitActions.loadHabitHistory!(habitId) })
    } catch {
      setLoad({ status: "error" })
    }
  }

  const state = snap?.state
  const items = useMemo(() => {
    if (load.status !== "ready" || !state) return []
    const names = new Map(state.dimensions.map((d) => [d.id as string, d.name]))
    return buildHabitHistory(load.rows, { dimensionName: (id) => names.get(id) ?? id })
  }, [load, state])
  const instant = useMemo(
    () => new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: state?.timezone }),
    [state?.timezone]
  )

  return (
    <details
      className="group rounded-xl border border-border"
      data-testid="habit-history"
      onToggle={(e) => {
        if (e.currentTarget.open && !demo && load.status === "idle") void fetchRows()
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <History className="size-4 text-text-tertiary" aria-hidden />
        <span className="flex-1">Historial de cambios</span>
        <ChevronRight className="size-4 text-text-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="border-t border-border/70 px-3 py-3 text-sm">
        {demo ? (
          <p className="text-xs leading-relaxed text-text-tertiary">Demo: aquí no se guarda el historial. Con una cuenta, cada cambio de este hábito queda registrado.</p>
        ) : load.status === "error" ? (
          <div className="space-y-2" role="alert">
            <p className="text-xs leading-relaxed text-warning">No se pudo cargar el historial: se consulta en la nube y necesita conexión.</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void fetchRows()}>
              Reintentar
            </Button>
          </div>
        ) : load.status !== "ready" ? (
          <p className="flex items-center gap-2 text-xs text-text-tertiary" role="status">
            <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            Cargando…
          </p>
        ) : items.length === 0 ? (
          <p className="text-xs leading-relaxed text-text-tertiary">Todavía no hay cambios registrados.</p>
        ) : (
          <>
            <ol className="space-y-3">
              {items.slice(0, shown).map((item) => (
                <li key={item.id} data-testid="habit-history-item">
                  <p className="font-medium">{item.title}</p>
                  {item.details.map((d) => (
                    <p key={d} className="mt-0.5 text-xs break-words text-text-secondary">
                      {d}
                    </p>
                  ))}
                  <p className="num mt-0.5 text-[0.6875rem] text-text-tertiary">{instant.format(new Date(item.at))}</p>
                </li>
              ))}
            </ol>
            {items.length > shown && (
              <Button type="button" variant="ghost" className="mt-2 min-h-11 w-full" onClick={() => setShown(shown + PAGE)}>
                Ver más
              </Button>
            )}
            {load.rows.length >= HABIT_HISTORY_LIMIT && <p className="mt-2 text-xs text-text-tertiary">Solo se consultan los {HABIT_HISTORY_LIMIT} cambios más recientes.</p>}
          </>
        )}
        {!demo && (snap?.sync?.pending ?? 0) > 0 && <p className="mt-3 text-xs leading-relaxed text-text-tertiary">Hay cambios sin enviar: aparecerán aquí cuando lleguen a la nube.</p>}
      </div>
    </details>
  )
}
