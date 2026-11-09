"use client"

import { useState } from "react"
import Link from "next/link"
import { Archive, ArchiveRestore, Check, ChevronLeft, ChevronRight, CircleSlash, Eye, EyeOff, Flag, MoreHorizontal, Pencil, Plus, RotateCcw, Trophy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DemoBadge } from "@/components/common/demo-note"
import { EmptyState } from "@/components/common/empty-state"
import { pct } from "@/components/common/format"
import { cn } from "@/lib/utils"
import { formatDate, type LocalDate } from "@/features/habits/domain/dates"
import type { Habit } from "@/features/habits/domain/types"
import { HabitIcon } from "@/features/habits/components/habit-icon"
import { goalsEnabled, habitActions } from "@/features/habits/store/habit-store"
import { GOAL_METRICS, GOAL_RULES } from "@/features/analytics/domain/catalog"
import { DrillSheet, type DrillRequest } from "@/features/analytics/drill-sheet"
import { goalStatusView } from "./domain/ops"
import type { GoalEvaluation } from "./domain/progress"
import { MAX_PRIMARY } from "./domain/types"
import { GoalChart } from "./components/goal-chart"
import { GoalFormSheet } from "./components/goal-form-sheet"
import { GoalLog } from "./components/goal-log"
import {
  DataLevelNote,
  dueText,
  EffortBar,
  formatRate,
  formatValue,
  HORIZON_LABEL,
  OutcomeBar,
  outcomeLine,
  StatusChip,
  statusText,
  useGoalsModel,
  type GoalsModel,
} from "./components/goal-ui"
import { GoalsSkeleton } from "./goals-view"
import { MeasureSheet } from "./components/measure-sheet"

export function GoalDetail({ id }: { id: string }) {
  const gm = useGoalsModel()
  if (!gm) return <GoalsSkeleton />
  const e = gm.evals.get(id)
  if (!e) {
    return (
      <div className="panel rounded-2xl">
        <EmptyState
          icon={Flag}
          title="Este objetivo no existe"
          description="Puede que se haya borrado o que pertenezca a otra cuenta."
          action={
            <Button asChild variant="outline">
              <Link href="/goals">Volver a Objetivos</Link>
            </Button>
          }
        />
      </div>
    )
  }
  return <Detail gm={gm} e={e} />
}

