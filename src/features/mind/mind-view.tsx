"use client"

import Link from "next/link"
import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { BarChart3, CloudOff, Moon, PenLine, SlidersHorizontal, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SourceBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { addDays, formatDate, isoWeekday, WEEKDAY_SHORT, type LocalDate } from "@/features/habits/domain/dates"
import { checkinDate, checkinFor, defaultPhase } from "./domain/ops"
import { checkinsIn } from "./domain/metrics"
import { PHASE_LABEL, type Checkin, type CheckinPhase } from "./domain/types"
import { CheckinSheet, type CheckinTarget } from "./components/checkin-sheet"
import { FieldsSheet } from "./components/fields-sheet"
import { checkinSummary, dayLabel } from "./components/mind-ui"
import { MindTrends, type TrendPeriod } from "./components/mind-trends"
import { useMindModel, type MindModel } from "./use-mind"
import { useNow } from "@/features/focus/use-focus"
import { habitActions } from "@/features/habits/store/habit-store"

/**
 * Mind & Energy (docs/m3.3-mind-energy-plan.md §2.2): today's two check-ins, the last 7 days,
 * trends and an editable history. Optional and independent of any habit score; not a diagnosis.
 */
export function MindView() {
  const m = useMindModel()
  const [fieldsOpen, setFieldsOpen] = useState(false)
  return (
    <>
      <PageHeader
        title="Mente y energía"
        meta={<SourceBadge source={m?.snap.source}>Demo · check-ins de ejemplo</SourceBadge>}
        description="Check-ins de 15 segundos, opcionales e independientes de tus hábitos. No es un diagnóstico."
        actions={
          <Button variant="outline" onClick={() => setFieldsOpen(true)} disabled={!m}>
            <SlidersHorizontal className="size-4" aria-hidden /> Indicadores
          </Button>
        }
      />
      {!m ? <MindSkeleton /> : <Content m={m} />}
      {m && <FieldsSheet m={m} open={fieldsOpen} onOpenChange={setFieldsOpen} />}
    </>
  )
}

function MindSkeleton() {
  return (
    <div className="grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]" role="status" aria-busy="true" aria-label="Cargando mente y energía">
      <div className="panel h-64 animate-pulse rounded-2xl" />
      <div className="panel h-96 animate-pulse rounded-2xl" />
    </div>
  )
}

function Content({ m }: { m: MindModel }) {
  const params = useSearchParams()
  const [target, setTarget] = useState<CheckinTarget | null>(() => {
    const q = params.get("checkin")
    if (q !== "am" && q !== "pm") return null
    return { phase: q, date: checkinDate(m.clockNow(), q, m.timezone), mode: "now" }
  })
  const [period, setPeriod] = useState<TrendPeriod>(30)

  const now = () => {
    const t = m.clockNow()
    const phase = defaultPhase(t, m.timezone)
    setTarget({ phase, date: checkinDate(t, phase, m.timezone), mode: "now" })
  }

  return (
    <div className="max-w-6xl space-y-8">
      {!m.saved && (
        <div role="note" className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/8 px-4 py-3 text-sm leading-relaxed text-warning">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Tu cuenta aún no guarda check-ins: el servidor todavía no tiene Mente y energía. No se muestra ningún dato de ejemplo.</p>
        </div>
      )}
      <PendingReflections m={m} />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Today m={m} onOpen={setTarget} />
          <WeekStrip m={m} onOpen={setTarget} />
        </div>
        <div className="min-w-0 space-y-8">
          <MindTrends state={m.state} today={m.today} period={period} onPeriod={setPeriod} onCheckin={now} />
          <History m={m} onOpen={setTarget} />
        </div>
      </div>
      <CheckinSheet m={m} target={target} onOpenChange={(o) => !o && setTarget(null)} />
    </div>
  )
}

const quote = (s: string | null | undefined) => (s ? `«${s.length > 280 ? `${s.slice(0, 280)}…` : s}»` : "(vacía)")

/**
 * Reflections that lost a conflict with another device (D47). They are kept on this device until
 * the user decides, so a closed toast or a reload never loses them; nothing is overwritten silently.
 */
function PendingReflections({ m }: { m: MindModel }) {
  const pending = (m.snap.sync?.notices ?? []).filter((n) => n.code === "note_conflict" && n.op?.type === "checkin.set")
  if (pending.length === 0) return null
  return (
    <section aria-labelledby="mind-pending-title" data-testid="mind-pending-reflections" className="space-y-3 rounded-2xl border border-warning/40 bg-warning/8 p-4 sm:p-5">
      <h2 id="mind-pending-title" className="text-base font-semibold text-warning">
        {pending.length === 1 ? "Una reflexión espera tu decisión" : `${pending.length} reflexiones esperan tu decisión`}
      </h2>
      <ul className="space-y-3">
        {pending.map((n) => {
          if (n.op?.type !== "checkin.set") return null
          const { local_date, phase } = n.op
          const current = checkinFor(m.state, local_date, phase)?.note
          return (
            <li key={n.id} className="space-y-2 rounded-xl border border-border bg-background/40 p-3 text-sm">
              <p className="font-medium">
                {PHASE_LABEL[phase]} del {dayLabel(local_date)}
              </p>
              <p className="leading-relaxed text-text-secondary">
                <span className="text-text-tertiary">Tu versión, guardada en este dispositivo: </span>
                <span className="whitespace-pre-line">{quote(n.op.fields.note)}</span>
              </p>
              <p className="leading-relaxed text-text-secondary">
                <span className="text-text-tertiary">La que hay ahora: </span>
                <span className="whitespace-pre-line">{quote(current)}</span>
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={() => habitActions.reapplyNotice?.(n.id)}>Aplicar la mía</Button>
                <Button variant="outline" onClick={() => habitActions.dismissNotice?.(n.id)}>
                  Mantener la otra
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Today's morning and evening, as the clock sees them (the evening before 04:00 is yesterday's). */
function Today({ m, onOpen }: { m: MindModel; onOpen: (t: CheckinTarget) => void }) {
  // Re-evaluated every 30 s, so the due phase and the 04:00 rollover follow the clock.
  const t = useNow(false, m.clockNow)
  const due = defaultPhase(t, m.timezone)
  return (
    <section aria-labelledby="mind-today-title" className="panel rounded-2xl p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 id="mind-today-title" className="text-base font-semibold">
          Hoy
        </h2>
        <Link href="/analytics#mente" className="-mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-text-secondary hover:text-foreground">
          <BarChart3 className="size-4" aria-hidden /> Análisis
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2.5">
        {(["am", "pm"] as const).map((phase) => {
          const date = checkinDate(t, phase, m.timezone)
          const c = checkinFor(m.state, date, phase)
          return <PhaseCard key={phase} phase={phase} date={date} c={c} due={due === phase} today={m.today} onOpen={() => onOpen({ phase, date, mode: "now" })} />
        })}
      </div>
    </section>
  )
}

function PhaseCard({ phase, date, c, due, today, onOpen }: { phase: CheckinPhase; date: LocalDate; c: Checkin | null; due: boolean; today: LocalDate; onOpen: () => void }) {
  const Icon = phase === "am" ? Sun : Moon
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`mind-card-${phase}`}
      className={cn(
        "flex min-h-16 w-full items-center gap-3.5 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-surface-raised/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.99] motion-reduce:active:scale-100",
        c ? "border-border" : due ? "border-signal/40 bg-signal/5" : "border-dashed border-border"
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-raised">
        <Icon className="size-4 text-dim-mind" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">
          {PHASE_LABEL[phase]}
          {date !== today && <span className="font-normal text-text-tertiary"> · {formatDate(date, { weekday: "short", day: "numeric" })}</span>}
        </span>
        <span className={cn("block truncate text-xs", c ? "num text-text-secondary" : "text-text-tertiary")}>{c ? checkinSummary(c) : due ? "Pendiente · unos segundos" : "Pendiente"}</span>
      </span>
      {c?.note && <PenLine className="size-3.5 shrink-0 text-text-tertiary" aria-label="Con reflexión" />}
    </button>
  )
}

/** Last 7 days: one column per day with its two phases. A day opens its check-ins (editable). */
function WeekStrip({ m, onOpen }: { m: MindModel; onOpen: (t: CheckinTarget) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(m.today, i - 6))
  return (
    <section aria-labelledby="mind-week-title" className="panel rounded-2xl p-5">
      <h2 id="mind-week-title" className="mb-3 text-base font-semibold">
        Últimos 7 días
      </h2>
      <ol className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const am = checkinFor(m.state, d, "am")
          const pm = checkinFor(m.state, d, "pm")
          const label = `${dayLabel(d)}: mañana ${am ? "hecha" : "sin check-in"}, noche ${pm ? "hecha" : "sin check-in"}`
          return (
            <li key={d}>
              <button
                type="button"
                aria-label={label}
                onClick={() => onOpen({ date: d, phase: am && !pm ? "pm" : "am", mode: "day" })}
                className={cn(
                  "flex min-h-16 w-full flex-col items-center justify-center gap-1.5 rounded-xl transition-colors hover:bg-surface-raised/60",
                  d === m.today && "bg-surface-raised/50"
                )}
              >
                <span className={cn("text-xs", d === m.today ? "font-semibold text-foreground" : "text-text-tertiary")}>{WEEKDAY_SHORT[isoWeekday(d)]}</span>
                <span className="flex flex-col gap-1" aria-hidden>
                  <span className={cn("size-2 rounded-full", am ? "bg-dim-mind" : "border border-border")} />
                  <span className={cn("size-2 rounded-full", pm ? "bg-dim-mind" : "border border-border")} />
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-[0.6875rem] text-text-tertiary">Arriba, mañana; abajo, noche. Pulsa un día para ver o editar.</p>
    </section>
  )
}

const PAGE = 14

/** Editable history, newest first. Reflections are never shown in the list: only an icon. */
function History({ m, onOpen }: { m: MindModel; onOpen: (t: CheckinTarget) => void }) {
  const [limit, setLimit] = useState(PAGE)
  const all = checkinsIn(m.state, { from: addDays(m.today, -365), to: m.today })
  if (all.length === 0) return null
  return (
    <section aria-labelledby="mind-history-title">
      <h2 id="mind-history-title" className="mb-3 text-base font-semibold">
        Historial
      </h2>
      <ul className="panel divide-y divide-border/60 rounded-2xl">
        {all.slice(0, limit).map(({ date, am, pm }) => (
          <li key={date} className="px-4 py-3 sm:px-5">
            <p className="mb-1.5 text-sm font-medium">{dayLabel(date)}</p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {(["am", "pm"] as const).map((phase) => {
                const c = phase === "am" ? am : pm
                return (
                  <button
                    key={phase}
                    type="button"
                    onClick={() => onOpen({ date, phase, mode: "day" })}
                    className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-raised/60"
                    aria-label={`${PHASE_LABEL[phase]} del ${dayLabel(date)}: ${c ? checkinSummary(c) : "sin check-in"}${c?.note ? ", con reflexión" : ""}. Editar`}
                  >
                    {phase === "am" ? <Sun className="size-3.5 shrink-0 text-text-tertiary" aria-hidden /> : <Moon className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />}
                    <span className={cn("num truncate", c ? "text-text-secondary" : "text-text-tertiary")}>{c ? checkinSummary(c) : "—"}</span>
                    {c?.note && <PenLine className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />}
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
      {all.length > limit && (
        <Button variant="ghost" className="mt-2 w-full" onClick={() => setLimit(limit + PAGE * 2)}>
          Ver más días
        </Button>
      )}
    </section>
  )
}
