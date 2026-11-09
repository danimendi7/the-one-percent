"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo } from "react"
import { ArrowRight, ChevronRight, History, ListChecks, NotebookPen } from "lucide-react"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { pct } from "@/components/common/format"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatDate } from "@/features/habits/domain/dates"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { minutesLabel } from "@/features/focus/components/focus-ui"
import { nextPeriod, periodFromStart, periodLabel } from "./domain/periods"
import { dueReview, headline, historyGroups, historyStart, pastPeriods, phaseOf, previousReviewOf, progressLabel, reviewOf } from "./domain/overview"
import { QUESTION_KEYS, type Review, type ReviewKind } from "./domain/types"
import { closeIntentOf, useReviewsModel, type ReviewsModel } from "./use-reviews"
import { KIND_LABEL, reviewHref, shortPeriod, StatusBadge } from "./components/review-ui"

export function ReviewsSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Cargando revisiones">
      <div className="panel h-44 animate-pulse rounded-2xl motion-reduce:animate-none" />
      <div className="panel h-72 animate-pulse rounded-2xl motion-reduce:animate-none" />
    </div>
  )
}

/** `/reviews` (plan §6.2): the review due now, then the history by month. */
export function ReviewsView() {
  const m = useReviewsModel()
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const kind: ReviewKind = params.get("tipo") === "mensual" ? "month" : "week"
  return (
    <>
      <PageHeader
        title="Revisiones"
        meta={<SourceBadge source={m?.source}>Demo · cifras de los registros de ejemplo</SourceBadge>}
        description="Cada semana y cada mes: cifras reales, una reflexión breve y hasta tres decisiones. Sin IA."
        actions={
          <Button variant="outline" asChild>
            <Link href="/reviews/decisions">
              <ListChecks aria-hidden />
              Registro de decisiones
            </Link>
          </Button>
        }
      />
      <Segmented
        label="Tipo de revisión"
        value={kind}
        onChange={(v) => router.replace(v === "month" ? `${pathname}?tipo=mensual` : pathname, { scroll: false })}
        options={[
          { value: "week", label: "Semanal" },
          { value: "month", label: "Mensual" },
        ]}
        className="mb-5 max-w-xs"
      />
      {m ? <Home m={m} kind={kind} /> : <ReviewsSkeleton />}
    </>
  )
}

