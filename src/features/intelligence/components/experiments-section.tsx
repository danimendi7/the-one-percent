"use client"

import { useId, useMemo, useState } from "react"
import { ChevronRight, FlaskConical, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { formatDate } from "@/features/habits/domain/dates"
import { habitActions, type HabitsSnapshot } from "@/features/habits/store/habit-store"
import { INDICATOR_LABEL, INDICATORS } from "@/features/mind/domain/types"
import { EXPERIMENT_DAYS, EXPERIMENT_LIMITS, MAX_ACTIVE, measureExperiment, suggestExperiments, type Experiment, type ExperimentDays, type ExperimentMeasure, type ExperimentMetric } from "../domain/experiments"
import type { Insight } from "../domain/insights"

const metricKey = (m: ExperimentMetric) => (m.kind === "habit" ? `habit:${m.habitId}` : m.kind === "checkin" ? `checkin:${m.indicator}` : "focus")
const keyToMetric = (k: string): ExperimentMetric => (k.startsWith("habit:") ? { kind: "habit", habitId: k.slice(6) } : k.startsWith("checkin:") ? { kind: "checkin", indicator: k.slice(8) as never } : { kind: "focus" })

function metricLabel(snap: HabitsSnapshot, m: ExperimentMetric): string {
  if (m.kind === "habit") return `Hábito «${snap.state.habits.find((h) => h.id === m.habitId)?.name ?? "borrado"}»`
  if (m.kind === "checkin") return INDICATOR_LABEL[m.indicator]
  return "Minutos de foco al día"
}

function value(m: ExperimentMeasure, v: number | null, sleep: boolean): string {
  if (v === null) return "sin datos"
  if (m.unit === "pct") return `${Math.round(v * 100)} %`
  if (m.unit === "minutes") return `${Math.round(v)} min/día`
  return `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })}${sleep ? " h" : ""}`
}

function delta(m: ExperimentMeasure, sleep: boolean): string | null {
  if (m.delta === null) return null
  const sign = m.delta > 0 ? "+" : m.delta < 0 ? "−" : "±"
  const abs = Math.abs(m.delta)
  if (m.unit === "pct") return `${sign}${Math.round(abs * 100)} pts`
  if (m.unit === "minutes") return `${sign}${Math.round(abs)} min/día`
  return `${sign}${abs.toLocaleString("es-ES", { maximumFractionDigits: 1 })}${sleep ? " h" : ""}`
}

/** E3 · Experiments in Intelligence: one change, one measure, a few weeks, compared with the weeks before. */
export function ExperimentsSection({ snap, insights }: { snap: HabitsSnapshot; insights: Insight[] }) {
  const [creating, setCreating] = useState<ExperimentMetric | null | false>(false)
  const all = useMemo(() => Object.values(snap.state.experiments).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [snap.state.experiments])
  const active = all.filter((e) => e.status === "active")
  const closed = all.filter((e) => e.status !== "active")
  const suggestions = suggestExperiments(insights).slice(0, 2)
  const full = active.length >= MAX_ACTIVE
  return (
    <section className="mt-6" aria-labelledby="experiments-title" data-testid="experiments">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="experiments-title" className="text-lg font-semibold">
            Experimentos
          </h2>
          <p className="text-sm text-text-secondary">Prueba un cambio durante unas semanas y compáralo con las semanas anteriores.</p>
        </div>
        <Button variant="outline" onClick={() => setCreating(null)} disabled={full} data-testid="experiment-new">
          <Plus aria-hidden />
          Nuevo experimento
        </Button>
      </div>
      {full && <p className="mb-3 text-xs text-text-tertiary">Tienes {MAX_ACTIVE} en marcha: termina alguno antes de empezar otro.</p>}
      {!full && suggestions.length > 0 && (
        <ul className="mb-3 space-y-2" aria-label="Propuestas a partir de lo que muestran tus registros">
          {suggestions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-sm">
              <span className="text-text-secondary">{s.reason}. ¿Mides un cambio?</span>
              <Button variant="ghost" className="min-h-11" onClick={() => setCreating(s.metric)} data-testid="experiment-suggestion">
                Probar
              </Button>
            </li>
          ))}
        </ul>
      )}
      {active.length === 0 ? (
        <p className="panel rounded-2xl px-5 py-4 text-sm text-text-tertiary">No hay experimentos en marcha.</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {active.map((e) => (
            <li key={e.id}>
              <ExperimentCard snap={snap} e={e} />
            </li>
          ))}
        </ul>
      )}
      {closed.length > 0 && <Closed snap={snap} list={closed} />}
      <ExperimentSheet snap={snap} metric={creating === false ? null : creating} open={creating !== false} onOpenChange={(o) => !o && setCreating(false)} />
    </section>
  )
}

