"use client"

import { useId, useState } from "react"
import { ChevronDown, Info } from "lucide-react"
import { pct } from "@/components/common/format"
import { cn } from "@/lib/utils"
import { formatDate, WEEKDAY_LONG, WEEKDAY_SHORT } from "@/features/habits/domain/dates"
import { DIMENSION_COLOR } from "@/features/habits/components/habit-icon"
import { STATUS } from "@/features/goals/components/goal-ui"
import { minutesLabel, NO_PROJECT_LABEL } from "@/features/focus/components/focus-ui"
import { INDICATOR_LABEL, INDICATORS, type Indicator } from "@/features/mind/domain/types"
import { ENOUGH_DAYS } from "@/features/mind/domain/metrics"
import { sleepLabel } from "@/features/mind/components/mind-ui"
import type { FocusFigures, ReviewSnapshot } from "../domain/snapshot"
import { Delta, KIND_LABEL, NotAvailable } from "./review-ui"

/**
 * The figures of a review (plan §2.2–2.3). Every number comes from the snapshot: frozen once
 * closed, live while it is a draft. Each figure keeps its denominator (n) and says N/D with a
 * reason instead of 0. Mind & Energy shows aggregated numbers only: reflections never appear.
 */
export function ReviewFigures({ s, live, className }: { s: ReviewSnapshot; live: boolean; className?: string }) {
  const k = KIND_LABEL[s.kind]
  return (
    <div className={cn("space-y-4", className)} data-testid="review-figures">
      <ContextNotes s={s} live={live} />
      <HabitsBlock s={s} against={k.previous} />
      {s.kind !== "day" && <GoalsBlock s={s} />}
      <FocusBlock s={s} against={k.previous} />
      <MindBlock s={s} against={k.previous} />
      {s.weekly && <WeeklyTable s={s} />}
    </div>
  )
}

function ContextNotes({ s, live }: { s: ReviewSnapshot; live: boolean }) {
  const notes: string[] = []
  if (live) notes.push("Cifras en vivo: se congelarán al cerrar la revisión.")
  if (s.kind === "day" && s.habits.current.pending > 0) notes.push(`El día seguía abierto: ${s.habits.current.pending === 1 ? "1 hábito pendiente cuenta" : `${s.habits.current.pending} hábitos pendientes cuentan`} como aún sin hacer.`)
  if (s.asOf < s.period.to) notes.push(`Hoy cuenta como pendiente: cifras hasta el ${formatDate(s.asOf, { day: "numeric", month: "long" })}.`)
  if (s.historyStart && s.historyStart > s.period.from && s.historyStart <= s.period.to)
    notes.push(`Tu historial empieza el ${formatDate(s.historyStart, { day: "numeric", month: "long" })}: los días anteriores no cuentan.`)
  if (!notes.length) return null
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-border px-3.5 py-2.5 text-xs leading-relaxed text-text-secondary">
      <Info className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden />
      <div>
        {notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
    </div>
  )
}

function Block({ title, figure, sub, children, testId }: { title: string; figure?: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; testId?: string }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="panel rounded-2xl" data-testid={testId}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-4 pt-4 pb-3 sm:px-5">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        {figure !== undefined && <div className="text-right">{figure}</div>}
      </div>
      {sub && <div className="-mt-1 px-4 pb-3 sm:px-5">{sub}</div>}
      {children && <div className="border-t border-border/70">{children}</div>}
    </section>
  )
}

function ratePts(a: number | null, b: number | null): number | null {
  return a !== null && b !== null ? Math.round((a - b) * 100) : null
}

// ── Habits ─────────────────────────────────────────────────────────────────

