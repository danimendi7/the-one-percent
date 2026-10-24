"use client"

import { useMemo, useState } from "react"
import { BookPlus, Heart, LayoutGrid, List, Search, SearchX, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DemoBadge, DemoNote } from "@/components/common/demo-note"
import { EmptyState } from "@/components/common/empty-state"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { filterBooks, readingProgress, type Shelf, type SortKey } from "../domain/search"
import { BOOKS, STATUS_LABEL, type Book } from "../fixtures"
import { BookCover } from "./book-cover"
import { BookDetailsSheet } from "./book-details-sheet"

const SHELVES: { id: Shelf; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "reading", label: "Leyendo" },
  { id: "want", label: "Quiero leer" },
  { id: "finished", label: "Terminados" },
  { id: "on_hold", label: "En pausa" },
  { id: "favorites", label: "Favoritos" },
]

export function LibraryView() {
  const [shelf, setShelf] = useState<Shelf>("all")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("recent")
  const [layout, setLayout] = useState<"grid" | "list">("grid")
  const [selected, setSelected] = useState<Book | null>(null)

  const books = useMemo(() => filterBooks(BOOKS, { shelf, query, sort }), [shelf, query, sort])
  const counts = useMemo(
    () => Object.fromEntries(SHELVES.map((s) => [s.id, filterBooks(BOOKS, { shelf: s.id, query: "", sort }).length])),
    [sort]
  )

  return (
    <>
      <PageHeader
        title="Biblioteca"
        meta={<DemoBadge>Demo · datos de ejemplo</DemoBadge>}
        inlineActions
        actions={<AddBookDialog />}
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Label htmlFor="lib-search" className="sr-only">
              Buscar por título, autor o etiqueta
            </Label>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <Input
              id="lib-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Título, autor o etiqueta"
              className="h-11 pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-11! flex-1 sm:w-44" aria-label="Ordenar">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recientes</SelectItem>
                <SelectItem value="title">Título A-Z</SelectItem>
                <SelectItem value="rating">Valoración</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex rounded-xl border border-border bg-surface p-[1px] sm:p-1" role="group" aria-label="Vista">
              {(["grid", "list"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={layout === l}
                  aria-label={l === "grid" ? "Portadas" : "Lista"}
                  onClick={() => setLayout(l)}
                  className={cn(
                    "grid size-10 place-items-center rounded-lg transition-colors sm:size-9",
                    layout === l ? "bg-surface-raised text-foreground" : "text-text-tertiary hover:text-foreground"
                  )}
                >
                  {l === "grid" ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex w-max gap-2" role="tablist" aria-label="Estanterías">
            {SHELVES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={shelf === s.id}
                onClick={() => setShelf(s.id)}
                className={cn(
                  "flex h-11 items-center gap-1.5 rounded-full border px-4 text-sm whitespace-nowrap transition-colors sm:h-9 sm:px-3.5",
                  shelf === s.id
                    ? "border-foreground/30 bg-surface-raised text-foreground"
                    : "border-border text-text-secondary hover:text-foreground"
                )}
              >
                {s.id === "favorites" && <Heart className="size-3.5" aria-hidden />}
                {s.label}
                <span className="num text-xs text-text-tertiary">{counts[s.id]}</span>
              </button>
            ))}
          </div>
        </div>

        {books.length === 0 ? (
          <div className="panel rounded-2xl">
            <EmptyState
              icon={SearchX}
              title="Sin resultados"
              description={query ? `Nada coincide con «${query}» en esta estantería.` : "Esta estantería está vacía."}
              action={
                query ? (
                  <Button variant="outline" onClick={() => setQuery("")}>
                    Limpiar búsqueda
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : layout === "grid" ? (
          <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {books.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelected(b)}
                  className="group block w-full rounded-lg text-left"
                >
                  <BookCover book={b} className="transition-transform duration-200 group-hover:-translate-y-0.5" />
                  <Progress book={b} />
                  <p className="mt-2 line-clamp-2 text-[0.8125rem] leading-snug font-medium">{b.title}</p>
                  <p className="truncate text-xs text-text-tertiary">{b.author}</p>
                  <span className="sr-only">{STATUS_LABEL[b.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="panel divide-y divide-border/70 rounded-2xl">
            {books.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => setSelected(b)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-surface-raised/50">
                  <BookCover book={b} className="w-11 shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.title}</p>
                    <p className="truncate text-xs text-text-tertiary">{b.author}</p>
                  </div>
                  <span className="hidden text-xs text-text-secondary sm:block">{STATUS_LABEL[b.status]}</span>
                  {b.rating !== undefined && (
                    <span className="num flex items-center gap-1 text-xs text-text-secondary">
                      <Star className="size-3" aria-hidden />
                      {b.rating}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <BookDetailsSheet book={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </>
  )
}

function Progress({ book }: { book: Book }) {
  const p = readingProgress(book)
  if (book.status !== "reading" && book.status !== "on_hold") return null
  return (
    <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-surface-raised" aria-hidden>
      {p !== null && <div className="h-full rounded-full bg-signal" style={{ width: `${p * 100}%` }} />}
    </div>
  )
}

function AddBookDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <BookPlus />
          Añadir libro
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Añadir libro</DialogTitle>
          <DialogDescription>
            La búsqueda en Google Books y Open Library, con alta manual cuando falle la API, llega en la fase M4.
          </DialogDescription>
        </DialogHeader>
        <DemoNote>
          Este prototipo no hace llamadas externas. En M4 la búsqueda pasará por el servidor (claves protegidas, caché y
          límites) y siempre podrás introducir el libro a mano.
        </DemoNote>
      </DialogContent>
    </Dialog>
  )
}
