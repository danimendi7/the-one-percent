"use client"

import Link from "next/link"
import { useState } from "react"
import { ChevronRight, LineChart as LineIcon, Table2, Timer } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { EmptyState } from "@/components/common/empty-state"
import { pct } from "@/components/common/format"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { addDays, formatDate, type LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { FOCUS_METRICS, FOCUS_RULES, type FocusMetricId } from "@/features/analytics/domain/catalog"
import {
  focusDataLevel,
  focusSeries,
  focusStreak,
  isComplete,
  NO_PROJECT,
  sameProject,
  sessionsIn,
  sessionsInBucket,
  summarizeSessions,
  type FocusScope,
} from "../domain/metrics"
import type { FocusSession } from "../domain/types"
import { minutesLabel, NO_PROJECT_LABEL } from "./focus-ui"
import { SessionList } from "./session-list"

interface Drill {
  title: string
  metric: FocusMetricId
  sessions: FocusSession[]
}

const axisTick = { fill: "var(--text-tertiary)", fontSize: 11 }

/**
 * Focus in Analytics (catalog v3). Period and project live in the URL with the other filters.
 * Habit, dimension and goal filters do not apply here: sessions are scoped by period and project.
 */
export function FocusAnalytics({
  state,
  today,
  range,
  periodLabel,
  project,
  onProject,
}: {
  state: HabitsState
  today: LocalDate
  range: DateRange
  periodLabel: string
  project: string | "all"
  onProject: (p: string | "all") => void
}) {
  const [drill, setDrill] = useState<Drill | null>(null)
  const [table, setTable] = useState(false)
  const projects = projectOptions(state)
  const scope: FocusScope = { range, project: project !== "all" && !projects.some((p) => sameProject({ project: p || null }, project)) ? "all" : project }
  const list = sessionsIn(state, scope)
  const sum = summarizeSessions(list)
  const level = focusDataLevel(state, scope, today)
  const streak = focusStreak(state, today, scope.project)
  const series = focusSeries(state, scope)
  const projectName = (p: string) => (p === NO_PROJECT ? NO_PROJECT_LABEL : p)
  const anyEver = state.focusSessions.some((s) => s.state === "finished")

  return (
    <section id="enfoque" className="scroll-mt-20 space-y-4" aria-labelledby="focus-analytics-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="focus-analytics-title" className="flex items-center gap-2 text-lg font-semibold">
            Enfoque
            {level === "few" && <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] font-normal text-text-tertiary">Pocos datos</span>}
          </h2>
          <p className="mt-0.5 text-xs text-text-tertiary">Sesiones terminadas en {periodLabel}. Los filtros de hábito y dimensión no se aplican aquí.</p>
        </div>
        {projects.length > 0 && (
          <Select value={scope.project === "all" ? "__all" : `p:${scope.project}`} onValueChange={(v) => onProject(v === "__all" ? "all" : v.slice(2))}>
            <SelectTrigger className="h-11! w-full sm:w-56" aria-label="Proyecto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos los proyectos</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p || "__none"} value={`p:${p}`}>
                  {projectName(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {level === "none" ? (
        <div className="panel rounded-2xl">
          <EmptyState
            icon={Timer}
            title={anyEver ? "Sin sesiones en este periodo" : "Aún no hay sesiones de enfoque"}
            description={anyEver ? "Amplía el periodo o elige otro proyecto." : "Los minutos, bloques completos y proyectos aparecerán aquí al terminar tu primer bloque."}
            className="py-8"
            action={
              !anyEver ? (
                <Button asChild variant="outline">
                  <Link href="/focus">Ir a Enfoque</Link>
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <FocusStat
              label={FOCUS_METRICS.focus_minutes.label}
              value={minutesLabel(sum.minutes)}
              detail={`en ${sum.days} ${sum.days === 1 ? "día" : "días"}`}
              onOpen={() => setDrill({ title: `Minutos de foco en ${periodLabel}`, metric: "focus_minutes", sessions: list })}
            />
            <FocusStat
              label={FOCUS_METRICS.focus_sessions.label}
              value={String(sum.sessions)}
              detail="terminadas"
              onOpen={() => setDrill({ title: `Sesiones en ${periodLabel}`, metric: "focus_sessions", sessions: list })}
            />
            <FocusStat
              label={FOCUS_METRICS.focus_complete.label}
              value={pct(sum.completeRate)}
              detail={`${sum.complete} de ${sum.sessions} alcanzaron lo previsto`}
              onOpen={() => setDrill({ title: "Bloques completos", metric: "focus_complete", sessions: list.filter(isComplete) })}
            />
            <FocusStat
              label={FOCUS_METRICS.focus_rating.label}
              value={sum.avgRating === null ? "N/D" : sum.avgRating.toLocaleString("es-ES", { maximumFractionDigits: 1 })}
              detail={`${sum.rated} de ${sum.sessions} valoradas`}
              onOpen={sum.rated ? () => setDrill({ title: "Sesiones valoradas", metric: "focus_rating", sessions: list.filter((s) => s.rating !== null) }) : undefined}
            />
            <FocusStat label={FOCUS_METRICS.focus_streak.label} value={`${streak} d`} detail="seguidos con sesión" className="col-span-2 lg:col-span-1" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="panel rounded-2xl p-4 sm:p-5 xl:col-span-3">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">Minutos {series.unit === "week" ? "por semana" : "por día"}</h3>
                  <p className="mt-0.5 text-xs text-text-tertiary">{level === "few" ? "Tendencia oculta hasta tener más datos" : "Pulsa una barra o usa la tabla para ver sus sesiones"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTable(!table)}
                  aria-pressed={table}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-text-secondary hover:bg-surface-raised hover:text-foreground"
                >
                  {table ? <LineIcon className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
                  {table ? "Gráfico" : "Tabla"}
                </button>
              </div>
              {table || level === "few" ? (
                <SeriesTable
                  points={series.points.filter((p) => p.sessions > 0)}
                  unit={series.unit}
                  onOpen={(d) => setDrill({ title: bucketTitle(series.unit, d), metric: "focus_minutes", sessions: sessionsInBucket(state, scope, series.unit, d) })}
                />
              ) : (
                <div
                  className="h-56 cursor-pointer"
                  role="img"
                  aria-label={`Minutos de foco ${series.unit === "week" ? "por semana" : "por día"}: ${series.points.filter((p) => p.minutes > 0).map((p) => `${formatDate(p.date, { day: "numeric", month: "short" })} ${p.minutes} min`).join(", ") || "sin datos"}. Usa la vista de tabla para abrir el detalle.`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={series.points.map((p) => ({ ...p, label: formatDate(p.date, { day: "numeric", month: "short" }) }))}
                      margin={{ top: 8, right: 4, bottom: 0, left: -18 }}
                      barCategoryGap="22%"
                      onClick={(st) => {
                        const i = Number(st?.activeIndex)
                        const pnt = Number.isInteger(i) ? series.points[i] : undefined
                        if (pnt && pnt.sessions > 0) setDrill({ title: bucketTitle(series.unit, pnt.date), metric: "focus_minutes", sessions: sessionsInBucket(state, scope, series.unit, pnt.date) })
                      }}
                    >
                      <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                      <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                      <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: "var(--surface-raised)", opacity: 0.5 }}
                        content={({ active, payload }) =>
                          active && payload?.length ? (
                            <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                              <p className="text-text-secondary">{bucketTitle(series.unit, (payload[0].payload as { date: string }).date)}</p>
                              <p className="num mt-0.5 text-sm font-semibold text-foreground">
                                {minutesLabel(Number(payload[0].value))}
                                <span className="ml-1.5 font-normal text-text-tertiary">{(payload[0].payload as { sessions: number }).sessions} ses.</span>
                              </p>
                            </div>
                          ) : null
                        }
                      />
                      <Bar dataKey="minutes" fill="var(--dim-work)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="panel rounded-2xl p-4 sm:p-5 xl:col-span-2">
              <h3 className="text-base font-semibold">{FOCUS_METRICS.focus_projects.label}</h3>
              <p className="mt-0.5 mb-3 text-xs text-text-tertiary">Minutos efectivos en el periodo</p>
              <ul className="space-y-1">
                {sum.byProject.map((p) => (
                  <li key={p.project || "__none"}>
                    <button
                      type="button"
                      onClick={() => setDrill({ title: projectName(p.project), metric: "focus_projects", sessions: list.filter((s) => sameProject(s, p.project)) })}
                      className="w-full rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-raised/60"
                    >
                      <span className="flex items-baseline justify-between gap-3 text-sm">
                        <span className={cn("truncate", p.project === NO_PROJECT && "text-text-secondary")}>{projectName(p.project)}</span>
                        <span className="num shrink-0 text-text-secondary">
                          {minutesLabel(p.minutes)} · {p.sessions}
                          <span className="sr-only"> sesiones. Ver detalle</span>
                        </span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-raised" aria-hidden>
                        <span className="block h-full rounded-full bg-dim-work" style={{ width: `${sum.seconds ? (p.seconds / sum.seconds) * 100 : 0}%` }} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      <details className="panel group rounded-2xl p-5">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-base font-semibold">
          Cómo se calcula el enfoque
          <ChevronRight className="size-4 text-text-tertiary transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm leading-relaxed md:grid-cols-2">
          {Object.values(FOCUS_METRICS).map((m) => (
            <div key={m.id}>
              <dt className="font-medium text-foreground">{m.label}</dt>
              <dd className="text-text-secondary">{m.formula}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-4 grid gap-x-8 gap-y-2 border-t border-border/70 pt-4 text-sm leading-relaxed text-text-secondary md:grid-cols-2">
          {FOCUS_RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>

      <FocusDrillSheet drill={drill} state={state} today={today} onOpenChange={(o) => !o && setDrill(null)} />
    </section>
  )
}

function bucketTitle(unit: "day" | "week", d: LocalDate) {
  return unit === "week"
    ? `Semana del ${formatDate(d, { day: "numeric", month: "short" })} al ${formatDate(addDays(d, 6), { day: "numeric", month: "short" })}`
    : formatDate(d, { weekday: "long", day: "numeric", month: "long" })
}

/** Projects ever used (and «Sin proyecto» when some session has none). */
function projectOptions(state: HabitsState): string[] {
  const seen = new Map<string, string>()
  for (const s of state.focusSessions) {
    if (s.state !== "finished") continue
    const p = s.project ?? NO_PROJECT
    const k = p.toLocaleLowerCase("es-ES")
    if (!seen.has(k)) seen.set(k, p)
  }
  return [...seen.values()].sort((a, b) => (a === NO_PROJECT ? 1 : b === NO_PROJECT ? -1 : a.localeCompare(b, "es")))
}

function FocusStat({ label, value, detail, onOpen, className }: { label: string; value: string; detail: string; onOpen?: () => void; className?: string }) {
  const body = (
    <>
      <p className="flex items-center justify-between text-xs font-medium text-text-secondary">
        {label}
        {onOpen && <ChevronRight className="size-3.5 text-text-tertiary" aria-hidden />}
      </p>
      <p className="num mt-3 text-[1.5rem] leading-none font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-snug text-text-tertiary">
        {detail}
        {onOpen && <span className="sr-only">. Ver detalle</span>}
      </p>
    </>
  )
  if (!onOpen) return <div className={cn("panel rounded-2xl p-4", className)}>{body}</div>
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "panel rounded-2xl p-4 text-left transition-colors hover:bg-surface-raised/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.99]",
        className
      )}
    >
      {body}
    </button>
  )
}

function SeriesTable({ points, unit, onOpen }: { points: { date: LocalDate; minutes: number; sessions: number }[]; unit: "day" | "week"; onOpen: (d: LocalDate) => void }) {
  if (points.length === 0) return <p className="py-8 text-center text-sm text-text-tertiary">Sin sesiones en este periodo.</p>
  return (
    <div className="max-h-56 overflow-y-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Minutos de foco {unit === "week" ? "por semana" : "por día"}</caption>
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-xs text-text-tertiary">
            <th scope="col" className="py-2 font-medium">
              {unit === "week" ? "Semana del" : "Día"}
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Minutos
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Sesiones
            </th>
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.date} className="border-b border-border/50 last:border-0">
              <td className="py-0">
                <button type="button" onClick={() => onOpen(p.date)} className="flex min-h-11 w-full items-center gap-1 text-left font-medium underline-offset-4 hover:underline">
                  {formatDate(p.date, unit === "week" ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric", month: "short" })}
                  <ChevronRight className="size-3.5 text-text-tertiary" aria-hidden />
                  <span className="sr-only">: ver sesiones</span>
                </button>
              </td>
              <td className="num text-right text-text-secondary">{p.minutes}</td>
              <td className="num text-right text-text-secondary">{p.sessions}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The exact sessions behind a figure; the header recomputes the figure from them. */
function FocusDrillSheet({ drill, state, today, onOpenChange }: { drill: Drill | null; state: HabitsState; today: LocalDate; onOpenChange: (o: boolean) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  const sum = drill ? summarizeSessions(drill.sessions) : null
  return (
    <Sheet open={drill !== null} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[88dvh] rounded-t-3xl")}>
        {drill && sum && (
          <>
            <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
              <SheetTitle className="text-lg">{drill.title}</SheetTitle>
              <SheetDescription>{FOCUS_METRICS[drill.metric].formula}</SheetDescription>
              <p className="num pt-2 text-sm" data-testid="focus-drill-summary">
                <span className="text-2xl font-semibold text-foreground">{minutesLabel(sum.minutes)}</span>
                <span className="ml-2 text-text-secondary">
                  {sum.sessions} {sum.sessions === 1 ? "sesión" : "sesiones"}
                </span>
              </p>
            </SheetHeader>
            <div role="group" aria-label="Sesiones" tabIndex={0} className="pb-safe flex-1 overflow-y-auto px-4 py-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
              {drill.sessions.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-tertiary">No hay sesiones en esta selección.</p>
              ) : (
                <SessionList sessions={drill.sessions} habits={state.habits} timezone={state.timezone} today={today} />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
