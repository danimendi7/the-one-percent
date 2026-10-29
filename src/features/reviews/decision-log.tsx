"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowLeft, ListChecks } from "lucide-react"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { periodLabel } from "./domain/periods"
import { decisionLog, filterLog, logSummary, type LogFilter } from "./domain/overview"
import { DECISION_KIND_LABEL, DECISION_KINDS, EVALUATION_LABEL, EVALUATION_OUTCOMES } from "./domain/types"
import { useReviewsModel } from "./use-reviews"
import { reviewHref } from "./components/review-ui"
import { ReviewsSkeleton } from "./reviews-view"

/** `/reviews/decisions` (plan §2.4): every decision with its later evaluation. A count with its n, never a score. */
export function DecisionLogView() {
  const m = useReviewsModel()
  const [f, setF] = useState<LogFilter>({ kind: "all", decision: "all", outcome: "all" })
  const all = useMemo(() => (m ? decisionLog(m.state.reviews) : []), [m])
  const rows = filterLog(all, f)
  const sum = logSummary(rows)
  return (
    <>
      <Link href="/reviews" className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-text-secondary hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Revisiones
      </Link>
      <PageHeader
        title="Registro de decisiones"
        className="mt-1"
        meta={<SourceBadge source={m?.source}>Demo · decisiones de ejemplo</SourceBadge>}
        description="Lo que decidiste en cada revisión y cómo salió, según tu propia evaluación en la siguiente."
      />
      {!m ? (
        <ReviewsSkeleton />
      ) : all.length === 0 ? (
        <div className="panel rounded-2xl">
          <EmptyState icon={ListChecks} title="Aún no hay decisiones" description="Las decisiones que tomes al final de cada revisión aparecerán aquí, con su evaluación posterior." />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Filtros">
            <Filter label="Tipo de revisión" value={f.kind} onChange={(v) => setF({ ...f, kind: v as LogFilter["kind"] })} options={[["all", "Todas"], ["week", "Semanales"], ["month", "Mensuales"]]} />
            <Filter label="Tipo de decisión" value={f.decision} onChange={(v) => setF({ ...f, decision: v as LogFilter["decision"] })} options={[["all", "Cualquier tipo"], ...DECISION_KINDS.map((k) => [k, DECISION_KIND_LABEL[k]] as [string, string])]} />
            <Filter
              label="Resultado"
              value={f.outcome}
              onChange={(v) => setF({ ...f, outcome: v as LogFilter["outcome"] })}
              options={[["all", "Cualquier resultado"], ["pending", "Sin evaluar"], ...EVALUATION_OUTCOMES.map((o) => [o, EVALUATION_LABEL[o]] as [string, string])]}
            />
          </div>
          <p className="num text-sm text-text-secondary" role="status" data-testid="decision-summary">
            {sum.evaluated === 0 ? `${rows.length} ${rows.length === 1 ? "decisión" : "decisiones"} · ninguna evaluada todavía` : `Cumplidas ${sum.done} de ${sum.evaluated} evaluadas · ${rows.length} en total`}
          </p>
          <ul className="panel divide-y divide-border/70 rounded-2xl">
            {rows.length === 0 && <li className="px-5 py-6 text-sm text-text-tertiary">Ninguna decisión con estos filtros.</li>}
            {rows.map((e) => (
              <li key={`${e.period.from}:${e.decision.id}`} data-testid="decision-row">
                <Link href={reviewHref(e.kind, e.period.from)} className="block px-5 py-3.5 hover:bg-surface-raised/50">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-sm font-medium">{e.decision.text}</span>
                    <span
                      className={cn(
                        "inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-[0.6875rem] font-medium",
                        !e.evaluation ? "border-border text-text-tertiary" : e.evaluation.outcome === "done" ? "border-signal/35 bg-signal/10 text-signal" : "border-border bg-surface-raised/70 text-text-secondary"
                      )}
                    >
                      {e.evaluation ? EVALUATION_LABEL[e.evaluation.outcome] : "Sin evaluar"}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-text-tertiary">
                    {DECISION_KIND_LABEL[e.decision.kind]} · {periodLabel(e.period)}
                    {e.decision.link && ` · ${e.decision.link.title}`}
                    {e.evaluation?.note && ` · «${e.evaluation.note}»`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground md:h-10">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}
