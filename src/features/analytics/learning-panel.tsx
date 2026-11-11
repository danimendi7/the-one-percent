"use client"

import type { DateRange } from "@/features/habits/domain/metrics"
import { useLibrary } from "@/features/library/store/use-library"
import { useHabits } from "@/features/habits/store/habit-store"
import { recallStats, RECALL_HISTORY_DAYS } from "@/features/recall/domain/stats"
import { learningMetrics } from "./domain/learning"

function hours(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function Figure({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <dt className="text-xs text-text-tertiary">{label}</dt>
      <dd className="num mt-0.5 text-xl font-semibold">{value}</dd>
      {detail && <dd className="mt-0.5 text-xs leading-snug text-text-tertiary">{detail}</dd>}
    </div>
  )
}

/** The learning dimension of Life Analytics, from the Library. Period only, like focus and check-ins. */
export function LearningPanel({ range, timeZone, periodLabel }: { range: DateRange; timeZone: string; periodLabel: string }) {
  const library = useLibrary()
  const snap = useHabits()
  if (!library || !snap) return null
  const m = learningMetrics(library.state, range, timeZone)
  const r = recallStats(snap.state.recall, range, snap.today)
  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="learning-title" data-testid="learning">
      <h2 id="learning-title" className="text-base font-semibold">
        Aprendizaje
      </h2>
      <p className="mb-3 text-xs text-text-tertiary">En {periodLabel}</p>
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Figure label="Libros terminados" value={`${m.booksFinished}`} testId="learning-books" />
        <Figure
          label="Episodios terminados"
          value={`${m.episodesFinished}`}
          detail={m.episodesFinished > 0 ? `${hours(m.listenedSeconds)}${m.episodesWithoutDuration > 0 ? ` · ${m.episodesWithoutDuration} sin duración conocida` : ""}` : undefined}
          testId="learning-episodes"
        />
        <Figure label="Notas e ideas" value={`${m.notesAdded}`} detail={m.applicationsAdded > 0 ? `${m.applicationsAdded} ${m.applicationsAdded === 1 ? "aplicación práctica" : "aplicaciones prácticas"}` : undefined} testId="learning-notes" />
        <Figure label="En curso ahora" value={`${m.inProgress}`} testId="learning-active" />
        <Figure label="Repasos" value={`${r.answers}`} detail={r.retention === null ? "Sin repasos en este periodo" : `${Math.round(r.retention * 100)} % recordadas (${r.remembered} de ${r.answers})`} testId="learning-recall" />
        <Figure label="Tarjetas pendientes hoy" value={`${r.cardsDue}`} detail={`${r.cards} ${r.cards === 1 ? "tarjeta" : "tarjetas"} en uso`} testId="learning-recall-due" />
      </dl>
      {snap.source === "account" && r.historyLimited && <p className="mt-3 text-xs text-text-tertiary">Cada dispositivo guarda al menos {RECALL_HISTORY_DAYS} días de repasos: en este periodo la cifra puede quedarse corta.</p>}
      {m.finishedWithoutDate > 0 && <p className="mt-3 text-xs text-text-tertiary">{m.finishedWithoutDate === 1 ? "1 contenido terminado no tiene fecha" : `${m.finishedWithoutDate} contenidos terminados no tienen fecha`} y no cuenta en ningún periodo.</p>}
    </section>
  )
}
