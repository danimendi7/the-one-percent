"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowLeft, CheckCheck, ChevronRight, Lightbulb, Pause, Play, Plus, Trash2 } from "lucide-react"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDate } from "@/features/habits/domain/dates"
import { habitActions, recallEnabled, useHabits, type HabitsSnapshot } from "@/features/habits/store/habit-store"
import { BRAIN_HREF, brainNoteHref } from "@/features/library/components/library-ui"
import { RecallCardSheet } from "./components/recall-card-sheet"
import { dailyQueue, DEFAULT_NEW_PER_DAY, forecast, GRADES, previewIntervals, type Grade } from "./domain/schedule"
import { afterAnswer, currentCard, intervalLabel } from "./domain/session"
import type { RecallCard } from "./domain/types"

const GRADE_LABEL: Record<Grade, string> = { again: "Otra vez", hard: "Difícil", good: "Bien", easy: "Fácil" }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** `/knowledge/brain/repaso`: one question at a time, reveal, then how well you remembered it. */
export function RecallView() {
  const snap = useHabits()
  const [creating, setCreating] = useState(false)
  return (
    <>
      <Link href={BRAIN_HREF} className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-text-secondary hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Cerebro
      </Link>
      <PageHeader
        title="Repaso"
        meta={<SourceBadge source={snap?.source}>Demo · tarjetas de ejemplo</SourceBadge>}
        description="Intenta recordar antes de mirar la respuesta. Cada tarjeta vuelve cuando toca."
        actions={
          <Button variant="outline" onClick={() => setCreating(true)} data-testid="recall-new">
            <Plus aria-hidden />
            Nueva tarjeta
          </Button>
        }
      />
      {snap ? <Session snap={snap} /> : <div className="panel h-72 animate-pulse rounded-2xl motion-reduce:animate-none" role="status" aria-busy="true" aria-label="Cargando el repaso" />}
      <RecallCardSheet open={creating} onOpenChange={setCreating} />
    </>
  )
}

function Session({ snap }: { snap: HabitsSnapshot }) {
  const [failed, setFailed] = useState<string[]>([])
  const recall = snap.state.recall
  const cards = useMemo(() => Object.values(recall.cards), [recall.cards])
  const q = useMemo(() => dailyQueue(cards, snap.today), [cards, snap.today])
  const card = currentCard(q.queue, failed)
  const suspended = cards.filter((c) => c.suspendedOn !== null)
  const answered = Object.keys(recall.attempts).length

  function answer(c: RecallCard, grade: Grade) {
    if (habitActions.answerRecallCard(c.id, grade)) setFailed((f) => afterAnswer(f, c.id, grade))
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {!recallEnabled() && (
        <p role="note" className="rounded-xl border border-dashed border-warning/40 px-4 py-3 text-sm text-text-secondary">
          Tu cuenta aún no guarda repasos en la nube: lo que hagas queda en este dispositivo y se enviará cuando esté disponible.
        </p>
      )}
      <p className="num text-sm text-text-secondary" data-testid="recall-count">
        {plural(q.queue.length, "tarjeta por repasar", "tarjetas por repasar")}
        {q.newToday > 0 && ` · ${plural(q.newToday, "nueva", "nuevas")}`}
      </p>
      {card ? <CardView key={`${card.id}-${answered}`} card={card} onAnswer={(g) => answer(card, g)} /> : <AllDone cards={cards} snap={snap} />}
      {card && q.heldBack > 0 && <HeldBack n={q.heldBack} />}
      {suspended.length > 0 && <Suspended cards={suspended} />}
    </div>
  )
}

