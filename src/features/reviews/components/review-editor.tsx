"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, CalendarX2, Check, Lock, Trash2 } from "lucide-react"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { Button } from "@/components/ui/button"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { localDateInZone } from "@/features/habits/domain/dates"
import { isLateClose, parseRoute, periodLabel, type Period } from "../domain/periods"
import { figuresFor, phaseOf, previousReviewOf, reviewOf, reviewProgress, reviewSteps, STEP_LABEL, type StepId } from "../domain/overview"
import { compareSnapshot, buildReviewSnapshot, type ReviewSnapshot } from "../domain/snapshot"
import { normalizeContent } from "../domain/content"
import { contentKeys } from "../domain/content"
import { DECISION_KIND_LABEL, EVALUATION_LABEL, LIMITS, QUESTION_LABEL, type Review, type ReviewField, type ReviewKind } from "../domain/types"
import { nextPeriod } from "../domain/periods"
import { closeIntentOf, reviewNotices, saveLine, savesKind, syncStateOf, useReviewsModel, waitingFields, type ReviewsModel } from "../use-reviews"
import { ReviewFigures } from "./review-figures"
import { DecisionsStep, EvaluationsStep, ReflectionStep, type SaveSection } from "./review-sections"
import { ConflictPanel } from "./review-conflicts"
import { CloseDialog, CloseIntentBanner, DeleteDialog } from "./review-close"
import { KIND_LABEL, reviewsHomeHref, SaveIndicator, StatusBadge } from "./review-ui"

export function ReviewEditorSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Cargando la revisión">
      <div className="h-24 animate-pulse rounded-2xl bg-surface/60 motion-reduce:animate-none" />
      <div className="panel h-96 animate-pulse rounded-2xl motion-reduce:animate-none" />
    </div>
  )
}

/** `/reviews/[kind]/[start]`: the editor of a draft, or the read-only document of a closed review. */
export function ReviewEditor({ kind, start }: { kind: string; start: string }) {
  const m = useReviewsModel()
  if (!m) return <ReviewEditorSkeleton />
  const period = parseRoute(kind, start, m.today)
  if (!period) return <InvalidPeriod />
  const review = reviewOf(m.state.reviews, period.kind, period.from)
  return review?.status === "closed" ? <ClosedReview m={m} period={period} review={review} /> : <DraftEditor key={period.from} m={m} period={period} review={review} />
}

function InvalidPeriod() {
  return (
    <div className="panel rounded-2xl" data-testid="review-invalid">
      <EmptyState
        icon={CalendarX2}
        title="Esta revisión no existe"
        description="La fecha no es válida, no corresponde al inicio de una semana (lunes) o de un mes, o el periodo aún no ha llegado."
        action={
          <Button asChild>
            <Link href="/reviews">Volver a Revisiones</Link>
          </Button>
        }
      />
    </div>
  )
}

function Header({ m, period, badge, children }: { m: ReviewsModel; period: Period; badge: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-5 md:mb-7">
      <Link href={reviewsHomeHref(period.kind)} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-text-secondary hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Revisiones
      </Link>
      <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            <span>{KIND_LABEL[period.kind].title}</span>
            {badge}
            <SourceBadge source={m.source}>Demo · registros de ejemplo</SourceBadge>
          </div>
          <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight text-balance md:text-[2rem]">{periodLabel(period)}</h1>
        </div>
        {children}
      </div>
    </header>
  )
}

// ── Draft ──────────────────────────────────────────────────────────────────

const stepKey = (p: Period) => `the-one-percent:review-step:${p.kind}:${p.from}`

function readStep(p: Period, steps: StepId[]): StepId {
  try {
    const s = window.sessionStorage.getItem(stepKey(p)) as StepId | null
    if (s && steps.includes(s)) return s
  } catch {
    // ignore: the walk starts at the figures
  }
  return steps[0]
}

