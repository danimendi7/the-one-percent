"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { Brain, Link2, Search, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { activeFilterCount, brainFilters, brainQueryString, EMPTY_BRAIN_QUERY, parseBrainQuery, type BrainPeriod, type BrainQuery } from "@/features/knowledge/domain/brain-query"
import { noteTopics, relatedNotes } from "@/features/knowledge/domain/relations"
import { explainMatch, search, type KnowledgeIndex, type NoteFormat } from "@/features/knowledge/domain/search"
import { collator, normalize } from "@/features/knowledge/domain/text"
import { APPLICATION_LABEL, APPLICATION_STATUSES, NOTE_TYPES, noteLabel, STATUSES, type ApplicationStatus, type ContentStatus, type KnowledgeNote, type KnowledgeState, type NoteType } from "@/features/knowledge/domain/types"
import { DEMO_NOTICE } from "@/features/knowledge/demo"
import { useLibrary } from "./store/use-library"
import type { LibrarySnapshot } from "./store/types"
import { NoteCard, QuickCapture } from "./components/knowledge-notes"
import { Connections, KnowledgePicker, Marked, refView } from "./components/knowledge-links"
import { LibraryConflicts, LibrarySyncBanner } from "./components/library-sync"
import { LibrarySkeleton } from "./library-views"
import { BackLink, BRAIN_HREF, brainNoteHref, itemHref, LIBRARY_HREF, showHref } from "./components/library-ui"
import { useKnowledgeIndex } from "./search/use-knowledge-index"

/** Notes rendered at a time: thousands of cards at once would make the page slow on a phone. */
const PAGE = 60

/** The plain list needs no index (no words to look up): it works before the index is ready. */
const NO_INDEX: KnowledgeIndex = { docs: new Map(), postings: new Map(), tokens: [] }

const ORIGIN_LABEL: Record<NoteFormat, string> = { book: "Libros", episode: "Podcasts", free: "Ideas sueltas" }
const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = { planned: "Pendiente", active: "En curso", paused: "En pausa", done: "Terminado", abandoned: "Abandonado" }
const PERIOD_LABEL: Record<BrainPeriod, string> = { "7d": "7 días", "30d": "30 días", "12m": "12 meses" }

function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "min-h-11 shrink-0 rounded-full border px-3.5 text-[0.8125rem] font-medium md:min-h-10",
        on ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary hover:bg-surface-raised"
      )}
    >
      {children}
    </button>
  )
}

const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

/** Every topic in the library, most used first (the topic filter's options). */
function allTopics(state: KnowledgeState): string[] {
  const counts = new Map<string, { label: string; n: number }>()
  const add = (t: string) => {
    const k = normalize(t)
    const c = counts.get(k)
    if (c) c.n++
    else counts.set(k, { label: t, n: 1 })
  }
  for (const i of Object.values(state.items)) i.topics.forEach(add)
  for (const s of Object.values(state.shows)) s.topics.forEach(add)
  for (const n of Object.values(state.notes)) n.topics.forEach(add)
  return [...counts.values()].sort((a, b) => b.n - a.n || collator.compare(a.label, b.label)).map((c) => c.label)
}

