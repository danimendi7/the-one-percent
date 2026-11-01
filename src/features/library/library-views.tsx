"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { ArrowRight, BookOpen, Brain, Headphones, LayoutGrid, List, Mic, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { filterContent, inProgress, shelfCounts, type ContentSort, type Shelf, SHELVES } from "@/features/knowledge/domain/library"
import { episodesOfShow } from "@/features/knowledge/domain/relations"
import { formatTimestamp } from "@/features/knowledge/domain/text"
import { STATUS_LABEL, type ContentItem, type ContentKind, type Episode, type KnowledgeState } from "@/features/knowledge/domain/types"
import { formatDate } from "@/features/habits/domain/dates"
import { DEMO_NOTICE } from "@/features/knowledge/demo"
import { useLibrary } from "./store/use-library"
import type { LibrarySnapshot } from "./store/types"
import type { DataSource } from "@/features/habits/store/types"
import { AddBookSheet } from "./components/add-book-sheet"
import { AddPodcastSheet } from "./components/add-podcast-sheet"
import { showResultOf } from "./metadata/to-input"
import type { ShowResult } from "./metadata/types"
import { useHabits } from "@/features/habits/store/habit-store"
import { ContentFormSheet, type FormTarget } from "./components/content-form"
import { NoteCard, QuickCapture } from "./components/knowledge-notes"
import { BackLink, BOOKS_HREF, BRAIN_HREF, byline, CoverArt, itemHref, LIBRARY_HREF, PODCASTS_HREF, ProgressLine, RatingBadge, showHref, StatusPill } from "./components/library-ui"
import { LibraryConflicts, LibrarySyncBanner } from "./components/library-sync"

export function LibrarySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando la biblioteca">
      <div className="panel h-28 animate-pulse rounded-2xl motion-reduce:animate-none" />
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-surface motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  )
}

/** One form sheet for the whole screen: what to add or edit, or nothing. */
/**
 * The add and edit sheets of the Library. With an account, a new book opens the search assistant
 * (M4g.3), which can hand over to the manual form with what was typed; the demo has no search, so a
 * new book there is manual as before. Editing, episodes and shows keep the manual form.
 */
export function useContentForm(state: KnowledgeState | undefined, source?: DataSource) {
  const router = useRouter()
  const [target, setTarget] = useState<FormTarget | null>(null)
  const [assistant, setAssistant] = useState(false)
  const [podcast, setPodcast] = useState<{ show: ShowResult | null } | null>(null)
  const timeZone = useHabits()?.state.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const open = (t: FormTarget) => {
    const isNew = !("item" in t && t.item) && !("show" in t && t.show) && !("draft" in t && t.draft)
    if (!isNew || source !== "account") return setTarget(t)
    if (t.kind === "book") return setAssistant(true)
    // A new episode or show: the podcast assistant (M4g.4). From a show's page, at that show's
    // episodes when it came from Apple; a show written by hand keeps the manual form.
    const local = t.kind === "episode" && t.showId ? state?.shows[t.showId] : undefined
    if (local && local.external?.provider !== "itunes") return setTarget(t)
    setPodcast({ show: local ? showResultOf(local) : null })
  }
  const sheet = state ? (
    <>
      <AddBookSheet
        open={assistant}
        onOpenChange={setAssistant}
        state={state}
        onManual={(draft) => setTarget({ kind: "book", draft })}
        onCreated={(id) => router.push(itemHref(id))}
      />
      <AddPodcastSheet
        open={!!podcast}
        onOpenChange={(v) => !v && setPodcast(null)}
        state={state}
        timeZone={timeZone}
        initialShow={podcast?.show ?? null}
        onManual={(m) => setTarget(m.kind === "show" ? { kind: "show", draft: { title: m.title } } : { kind: "episode", showId: m.showId ?? null, draft: { title: m.title } })}
        onCreated={(href) => router.push(href)}
      />
      <ContentFormSheet
      target={target ?? { kind: "book" }}
      state={state}
      open={!!target}
      onOpenChange={(v) => !v && setTarget(null)}
      onDone={(id) => {
        const t = target
        if (t && !("item" in t && t.item) && !("show" in t && t.show)) router.push(t.kind === "show" ? showHref(id) : itemHref(id))
      }}
      />
    </>
  ) : null
  return { open, sheet }
}

