"use client"

import Link from "next/link"
import { useDeferredValue, useMemo, useState } from "react"
import { ArrowRightLeft, BookOpen, Check, Headphones, Lightbulb, Link2, Mic, Search, X } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { linkedTo, refKey } from "@/features/knowledge/domain/relations"
import { search } from "@/features/knowledge/domain/search"
import { cmp, highlight } from "@/features/knowledge/domain/text"
import { noteLabel, type EntityRef, type KnowledgeState } from "@/features/knowledge/domain/types"
import { libraryActions } from "../store/use-library"
import type { LibrarySnapshot } from "../store/types"
import { useKnowledgeIndex } from "../search/use-knowledge-index"
import { brainNoteHref, itemHref, showHref } from "./library-ui"

/**
 * Manual connections between knowledge (M4e): a note with a note, a book or episode, or a show,
 * stored once per pair (D66). And moving a note to another content or making it free-standing,
 * without losing its text or its connections.
 */

export interface RefView {
  ref: EntityRef
  title: string
  kind: string
  href: string
  icon: typeof BookOpen
}

/** How any entity is shown in a list of connections or in the picker; null if it no longer exists. */
export function refView(state: KnowledgeState, ref: EntityRef): RefView | null {
  if (ref.type === "note") {
    const n = state.notes[ref.id]
    if (!n) return null
    const item = n.itemId ? state.items[n.itemId] : undefined
    const text = n.body.replace(/\s+/g, " ")
    return { ref, title: text.length > 90 ? text.slice(0, 89) + "…" : text, kind: noteLabel(n.type, item?.kind ?? null) + (item ? ` · ${item.title}` : " · idea suelta"), href: brainNoteHref(n.id), icon: Lightbulb }
  }
  if (ref.type === "item") {
    const i = state.items[ref.id]
    if (!i) return null
    return { ref, title: i.title, kind: i.kind === "book" ? "Libro" : "Episodio", href: itemHref(i.id), icon: i.kind === "book" ? BookOpen : Headphones }
  }
  const s = state.shows[ref.id]
  return s ? { ref, title: s.title, kind: "Programa", href: showHref(s.id), icon: Mic } : null
}

