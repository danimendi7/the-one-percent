"use client"

import { Heart, NotebookPen, Plus, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { DemoBadge } from "@/components/common/demo-note"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { formatDate } from "@/features/habits/domain/dates"
import { readingProgress } from "../domain/search"
import { NOTE_LABEL, STATUS_LABEL, type Book } from "../fixtures"
import { BookCover } from "./book-cover"

/** BookDetailsDrawer (DESIGN_SYSTEM): metadata, reading state and notes. Read-only in M1. */
export function BookDetailsSheet({ book, onOpenChange }: { book: Book | null; onOpenChange: (open: boolean) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={book !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn("gap-0 overflow-y-auto p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl")}
      >
        {book && <Details book={book} />}
      </SheetContent>
    </Sheet>
  )
}

function Details({ book }: { book: Book }) {
  const p = readingProgress(book)
  return (
    <>
      <SheetHeader className="flex-row gap-4 border-b border-border p-5 pr-12">
        <BookCover book={book} className="w-24 shrink-0" />
        <div className="min-w-0 space-y-1">
          <SheetTitle className="text-lg leading-tight text-balance">{book.title}</SheetTitle>
          <SheetDescription>
            {book.author}
            {book.year ? ` · ${book.year}` : ""}
          </SheetDescription>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge variant="secondary">{STATUS_LABEL[book.status]}</Badge>
            {book.favorite && (
              <Badge variant="secondary" className="gap-1">
                <Heart className="size-3" aria-hidden /> Favorito
              </Badge>
            )}
            <DemoBadge />
          </div>
        </div>
      </SheetHeader>

      <div className="space-y-6 p-5">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Páginas" value={book.pageCount ?? "Desconocidas"} />
          <Stat label="Progreso" value={p === null ? (book.status === "finished" ? "100%" : "N/D") : `${Math.round(p * 100)}%`} />
          <Stat
            label="Valoración"
            value={
              book.rating !== undefined ? (
                <span className="flex items-center gap-1">
                  <Star className="size-3.5 text-signal" aria-hidden /> {book.rating}/10
                </span>
              ) : (
                "Sin valorar"
              )
            }
          />
        </dl>

        {book.currentPage !== undefined && book.pageCount && (
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-text-secondary">
              <span>Página {book.currentPage}</span>
              <span className="num">{book.pageCount - book.currentPage} restantes</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <div className="h-full rounded-full bg-signal" style={{ width: `${(p ?? 0) * 100}%` }} />
            </div>
          </div>
        )}

        <div className="text-xs text-text-tertiary">
          {book.startedOn && <p>Empezado el {formatDate(book.startedOn, { day: "numeric", month: "long", year: "numeric" })}</p>}
          {book.finishedOn && <p>Terminado el {formatDate(book.finishedOn, { day: "numeric", month: "long", year: "numeric" })}</p>}
        </div>

        {book.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {book.tags.map((t) => (
              <span key={t} className="rounded-full border border-border px-2.5 py-1 text-xs text-text-secondary">
                {t}
              </span>
            ))}
          </div>
        )}

        <section aria-labelledby="notes-title">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="notes-title" className="text-sm font-semibold">
              Notas ({book.notes.length})
            </h3>
            <Button variant="ghost" size="sm" disabled title="Disponible en M4">
              <Plus /> Nota
            </Button>
          </div>
          {book.notes.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-text-tertiary">
              <NotebookPen className="size-4" aria-hidden /> Sin notas todavía.
            </p>
          ) : (
            <ul className="space-y-2">
              {book.notes.map((n) => (
                <li key={n.id} className="rounded-xl bg-surface-raised/60 p-3.5">
                  <p className="mb-1 text-[0.6875rem] font-medium text-text-tertiary">
                    {NOTE_LABEL[n.type]}
                    {n.page ? ` · p. ${n.page}` : ""}
                  </p>
                  <p className={cn("text-sm leading-relaxed", n.type === "quote" && "italic")}>{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Button variant="outline" className="w-full" disabled>
          Registrar sesión de lectura · M4
        </Button>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <dt className="text-[0.6875rem] text-text-tertiary">{label}</dt>
      <dd className="num mt-1 text-sm font-medium">{value}</dd>
    </div>
  )
}