function Home({ m, kind }: { m: ReviewsModel; kind: ReviewKind }) {
  const groups = useMemo(() => historyGroups(m.state.reviews, kind), [m.state.reviews, kind])
  const start = useMemo(() => historyStart(m.state), [m.state])
  const past = useMemo(() => pastPeriods(kind, m.today, start).slice(1).filter((p) => !reviewOf(m.state.reviews, kind, p.from)), [kind, m.today, start, m.state.reviews])
  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6">
      <NowCard m={m} kind={kind} hasHistory={start !== null} />
      <div className="space-y-5">
        <section aria-labelledby="history-title" className="panel rounded-2xl">
          <h2 id="history-title" className="flex items-center gap-2 px-5 pt-5 pb-3 text-base font-semibold">
            <History className="size-4 text-text-tertiary" aria-hidden />
            Histórico
          </h2>
          {groups.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-text-tertiary">Todavía no hay revisiones {kind === "week" ? "semanales" : "mensuales"}.</p>
          ) : (
            groups.map((g) => (
              <div key={g.month}>
                <h3 className="border-t border-border/70 bg-background/30 px-5 py-2 text-xs font-medium text-text-tertiary">{g.label}</h3>
                <ul className="divide-y divide-border/70">
                  {g.reviews.map((r) => (
                    <HistoryRow key={r.periodStart} m={m} review={r} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
        {past.length > 0 && (
          <details className="panel group rounded-2xl" data-testid="review-past">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
              {kind === "week" ? "Revisar una semana anterior" : "Revisar un mes anterior"}
              <ChevronRight className="size-4 text-text-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
            </summary>
            <ul className="divide-y divide-border/70 border-t border-border/70">
              {past.map((p) => (
                <li key={p.from}>
                  <Link href={reviewHref(kind, p.from)} className="flex min-h-12 items-center justify-between gap-3 px-5 text-sm text-text-secondary hover:bg-surface-raised/50 hover:text-foreground">
                    {periodLabel(p)}
                    <ArrowRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

function NowCard({ m, kind, hasHistory }: { m: ReviewsModel; kind: ReviewKind; hasHistory: boolean }) {
  const due = dueReview(m.state.reviews, kind, m.today)
  const previous = previousReviewOf(m.state.reviews, due.period)
  const closing = closeIntentOf(m, kind, due.period.from)?.state === "waiting"
  const k = KIND_LABEL[kind]
  if (!hasHistory) {
    return (
      <section className="panel rounded-2xl" aria-label="Ahora">
        <EmptyState
          icon={NotebookPen}
          title="Tu primera revisión estará lista pronto"
          description={`Cuando tengas hábitos, sesiones de foco o check-ins, cada ${k.noun} tendrá su revisión con cifras reales.`}
        />
      </section>
    )
  }
  if (due.phase === "closed") {
    const next = nextPeriod(due.period)
    return (
      <section className="panel rounded-2xl p-5 sm:p-6" aria-labelledby="now-title" data-testid="review-now">
        <p className="text-xs font-medium tracking-wide text-text-tertiary uppercase">Ahora</p>
        <h2 id="now-title" className="mt-2 text-lg font-semibold">
          Estás al día
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {periodLabel(due.period)} está cerrada. La próxima estará lista el {formatDate(next.to, { weekday: "long", day: "numeric", month: "long" })}.
        </p>
        <Button variant="outline" className="mt-5" asChild>
          <Link href={reviewHref(kind, due.period.from)}>Ver la revisión</Link>
        </Button>
      </section>
    )
  }
  const started = due.phase === "draft"
  return (
    <section className="panel relative overflow-hidden rounded-2xl border-signal/30 p-5 sm:p-6" aria-labelledby="now-title" data-testid="review-now">
      <div className="pointer-events-none absolute -top-24 -right-24 size-56 rounded-full bg-signal/6 blur-3xl" aria-hidden />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-text-tertiary uppercase">Ahora</p>
        <StatusBadge phase={closing ? "closing" : due.phase} />
      </div>
      <h2 id="now-title" className="mt-3 text-xl font-semibold tracking-tight text-balance">
        {started ? `Continúa tu ${k.title.toLowerCase()}` : `Tu ${k.title.toLowerCase()} está lista`}
      </h2>
      <p className="mt-1 text-sm text-text-secondary">{periodLabel(due.period)}</p>
      <p className="num mt-3 text-xs text-text-tertiary">{progressLabel(due.review, previous, QUESTION_KEYS[kind].length)}</p>
      <Button size="lg" className="mt-5 w-full sm:w-auto" asChild>
        <Link href={reviewHref(kind, due.period.from)} data-testid="review-now-open">
          {started ? "Continuar" : "Empezar"}
          <ArrowRight aria-hidden />
        </Link>
      </Button>
      <p className="mt-3 text-xs text-text-tertiary">Unos 5 minutos · todo es opcional.</p>
    </section>
  )
}

function HistoryRow({ m, review }: { m: ReviewsModel; review: Review }) {
  const p = periodFromStart(review.kind, review.periodStart)!
  const phase = phaseOf(review)
  const closing = closeIntentOf(m, review.kind, review.periodStart)?.state === "waiting"
  const pending = m.snap.sync?.pendingReviews?.includes(`${review.kind}:${review.periodStart}`)
  const h = review.snapshot ? headline(review.snapshot) : null
  return (
    <li>
      <Link href={reviewHref(review.kind, review.periodStart)} className="flex min-h-14 items-center gap-3 px-5 py-2 hover:bg-surface-raised/50" data-testid="review-row">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium first-letter:uppercase">{shortPeriod(p)}</span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <StatusBadge phase={closing ? "closing" : phase} />
            {pending && <span className="text-[0.6875rem] text-text-tertiary">· pendiente de sincronizar</span>}
          </span>
        </span>
        {h ? (
          <span className="num text-right text-xs text-text-secondary">
            <span className={cn("block text-sm font-semibold text-foreground")}>{h.applicable ? pct(h.completion) : "N/D"}</span>
            {minutesLabel(h.focusMinutes)} foco
          </span>
        ) : (
          <span className="num text-right text-xs text-text-tertiary">{progressLabel(review, null, QUESTION_KEYS[review.kind].length).split(" · ")[0]}</span>
        )}
        <ChevronRight className="size-4 shrink-0 text-text-tertiary" aria-hidden />
      </Link>
    </li>
  )
}
