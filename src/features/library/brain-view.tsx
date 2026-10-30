"use client"

import { useMemo, useState } from "react"
import { Brain } from "lucide-react"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { NOTE_TYPES, noteLabel, type NoteType } from "@/features/knowledge/domain/types"
import { DEMO_NOTICE } from "@/features/knowledge/demo"
import { useLibrary } from "./store/use-library"
import { NoteCard, QuickCapture } from "./components/knowledge-notes"
import { LibraryConflicts, LibrarySyncBanner } from "./components/library-sync"
import { LibrarySkeleton } from "./library-views"
import { LIBRARY_HREF, BackLink } from "./components/library-ui"

type Filter = "all" | NoteType | "free" | "starred"

/**
 * `/knowledge/brain` · Cerebro (P16, first version): every idea, learning, quote, application,
 * question and note in one place, newest first, with simple filters and the content it came from.
 * Full-text search and combined filters arrive with M4e. No AI.
 */
export function BrainView() {
  const snap = useLibrary()
  const [filter, setFilter] = useState<Filter>("all")
  const notes = useMemo(() => {
    if (!snap) return []
    const all = Object.values(snap.state.notes).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    return all.filter((n) => (filter === "all" ? true : filter === "free" ? n.itemId === null : filter === "starred" ? n.starred : n.type === filter))
  }, [snap, filter])
  if (!snap) return <LibrarySkeleton />
  const total = Object.keys(snap.state.notes).length
  const options: { value: Filter; label: string }[] = [
    { value: "all", label: "Todas" },
    ...NOTE_TYPES.map((t) => ({ value: t as Filter, label: noteLabel(t, null, true) })),
    { value: "free", label: "Sueltas" },
    { value: "starred", label: "Destacadas" },
  ]
  return (
    <>
      <BackLink href={LIBRARY_HREF}>Biblioteca</BackLink>
      <PageHeader title="Cerebro" meta={<SourceBadge source={snap.source}>{DEMO_NOTICE}</SourceBadge>} description="Todo lo que has aprendido, en un sitio. Abre cualquier nota para editarla o ir a su origen." />
      <LibrarySyncBanner snap={snap} className="mb-4" />
      <LibraryConflicts snap={snap} className="mb-5" />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <aside className="min-w-0 space-y-3 lg:sticky lg:top-6">
          <QuickCapture itemId={null} kind={null} snap={snap} />
          <p className="text-xs text-text-tertiary">Una idea suelta no necesita libro ni episodio. Puedes moverla después.</p>
        </aside>
        <section aria-label="Notas" className="min-w-0 space-y-4">
          {total === 0 ? (
            <div className="panel rounded-2xl">
              <EmptyState icon={Brain} title="Aquí se reunirá lo que aprendas" description="Las ideas que guardes en tus libros y episodios, y las sueltas, aparecerán aquí." />
            </div>
          ) : (
            <>
              <div role="radiogroup" aria-label="Mostrar" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={filter === o.value}
                    onClick={() => setFilter(o.value)}
                    className={cn("min-h-11 md:min-h-10 shrink-0 rounded-full border px-3.5 text-[0.8125rem] font-medium", filter === o.value ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary hover:bg-surface-raised")}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="num text-xs text-text-tertiary" aria-live="polite">
                {notes.length} {notes.length === 1 ? "nota" : "notas"}
              </p>
              {notes.length === 0 ? (
                <p className="panel rounded-2xl p-5 text-sm text-text-secondary">No hay notas de este tipo todavía.</p>
              ) : (
                notes.map((n) => {
                  const it = n.itemId ? snap.state.items[n.itemId] : null
                  return <NoteCard key={n.id} note={n} snap={snap} kind={it?.kind ?? null} origin={it ? { id: it.id, title: it.title } : null} />
                })
              )}
            </>
          )}
        </section>
      </div>
    </>
  )
}
