"use client"

import { useId } from "react"
import { toast } from "sonner"
import { Copy, GitCompareArrows } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SyncNotice } from "@/features/sync/domain/types"
import { sectionOf, type SectionValue } from "../domain/sync"
import { DECISION_KIND_LABEL, EVALUATION_LABEL, QUESTION_LABEL, type ContentKey, type Decision, type Evaluation, type Review, type ReviewField } from "../domain/types"
import type { ReviewsModel } from "../use-reviews"

export function fieldLabel(field: ReviewField): string {
  if (field === "decisions") return "Decisiones"
  if (field === "evaluations") return "Evaluación de decisiones anteriores"
  return QUESTION_LABEL[field.slice("content.".length) as ContentKey]
}

/** A section's value as readable text (both versions are shown side by side). */
export function sectionText(field: ReviewField, v: SectionValue): string {
  if (v === null || v === undefined) return ""
  if (field === "decisions") return (v as Decision[]).map((d) => `${DECISION_KIND_LABEL[d.kind]}: ${d.text}${d.expected ? ` (${d.expected})` : ""}`).join("\n")
  if (field === "evaluations") return (v as Evaluation[]).map((e) => `${EVALUATION_LABEL[e.outcome]}${e.note ? `: ${e.note}` : ""}`).join("\n")
  return v as string
}

const WHY: Record<string, string> = {
  review_field_conflict: "Este apartado cambió en otro dispositivo mientras lo editabas.",
  review_deleted: "La revisión se borró en otro dispositivo después de que escribieras esto.",
  review_closed: "La revisión ya se cerró en otro dispositivo. Tu texto se ha conservado aquí; la revisión cerrada no cambia.",
}

/**
 * «Hay un cambio que espera tu decisión» (D47 generalized, plan §4.2), inside the review: both
 * versions of each kept section, and a durable decision. Nothing here closes on its own; the
 * review cannot close until every section is decided.
 */
export function ConflictPanel({ m, notices, review }: { m: ReviewsModel; notices: SyncNotice[]; review: Review | undefined }) {
  const titleId = useId()
  const items = notices.flatMap((n) => (n.op?.type === "review.save" ? (Object.entries(n.op.fields) as [ReviewField, SectionValue][]).map(([field, mine]) => ({ n, field, mine })) : []))
  if (items.length === 0) return null
  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-warning/40 bg-warning/6 p-4 sm:p-5" data-testid="review-conflicts">
      <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold text-warning">
        <GitCompareArrows className="size-4" aria-hidden />
        {items.length === 1 ? "Hay un cambio que espera tu decisión" : `Hay ${items.length} cambios que esperan tu decisión`}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">No se pierde nada aunque cierres la app. La revisión no se puede cerrar hasta que decidas.</p>
      <ul className="mt-4 space-y-4">
        {items.map(({ n, field, mine }) => {
          const conflict = n.code === "review_field_conflict" || n.code === "review_deleted"
          const theirs = n.code === "review_deleted" ? null : sectionOf(review, field)
          const mineText = sectionText(field, mine)
          return (
            <li key={`${n.id}:${field}`} className="rounded-xl border border-border bg-surface p-3.5" data-testid="review-conflict">
              <p className="text-sm font-medium">{fieldLabel(field)}</p>
              <p className="mt-0.5 text-xs text-text-tertiary">{WHY[n.code ?? ""] ?? "El servidor no aceptó este texto. Se ha conservado aquí."}</p>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <Version label="Tu versión" text={mineText} />
                <Version label={n.code === "review_deleted" ? "Ahora" : "La otra versión"} text={n.code === "review_deleted" ? "" : sectionText(field, theirs)} empty={n.code === "review_deleted" ? "Revisión borrada" : "Vacío"} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {conflict ? (
                  <>
                    <Button onClick={() => m.api.resolveReviewText(n.id, field, "mine")} data-testid="review-apply-mine">
                      {n.code === "review_deleted" ? "Recuperar con mi texto" : "Aplicar la mía"}
                    </Button>
                    <Button variant="outline" onClick={() => m.api.resolveReviewText(n.id, field, "theirs")}>
                      {n.code === "review_deleted" ? "Dejarla borrada" : "Mantener la otra"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => copy(mineText)}>
                      <Copy aria-hidden />
                      Copiar mi texto
                    </Button>
                    <Button variant="ghost" onClick={() => m.api.resolveReviewText(n.id, field, "theirs")}>
                      Descartar mi texto
                    </Button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Version({ label, text, empty = "Vacío" }: { label: string; text: string; empty?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-3">
      <p className="text-[0.6875rem] font-medium tracking-wide text-text-tertiary uppercase">{label}</p>
      <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-text-secondary">{text || <span className="italic">{empty}</span>}</p>
    </div>
  )
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast("Texto copiado"),
    () => toast.error("No se pudo copiar")
  )
}