function FiltersSheet({ open, onOpenChange, b, set, topics, count }: { open: boolean; onOpenChange: (v: boolean) => void; b: BrainQuery; set: (p: Partial<BrainQuery>) => void; topics: string[]; count: number }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  const group = (label: string, children: React.ReactNode) => (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  )
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[88dvh] rounded-t-3xl border-x-0")} data-testid="filters">
        <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
          <SheetTitle className="text-lg">Filtros</SheetTitle>
          <SheetDescription>Se combinan entre sí y se guardan en la dirección de la página.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {group(
            "Origen",
            (["book", "episode", "free"] as NoteFormat[]).map((o) => (
              <Chip key={o} on={b.origins.includes(o)} onClick={() => set({ origins: toggle(b.origins, o) })}>
                {ORIGIN_LABEL[o]}
              </Chip>
            ))
          )}
          <div className="space-y-2">
            <label htmlFor="brain-topic" className="block text-sm font-medium">
              Tema
            </label>
            <select id="brain-topic" value={b.topic ?? ""} onChange={(e) => set({ topic: e.target.value || null })} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
              <option value="">Cualquiera</option>
              {topics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {group(
            "Estado del libro o episodio",
            STATUSES.map((s) => (
              <Chip key={s} on={b.contentStatus.includes(s)} onClick={() => set({ contentStatus: toggle(b.contentStatus, s) })}>
                {CONTENT_STATUS_LABEL[s]}
              </Chip>
            ))
          )}
          <div className="space-y-2">
            <label htmlFor="brain-rating" className="block text-sm font-medium">
              Valoración del contenido
            </label>
            <select id="brain-rating" value={b.minRating ?? ""} onChange={(e) => set({ minRating: e.target.value ? Number(e.target.value) : null })} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
              <option value="">Cualquiera</option>
              {[5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n === 10 ? "10" : `${n} o más`}
                </option>
              ))}
            </select>
          </div>
          {group(
            "Marcadas",
            <>
              <Chip on={b.favorite} onClick={() => set({ favorite: !b.favorite })}>
                De favoritos
              </Chip>
              <Chip on={b.starred} onClick={() => set({ starred: !b.starred })}>
                Destacadas
              </Chip>
            </>
          )}
          {group(
            "Fecha",
            <>
              <Chip on={!b.period} onClick={() => set({ period: null })}>
                Siempre
              </Chip>
              {(["7d", "30d", "12m"] as BrainPeriod[]).map((p) => (
                <Chip key={p} on={b.period === p} onClick={() => set({ period: p })}>
                  {PERIOD_LABEL[p]}
                </Chip>
              ))}
            </>
          )}
          {group(
            "Aplicaciones prácticas",
            APPLICATION_STATUSES.map((s) => (
              <Chip key={s} on={b.applications.includes(s)} onClick={() => set({ applications: toggle(b.applications, s) })}>
                {APPLICATION_LABEL[s]}
              </Chip>
            ))
          )}
        </div>
        <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
          <Button variant="outline" onClick={() => set({ ...EMPTY_BRAIN_QUERY, q: b.q, view: b.view, group: b.group })} disabled={!count}>
            Quitar filtros
          </Button>
          <Button className="flex-1" onClick={() => onOpenChange(false)} data-testid="filters-done">
            Ver resultados
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** Active filters as removable chips (one tap undoes each). */
function ActiveFilters({ b, set }: { b: BrainQuery; set: (p: Partial<BrainQuery>) => void }) {
  const chips: { label: string; clear: Partial<BrainQuery> }[] = [
    ...b.origins.map((o) => ({ label: ORIGIN_LABEL[o], clear: { origins: b.origins.filter((x) => x !== o) } })),
    ...(b.topic ? [{ label: `Tema: ${b.topic}`, clear: { topic: null } }] : []),
    ...b.contentStatus.map((s) => ({ label: CONTENT_STATUS_LABEL[s], clear: { contentStatus: b.contentStatus.filter((x) => x !== s) } })),
    ...(b.minRating ? [{ label: `Valoración ≥ ${b.minRating}`, clear: { minRating: null } }] : []),
    ...(b.favorite ? [{ label: "De favoritos", clear: { favorite: false } }] : []),
    ...(b.starred ? [{ label: "Destacadas", clear: { starred: false } }] : []),
    ...(b.period ? [{ label: `Últimos ${PERIOD_LABEL[b.period]}`, clear: { period: null } }] : []),
    ...(b.view === "ideas" ? b.applications.map((s) => ({ label: `Aplicación: ${APPLICATION_LABEL[s]}`, clear: { applications: b.applications.filter((x) => x !== s) } })) : []),
  ]
  if (!chips.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Filtros activos">
      {chips.map((c) => (
        <li key={c.label}>
          <button type="button" onClick={() => set(c.clear)} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-surface-raised px-3 text-xs text-text-secondary hover:text-foreground md:min-h-9" aria-label={`Quitar filtro ${c.label}`}>
            {c.label} <X className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The note on its own (`?nota=`): its connections and the notes that share its topics. */
function NoteFocus({ snap, id }: { snap: LibrarySnapshot; id: string }) {
  const [linking, setLinking] = useState(false)
  const s = snap.state
  const note = Object.hasOwn(s.notes, id) ? s.notes[id] : undefined
  if (!note)
    return (
      <section className="panel rounded-2xl">
        <EmptyState icon={Brain} title="Esa nota no está en este dispositivo" description="Puede que se haya eliminado, o que todavía no haya llegado de tu cuenta." />
      </section>
    )
  const item = note.itemId ? s.items[note.itemId] : undefined
  const related = relatedNotes(s, id)
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2" data-testid="note-focus">
      <div className="min-w-0 space-y-3">
        <NoteCard note={note} snap={snap} kind={item?.kind ?? null} origin={item ? { id: item.id, title: item.title } : null} />
        {item && (
          <Link href={`${itemHref(item.id)}#note-${note.id}`} className="inline-flex min-h-11 items-center text-sm text-text-secondary underline-offset-2 hover:text-foreground hover:underline">
            Ver en «{item.title}»
          </Link>
        )}
      </div>
      <div className="min-w-0 space-y-6">
        <section aria-labelledby="conns" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 id="conns" className="text-base font-semibold">
              Conexiones
            </h2>
            <Button variant="outline" onClick={() => setLinking(true)} data-testid="connect">
              <Link2 aria-hidden /> Conectar con…
            </Button>
          </div>
          <Connections from={{ type: "note", id }} snap={snap} empty="Aún no la has conectado con nada." />
        </section>
        <section aria-labelledby="rel" className="space-y-2">
          <h2 id="rel" className="text-base font-semibold">
            Relacionadas por temas
          </h2>
          {related.length === 0 ? (
            <p className="text-sm text-text-tertiary">{noteTopics(s, note).length ? "Ninguna otra nota comparte sus temas." : "Ni la nota ni su origen tienen temas todavía."}</p>
          ) : (
            <ul className="panel divide-y divide-border/70 rounded-2xl" data-testid="related-notes">
              {related.map((r) => {
                const v = refView(s, { type: "note", id: r.note.id })!
                return (
                  <li key={r.note.id}>
                    <Link href={brainNoteHref(r.note.id)} className="flex min-h-14 flex-col justify-center px-4 py-2 hover:bg-surface-raised/50">
                      <span className="line-clamp-2 text-sm">{v.title}</span>
                      <span className="block truncate text-xs text-text-tertiary">Comparten: {r.shared.join(", ")}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
      {linking && <KnowledgePicker from={{ type: "note", id }} mode="link" snap={snap} open onOpenChange={setLinking} />}
    </div>
  )
}

function groupNotes(state: KnowledgeState, notes: KnowledgeNote[], by: "contenido" | "tema"): { key: string; title: string; href: string | null; notes: KnowledgeNote[] }[] {
  const groups = new Map<string, { key: string; title: string; href: string | null; notes: KnowledgeNote[] }>()
  for (const n of notes) {
    let key: string
    let title: string
    let href: string | null = null
    if (by === "contenido") {
      const item = n.itemId ? state.items[n.itemId] : undefined
      key = item ? item.id : "__free"
      title = item ? item.title : "Ideas sueltas"
      href = item ? itemHref(item.id) : null
    } else {
      const t = noteTopics(state, n)[0]
      key = t ? normalize(t) : "__none"
      title = t ?? "Sin tema"
    }
    const g = groups.get(key)
    if (g) g.notes.push(n)
    else groups.set(key, { key, title, href, notes: [n] })
  }
  return [...groups.values()]
}

/**
 * `/knowledge/brain` · Cerebro (P16, D78; M4e D81–D83): every note in one place, searched with the
 * device's own index (offline, accents and case ignored, several words), filtered and grouped from
 * the URL, plus the «Aplicaciones» view and one note with its connections. No AI.
 */
export function BrainView() {
  const snap = useLibrary()
  const pathname = usePathname()
  const sp = useSearchParams()
  const b = useMemo(() => parseBrainQuery((k) => sp.get(k)), [sp])
  // From the address bar, not this render: two quick taps must build on each other.
  const set = (p: Partial<BrainQuery>) => {
    const current = new URLSearchParams(window.location.search)
    const qs = brainQueryString({ ...parseBrainQuery((k) => current.get(k)), ...p })
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname)
  }

  // The box answers at once; the URL follows a moment later (no history entry per keystroke).
  const [text, setText] = useState(b.q)
  const pushed = useRef(b.q)
  useEffect(() => {
    if (b.q !== pushed.current) {
      pushed.current = b.q
      setText(b.q)
    }
  }, [b.q])
  useEffect(() => {
    if (text === pushed.current) return
    const t = setTimeout(() => {
      pushed.current = text
      set({ q: text })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  const query = useDeferredValue(text)

  const { index, progress } = useKnowledgeIndex(snap, !b.note)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const resultKey = `${query}|${brainQueryString({ ...b, q: "" })}`
  const [lastKey, setLastKey] = useState(resultKey)
  if (lastKey !== resultKey) {
    setLastKey(resultKey)
    setShown(PAGE)
  }

  const topics = useMemo(() => (snap ? allTopics(snap.state) : []), [snap])
  const hasWords = query.trim().length > 0
  const waiting = hasWords && !index
  const result = useMemo(() => {
    if (!snap || b.note) return null
    return search(snap.state, hasWords ? (index ?? NO_INDEX) : NO_INDEX, { query: hasWords ? query : "", filters: brainFilters(b, new Date()), limit: 100_000, sort: hasWords ? "relevance" : "recent" })
  }, [snap, index, query, hasWords, b])

  if (!snap) return <LibrarySkeleton />
  const total = Object.keys(snap.state.notes).length
  const appsPending = Object.values(snap.state.notes).filter((n) => n.type === "application" && (n.applicationStatus === "open" || n.applicationStatus === "doing")).length
  const count = activeFilterCount(b)
  const notes = waiting ? [] : (result?.notes.map((h) => h.entity) ?? [])
  const terms = result?.terms ?? []
  const contents = hasWords && !waiting && result ? [...result.items.map((h) => ({ type: "item" as const, id: h.entity.id })), ...result.shows.map((h) => ({ type: "show" as const, id: h.entity.id }))].slice(0, 6) : []
  const page = notes.slice(0, shown)
  const card = (n: KnowledgeNote) => {
    const it = n.itemId ? snap.state.items[n.itemId] : null
    return <NoteCard key={n.id} note={n} snap={snap} kind={it?.kind ?? null} origin={it ? { id: it.id, title: it.title } : null} terms={terms} matched={hasWords ? explainMatch(snap.state, n, terms) : undefined} />
  }

  return (
    <>
      <BackLink href={LIBRARY_HREF}>Biblioteca</BackLink>
      <PageHeader title="Cerebro" meta={<SourceBadge source={snap.source}>{DEMO_NOTICE}</SourceBadge>} description="Todo lo que has aprendido, en un sitio. Busca, filtra y conecta tus ideas." />
      <LibrarySyncBanner snap={snap} className="mb-4" />
      <LibraryConflicts snap={snap} className="mb-5" />
      <nav aria-label="Vistas de Cerebro" className="mb-5 flex gap-1.5">
        <Link href={BRAIN_HREF} aria-current={b.view === "ideas" && !b.note ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium md:min-h-10", b.view === "ideas" && !b.note ? "border-signal/60 bg-signal/12" : "border-border text-text-secondary hover:bg-surface-raised")}>
          Ideas
        </Link>
        <Link href={`${BRAIN_HREF}?vista=aplicaciones`} aria-current={b.view === "aplicaciones" ? "page" : undefined} className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium md:min-h-10", b.view === "aplicaciones" ? "border-signal/60 bg-signal/12" : "border-border text-text-secondary hover:bg-surface-raised")} data-testid="tab-applications">
          Aplicaciones
          {appsPending > 0 && <span className="num rounded-full bg-surface-raised px-1.5 text-xs text-text-secondary">{appsPending}</span>}
        </Link>
      </nav>

      {b.note ? (
        <>
          <Link href={BRAIN_HREF} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-text-secondary hover:text-foreground">
            ← Todas las notas
          </Link>
          <NoteFocus snap={snap} id={b.note} />
        </>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <aside className="min-w-0 space-y-3 lg:sticky lg:top-6">
            <QuickCapture itemId={null} kind={null} snap={snap} />
            <p className="text-xs text-text-tertiary">Una idea suelta no necesita libro ni episodio. Puedes moverla después.</p>
          </aside>
          <section aria-label={b.view === "aplicaciones" ? "Aplicaciones prácticas" : "Notas"} className="min-w-0 space-y-4">
            {total === 0 ? (
              <div className="panel rounded-2xl">
                <EmptyState icon={Brain} title="Aquí se reunirá lo que aprendas" description="Las ideas que guardes en tus libros y episodios, y las sueltas, aparecerán aquí." />
              </div>
            ) : (
              <>
                <div role="search" className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
                  <label htmlFor="brain-search" className="sr-only">
                    Buscar en tu conocimiento
                  </label>
                  <input
                    id="brain-search"
                    type="search"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Buscar ideas, libros, autores, temas…"
                    maxLength={200}
                    autoComplete="off"
                    className="h-12 w-full rounded-2xl border border-input bg-background pr-11 pl-10 text-[0.9375rem]"
                    data-testid="brain-search"
                  />
                  {text && (
                    <button type="button" onClick={() => setText("")} aria-label="Borrar la búsqueda" className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-text-tertiary hover:text-foreground">
                      <X className="size-4" aria-hidden />
                    </button>
                  )}
                </div>

                {b.view === "ideas" ? (
                  <div role="group" aria-label="Tipo de nota" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
                    <Chip on={b.types.length === 0} onClick={() => set({ types: [] })}>
                      Todas
                    </Chip>
                    {NOTE_TYPES.map((t: NoteType) => (
                      <Chip key={t} on={b.types.includes(t)} onClick={() => set({ types: toggle(b.types, t) })}>
                        {noteLabel(t, null, true)}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <div role="group" aria-label="Estado de la aplicación" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
                    <Chip on={b.applications.length === 0} onClick={() => set({ applications: [] })}>
                      Todas
                    </Chip>
                    {APPLICATION_STATUSES.map((s: ApplicationStatus) => (
                      <Chip key={s} on={b.applications.includes(s)} onClick={() => set({ applications: toggle(b.applications, s) })} testId={`app-filter-${s}`}>
                        {APPLICATION_LABEL[s]}
                      </Chip>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => setFiltersOpen(true)} data-testid="filters-open">
                    <SlidersHorizontal aria-hidden /> Filtros{count > 0 && <span className="num rounded-full bg-signal/20 px-1.5 text-xs">{count}</span>}
                  </Button>
                  {b.view === "ideas" && (
                    <label className="flex items-center gap-2 text-sm text-text-secondary">
                      Agrupar
                      <select value={b.group} onChange={(e) => set({ group: e.target.value as BrainQuery["group"] })} className="h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground md:h-10" data-testid="group-by">
                        <option value="ninguno">No</option>
                        <option value="contenido">Por origen</option>
                        <option value="tema">Por tema</option>
                      </select>
                    </label>
                  )}
                </div>
                <ActiveFilters b={b} set={set} />

                <p className="num text-xs text-text-tertiary" aria-live="polite" data-testid="brain-count">
                  {waiting ? `Preparando la búsqueda… ${Math.round(progress * 100)} %` : `${notes.length} ${notes.length === 1 ? "nota" : "notas"}${contents.length ? ` · ${result!.items.length + result!.shows.length} contenidos` : ""}`}
                </p>

                {contents.length > 0 && (
                  <section aria-labelledby="hits-contents" className="space-y-2">
                    <h2 id="hits-contents" className="text-sm font-semibold text-text-secondary">
                      Libros, episodios y programas
                    </h2>
                    <ul className="panel divide-y divide-border/70 rounded-2xl" data-testid="content-hits">
                      {contents.map((r) => {
                        const v = refView(snap.state, r)
                        if (!v) return null
                        return (
                          <li key={`${r.type}:${r.id}`}>
                            <Link href={r.type === "item" ? itemHref(r.id) : showHref(r.id)} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-raised/50">
                              <v.icon className="size-4 shrink-0 text-text-tertiary" aria-hidden />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                  <Marked text={v.title} terms={terms} />
                                </span>
                                <span className="block truncate text-xs text-text-tertiary">{v.kind}</span>
                              </span>
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}

                {!waiting && notes.length === 0 ? (
                  <p className="panel rounded-2xl p-5 text-sm text-text-secondary" data-testid="brain-empty">
                    {hasWords ? `Ninguna nota coincide con «${query.trim()}»${count ? " con estos filtros" : ""}.` : count ? "Ninguna nota cumple estos filtros." : b.view === "aplicaciones" ? "Todavía no hay aplicaciones prácticas." : "No hay notas de este tipo todavía."}
                  </p>
                ) : b.view === "aplicaciones" ? (
                  APPLICATION_STATUSES.map((s) => {
                    const list = page.filter((n) => n.applicationStatus === s)
                    if (!list.length) return null
                    return (
                      <section key={s} aria-labelledby={`app-${s}`} className="space-y-3" data-testid={`apps-${s}`}>
                        <h2 id={`app-${s}`} className="flex items-baseline gap-2 text-base font-semibold">
                          {APPLICATION_LABEL[s]}
                          <span className="num text-xs font-normal text-text-tertiary">{notes.filter((n) => n.applicationStatus === s).length}</span>
                        </h2>
                        {list.map(card)}
                      </section>
                    )
                  })
                ) : b.group !== "ninguno" ? (
                  groupNotes(snap.state, page, b.group).map((g) => (
                    <section key={g.key} aria-label={g.title} className="space-y-3" data-testid="brain-group">
                      <h2 className="flex items-baseline gap-2 text-base font-semibold">
                        {g.href ? (
                          <Link href={g.href} className="underline-offset-2 hover:underline">
                            {g.title}
                          </Link>
                        ) : (
                          g.title
                        )}
                        <span className="num text-xs font-normal text-text-tertiary">{g.notes.length}</span>
                      </h2>
                      {g.notes.map(card)}
                    </section>
                  ))
                ) : (
                  page.map(card)
                )}
                {notes.length > shown && (
                  <Button variant="outline" className="w-full" onClick={() => setShown(shown + PAGE)} data-testid="brain-more">
                    Mostrar {Math.min(PAGE, notes.length - shown)} más
                  </Button>
                )}
              </>
            )}
          </section>
        </div>
      )}
      <FiltersSheet open={filtersOpen} onOpenChange={setFiltersOpen} b={b} set={set} topics={topics} count={count} />
    </>
  )
}