function DraftEditor({ m, period, review }: { m: ReviewsModel; period: Period; review: Review | undefined }) {
  const desktop = useMediaQuery("(min-width: 1024px)")
  const { kind, from: start } = period
  const previous = previousReviewOf(m.state.reviews, period)
  const steps = reviewSteps(previous, kind)
  const notices = reviewNotices(m, kind, start)
  const waiting = waitingFields(notices)
  const intent = closeIntentOf(m, kind, start)
  const closing = intent?.state === "waiting"
  const figures = useMemo(() => figuresFor(m.state, review, period, m.today), [m.state, review, period, m.today])
  const [typing, setTyping] = useState<ReadonlySet<ReviewField>>(new Set())
  const [closeOpen, setCloseOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const router = useRouter()

  const onTyping = useCallback((field: ReviewField, on: boolean) => {
    setTyping((prev) => {
      if (prev.has(field) === on) return prev
      const next = new Set(prev)
      if (on) next.add(field)
      else next.delete(field)
      return next
    })
  }, [])
  const api = m.api
  const save: SaveSection = useCallback(
    (field, value) => {
      const r = api.saveReview(kind, start, { [field]: value })
      return r.ok ? null : r.reason
    },
    [api, kind, start]
  )

  const line = saveLine(m, kind, syncStateOf(m, kind, start), typing.size > 0)
  const saves = savesKind(m, kind)
  const offline = m.snap.sync?.status === "offline"
  const phase = closing ? "closing" : phaseOf(review)
  const nextLabel = KIND_LABEL[kind].next
  const sections: Record<Exclude<StepId, "figures" | "close">, React.ReactNode> = {
    reflection: <ReflectionStep review={review} kind={kind} save={save} onTyping={onTyping} waiting={waiting} disabled={closing} />,
    evaluations: previous ? <EvaluationsStep review={review} previous={previous} save={save} onTyping={onTyping} waiting={waiting.has("evaluations")} disabled={closing} /> : null,
    decisions: <DecisionsStep review={review} state={m.state} nextLabel={nextLabel} save={save} onTyping={onTyping} waiting={waiting.has("decisions")} disabled={closing} />,
  }
  const closeAction = (
    <CloseBlock
      m={m}
      review={review}
      previous={previous}
      kind={kind}
      onClose={() => setCloseOpen(true)}
      onDelete={review?.serverSeq !== undefined || m.source === "demo" ? () => setDeleteOpen(true) : undefined}
      disabled={closing || waiting.size > 0}
      waiting={waiting.size}
    />
  )
  const figuresView = figures ? <ReviewFigures s={figures} live /> : <p className="text-sm text-text-tertiary">No se pudieron calcular las cifras de este periodo.</p>

  return (
    <>
      <Header m={m} period={period} badge={<StatusBadge phase={phase} />}>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <SaveIndicator text={line.text} tone={line.tone} offline={offline} />
          {desktop && (
            <Button onClick={() => setCloseOpen(true)} disabled={closing || waiting.size > 0} data-testid="review-close-header">
              <Lock aria-hidden />
              Cerrar revisión
            </Button>
          )}
        </div>
      </Header>

      <div className="space-y-4">
        {intent && <CloseIntentBanner m={m} intent={intent} kind={kind} start={start} />}
        <ConflictPanel m={m} notices={notices} review={review} />
        {!saves && (
          <p role="note" className="rounded-xl border border-dashed border-warning/40 px-4 py-3 text-sm text-text-secondary">
            Tu cuenta aún no guarda revisiones en la nube: lo que escribas queda en este dispositivo y se enviará cuando esté disponible. Mientras tanto no se puede cerrar.
          </p>
        )}
      </div>

      {desktop ? (
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] items-start gap-6 xl:gap-8">
          <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto pr-2 [scrollbar-width:thin]" aria-label="Cifras del periodo" role="region" tabIndex={0}>
            {figuresView}
          </div>
          <div className="space-y-5">
            {steps
              .filter((s): s is Exclude<StepId, "figures" | "close"> => s !== "figures" && s !== "close")
              .map((s) => (
                <WritingPanel key={s} id={s} title={s === "decisions" ? `Decisiones para ${nextLabel}` : STEP_LABEL[s]}>
                  {sections[s]}
                </WritingPanel>
              ))}
            {closeAction}
          </div>
        </div>
      ) : (
        <Stepper period={period} steps={steps} figures={figuresView} sections={sections} closeAction={closeAction} nextLabel={nextLabel} progress={reviewProgress(kind, review, previous)} />
      )}

      <CloseDialog m={m} period={period} review={review} open={closeOpen} onOpenChange={setCloseOpen} conflicts={waiting.size} />
      <DeleteDialog m={m} period={period} label={periodLabel(period)} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={() => router.push("/reviews")} />
    </>
  )
}