function CardView({ card, onAnswer }: { card: RecallCard; onAnswer: (g: Grade) => void }) {
  const [revealed, setRevealed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const days = previewIntervals(card.schedule)
  return (
    <article className="panel rounded-2xl p-5 sm:p-6" data-testid="recall-card" aria-label="Tarjeta de repaso">
      <p className="text-xs font-medium tracking-wide text-text-tertiary uppercase">Pregunta</p>
      <h2 className="mt-2 text-lg leading-snug font-semibold text-balance break-words whitespace-pre-wrap" data-testid="recall-question">
        {card.question}
      </h2>
      {revealed ? (
        <>
          <div className="mt-5 border-t border-border/70 pt-4">
            <p className="text-xs font-medium tracking-wide text-text-tertiary uppercase">Respuesta</p>
            <p className="mt-2 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap" data-testid="recall-answer">
              {card.answer}
            </p>
            {card.sourceType === "note" && card.sourceId && (
              <Link href={brainNoteHref(card.sourceId)} className="mt-2 -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs text-text-secondary hover:text-foreground">
                <Lightbulb className="size-3.5" aria-hidden />
                Ver la idea de origen
              </Link>
            )}
          </div>
          <p className="mt-4 mb-2 text-sm font-medium">¿Cómo la has recordado?</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GRADES.map((g) => (
              <Button key={g} variant={g === "good" ? "default" : "outline"} className="h-auto min-h-14 flex-col gap-0.5 py-2" onClick={() => onAnswer(g)} data-testid={`recall-grade-${g}`}>
                <span>{GRADE_LABEL[g]}</span>
                <span className="num text-[0.6875rem] font-normal opacity-80">{intervalLabel(days[g])}</span>
              </Button>
            ))}
          </div>
        </>
      ) : (
        <Button size="lg" className="mt-6 w-full" onClick={() => setRevealed(true)} data-testid="recall-reveal">
          Mostrar respuesta
        </Button>
      )}
      <div className="mt-4 flex justify-end gap-1 border-t border-border/70 pt-2">
        <Button variant="ghost" className="min-h-11 text-text-secondary" onClick={() => habitActions.suspendRecallCard(card.id, true)} data-testid="recall-suspend">
          <Pause aria-hidden />
          Suspender
        </Button>
        <Button variant="ghost" className="min-h-11 text-text-secondary" onClick={() => setConfirmDelete(true)} data-testid="recall-delete">
          <Trash2 aria-hidden />
          Borrar
        </Button>
      </div>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Borrar esta tarjeta?</DialogTitle>
            <DialogDescription>Desaparece de todos tus dispositivos. Se conserva el historial de tus respuestas, sin su texto. No se puede deshacer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button onClick={() => habitActions.deleteRecallCard(card.id)} data-testid="recall-delete-confirm">
              Borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

function HeldBack({ n }: { n: number }) {
  return (
    <p className="text-xs leading-relaxed text-text-tertiary" data-testid="recall-held-back">
      {plural(n, "tarjeta nueva espera", "tarjetas nuevas esperan")} a otro día: se añaden hasta {DEFAULT_NEW_PER_DAY} al día.
    </p>
  )
}

function AllDone({ cards, snap }: { cards: RecallCard[]; snap: HabitsSnapshot }) {
  const held = dailyQueue(cards, snap.today).heldBack
  const ahead = forecast(cards, snap.today, 8)
    .slice(1)
    .filter((d) => d.count > 0)
  const active = cards.some((c) => c.suspendedOn === null)
  return (
    <section className="panel rounded-2xl" data-testid="recall-done">
      <EmptyState
        icon={CheckCheck}
        title={active ? "Hoy no te queda nada por repasar" : "Todavía no tienes tarjetas"}
        description={active ? "Las tarjetas volverán cuando toque." : "Crea una aquí o desde cualquier idea de Cerebro."}
      />
      {held > 0 && (
        <div className="px-5 pb-4">
          <HeldBack n={held} />
        </div>
      )}
      {ahead.length > 0 && (
        <div className="border-t border-border/70 px-5 py-4">
          <h2 className="text-sm font-medium">Próximos 7 días</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-text-secondary" data-testid="recall-forecast">
            {ahead.map((d) => (
              <li key={d.date} className="flex items-center justify-between gap-3">
                <span className="first-letter:uppercase">{formatDate(d.date, { weekday: "long", day: "numeric", month: "short" })}</span>
                <span className="num">{plural(d.count, "tarjeta", "tarjetas")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Suspended({ cards }: { cards: RecallCard[] }) {
  return (
    <details className="panel group rounded-2xl" data-testid="recall-suspended">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Suspendidas ({cards.length})
        <ChevronRight className="size-4 text-text-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
      </summary>
      <ul className="divide-y divide-border/70 border-t border-border/70">
        {cards.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-5 py-2">
            <span className="min-w-0 flex-1 truncate text-sm">{c.question}</span>
            <Button variant="ghost" className="min-h-11 shrink-0" onClick={() => habitActions.suspendRecallCard(c.id, false)} aria-label={`Reanudar: ${c.question}`}>
              <Play aria-hidden />
              Reanudar
            </Button>
          </li>
        ))}
      </ul>
    </details>
  )
}