/** The connections of an entity, each one opening its page, with «Quitar conexión». */
export function Connections({ from, snap, className, empty }: { from: EntityRef; snap: LibrarySnapshot; className?: string; empty?: string }) {
  const refs = linkedTo(snap.state, from)
    .map((r) => refView(snap.state, r))
    .filter((v): v is RefView => v !== null)
  if (!refs.length) return empty ? <p className={cn("text-sm text-text-tertiary", className)}>{empty}</p> : null
  return (
    <ul className={cn("panel divide-y divide-border/70 rounded-2xl", className)} aria-label="Conexiones" data-testid="connections">
      {refs.map((v) => (
        <li key={refKey(v.ref)} className="flex items-center gap-2 pr-2">
          <Link href={v.href} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2 hover:bg-surface-raised/50">
            <v.icon className="size-4 shrink-0 text-text-tertiary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{v.title}</span>
              <span className="block truncate text-xs text-text-tertiary">{v.kind}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => {
              const r = libraryActions.setLink(from, v.ref, false)
              if (r.ok) toast("Conexión quitada", { action: { label: "Deshacer", onClick: () => libraryActions.setLink(from, v.ref, true) } })
            }}
            aria-label={`Quitar conexión con ${v.title}`}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-text-tertiary hover:bg-surface-raised hover:text-foreground md:size-10"
          >
            <X className="size-4" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlight(text, terms).map((s, i) =>
        s.match ? (
          <mark key={i} className="rounded-sm bg-signal/25 text-foreground">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </>
  )
}

/**
 * Search the library to connect `from` with something (toggle: a connected row disconnects), or,
 * for a note, to move it to another content or make it a free idea.
 */
export function KnowledgePicker({
  from,
  mode,
  snap,
  open,
  onOpenChange,
}: {
  from: EntityRef
  mode: "link" | "move"
  snap: LibrarySnapshot
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { index, progress } = useKnowledgeIndex(snap, open)
  const [q, setQ] = useState("")
  const dq = useDeferredValue(q)
  const state = snap.state
  const note = from.type === "note" ? state.notes[from.id] : undefined
  const linked = useMemo(() => new Set(linkedTo(state, from).map(refKey)), [state, from])

  const rows = useMemo((): { views: RefView[]; terms: string[] } => {
    if (!index) return { views: [], terms: [] }
    const r = search(state, index, { query: dq, limit: 20 })
    const items = r.terms.length
      ? r.items.map((h) => h.entity)
      : Object.values(state.items)
          .sort((a, b) => cmp(b.updatedAt, a.updatedAt))
          .slice(0, 8)
    const self = refKey(from)
    let refs: EntityRef[]
    if (mode === "move") refs = items.filter((i) => i.id !== note?.itemId).map((i) => ({ type: "item", id: i.id }))
    else
      refs = [
        ...items.map((i): EntityRef => ({ type: "item", id: i.id })),
        ...(r.terms.length ? r.shows.map((h): EntityRef => ({ type: "show", id: h.entity.id })) : []),
        ...r.notes.map((h): EntityRef => ({ type: "note", id: h.entity.id })),
      ]
    const views = refs
      .filter((x) => refKey(x) !== self)
      .map((x) => refView(state, x))
      .filter((v): v is RefView => v !== null)
      .slice(0, 20)
    return { views, terms: r.terms }
  }, [index, state, dq, mode, from, note?.itemId])

  function pick(v: RefView | null) {
    if (mode === "move") {
      const r = libraryActions.moveNote(from.id, v ? v.ref.id : null)
      if (!r.ok) return void toast.error("No se pudo mover la nota.")
      onOpenChange(false)
      return void toast(v ? `Nota movida a «${v.title}»` : "Ahora es una idea suelta")
    }
    if (!v) return
    const on = linked.has(refKey(v.ref))
    const r = libraryActions.setLink(from, v.ref, !on)
    if (!r.ok) return void toast.error("No se pudo conectar.")
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (onOpenChange(v), v || setQ(""))}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-lg" data-testid="picker">
        <DialogHeader>
          <DialogTitle>{mode === "move" ? "Mover la nota" : "Conectar con…"}</DialogTitle>
          <DialogDescription>{mode === "move" ? "Elige el libro o episodio. El texto y sus conexiones se conservan." : "Busca una idea, un libro, un episodio o un programa. Pulsa otra vez para quitar la conexión."}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" aria-label="Buscar en tu biblioteca" className="h-11 pl-9" autoFocus data-testid="picker-search" />
        </div>
        {!index && (
          <p role="status" className="text-xs text-text-tertiary">
            Preparando la búsqueda… {Math.round(progress * 100)} %
          </p>
        )}
        <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" aria-label="Resultados">
          {mode === "move" && note?.itemId && (
            <li>
              <button type="button" onClick={() => pick(null)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-raised" data-testid="picker-free">
                <Lightbulb className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Convertir en idea suelta</span>
                  <span className="block text-xs text-text-tertiary">Sin libro ni episodio</span>
                </span>
              </button>
            </li>
          )}
          {rows.views.map((v) => {
            const on = mode === "link" && linked.has(refKey(v.ref))
            return (
              <li key={refKey(v.ref)}>
                <button
                  type="button"
                  onClick={() => pick(v)}
                  aria-pressed={mode === "link" ? on : undefined}
                  className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-raised", on && "bg-signal/10")}
                  data-testid="picker-row"
                >
                  <v.icon className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium">
                      <Marked text={v.title} terms={rows.terms} />
                    </span>
                    <span className={cn("block truncate text-xs", on ? "text-text-secondary" : "text-text-tertiary")}>{v.kind}</span>
                  </span>
                  {mode === "link" ? (
                    on ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-foreground">
                        <Check className="size-3.5" aria-hidden /> Conectada
                      </span>
                    ) : (
                      <Link2 className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                    )
                  ) : (
                    <ArrowRightLeft className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                  )}
                </button>
              </li>
            )
          })}
          {index && rows.views.length === 0 && <li className="px-3 py-6 text-center text-sm text-text-tertiary">{dq.trim() ? `Nada coincide con «${dq.trim()}».` : "Todavía no hay nada con lo que conectar."}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

export { Marked }
