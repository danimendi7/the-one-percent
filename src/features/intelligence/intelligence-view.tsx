"use client"

import { useMemo } from "react"
import { ChevronRight, Cpu, KeyRound, ListChecks, Lock, ShieldCheck } from "lucide-react"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { formatDate } from "@/features/habits/domain/dates"
import { useHabits } from "@/features/habits/store/habit-store"
import { INSIGHT_RULES, insights, type Insight } from "./domain/insights"
import type { AiStatus } from "./domain/ai-provider"
import { ExperimentsSection } from "./components/experiments-section"

const PRINCIPLES = [
  { icon: KeyRound, title: "Claves solo en el servidor", body: "Si algún día se activa, nunca en el navegador, con cuotas, caché y límites de coste." },
  { icon: ShieldCheck, title: "Fuentes antes que afirmaciones", body: "Lo no verificado se etiqueta como tal. Sin estudios ni enlaces inventados." },
  { icon: Cpu, title: "Tus datos privados no salen", body: "Check-ins, reflexiones y notas no se envían a ningún modelo." },
]

const TONE: Record<Insight["tone"], string> = { positive: "border-l-signal", negative: "border-l-warning", neutral: "border-l-border" }
const span = (from: string, to: string) => `${formatDate(from, { day: "numeric", month: "short" })} – ${formatDate(to, { day: "numeric", month: "short" })}`

/** `/intelligence`: what your records show, by fixed rules, each finding with where it comes from. */
export function IntelligenceView({ ai }: { ai: AiStatus }) {
  const snap = useHabits()
  const list = useMemo(() => (snap ? insights(snap.state, snap.today) : []), [snap])
  return (
    <>
      <PageHeader
        title="Inteligencia"
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-border px-2 text-[0.6875rem] font-medium text-text-secondary" data-testid="insights-rules-badge">
              <ListChecks className="size-3" aria-hidden />
              Reglas · sin IA
            </span>
            <SourceBadge source={snap?.source}>Demo · calculado con los datos de ejemplo</SourceBadge>
          </span>
        }
        description="Patrones de tus registros descritos con reglas fijas. Cada uno dice su periodo, qué compara, cuántos datos usa y qué no permite concluir."
      />
      {!snap ? (
        <div className="panel h-64 animate-pulse rounded-2xl motion-reduce:animate-none" role="status" aria-busy="true" aria-label="Calculando" />
      ) : list.length === 0 ? (
        <section className="panel rounded-2xl" data-testid="insights-empty">
          <EmptyState icon={ListChecks} title="Aún no hay datos suficientes" description="Cada regla necesita un mínimo de registros antes de decir algo. Con unas semanas de hábitos, foco o check-ins aparecerán aquí." />
        </section>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Lo que muestran tus registros">
          {list.map((i) => (
            <li key={i.id} className={cn("panel rounded-2xl border-l-2 p-5", TONE[i.tone])} data-testid="insight">
              <h2 className="font-semibold text-balance">{i.title}</h2>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-text-secondary">{i.statement}</p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-text-tertiary">Periodo</dt>
                <dd className="num text-text-secondary">{span(i.period.from, i.period.to)}</dd>
                <dt className="text-text-tertiary">Variables</dt>
                <dd className="text-text-secondary">{i.variables.join(" · ")}</dd>
                <dt className="text-text-tertiary">Datos</dt>
                <dd className="num text-text-secondary">n = {i.n} · {i.nLabel}</dd>
              </dl>
              <ul className="mt-3 space-y-1 border-t border-border/70 pt-2.5 text-xs leading-relaxed text-text-tertiary" aria-label="Limitaciones">
                {i.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {snap && <ExperimentsSection snap={snap} insights={list} />}
      <details className="panel group mt-5 rounded-2xl" data-testid="insight-rules">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
          Cómo se calculan
          <ChevronRight className="size-4 text-text-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
        </summary>
        <ul className="space-y-2 border-t border-border/70 px-5 py-4 text-sm leading-relaxed text-text-secondary">
          {Object.values(INSIGHT_RULES).map((r) => (
            <li key={r.description}>{r.description}</li>
          ))}
        </ul>
      </details>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        <li className="panel rounded-2xl p-5" data-testid="ai-status">
          <Lock className="size-5 text-signal" strokeWidth={1.75} aria-hidden />
          <h2 className="mt-4 font-semibold">{ai.enabled ? "IA generativa disponible" : "IA generativa apagada"}</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            {ai.enabled
              ? `Proveedor «${ai.provider}», con un tope de ${ai.monthlyTokenBudget.toLocaleString("es-ES")} tokens al mes. Lo de arriba sigue saliendo de reglas.`
              : "No hay proveedor configurado: todo lo de esta página sale de reglas fijas. Activarlo es una decisión pendiente, porque tendría coste."}
          </p>
        </li>
        {PRINCIPLES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="panel rounded-2xl p-5">
            <Icon className="size-5 text-signal" strokeWidth={1.75} aria-hidden />
            <h2 className="mt-4 font-semibold">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{body}</p>
          </li>
        ))}
      </ul>
    </>
  )
}