function AddMenu({ open, only }: { open: (t: FormTarget) => void; only?: ContentKind | "podcasts" }) {
  if (only === "book")
    return (
      <Button onClick={() => open({ kind: "book" })} data-testid="add-book">
        <Plus aria-hidden /> Añadir libro
      </Button>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="add-menu">
          <Plus aria-hidden /> Añadir
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {only !== "podcasts" && (
          <DropdownMenuItem onSelect={() => open({ kind: "book" })}>
            <BookOpen aria-hidden /> Libro
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => open({ kind: "episode" })}>
          <Headphones aria-hidden /> Episodio
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open({ kind: "show" })}>
          <Mic aria-hidden /> Programa de podcast
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const showTitle = (s: KnowledgeState, i: ContentItem) => (i.kind === "episode" && i.episode.showId ? s.shows[i.episode.showId]?.title : null)

/** A cover that opens its page, with the little that matters underneath. */
function ItemTile({ item, state }: { item: ContentItem; state: KnowledgeState }) {
  return (
    <Link href={itemHref(item.id)} className="group block min-w-0 rounded-xl focus-visible:outline-2" data-testid="item-tile">
      <CoverArt seed={item.id} title={item.title} byline={byline(item, showTitle(state, item))} kind={item.kind} cover={item.cover} className="transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none" />
      <p className="mt-2 line-clamp-2 text-sm leading-snug font-medium">{item.title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <StatusPill kind={item.kind} status={item.status} />
        <RatingBadge rating={item.rating} />
      </div>
      <ProgressLine item={item} className="mt-2" />
    </Link>
  )
}

function ItemRow({ item, state }: { item: ContentItem; state: KnowledgeState }) {
  const sub = byline(item, showTitle(state, item)) ?? (item.kind === "episode" ? "Sin programa" : null)
  const e = item.kind === "episode" ? item.episode : null
  return (
    <li>
      <Link href={itemHref(item.id)} className="flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-surface-raised/50" data-testid="item-row">
        <div className={cn("shrink-0", item.kind === "book" ? "w-10" : "w-12")}>
          <CoverArt seed={item.id} title={item.title} kind={item.kind} size="sm" cover={item.cover} />
        </div>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.title}</span>
          <span className="block truncate text-xs text-text-tertiary">
            {[sub, e?.durationSeconds ? formatTimestamp(e.durationSeconds) : null, e?.publishedOn ? formatDate(e.publishedOn, { day: "numeric", month: "short", year: "numeric" }) : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill kind={item.kind} status={item.status} />
          <RatingBadge rating={item.rating} />
        </span>
      </Link>
    </li>
  )
}

function Header({ snap, title, back, actions, description }: { snap: LibrarySnapshot; title: string; back?: boolean; actions?: React.ReactNode; description?: string }) {
  return (
    <>
      {back && <BackLink href={LIBRARY_HREF}>Biblioteca</BackLink>}
      <PageHeader title={title} inlineActions meta={<SourceBadge source={snap.source}>{DEMO_NOTICE}</SourceBadge>} description={description} actions={actions} />
      <LibrarySyncBanner snap={snap} className="mb-4" />
      <LibraryConflicts snap={snap} className="mb-5" />
    </>
  )
}

/** `/knowledge/library`: the door to Books, Podcasts and Cerebro, what you are on now, and a free idea. */
export function LibraryHome() {
  const snap = useLibrary()
  const form = useContentForm(snap?.state, snap?.source)
  if (!snap) return <LibrarySkeleton />
  const s = snap.state
  const items = Object.values(s.items)
  const books = items.filter((i) => i.kind === "book")
  const episodes = items.filter((i) => i.kind === "episode")
  const notes = Object.values(s.notes).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const current = inProgress(s, 8)
  const empty = items.length === 0 && notes.length === 0
  const doors = [
    { href: BOOKS_HREF, icon: BookOpen, title: "Libros", line: `${books.length} ${books.length === 1 ? "libro" : "libros"}`, extra: books.filter((b) => b.status === "active").length, extraLabel: "leyendo" },
    { href: PODCASTS_HREF, icon: Headphones, title: "Podcasts", line: `${episodes.length} ${episodes.length === 1 ? "episodio" : "episodios"} · ${Object.keys(s.shows).length} programas`, extra: episodes.filter((e) => e.status === "active").length, extraLabel: "en curso" },
    { href: BRAIN_HREF, icon: Brain, title: "Cerebro", line: `${notes.length} ${notes.length === 1 ? "nota" : "notas"}`, extra: notes.filter((n) => n.itemId === null).length, extraLabel: "sueltas" },
  ]
  return (
    <>
      <Header snap={snap} title="Biblioteca" description="Lo que lees y escuchas, convertido en ideas que puedes recuperar." actions={<AddMenu open={form.open} />} />
      <nav aria-label="Secciones de la biblioteca" className="mb-6 grid gap-3 md:grid-cols-3">
        {doors.map((d) => (
          <Link key={d.href} href={d.href} className="panel group flex min-h-20 items-center gap-4 rounded-2xl p-4 hover:bg-surface-raised/50" data-testid={`door-${d.title}`}>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-surface-raised">
              <d.icon className="size-5 text-text-secondary" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{d.title}</span>
              <span className="num block truncate text-xs text-text-tertiary">
                {d.line}
                {d.extra > 0 && ` · ${d.extra} ${d.extraLabel}`}
              </span>
            </span>
            <ArrowRight className="size-4 text-text-tertiary transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
          </Link>
        ))}
      </nav>
      {empty ? (
        <section className="panel rounded-2xl">
          <EmptyState
            icon={BookOpen}
            title="Tu biblioteca empieza con un título"
            description="Añade un libro o un episodio y guarda ideas mientras lees o escuchas. También funciona sin conexión."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => form.open({ kind: "book" })}>Añadir libro</Button>
                <Button variant="outline" onClick={() => form.open({ kind: "episode" })}>
                  Añadir episodio
                </Button>
              </div>
            }
          />
        </section>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="current-title" className="min-w-0">
            <h2 id="current-title" className="mb-3 text-base font-semibold">
              En curso
            </h2>
            {current.length === 0 ? (
              <p className="panel rounded-2xl p-5 text-sm text-text-secondary">Nada en curso. Marca un libro como «Leyendo» o un episodio como «En curso» para tenerlo aquí.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {current.map((i) => (
                  <ItemTile key={i.id} item={i} state={s} />
                ))}
              </div>
            )}
          </section>
          <section aria-labelledby="recent-title" className="min-w-0 space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="recent-title" className="text-base font-semibold">
                Ideas recientes
              </h2>
              <Link href={BRAIN_HREF} className="min-h-11 content-center text-sm text-text-secondary hover:text-foreground">
                Ver todas
              </Link>
            </div>
            <QuickCapture itemId={null} kind={null} snap={snap} />
            {notes.slice(0, 3).map((n) => {
              const it = n.itemId ? s.items[n.itemId] : null
              return <NoteCard key={n.id} note={n} snap={snap} kind={it?.kind ?? null} origin={it ? { id: it.id, title: it.title } : null} />
            })}
          </section>
        </div>
      )}
      {form.sheet}
    </>
  )
}

const SORTS: { value: ContentSort; label: string }[] = [
  { value: "recent", label: "Recientes" },
  { value: "title", label: "Título" },
  { value: "creator", label: "Autor" },
  { value: "rating", label: "Valoración" },
  { value: "finished", label: "Terminados" },
]
const shelfLabel = (kind: ContentKind, s: Shelf) => (s === "all" ? "Todos" : s === "favorites" ? "Favoritos" : STATUS_LABEL[kind][s])

function Shelves({ kind, state, shelf, onShelf }: { kind: ContentKind; state: KnowledgeState; shelf: Shelf; onShelf: (s: Shelf) => void }) {
  const counts = shelfCounts(state, kind)
  return (
    <div role="radiogroup" aria-label="Estantería" className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
      {SHELVES.filter((s) => s === "all" || counts[s] > 0 || s === shelf).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={shelf === s}
          onClick={() => onShelf(s)}
          className={cn("min-h-11 md:min-h-10 shrink-0 rounded-full border px-3.5 text-[0.8125rem] font-medium", shelf === s ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary hover:bg-surface-raised")}
        >
          {shelfLabel(kind, s)} <span className="num text-text-tertiary">{counts[s]}</span>
        </button>
      ))}
    </div>
  )
}

/** `/knowledge/library/books`. */
export function BooksView() {
  const snap = useLibrary()
  const form = useContentForm(snap?.state, snap?.source)
  const [shelf, setShelf] = useState<Shelf>("all")
  const [sort, setSort] = useState<ContentSort>("recent")
  const [layout, setLayout] = useState<"grid" | "list">("grid")
  const books = useMemo(() => (snap ? filterContent(snap.state, { kind: "book", shelf, sort }) : []), [snap, shelf, sort])
  if (!snap) return <LibrarySkeleton />
  const total = shelfCounts(snap.state, "book").all
  return (
    <>
      <Header snap={snap} title="Libros" back actions={<AddMenu open={form.open} only="book" />} />
      {total === 0 ? (
        <section className="panel rounded-2xl">
          <EmptyState icon={BookOpen} title="Aún no hay libros" description="Añade el que estás leyendo: con el título basta." action={<Button onClick={() => form.open({ kind: "book" })}>Añadir libro</Button>} />
        </section>
      ) : (
        <>
          <Shelves kind="book" state={snap.state} shelf={shelf} onShelf={setShelf} />
          <div className="mb-4 flex items-center gap-2">
            <label htmlFor="books-sort" className="sr-only">
              Ordenar
            </label>
            <select id="books-sort" value={sort} onChange={(e) => setSort(e.target.value as ContentSort)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm">
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="flex-1" />
            <div role="radiogroup" aria-label="Vista" className="flex rounded-xl border border-border p-0.5">
              {(["grid", "list"] as const).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={layout === l} aria-label={l === "grid" ? "Cuadrícula" : "Lista"} onClick={() => setLayout(l)} className={cn("grid size-10 place-items-center rounded-lg", layout === l ? "bg-surface-raised text-foreground" : "text-text-tertiary")}>
                  {l === "grid" ? <LayoutGrid className="size-4" aria-hidden /> : <List className="size-4" aria-hidden />}
                </button>
              ))}
            </div>
          </div>
          {books.length === 0 ? (
            <p className="panel rounded-2xl p-5 text-sm text-text-secondary">No hay libros en esta estantería.</p>
          ) : layout === "grid" ? (
            <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
              {books.map((b) => (
                <ItemTile key={b.id} item={b} state={snap.state} />
              ))}
            </div>
          ) : (
            <ul className="panel divide-y divide-border/70 rounded-2xl">
              {books.map((b) => (
                <ItemRow key={b.id} item={b} state={snap.state} />
              ))}
            </ul>
          )}
        </>
      )}
      {form.sheet}
    </>
  )
}

/** `/knowledge/library/podcasts`: episodes (by status) and shows (grouping their episodes). */
export function PodcastsView() {
  const snap = useLibrary()
  const form = useContentForm(snap?.state, snap?.source)
  const [tab, setTab] = useState<"episodes" | "shows">("episodes")
  const [shelf, setShelf] = useState<Shelf>("all")
  const episodes = useMemo(() => (snap ? (filterContent(snap.state, { kind: "episode", shelf, sort: "recent" }) as Episode[]) : []), [snap, shelf])
  if (!snap) return <LibrarySkeleton />
  const shows = Object.values(snap.state.shows).sort((a, b) => a.title.localeCompare(b.title, "es"))
  const total = shelfCounts(snap.state, "episode").all
  return (
    <>
      <Header snap={snap} title="Podcasts" back actions={<AddMenu open={form.open} only="podcasts" />} />
      <Segmented label="Vista de podcasts" value={tab} onChange={(v) => setTab(v as typeof tab)} options={[{ value: "episodes", label: "Episodios" }, { value: "shows", label: "Programas" }]} className="mb-5 max-w-xs" />
      {tab === "episodes" ? (
        total === 0 ? (
          <section className="panel rounded-2xl">
            <EmptyState icon={Headphones} title="Aún no hay episodios" description="Añade el que estás escuchando, con o sin programa." action={<Button onClick={() => form.open({ kind: "episode" })}>Añadir episodio</Button>} />
          </section>
        ) : (
          <>
            <Shelves kind="episode" state={snap.state} shelf={shelf} onShelf={setShelf} />
            {episodes.length === 0 ? (
              <p className="panel rounded-2xl p-5 text-sm text-text-secondary">No hay episodios con este estado.</p>
            ) : (
              <ul className="panel divide-y divide-border/70 rounded-2xl">
                {episodes.map((e) => (
                  <ItemRow key={e.id} item={e} state={snap.state} />
                ))}
              </ul>
            )}
          </>
        )
      ) : shows.length === 0 ? (
        <section className="panel rounded-2xl">
          <EmptyState icon={Mic} title="Aún no hay programas" description="Un programa agrupa sus episodios y guarda sus datos una sola vez." action={<Button onClick={() => form.open({ kind: "show" })}>Añadir programa</Button>} />
        </section>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          {shows.map((sh) => {
            const eps = episodesOfShow(snap.state, sh.id)
            return (
              <Link key={sh.id} href={showHref(sh.id)} className="group block min-w-0" data-testid="show-tile">
                <CoverArt seed={sh.id} title={sh.title} byline={sh.publisher} kind="show" cover={sh.cover} className="transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none" />
                <p className="mt-2 line-clamp-2 text-sm font-medium">{sh.title}</p>
                <p className="num text-xs text-text-tertiary">
                  {eps.length} {eps.length === 1 ? "episodio" : "episodios"}
                </p>
              </Link>
            )
          })}
        </div>
      )}
      {form.sheet}
    </>
  )
}