function Result({ snap, e, m }: { snap: HabitsSnapshot; e: Experiment; m: ExperimentMeasure }) {
  const sleep = e.metric.kind === "checkin" && e.metric.indicator === "sleep"
  const span = (r: { from: string; to: string }) => `${formatDate(r.from, { day: "numeric", month: "short" })}–${formatDate(r.to, { day: "numeric", month: "short" })}`
  const d = delta(m, sleep)
  return (
    <div className="mt-3 text-sm" data-testid="experiment-result">
      <p className="text-xs text-text-tertiary">{metricLabel(snap, e.metric)}</p>
      <dl className="num mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-text-tertiary">Antes</dt>
        <dd className="text-text-secondary">
          {value(m, m.baseline.value, sleep)} · n = {m.baseline.n} · {span(m.baseline.range)}
        </dd>
        <dt className="text-text-tertiary">Durante</dt>
        <dd className="text-text-secondary">{m.trial.n === 0 ? "aún sin datos" : `${value(m, m.trial.value, sleep)} · n = ${m.trial.n} · ${span(m.trial.range)}`}</dd>
      </dl>
      {d && <p className="num mt-1.5 font-medium">Diferencia: {d}</p>}
      <ul className="mt-2 space-y-0.5 text-xs leading-relaxed text-text-tertiary" aria-label="Limitaciones">
        {m.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  )
}

function ExperimentCard({ snap, e }: { snap: HabitsSnapshot; e: Experiment }) {
  const m = measureExperiment(snap.state, e, snap.today)
  const [closing, setClosing] = useState<"finished" | "abandoned" | null>(null)
  const [note, setNote] = useState("")
  const id = useId()
  return (
    <article className="panel rounded-2xl p-5" data-testid="experiment">
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold break-words">{e.title}</h3>
          <p className="num text-xs text-text-tertiary" data-testid="experiment-day">
            {m.finished ? "Periodo terminado: cierra el experimento" : `Día ${m.day} de ${m.of}`}
          </p>
        </div>
      </div>
      <Result snap={snap} e={e} m={m} />
      <div className="mt-3 flex flex-wrap justify-end gap-1 border-t border-border/70 pt-2">
        <Button variant="ghost" className="min-h-11 text-text-secondary" onClick={() => setClosing("abandoned")}>
          Abandonar
        </Button>
        <Button variant="outline" className="min-h-11" onClick={() => setClosing("finished")} data-testid="experiment-finish">
          Terminar
        </Button>
      </div>
      <Dialog open={closing !== null} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{closing === "finished" ? "Terminar el experimento" : "Abandonar el experimento"}</DialogTitle>
            <DialogDescription>Se queda como registro de lo que pasó, con sus cifras. No se puede reabrir.</DialogDescription>
          </DialogHeader>
          <label htmlFor={id} className="text-sm font-medium">
            ¿Qué concluyes? <span className="font-normal text-text-tertiary">· opcional</span>
          </label>
          <Textarea id={id} value={note} rows={3} maxLength={EXPERIMENT_LIMITS.note} onChange={(ev) => setNote(ev.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (closing) habitActions.closeExperiment(e.id, closing, note)
                setClosing(null)
              }}
              data-testid="experiment-close-confirm"
            >
              {closing === "finished" ? "Terminar" : "Abandonar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

function Closed({ snap, list }: { snap: HabitsSnapshot; list: Experiment[] }) {
  return (
    <details className="panel group mt-3 rounded-2xl" data-testid="experiments-closed">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Terminados ({list.length})
        <ChevronRight className="size-4 text-text-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
      </summary>
      <ul className="divide-y divide-border/70 border-t border-border/70">
        {list.map((e) => (
          <li key={e.id} className="px-5 py-3">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium break-words">
                {e.title} <span className="text-xs font-normal text-text-tertiary">· {e.status === "finished" ? "terminado" : "abandonado"}</span>
              </p>
              <Button variant="ghost" size="icon" className="size-11 shrink-0 text-text-tertiary" aria-label={`Borrar: ${e.title}`} onClick={() => habitActions.deleteExperiment(e.id)}>
                <Trash2 aria-hidden />
              </Button>
            </div>
            {e.note && <p className="mt-1 text-sm whitespace-pre-wrap text-text-secondary">{e.note}</p>}
            <Result snap={snap} e={e} m={measureExperiment(snap.state, e, snap.today)} />
          </li>
        ))}
      </ul>
    </details>
  )
}

function ExperimentSheet({ snap, metric, open, onOpenChange }: { snap: HabitsSnapshot; metric: ExperimentMetric | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl border-x-0")}>
        {open && <ExperimentForm snap={snap} initial={metric} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function ExperimentForm({ snap, initial, onDone }: { snap: HabitsSnapshot; initial: ExperimentMetric | null; onDone: () => void }) {
  const ids = { title: useId(), metric: useId() }
  const habits = snap.state.habits.filter((h) => !h.archivedOn || h.archivedOn > snap.today)
  const options = [
    ...habits.map((h) => ({ key: `habit:${h.id}`, label: `Hábito: ${h.name}` })),
    ...INDICATORS.map((i) => ({ key: `checkin:${i}`, label: `Check-in: ${INDICATOR_LABEL[i]}` })),
    { key: "focus", label: "Minutos de foco al día" },
  ]
  const [title, setTitle] = useState("")
  const [metric, setMetric] = useState(initial ? metricKey(initial) : options[0].key)
  const [days, setDays] = useState<ExperimentDays>(14)
  const [error, setError] = useState<string | null>(null)
  function submit(ev: React.FormEvent) {
    ev.preventDefault()
    const r = habitActions.startExperiment({ title, metric: keyToMetric(metric), days })
    if (!r.ok) {
      setError(r.field === "title" ? (r.reason === "empty" ? "Escribe qué vas a cambiar." : "Acórtalo un poco.") : r.field === "active" ? `Ya tienes ${MAX_ACTIVE} en marcha.` : "Revisa lo que vas a medir.")
      return
    }
    toast("Experimento en marcha", { description: `Empieza hoy y dura ${days} días.` })
    onDone()
  }
  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader className="border-b border-border px-5 py-4">
        <SheetTitle className="text-lg">Nuevo experimento</SheetTitle>
        <SheetDescription>Un cambio, una medida y unas semanas. Se compara con las mismas semanas justo antes.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <label htmlFor={ids.title} className="mb-1.5 block text-sm font-medium">
            ¿Qué vas a cambiar?
          </label>
          <Input id={ids.title} value={title} placeholder="Dejar el móvil fuera del dormitorio" onChange={(ev) => setTitle(ev.target.value)} aria-invalid={error !== null} />
          {error && (
            <p role="alert" className="mt-1.5 text-xs text-warning">
              {error}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={ids.metric} className="mb-1.5 block text-sm font-medium">
            ¿Qué vas a medir?
          </label>
          <select id={ids.metric} value={metric} onChange={(ev) => setMetric(ev.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Duración</legend>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Duración en días">
            {EXPERIMENT_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={days === d}
                onClick={() => setDays(d)}
                className={cn("num min-h-11 rounded-xl border text-sm font-medium", days === d ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary")}
              >
                {d} días
              </button>
            ))}
          </div>
        </fieldset>
        <p className="text-xs leading-relaxed text-text-tertiary">Empieza hoy. Mide con lo que ya registras: no hace falta apuntar nada nuevo.</p>
      </div>
      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        <Button type="submit" className="ml-auto min-w-32">
          Empezar
        </Button>
      </SheetFooter>
    </form>
  )
}