function HabitsBlock({ s, against }: { s: ReviewSnapshot; against: string }) {
  const [all, setAll] = useState(false)
  const h = s.habits
  const rows = all ? h.rows : h.rows.slice(0, 5)
  const delta = ratePts(h.current.rate, h.previous.rate)
  const noData = h.current.applicable === 0
  return (
    <Block
      title="Hábitos"
      testId="figures-habits"
      figure={noData ? <NotAvailable reason="sin días programados" /> : <span className="num text-2xl font-semibold">{pct(h.current.rate)}</span>}
      sub={
        noData ? (
          <p className="text-xs text-text-tertiary">Sin datos en este periodo: no había hábitos con días programados.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="num text-xs text-text-tertiary">
              {h.current.fulfilled} de {h.current.applicable} cumplidas
              {h.current.exempt > 0 && ` · ${h.current.exempt} exentas`}
              {s.kind !== "day" && h.perfectDays.withData > 0 && ` · ${h.perfectDays.perfect} de ${h.perfectDays.withData} días completos`}
            </p>
            {delta !== null ? <Delta value={delta} unit="pts" against={against} /> : <span className="text-xs text-text-tertiary">Sin comparación: sin datos en el {against}</span>}
          </div>
        )
      }
    >
      {h.byDimension.length > 0 && (
        <ul className="grid grid-cols-2 gap-px bg-border/70 sm:grid-cols-4" aria-label="Por dimensión">
          {h.byDimension.map((d) => (
            <li key={d.id} className="bg-surface px-4 py-3">
              <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                <span className="size-2 rounded-full" style={{ background: DIMENSION_COLOR[d.id] }} aria-hidden />
                {d.name}
              </span>
              <span className="num mt-0.5 block text-sm font-semibold">
                {pct(d.rate)} <span className="text-xs font-normal text-text-tertiary">{d.fulfilled}/{d.applicable}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {h.rows.length > 0 && (
        <ul className="divide-y divide-border/70 border-t border-border/70" aria-label="Por hábito, de mayor a menor cumplimiento">
          {rows.map((r) => (
            <li key={r.id} className="flex min-h-11 items-center gap-3 px-4 py-2 sm:px-5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: DIMENSION_COLOR[r.dimension] }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
              {r.streak && r.streak.count > 0 && (
                <span className="num hidden text-xs text-text-tertiary sm:inline">
                  racha {r.streak.count} {r.streak.unit === "day" ? (r.streak.count === 1 ? "día" : "días") : r.streak.count === 1 ? "semana" : "semanas"}
                </span>
              )}
              <span className="num text-sm text-text-secondary">
                {pct(r.rate)} <span className="text-xs text-text-tertiary">{r.fulfilled}/{r.applicable}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {h.rows.length > 5 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          aria-expanded={all}
          className="flex h-11 w-full items-center justify-center gap-1.5 border-t border-border/70 text-xs font-medium text-text-secondary hover:text-foreground"
        >
          {all ? "Ver menos" : `Ver los ${h.rows.length} hábitos`}
          <ChevronDown className={cn("size-3.5 transition-transform motion-reduce:transition-none", all && "rotate-180")} aria-hidden />
        </button>
      )}
      {h.weekday && <WeekdayStrip weekday={h.weekday} />}
    </Block>
  )
}

function WeekdayStrip({ weekday }: { weekday: NonNullable<ReviewSnapshot["habits"]["weekday"]> }) {
  return (
    <div className="border-t border-border/70 px-4 py-3 sm:px-5">
      <p className="mb-2 text-xs text-text-tertiary">Cumplimiento por día de la semana</p>
      <ol className="grid grid-cols-7 gap-1.5">
        {weekday.map((w) => (
          <li key={w.weekday} className="text-center" aria-label={`${WEEKDAY_LONG[w.weekday]}: ${w.rate === null ? "N/D" : pct(w.rate)}, ${w.applicable} aplicables`}>
            <div className="relative mx-auto h-14 w-full max-w-8 overflow-hidden rounded-md bg-surface-raised" aria-hidden>
              <div className="absolute inset-x-0 bottom-0 bg-signal/70" style={{ height: `${Math.round((w.rate ?? 0) * 100)}%` }} />
            </div>
            <span className="mt-1 block text-[0.6875rem] text-text-tertiary" aria-hidden>
              {WEEKDAY_SHORT[w.weekday]}
            </span>
            <span className="num block text-[0.6875rem] text-text-secondary" aria-hidden>
              {w.rate === null ? "N/D" : pct(w.rate)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Goals ──────────────────────────────────────────────────────────────────

function GoalsBlock({ s }: { s: ReviewSnapshot }) {
  const goals = s.goals
  const achieved = goals.filter((g) => g.closedInPeriod === "achieved").length
  const atRisk = goals.filter((g) => g.status === "behind" || g.status === "overdue").length
  return (
    <Block
      title="Objetivos"
      testId="figures-goals"
      figure={goals.length ? <span className="num text-sm text-text-secondary">{goals.length} en el periodo</span> : undefined}
      sub={
        goals.length ? (
          <p className="num text-xs text-text-tertiary">
            {achieved} conseguidos · {atRisk} por detrás o vencidos
          </p>
        ) : (
          <p className="text-xs text-text-tertiary">Sin objetivos activos en este periodo.</p>
        )
      }
    >
      {goals.length > 0 && (
        <ul className="divide-y divide-border/70">
          {goals.map((g) => {
            const st = STATUS[g.status]
            return (
              <li key={g.id} className="px-4 py-3 sm:px-5">
                <div className="flex items-start gap-3">
                  <span className="min-w-0 flex-1 text-sm font-medium">{g.title}</span>
                  <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[0.6875rem] font-medium", st.tone)}>
                    <st.icon className="size-3" aria-hidden />
                    {st.label}
                  </span>
                </div>
                <p className="num mt-1 text-xs text-text-tertiary">
                  {g.progress !== null ? (
                    <>
                      Progreso {g.progressAtStart !== undefined && g.progressAtStart !== null ? `${pct(g.progressAtStart)} → ` : ""}
                      <span className="text-text-secondary">{pct(g.progress)}</span>
                    </>
                  ) : (
                    <>Progreso N/D{g.reason ? ` · ${g.reason}` : ""}</>
                  )}
                  {g.effort !== null && ` · esfuerzo ${pct(g.effort)} (${g.effortApplicable} aplicables)`}
                  {g.closedInPeriod === "abandoned" && " · abandonado en el periodo"}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Block>
  )
}

// ── Deep Work ──────────────────────────────────────────────────────────────

function FocusBlock({ s, against }: { s: ReviewSnapshot; against: string }) {
  const f: FocusFigures = s.focus.current
  const p = s.focus.previous
  const none = f.sessions === 0
  return (
    <Block
      title="Deep Work"
      testId="figures-focus"
      figure={none ? <NotAvailable reason="sin sesiones" /> : <span className="num text-2xl font-semibold">{minutesLabel(f.minutes)}</span>}
      sub={
        none ? (
          <p className="text-xs text-text-tertiary">Sin sesiones de foco terminadas en este periodo.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="num text-xs text-text-tertiary">
              {f.sessions} {f.sessions === 1 ? "sesión" : "sesiones"} en {f.days} {f.days === 1 ? "día" : "días"} · {pct(f.completeRate)} bloques completos ({f.complete}/{f.sessions})
              {f.avgRating !== null ? ` · valoración ${f.avgRating.toLocaleString("es-ES", { maximumFractionDigits: 1 })} (n = ${f.rated})` : " · sin valoraciones"}
            </p>
            {p.sessions > 0 ? <Delta value={f.minutes - p.minutes} unit="min" against={against} /> : <span className="text-xs text-text-tertiary">Sin comparación: sin sesiones en el {against}</span>}
          </div>
        )
      }
    >
      {f.topProjects.length > 0 && (
        <ul className="divide-y divide-border/70" aria-label="Proyectos con más minutos">
          {f.topProjects.map((t) => (
            <li key={t.project || ""} className="flex min-h-11 items-center gap-3 px-4 py-2 sm:px-5">
              <span className="min-w-0 flex-1 truncate text-sm">{t.project || NO_PROJECT_LABEL}</span>
              <span className="num text-sm text-text-secondary">
                {minutesLabel(t.minutes)} <span className="text-xs text-text-tertiary">· {t.sessions}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}

// ── Mind & Energy (numbers only) ───────────────────────────────────────────

function indicatorValue(i: Indicator, v: number): string {
  return i === "sleep" ? sleepLabel(Math.round(v * 4) / 4) : v.toLocaleString("es-ES", { maximumFractionDigits: 1 })
}

function MindBlock({ s, against }: { s: ReviewSnapshot; against: string }) {
  const m = s.mind
  const none = m.coverage.days === 0
  return (
    <Block
      title="Mente y energía"
      testId="figures-mind"
      figure={<span className="num text-sm text-text-secondary">{s.kind === "day" ? (none ? "Sin check-in" : "Con check-in") : `${m.coverage.days} de ${m.coverage.total} días con check-in`}</span>}
      sub={
        <p className="text-xs text-text-tertiary">
          {none ? "Sin check-ins en este periodo. " : ""}Solo cifras agregadas: tus reflexiones privadas nunca aparecen en una revisión.
        </p>
      }
    >
      {!none && (
        <>
          <dl className="grid grid-cols-2 gap-px bg-border/70 sm:grid-cols-4">
            {INDICATORS.map((i) => {
              const a = m.averages[i]
              const change = m.change[i]
              const prev = m.previous.averages[i]
              return (
                <div key={i} className="bg-surface px-4 py-3">
                  <dt className="text-xs text-text-secondary">{INDICATOR_LABEL[i]}</dt>
                  <dd className="num mt-0.5 text-sm font-semibold">
                    {a.value === null ? "N/D" : indicatorValue(i, a.value)} <span className="text-xs font-normal text-text-tertiary">n = {a.n}</span>
                  </dd>
                  <dd className="num mt-0.5 text-[0.6875rem] text-text-tertiary">
                    {change !== null ? (
                      <Delta value={Math.round(change * 10) / 10} unit={i === "sleep" ? "h" : ""} against={against} compact className="text-[0.6875rem]" />
                    ) : prev.value !== null ? (
                      `antes ${indicatorValue(i, prev.value)} (n = ${prev.n})`
                    ) : (
                      "sin dato anterior"
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
          {s.kind !== "day" && <p className="border-t border-border/70 px-4 py-2.5 text-[0.6875rem] leading-relaxed text-text-tertiary sm:px-5">
            El cambio solo se calcula con al menos {ENOUGH_DAYS} días con dato en ambos periodos; con menos, se muestra el valor anterior como contexto.
            {m.energyByFocus.shown || m.completionBySleep.shown ? "" : " Las comparaciones energía-foco y sueño-hábitos necesitan más días."}
          </p>}
        </>
      )}
    </Block>
  )
}

// ── Monthly: weeks inside the month (accessible table) ─────────────────────

function WeeklyTable({ s }: { s: ReviewSnapshot }) {
  const weeks = s.weekly ?? []
  const max = Math.max(1, ...weeks.map((w) => w.focusMinutes))
  return (
    <Block title="Evolución por semanas" testId="figures-weeks">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] text-left text-xs">
          <caption className="sr-only">Cumplimiento, minutos de foco, energía y ánimo de cada semana del mes</caption>
          <thead className="text-text-tertiary">
            <tr className="border-b border-border/70">
              <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                Semana
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Hábitos
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Foco
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Energía
              </th>
              <th scope="col" className="px-2 py-2 pr-4 font-medium sm:pr-5">
                Ánimo
              </th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-border/70">
            {weeks.map((w) => (
              <tr key={w.week}>
                <th scope="row" className="px-4 py-2.5 font-normal text-text-secondary sm:px-5">
                  {formatDate(w.range.from, { day: "numeric" })}–{formatDate(w.range.to, { day: "numeric", month: "short" })}
                </th>
                <td className="px-2 py-2.5">
                  {w.applicable ? pct(w.completion) : "N/D"}
                </td>
                <td className="px-2 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-surface-raised sm:block" aria-hidden>
                      <span className="block h-full rounded-full bg-dim-work" style={{ width: `${(w.focusMinutes / max) * 100}%` }} />
                    </span>
                    {w.focusMinutes ? minutesLabel(w.focusMinutes) : "—"}
                  </span>
                </td>
                <td className="px-2 py-2.5">{w.energy.value === null ? "N/D" : `${w.energy.value.toLocaleString("es-ES", { maximumFractionDigits: 1 })} (n = ${w.energy.n})`}</td>
                <td className="px-2 py-2.5 pr-4 sm:pr-5">{w.mood.value === null ? "N/D" : `${w.mood.value.toLocaleString("es-ES", { maximumFractionDigits: 1 })} (n = ${w.mood.n})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Block>
  )
}
