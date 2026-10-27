"use client"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { pct } from "@/components/common/format"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { addDays, formatDate } from "@/features/habits/domain/dates"
import type { Habit } from "@/features/habits/domain/types"
import type { EvalContext } from "@/features/habits/domain/metrics"
import { HabitIcon } from "@/features/habits/components/habit-icon"
import { drilldown, type DrillRow, type DrillTarget } from "./domain/drilldown"
import { METRICS, type MetricId } from "./domain/catalog"

export interface DrillRequest {
  title: string
  metric: MetricId
  target: DrillTarget
  /** Show only some statuses (e.g. the "Exentos" figure lists exempt rows). The summary still covers the whole figure. */
  only?: DrillRow["status"][]
}

const STATUS: Record<DrillRow["status"], { label: string; dot: string }> = {
  missed: { label: "No cumplido", dot: "bg-text-tertiary" },
  pending: { label: "Pendiente hoy", dot: "border border-signal bg-transparent" },
  in_progress: { label: "Semana en curso", dot: "border border-signal bg-signal/30" },
  fulfilled: { label: "Cumplido", dot: "bg-signal" },
  exempt: { label: "Exento · descanso", dot: "hatch border border-border" },
}

export function DrillSheet({
  request,
  habits,
  ctx,
  onOpenChange,
}: {
  request: DrillRequest | null
  habits: Habit[]
  ctx: EvalContext
  onOpenChange: (open: boolean) => void
}) {
  const desktop = useMediaQuery("(min-width: 768px)")
  const result = request ? drilldown(habits, request.target, ctx) : null
  const rows = result ? result.rows.filter((r) => !request?.only || request.only.includes(r.status)) : []
  const byId = new Map(habits.map((h) => [h.id, h]))
  const groups = (Object.keys(STATUS) as DrillRow["status"][])
    .map((status) => ({ status, rows: rows.filter((r) => r.status === status) }))
    .filter((g) => g.rows.length > 0)

  return (
    <Sheet open={request !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[88dvh] rounded-t-3xl")}
      >
        {request && result && (
          <>
            <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
              <SheetTitle className="text-lg">{request.title}</SheetTitle>
              <SheetDescription>{METRICS[request.metric].formula}</SheetDescription>
              <p className="num pt-2 text-sm" data-testid="drill-summary">
                <span className="text-2xl font-semibold text-foreground">{pct(result.summary.rate)}</span>
                <span className="ml-2 text-text-secondary">
                  {result.summary.fulfilled} cumplidas de {result.summary.applicable} aplicables
                  {result.summary.exempt > 0 && ` · ${result.summary.exempt} exentas`}
                  {result.summary.inProgress > 0 && ` · ${result.summary.inProgress} en curso`}
                </span>
              </p>
            </SheetHeader>
            {/* Rows are not interactive, so the scroll area itself takes focus for keyboard scrolling. */}
            <div
              role="group"
              aria-label="Registros"
              tabIndex={0}
              className="pb-safe flex-1 overflow-y-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            >
              {groups.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-text-tertiary">No hay registros que mostrar en esta selección.</p>
              ) : (
                groups.map((g) => (
                  <section key={g.status} aria-label={STATUS[g.status].label}>
                    <h3 className="sticky top-0 flex items-center gap-2 border-b border-border/70 bg-surface px-5 py-2 text-xs font-medium text-text-secondary">
                      <span className={cn("size-2.5 rounded-full", STATUS[g.status].dot)} aria-hidden />
                      {STATUS[g.status].label}
                      <span className="num ml-auto text-text-tertiary">{g.rows.length}</span>
                    </h3>
                    <ul className="divide-y divide-border/50">
                      {g.rows.map((r) => {
                        const h = byId.get(r.habitId)
                        return (
                          <li key={`${r.habitId}:${r.date}`} className="flex min-h-12 items-center gap-3 px-5 py-2">
                            {h && <HabitIcon icon={h.icon} dimensionId={h.dimensionId} size="sm" />}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{r.habitName}</span>
                              <span className="block text-xs text-text-tertiary">
                                {r.kind === "day"
                                  ? formatDate(r.date, { weekday: "long", day: "numeric", month: "long" })
                                  : `Semana del ${formatDate(r.date, { day: "numeric", month: "short" })} al ${formatDate(addDays(r.date, 6), { day: "numeric", month: "short" })}`}
                              </span>
                            </span>
                            {r.kind === "week" && (
                              <span className="num text-xs text-text-secondary">
                                {r.achieved}/{r.target}
                              </span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