function Detail({ gm, e }: { gm: GoalsModel; e: GoalEvaluation }) {
  const g = e.goal
  const today = gm.model.today
  const [editOpen, setEditOpen] = useState(false)
  const [measure, setMeasure] = useState<{ date?: LocalDate } | null>(null)
  const [drill, setDrill] = useState<{ request: DrillRequest; habits: Habit[] } | null>(null)
  const editable = goalsEnabled()
  const manual = g.kind === "numeric" && g.numeric?.source === "manual"
  const sourceHabit = g.numeric?.habitId ? gm.model.all.find((h) => h.id === g.numeric!.habitId) : undefined
  const unit = g.kind === "numeric" ? (g.numeric?.unit ?? "") : g.kind === "milestones" ? "hitos" : ""
  const parent = g.parentId ? gm.goals.find((x) => x.id === g.parentId) : undefined
  const children = gm.goals.filter((x) => x.parentId === g.id)
  const linkedHabits = e.effort?.perHabit.map((p) => p.habit) ?? []
  const openPrimary = gm.goals.filter((x) => x.priority === "primary" && x.state === "active" && !x.archivedOn).length

  const inReview = goalStatusView(g) === "review"

  const setReview = (review: boolean) => {
    habitActions.setGoalReview(g.id, review)
    toast(review ? "Objetivo en revisión" : "Objetivo fuera de revisión", {
      description: review ? "Se sigue midiendo y sigue en el Resumen." : undefined,
      action: { label: "Deshacer", onClick: () => habitActions.setGoalReview(g.id, !review) },
    })
  }

  const setState = (s: "active" | "achieved" | "abandoned") => {
    const prev = g.state
    habitActions.setGoalState(g.id, s)
    toast(s === "achieved" ? "Objetivo marcado como conseguido" : s === "abandoned" ? "Objetivo abandonado" : "Objetivo reactivado", {
      action: { label: "Deshacer", onClick: () => habitActions.setGoalState(g.id, prev) },
    })
  }

  return (
    <>
      <Link href="/goals" className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-text-secondary hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Objetivos
      </Link>

      <header className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          {gm.model.source === "demo" && <DemoBadge />}
          <span>{HORIZON_LABEL[e.horizon]}</span>
          <span aria-hidden>·</span>
          <span>{g.priority === "primary" ? "Principal" : "Secundario"}</span>
          <span aria-hidden>·</span>
          <span>{dueText(g, today)}</span>
          {inReview && (
            <>
              <span aria-hidden>·</span>
              <span className="text-text-secondary">En revisión</span>
            </>
          )}
        </div>
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight text-balance md:text-[2rem]">{g.title}</h1>
        {g.why && <p className="mt-2 max-w-[60ch] text-[0.9375rem] leading-relaxed text-text-secondary">{g.why}</p>}
        {parent && (
          <p className="mt-2 text-sm text-text-secondary">
            Forma parte de{" "}
            <Link href={`/goals/${parent.id}`} className="text-foreground underline underline-offset-4">
              {parent.title}
            </Link>
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="space-y-4 lg:col-span-7">
          {/* Outcome */}
          <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="outcome-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="outcome-title" className="text-sm font-medium text-text-secondary">
                {GOAL_METRICS.goal_outcome.label}
              </h2>
              <div className="flex items-center gap-1.5">
                <DataLevelNote evaluation={e} />
                <StatusChip evaluation={e} />
              </div>
            </div>
            <p className="num mt-3 text-5xl leading-none font-semibold tracking-tight">{pct(e.outcome.progress)}</p>
            <p className="num mt-2 text-sm text-text-secondary">{e.outcome.progress === null ? e.outcome.reason : outcomeLine(e)}</p>
            <p className="mt-1 text-xs text-text-tertiary">Estado · {statusText(e)}</p>
            <OutcomeBar
              value={e.outcome.progress}
              ideal={g.kind === "habits" || g.state !== "active" ? null : e.timeShare}
              className="mt-4"
              label={`Resultado ${pct(e.outcome.progress)}`}
            />
            {g.kind !== "habits" && g.state === "active" && (
              <p className="mt-2 text-xs text-text-tertiary">
                La marca vertical es el ritmo ideal a hoy: {pct(e.timeShare)} del tiempo transcurrido ({e.daysElapsed} de {e.daysTotal} días).
              </p>
            )}
            {sourceHabit && (
              <p className="mt-3 rounded-xl border border-border bg-surface-raised/40 px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
                Se alimenta de los registros de <strong className="font-medium text-foreground">{sourceHabit.name}</strong>
                {g.numeric?.aggregation === "sum" ? " (suma desde el inicio)" : " (último valor)"}. No hay que registrar nada aquí.
              </p>
            )}
            {editable && (
              <div className="mt-4 flex gap-2">
                {manual && g.state === "active" && (
                  <Button onClick={() => setMeasure({})} className="h-11 flex-1 sm:flex-none">
                    <Plus />
                    Registrar medición
                  </Button>
                )}
                <Button variant="outline" className="h-11 max-sm:w-11 max-sm:px-0" onClick={() => setEditOpen(true)} aria-label="Editar objetivo">
                  <Pencil />
                  <span className="max-sm:sr-only">Editar</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="size-11" aria-label="Más acciones">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {g.state === "active" ? (
                      <>
                        {!g.archivedOn && (
                          <DropdownMenuItem onSelect={() => setReview(!inReview)}>
                            {inReview ? <EyeOff /> : <Eye />}
                            {inReview ? "Quitar de revisión" : "Marcar en revisión"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => setState("achieved")}>
                          <Trophy />
                          Marcar como conseguido
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setState("abandoned")}>
                          <CircleSlash />
                          Abandonar
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <DropdownMenuItem onSelect={() => setState("active")}>
                        <RotateCcw />
                        Reactivar
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {g.archivedOn ? (
                      <DropdownMenuItem onSelect={() => habitActions.restoreGoal(g.id)}>
                        <ArchiveRestore />
                        Restaurar
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onSelect={() => {
                          habitActions.archiveGoal(g.id)
                          toast("Objetivo archivado", { description: "Sus datos se conservan.", action: { label: "Deshacer", onClick: () => habitActions.restoreGoal(g.id) } })
                        }}
                      >
                        <Archive />
                        Archivar
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {g.priority === "primary" && openPrimary > MAX_PRIMARY && (
              <p className="mt-3 text-xs text-text-tertiary">Tienes {openPrimary} objetivos principales; el Resumen muestra los {MAX_PRIMARY} más próximos.</p>
            )}
          </section>

          {/* Pace & trend */}
          {g.kind !== "habits" && (
            <section className="grid grid-cols-2 gap-3" aria-label="Ritmo y tendencia">
              <Tile
                label={GOAL_METRICS.goal_pace.label}
                value={e.pace.required === null ? (e.outcome.raw !== null && e.outcome.raw >= 1 ? "Meta alcanzada" : "N/D") : formatRate(e.pace.required, unit)}
                detail={e.pace.required === null ? (e.daysLeft === 0 ? "Sin días restantes" : (e.outcome.reason ?? "")) : `${e.daysLeft} días restantes`}
              />
              <Tile
                label="Ritmo actual"
                value={e.pace.actual === null ? "N/D" : formatRate(e.pace.actual, unit)}
                detail={e.pace.actual === null ? (e.projection.reason ?? "") : e.pace.actual > 0 ? "en la dirección de la meta" : "en contra de la meta"}
              />
              <Tile
                className="col-span-2"
                label={GOAL_METRICS.goal_projection.label}
                value={e.projection.value === null ? "N/D" : `${formatValue(e.projection.value, unit)} el ${formatDate(g.dueDate, { day: "numeric", month: "short" })}`}
                detail={
                  e.projection.value === null
                    ? (e.projection.reason ?? "")
                    : e.projection.reachOn
                      ? `A este ritmo llegarías a la meta el ${formatDate(e.projection.reachOn, { day: "numeric", month: "long", year: "numeric" })}.`
                      : e.projection.progress !== null && e.projection.progress >= 1
                        ? "A este ritmo llegarías a la meta."
                        : "A este ritmo no llegarías a la meta en la fecha."
                }
              />
            </section>
          )}

          {g.kind !== "habits" && <GoalChart e={e} onEdit={manual && editable ? (date) => setMeasure({ date }) : undefined} />}

          {g.checkpoints.length > 0 && <Milestones e={e} today={today} editable={editable} />}
          <GoalLog goal={g} editable={editable} />
        </div>

        <div className="space-y-4 lg:col-span-5">
          {/* System / effort */}
          <section className="panel overflow-hidden rounded-2xl" aria-labelledby="system-title">
            <div className="px-4 pt-4 pb-3 sm:px-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="system-title" className="text-base font-semibold">
                  {g.kind === "habits" ? "Sistema" : GOAL_METRICS.goal_effort.label}
                </h2>
                {e.effort && <span className="num text-sm text-text-secondary">{pct(e.effort.rate)}</span>}
              </div>
              <p className="mt-0.5 text-xs text-text-tertiary">
                {e.effort
                  ? `Hábitos vinculados desde el ${formatDate(e.effort.range.from, { day: "numeric", month: "short" })}${e.effort.weighted ? " · ponderado" : ""}. Últimos 28 días: ${pct(e.effort.recent.rate)}.`
                  : "Vincula hábitos para medir el esfuerzo por separado del resultado."}
              </p>
              {e.effort && (
                <button
                  type="button"
                  onClick={() => setDrill({ request: { title: `Esfuerzo · ${g.title}`, metric: "completion", target: { kind: "range", range: e.effort!.range } }, habits: linkedHabits })}
                  className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-border px-3 text-left text-sm hover:bg-surface-raised"
                >
                  <span>
                    {e.effort.summary.fulfilled} de {e.effort.summary.applicable} oportunidades cumplidas
                    <span className="sr-only">. Ver detalle</span>
                  </span>
                  <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
                </button>
              )}
              {e.effort && (
                <Link href={`/analytics?objetivo=${g.id}`} className="-ml-1 mt-1.5 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm text-text-secondary underline-offset-4 hover:text-foreground hover:underline">
                  Ver estos hábitos en Análisis
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              )}
            </div>
            {e.effort && (
              <ul className="divide-y divide-border/70 border-t border-border">
                {e.effort.perHabit.map(({ habit, weight, summary }) => (
                  <li key={habit.id}>
                    <button
                      type="button"
                      onClick={() => setDrill({ request: { title: `${habit.name} · desde el inicio del objetivo`, metric: "completion", target: { kind: "range", range: e.effort!.range } }, habits: [habit] })}
                      className="grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-raised/50 sm:px-5"
                    >
                      <HabitIcon icon={habit.icon} dimensionId={habit.dimensionId} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{habit.name}</span>
                        <EffortBar value={summary.rate} label={`${pct(summary.rate)}`} className="mt-1.5" />
                      </span>
                      <span className="num text-right text-sm">
                        {pct(summary.rate)}
                        <span className="block text-[0.6875rem] text-text-tertiary">
                          {summary.fulfilled}/{summary.applicable}
                          {e.effort!.weighted ? ` · ×${weight}` : ""}
                        </span>
                        <span className="sr-only">. Ver detalle</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {children.length > 0 && (
            <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="children-title">
              <h2 id="children-title" className="text-base font-semibold">
                Subobjetivos
              </h2>
              {g.aggregateChildren && <p className="mt-0.5 text-xs text-text-tertiary">El resultado de este objetivo es la media del de sus subobjetivos.</p>}
              <ul className="mt-2 divide-y divide-border/70">
                {children.map((c) => {
                  const ce = gm.evals.get(c.id)!
                  return (
                    <li key={c.id}>
                      <Link href={`/goals/${c.id}`} className="flex min-h-12 items-center gap-3 py-2 text-sm hover:text-foreground">
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        <span className="num text-text-secondary">{pct(ce.outcome.progress)}</span>
                        <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <HowItWorks />
        </div>
      </div>

      {editable && (
        <>
          <GoalFormSheet open={editOpen} onOpenChange={setEditOpen} goal={g} />
          <MeasureSheet goal={measure ? g : null} initialDate={measure?.date} today={today} measurements={gm.model.state.measurements} onOpenChange={(o) => !o && setMeasure(null)} />
        </>
      )}
      <DrillSheet
        request={drill?.request ?? null}
        habits={drill?.habits ?? []}
        ctx={gm.model.ctx}
        onOpenChange={(o) => !o && setDrill(null)}
      />
    </>
  )
}

function Tile({ label, value, detail, className }: { label: string; value: string; detail: string; className?: string }) {
  return (
    <div className={cn("panel rounded-2xl p-4", className)}>
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <p className="num mt-2 text-lg leading-tight font-semibold">{value}</p>
      {detail && <p className="mt-1.5 text-xs leading-snug text-text-tertiary">{detail}</p>}
    </div>
  )
}

function Milestones({ e, today, editable }: { e: GoalEvaluation; today: LocalDate; editable: boolean }) {
  const g = e.goal
  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="milestones-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="milestones-title" className="text-base font-semibold">
          Hitos
        </h2>
        <span className="num text-xs text-text-tertiary">
          {e.checkpoints.filter((c) => c.doneOn && c.doneOn <= today).length}/{e.checkpoints.length}
        </span>
      </div>
      <ol className="mt-2 space-y-0.5">
        {e.checkpoints.map(({ checkpoint: c, doneOn, auto }) => {
          const done = !!doneOn && doneOn <= today
          const sub = auto
            ? done
              ? `Alcanzado el ${formatDate(doneOn!, { day: "numeric", month: "short" })} con tus datos`
              : `Se cumple solo al llegar a ${formatValue(c.value, g.numeric?.unit)}`
            : done
              ? `Cumplido el ${formatDate(doneOn!, { day: "numeric", month: "short" })}`
              : c.dueOn
                ? `Previsto para el ${formatDate(c.dueOn, { day: "numeric", month: "short" })}`
                : "Pendiente"
          const body = (
            <>
              <span
                className={cn("grid size-6 shrink-0 place-items-center rounded-full border", done ? "border-transparent bg-signal text-signal-foreground" : "border-text-tertiary/60")}
                aria-hidden
              >
                {done && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm", done && "text-text-secondary")}>{c.title}</span>
                <span className="block text-xs text-text-tertiary">{sub}</span>
              </span>
            </>
          )
          return (
            <li key={c.id}>
              {auto || !editable || g.state !== "active" ? (
                <div className="flex min-h-12 items-center gap-3 px-1 py-1.5">{body}</div>
              ) : (
                <button
                  type="button"
                  aria-pressed={done}
                  onClick={() => habitActions.setCheckpoint(g.id, c.id, done ? null : today)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-1 py-1.5 text-left transition-colors hover:bg-surface-raised"
                >
                  {body}
                  <span className="sr-only">{done ? ". Pulsa para desmarcar" : ". Pulsa para marcar como cumplido hoy"}</span>
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="goal-how-title">
      <h2 id="goal-how-title" className="text-base font-semibold">
        Cómo se calcula
      </h2>
      <dl className="mt-3 space-y-3 text-sm leading-relaxed">
        {Object.values(GOAL_METRICS).map((m) => (
          <div key={m.id}>
            <dt className="font-medium">{m.label}</dt>
            <dd className="text-text-secondary">{m.formula}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-4 space-y-2 border-t border-border/70 pt-4 text-sm leading-relaxed text-text-secondary">
        {GOAL_RULES.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </section>
  )
}
