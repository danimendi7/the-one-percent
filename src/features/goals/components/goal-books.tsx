"use client"

import Link from "next/link"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { pct } from "@/components/common/format"
import { habitActions } from "@/features/habits/store/habit-store"
import { itemHref } from "@/features/library/components/library-ui"
import { useLibrary } from "@/features/library/store/use-library"
import { goalBooksProgress, linkableBooks } from "../domain/books"
import { GOAL_BOOKS_LIMIT } from "../domain/ops"
import type { Goal } from "../domain/types"

/** The Library books behind this goal. Their figures are shown here and never enter the goal's own result. */
export function GoalBooks({ goal, editable }: { goal: Goal; editable: boolean }) {
  const library = useLibrary()
  if (!library) return null
  const progress = goalBooksProgress(goal.bookIds, library.state.items)
  const available = linkableBooks(goal.bookIds, library.state.items)
  const full = (goal.bookIds?.length ?? 0) >= GOAL_BOOKS_LIMIT

  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="goal-books-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="goal-books-title" className="text-sm font-medium text-text-secondary">
          Libros vinculados
        </h2>
        {progress.total > 0 && (
          <p className="num text-xs text-text-tertiary">
            {progress.finished} de {progress.total} terminados
          </p>
        )}
      </div>

      {progress.rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary">Sin libros vinculados.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border" aria-label="Libros del objetivo">
          {progress.rows.map(({ book, progress: read }) => (
            <li key={book.id} className="flex items-center gap-2">
              <Link href={itemHref(book.id)} className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 py-2 text-sm hover:text-foreground">
                <span className="truncate">{book.title}</span>
                <span className="num shrink-0 text-xs text-text-tertiary">{book.status === "abandoned" ? "Abandonado" : pct(read)}</span>
              </Link>
              {editable && (
                <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`Desvincular ${book.title}`} onClick={() => habitActions.setGoalBook(goal.id, book.id, false)}>
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && !full && available.length > 0 && (
        <Select value="" onValueChange={(id) => habitActions.setGoalBook(goal.id, id, true)}>
          <SelectTrigger className="mt-3 h-11 w-full" aria-label="Vincular un libro">
            <SelectValue placeholder="Vincular un libro" />
          </SelectTrigger>
          <SelectContent>
            {available.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {editable && available.length === 0 && progress.rows.length === 0 && (
        <p className="mt-2 text-xs text-text-tertiary">Añade libros en la Biblioteca para poder vincularlos.</p>
      )}
      {editable && full && <p className="mt-3 text-xs text-text-tertiary">Has llegado a los {GOAL_BOOKS_LIMIT} libros de este objetivo.</p>}
    </section>
  )
}