function WritingPanel({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const h = useId()
  return (
    <section aria-labelledby={h} className="panel rounded-2xl p-5" data-step={id}>
      <h2 id={h} className="mb-4 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

function CloseBlock({
  m,
  review,
  previous,
  kind,
  onClose,
  onDelete,
  disabled,
  waiting,
}: {
  m: ReviewsModel
  review: Review | undefined
  previous: Review | null
  kind: ReviewKind
  onClose: () => void
  onDelete?: () => void
  disabled: boolean
  waiting: number
}) {
  return (
    <section className="panel rounded-2xl p-5" aria-label="Cerrar la revisión">
      <p className="num text-sm text-text-secondary">{reviewProgress(kind, review, previous)}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-text-tertiary">
        Nada es obligatorio. Al cerrar, las cifras se congelan y la revisión queda como documento de solo lectura.
        {m.source === "account" && " Solo se cierra con todo sincronizado: sin conexión, el cierre espera a que vuelva."}
      </p>
      {waiting > 0 && <p className="mt-2 text-xs text-warning">Decide antes los cambios pendientes (arriba).</p>}
      <Button className="mt-4 w-full" size="lg" onClick={onClose} disabled={disabled || !savesKind(m, kind)} data-testid="review-close">
        <Lock aria-hidden />
        Cerrar revisión
      </Button>
      {onDelete && (
        <Button variant="ghost" className="mt-2 w-full text-text-tertiary" onClick={onDelete}>
          <Trash2 aria-hidden />
          Borrar esta revisión
        </Button>
      )}
    </section>
  )
}

/** Mobile: one step at a time, free to jump; «Anterior» / «Siguiente» fixed above the tab bar. */
function Stepper({
  period,
  steps,
  figures,
  sections,
  closeAction,
  nextLabel,
  progress,
}: {
  period: Period
  steps: StepId[]
  figures: React.ReactNode
  sections: Record<Exclude<StepId, "figures" | "close">, React.ReactNode>
  closeAction: React.ReactNode
  nextLabel: string
  progress: string
}) {
  const [step, setStepState] = useState<StepId>(() => readStep(period, steps))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)
  const i = Math.max(0, steps.indexOf(step))
  const current = steps[i]
  function setStep(s: StepId) {
    moved.current = true
    setStepState(s)
    try {
      window.sessionStorage.setItem(stepKey(period), s)
    } catch {
      // ignore
    }
  }
  useEffect(() => {
    if (!moved.current) return
    // A new step starts at its heading, for screen readers and keyboard users alike.
    headingRef.current?.focus({ preventScroll: true })
    document.querySelector('[aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "center" })
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })
  }, [current])
  const title = current === "decisions" ? `Decisiones para ${nextLabel}` : STEP_LABEL[current]
  return (
    <div className="mt-5">
      <nav aria-label="Pasos de la revisión" className="-mx-4 overflow-x-auto px-4 scrollbar-none">
        <ol className="flex min-w-max gap-1.5">
          {steps.map((s, n) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => setStep(s)}
                aria-current={s === current ? "step" : undefined}
                className={cn(
                  "inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-medium transition-colors motion-reduce:transition-none",
                  s === current ? "border-signal/50 bg-signal/10 text-foreground" : "border-border text-text-secondary hover:text-foreground"
                )}
              >
                <span className="num text-text-tertiary">{n + 1}</span>
                {STEP_LABEL[s]}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <section aria-labelledby="review-step-title" className="mt-4" data-step={current}>
        <p className="num text-xs text-text-tertiary">
          Paso {i + 1} de {steps.length} · {progress}
        </p>
        <h2 id="review-step-title" ref={headingRef} tabIndex={-1} className="mt-1 mb-4 text-lg font-semibold outline-none">
          {title}
        </h2>
        {current === "figures" ? figures : current === "close" ? closeAction : <div className="panel rounded-2xl p-4">{sections[current]}</div>}
      </section>
      <div className="h-20" aria-hidden />
      <div className="fixed inset-x-0 bottom-[calc(var(--bottom-tabs-h)+env(safe-area-inset-bottom))] z-(--z-header) border-t border-border bg-background/92 px-4 py-2 backdrop-blur-xl md:bottom-0 md:pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:pl-[calc(72px+1rem)]">
        <div className="mx-auto flex max-w-xl gap-2">
          <Button variant="outline" size="lg" className="flex-1" disabled={i === 0} onClick={() => setStep(steps[i - 1])}>
            <ArrowLeft aria-hidden />
            Anterior
          </Button>
          <Button size="lg" className="flex-1" disabled={i === steps.length - 1} onClick={() => setStep(steps[i + 1])} data-testid="review-next">
            Siguiente
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Closed: a read-only historical document ────────────────────────────────

const FIGURE_LABEL: Record<string, string> = {
  "habits.current": "Cumplimiento de hábitos",
  "habits.perfectDays": "Días completos",
  "focus.current": "Deep Work",
  "mind.coverage": "Días con check-in",
  "mind.averages": "Medias de mente y energía",
}

function ClosedReview({ m, period, review }: { m: ReviewsModel; period: Period; review: Review }) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const s = review.snapshot!
  const tz = m.state.timezone
  const closedAt = review.closedAt ? new Date(review.closedAt) : null
  const closedOn = closedAt ? localDateInZone(closedAt, tz) : null
  const late = closedOn ? isLateClose(period, closedOn, LIMITS.lateCloseDays) : false
  const stamp = closedAt
    ? new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(closedAt).replace(",", " a las")
    : null
  const notices = reviewNotices(m, period.kind, period.from)
  const previous = previousReviewOf(m.state.reviews, period)
  const next = reviewOf(m.state.reviews, period.kind, nextPeriod(period).from)
  const comparison = useMemo(() => {
    try {
      return compareSnapshot(s, buildReviewSnapshot({ state: m.state, kind: period.kind, periodStart: period.from, today: m.today, computedAt: "" }))
    } catch {
      return null
    }
  }, [s, m.state, m.today, period])
  const content = normalizeContent(review.content)
  return (
    <>
      <Header m={m} period={period} badge={<StatusBadge phase={late ? "late" : "closed"} />} />
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary" data-testid="review-closed-stamp">
          <Lock className="size-3.5" aria-hidden />
          Cerrada · cifras congeladas{stamp ? ` el ${stamp}` : ""} · métricas v{s.metricsVersion}
        </p>
        <ConflictPanel m={m} notices={notices} review={review} />
        {comparison && <ChangedNote comparison={comparison} s={s} />}
      </div>
      <div className="mt-5 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] xl:gap-8">
        <ReviewFigures s={s} live={false} />
        <div className="space-y-5">
          <WritingPanel id="reflection" title="Reflexión">
            <dl className="space-y-4">
              {contentKeys(period.kind)
                .filter((k) => k !== "note" || content.note)
                .map((k) => (
                  <div key={k}>
                    <dt className="text-xs font-medium text-text-tertiary">{QUESTION_LABEL[k]}</dt>
                    <dd className={cn("mt-1 text-[0.9375rem] leading-relaxed whitespace-pre-wrap", !content[k] && "text-sm text-text-tertiary italic")}>{content[k] ?? "Sin respuesta"}</dd>
                  </div>
                ))}
            </dl>
          </WritingPanel>
          {previous && previous.decisions.length > 0 && (
            <WritingPanel id="evaluations" title="Decisiones anteriores">
              <ul className="space-y-3">
                {previous.decisions.map((d) => {
                  const e = review.evaluations.find((x) => x.decisionId === d.id)
                  return (
                    <li key={d.id} className="text-sm">
                      <p className="font-medium">{d.text}</p>
                      <p className="mt-0.5 text-xs text-text-tertiary">
                        {e ? EVALUATION_LABEL[e.outcome] : "Sin evaluar"}
                        {e?.note && ` · ${e.note}`}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </WritingPanel>
          )}
          {period.kind !== "day" && <WritingPanel id="decisions" title={`Decisiones para ${KIND_LABEL[period.kind].next}`}>
            {review.decisions.length === 0 ? (
              <p className="text-sm text-text-tertiary italic">Sin decisiones.</p>
            ) : (
              <ul className="space-y-3">
                {review.decisions.map((d) => {
                  const e = next?.evaluations.find((x) => x.decisionId === d.id && x.from === period.from)
                  const exists = !d.link || (d.link.type === "habit" ? m.state.habits.some((h) => h.id === d.link!.id) : m.state.goals.some((g) => g.id === d.link!.id))
                  return (
                    <li key={d.id} className="text-sm" data-testid="review-closed-decision">
                      <p className="font-medium">{d.text}</p>
                      <p className="mt-0.5 text-xs text-text-tertiary">
                        {DECISION_KIND_LABEL[d.kind]}
                        {d.expected && ` · esperado: ${d.expected}`}
                        {d.link && ` · ${d.link.title}${exists ? "" : " (ya no existe)"}`}
                        {" · "}
                        {e ? (
                          <span className="inline-flex items-center gap-1 text-text-secondary">
                            <Check className="size-3" aria-hidden />
                            {EVALUATION_LABEL[e.outcome]}
                          </span>
                        ) : (
                          "sin evaluar todavía"
                        )}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </WritingPanel>}
          <Button variant="ghost" className="w-full text-text-tertiary" onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden />
            Borrar esta revisión
          </Button>
        </div>
      </div>
      <DeleteDialog m={m} period={period} label={periodLabel(period)} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={() => router.push("/reviews")} />
    </>
  )
}

/** §4.4: informative only. The snapshot never changes; this says what differs today, and why it can't be compared otherwise. */
function ChangedNote({ comparison, s }: { comparison: ReturnType<typeof compareSnapshot>; s: ReviewSnapshot }) {
  if (!comparison.comparable) {
    return (
      <p role="note" className="text-xs text-text-tertiary">
        Estas cifras se calcularon con otra versión de las métricas: no se comparan con los datos de hoy.
      </p>
    )
  }
  if (comparison.changes.length === 0) return null
  const goalTitle = (id: string) => s.goals.find((g) => g.id === id)?.title ?? "un objetivo"
  return (
    <details className="rounded-xl border border-dashed border-border px-4 py-3 text-sm" data-testid="review-changed">
      <summary className="min-h-6 cursor-pointer text-text-secondary">Algunos datos de este periodo cambiaron después del cierre</summary>
      <p className="mt-2 text-xs text-text-tertiary">Las cifras congeladas no cambian. Esto es solo informativo:</p>
      <ul className="mt-2 space-y-1 text-xs text-text-secondary">
        {comparison.changes.map((c) => (
          <li key={c.figure}>{c.figure.startsWith("goal:") ? `Objetivo «${goalTitle(c.figure.slice(5))}»` : (FIGURE_LABEL[c.figure] ?? c.figure)}: {describe(c.frozen)} congelada · {describe(c.live)} ahora</li>
        ))}
      </ul>
    </details>
  )
}

function describe(v: unknown): string {
  if (v === null || v === undefined) return "—"
  if (typeof v === "object") {
    const o = v as Record<string, unknown>
    if ("rate" in o && "applicable" in o) return o.rate === null ? "N/D" : `${Math.round((o.rate as number) * 100)}% (${o.fulfilled}/${o.applicable})`
    if ("minutes" in o) return `${o.minutes} min`
    if ("days" in o && "total" in o) return `${o.days}/${o.total} días`
    if ("perfect" in o) return `${o.perfect}/${o.withData}`
    if ("progress" in o) return o.progress === null ? "N/D" : `${Math.round((o.progress as number) * 100)}%`
  }
  return "distinto"
}
