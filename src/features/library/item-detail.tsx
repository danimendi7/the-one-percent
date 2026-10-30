"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { BookOpen, ExternalLink, Heart, Link2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { cn } from "@/lib/utils"
import { formatDate } from "@/features/habits/domain/dates"
import { episodesOfShow, notesOfShow, relatedByTopics, sectionsOf, showTopics } from "@/features/knowledge/domain/relations"
import { formatTimestamp, parseTimestamp } from "@/features/knowledge/domain/text"
import { noteLabel, PLATFORM_LABEL, STATUSES, STATUS_LABEL, type ContentItem, type ContentStatus, type KnowledgeState } from "@/features/knowledge/domain/types"
import { DEMO_NOTICE } from "@/features/knowledge/demo"
import { libraryActions, useLibrary } from "./store/use-library"
import type { LibrarySnapshot } from "./store/types"
import { NoteCard, QuickCapture, refusalText } from "./components/knowledge-notes"
import { BackLink, BOOKS_HREF, CoverArt, itemHref, LIBRARY_HREF, PODCASTS_HREF, ProgressLine, RatingInput, showHref, StatusPill, SyncLine } from "./components/library-ui"
import { LibraryConflicts, LibrarySyncBanner } from "./components/library-sync"
import { Connections, KnowledgePicker } from "./components/knowledge-links"
import { LibrarySkeleton, useContentForm } from "./library-views"

function NotHere({ back }: { back: string }) {
  return (
    <>
      <BackLink href={back}>Biblioteca</BackLink>
      <section className="panel rounded-2xl">
        <EmptyState icon={BookOpen} title="No está en este dispositivo" description="Puede que se haya eliminado, o que todavía no haya llegado de tu cuenta." />
      </section>
    </>
  )
}

/** Delete with a confirmation when notes would go too (P14), then «Deshacer» while it is safe. */
function DeleteButton({ label, notes, onConfirm }: { label: string; notes: number; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" onClick={() => (notes > 0 ? setOpen(true) : onConfirm())} data-testid="delete">
        <Trash2 aria-hidden /> Eliminar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar {label}</DialogTitle>
            <DialogDescription>
              Se eliminarán también {notes === 1 ? "su nota" : `sus ${notes} notas`} y sus enlaces. Podrás deshacerlo justo después.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => (setOpen(false), onConfirm())} data-testid="delete-confirm">
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StatusPicker({ item }: { item: ContentItem }) {
  return (
    <div role="radiogroup" aria-label="Estado" className="flex flex-wrap gap-1.5">
      {STATUSES.map((s: ContentStatus) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={item.status === s}
          onClick={() => libraryActions.updateItem(item.id, { status: s })}
          className={cn("min-h-11 md:min-h-10 shrink-0 rounded-full border px-3.5 text-[0.8125rem] font-medium", item.status === s ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary hover:bg-surface-raised")}
        >
          {STATUS_LABEL[item.kind][s]}
        </button>
      ))}
    </div>
  )
}

/** Where you are: current page for a book, minute for an episode. Saved on leaving the field. */
function ProgressInput({ item }: { item: ContentItem }) {
  const initial = item.kind === "book" ? (item.book.currentPage?.toString() ?? "") : item.episode.positionSeconds != null ? formatTimestamp(item.episode.positionSeconds) : ""
  const [v, setV] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  function save() {
    if (v === initial) return
    let r
    if (item.kind === "book") {
      if (v.trim() && !/^\d+$/.test(v.trim())) return setErr("Escribe un número de página.")
      r = libraryActions.updateItem(item.id, { book: { currentPage: v.trim() ? Number(v) : null } })
    } else {
      const s = v.trim() ? parseTimestamp(v) : null
      if (v.trim() && s === null) return setErr("Escribe el minuto como 12:34.")
      r = libraryActions.updateItem(item.id, { episode: { positionSeconds: s } })
    }
    setErr(r.ok ? null : refusalText(r.error))
  }
  return (
    <div>
      <label htmlFor={`progress-${item.id}`} className="mb-1 block text-xs text-text-tertiary">
        {item.kind === "book" ? `Página actual${item.book.pageCount ? ` (de ${item.book.pageCount})` : ""}` : "Te quedaste en"}
      </label>
      <input id={`progress-${item.id}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} inputMode={item.kind === "book" ? "numeric" : "text"} placeholder={item.kind === "book" ? "214" : "27:40"} className="num h-11 w-32 rounded-xl border border-input bg-background px-3 text-sm" data-testid="progress-input" />
      {err && (
        <p role="alert" className="mt-1 text-xs text-warning">
          {err}
        </p>
      )}
    </div>
  )
}

function Chrome({ snap, back, children }: { snap: LibrarySnapshot; back: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <>
      <BackLink href={back.href}>{back.label}</BackLink>
      <div className="mb-3">
        <SourceBadge source={snap.source}>{DEMO_NOTICE}</SourceBadge>
      </div>
      <LibrarySyncBanner snap={snap} className="mb-4" />
      <LibraryConflicts snap={snap} className="mb-5" />
      {children}
    </>
  )
}

/** `/knowledge/library/item?id=`: reads the id from the URL (behind the page's Suspense). */
export function ItemDetailFromUrl() {
  const id = useSearchParams().get("id") ?? ""
  return <ItemDetail key={id} id={id} />
}

/** A content's manual connections (M4e), with «Conectar con…». */
function ItemConnections({ id, snap }: { id: string; snap: LibrarySnapshot }) {
  const [linking, setLinking] = useState(false)
  return (
    <section aria-labelledby="item-conns" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="item-conns" className="text-base font-semibold">
          Conexiones
        </h2>
        <Button variant="outline" onClick={() => setLinking(true)} data-testid="item-connect">
          <Link2 aria-hidden /> Conectar con…
        </Button>
      </div>
      <Connections from={{ type: "item", id }} snap={snap} empty="Conecta este contenido con ideas, libros o episodios relacionados." />
      {linking && <KnowledgePicker from={{ type: "item", id }} mode="link" snap={snap} open onOpenChange={setLinking} />}
    </section>
  )
}

/** One book or episode, its knowledge first, editing at hand. */
export function ItemDetail({ id }: { id: string }) {
  const snap = useLibrary()
  const router = useRouter()
  const form = useContentForm(snap?.state)
  if (!snap) return <LibrarySkeleton />
  const s: KnowledgeState = snap.state
  const found = Object.hasOwn(s.items, id) ? s.items[id] : undefined
  if (!found) return <NotHere back={LIBRARY_HREF} />
  const item = found
  const show = item.kind === "episode" && item.episode.showId ? s.shows[item.episode.showId] : null
  const sections = sectionsOf(s, id).filter((x) => x.notes.length > 0)
  const noteCount = sections.reduce((n, x) => n + x.notes.length, 0)
  const related = relatedByTopics(s, id, 4)
  const back = item.kind === "book" ? { href: BOOKS_HREF, label: "Libros" } : show ? { href: showHref(show.id), label: show.title } : { href: PODCASTS_HREF, label: "Podcasts" }
  function remove() {
    const r = libraryActions.deleteItem(id)
    if (!r.ok) return void toast.error(refusalText(r.error))
    router.push(back.href)
    toast(`${item.kind === "book" ? "Libro" : "Episodio"} eliminado`, { action: { label: "Deshacer", onClick: () => libraryActions.undo(r.undo) } })
  }
  const e = item.kind === "episode" ? item.episode : null
  return (
    <Chrome snap={snap} back={back}>
      <article className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
        <header className="min-w-0 space-y-4">
          <div className="flex gap-4">
            <div className={cn("shrink-0", item.kind === "book" ? "w-28 sm:w-36" : "w-32 sm:w-40")}>
              <CoverArt seed={item.id} title={item.title} byline={item.creators.join(", ") || show?.title} kind={item.kind} size="lg" />
            </div>
            <div className="min-w-0 space-y-2">
              <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance">{item.title}</h1>
              {item.subtitle && <p className="text-sm text-text-secondary">{item.subtitle}</p>}
              {item.creators.length > 0 && <p className="text-sm text-text-secondary">{(item.kind === "episode" ? "Con " : "") + item.creators.join(", ")}</p>}
              {show && (
                <Link href={showHref(show.id)} className="block min-h-11 md:min-h-10 content-center text-sm text-text-secondary underline-offset-2 hover:text-foreground hover:underline">
                  {show.title}
                </Link>
              )}
              {e && (
                <p className="num text-xs text-text-tertiary">
                  {[e.platform ? PLATFORM_LABEL[e.platform] : null, e.durationSeconds ? formatTimestamp(e.durationSeconds) : null, e.publishedOn ? formatDate(e.publishedOn, { day: "numeric", month: "short", year: "numeric" }) : null, e.episodeNumber ? `Nº ${e.episodeNumber}` : null].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill kind={item.kind} status={item.status} />
                <button type="button" aria-pressed={item.favorite} aria-label={item.favorite ? "Quitar de favoritos" : "Añadir a favoritos"} onClick={() => libraryActions.updateItem(id, { favorite: !item.favorite })} className="grid size-11 place-items-center rounded-lg md:size-10 hover:bg-surface-raised">
                  <Heart className={cn("size-4", item.favorite ? "fill-current text-signal" : "text-text-tertiary")} aria-hidden />
                </button>
              </div>
            </div>
          </div>
          {item.sourceUrl && (
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden /> Abrir {e?.platform ? `en ${PLATFORM_LABEL[e.platform]}` : "el enlace original"}
              </a>
            </Button>
          )}
          <QuickCapture itemId={id} kind={item.kind} snap={snap} />
          <section aria-label="Estado y valoración" className="panel space-y-4 rounded-2xl p-4">
            <StatusPicker item={item} />
            <ProgressLine item={item} />
            <ProgressInput key={`${item.updatedAt}`} item={item} />
            <div className="space-y-1.5">
              <p className="text-xs text-text-tertiary">Tu valoración (opcional)</p>
              <RatingInput value={item.rating} onChange={(rating) => libraryActions.updateItem(id, { rating })} />
            </div>
            {(item.startedOn || item.finishedOn) && (
              <p className="num text-xs text-text-tertiary">
                {item.startedOn && `Empezado el ${formatDate(item.startedOn, { day: "numeric", month: "long", year: "numeric" })}`}
                {item.startedOn && item.finishedOn && " · "}
                {item.finishedOn && `${item.kind === "book" ? "Terminado" : "Escuchado"} el ${formatDate(item.finishedOn, { day: "numeric", month: "long", year: "numeric" })}`}
              </p>
            )}
            {item.topics.length > 0 && (
              <ul aria-label="Temas" className="flex flex-wrap gap-1.5">
                {item.topics.map((t) => (
                  <li key={t} className="rounded-full border border-border px-2.5 py-1 text-xs text-text-secondary">
                    {t}
                  </li>
                ))}
              </ul>
            )}
            <SyncLine state={libraryActions.syncStateOf("item", id)} snap={snap} testId="item-save" />
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button variant="outline" onClick={() => form.open({ kind: item.kind, item })} data-testid="edit">
                <Pencil aria-hidden /> Editar
              </Button>
              <DeleteButton label={item.kind === "book" ? "libro" : "episodio"} notes={noteCount} onConfirm={remove} />
            </div>
          </section>
          {item.description && (
            <details className="panel group rounded-2xl p-4">
              <summary className="min-h-11 md:min-h-10 cursor-pointer content-center text-sm font-medium">{item.kind === "book" ? "Sinopsis" : "Descripción"}</summary>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-text-secondary">{item.description}</p>
            </details>
          )}
        </header>
        <div className="min-w-0 space-y-6">
          {sections.length === 0 ? (
            <section className="panel rounded-2xl">
              <EmptyState icon={BookOpen} title="Todavía no hay ideas" description="Pulsa «Añadir idea» mientras lees o escuchas: se guarda sola, también sin conexión." />
            </section>
          ) : (
            sections.map((sec) => (
              <section key={sec.type} aria-labelledby={`sec-${sec.type}`} className="space-y-3">
                <h2 id={`sec-${sec.type}`} className="flex items-baseline gap-2 text-base font-semibold">
                  {noteLabel(sec.type, item.kind, true)}
                  <span className="num text-xs font-normal text-text-tertiary">{sec.notes.length}</span>
                </h2>
                {sec.notes.map((n) => (
                  <NoteCard key={n.id} note={n} snap={snap} kind={item.kind} />
                ))}
              </section>
            ))
          )}
          <ItemConnections id={id} snap={snap} />
          {related.length > 0 && (
            <section aria-labelledby="related" className="space-y-2">
              <h2 id="related" className="text-base font-semibold">
                Relacionados por temas
              </h2>
              <ul className="panel divide-y divide-border/70 rounded-2xl">
                {related.map((r) => (
                  <li key={r.item.id}>
                    <Link href={itemHref(r.item.id)} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-raised/50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.item.title}</span>
                        <span className="block truncate text-xs text-text-tertiary">Comparten: {r.shared.join(", ")}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </article>
      {form.sheet}
    </Chrome>
  )
}

/** `/knowledge/library/show?id=`: reads the id from the URL (behind the page's Suspense). */
export function ShowDetailFromUrl() {
  const id = useSearchParams().get("id") ?? ""
  return <ShowDetail key={id} id={id} />
}

/** A show, its episodes and the ideas taken from them. */
export function ShowDetail({ id }: { id: string }) {
  const snap = useLibrary()
  const router = useRouter()
  const form = useContentForm(snap?.state)
  if (!snap) return <LibrarySkeleton />
  const show = Object.hasOwn(snap.state.shows, id) ? snap.state.shows[id] : undefined
  if (!show) return <NotHere back={PODCASTS_HREF} />
  const episodes = episodesOfShow(snap.state, id)
  const notes = notesOfShow(snap.state, id)
  const topics = showTopics(snap.state, id)
  function remove() {
    const r = libraryActions.deleteShow(id)
    if (!r.ok) return void toast.error(refusalText(r.error))
    router.push(PODCASTS_HREF)
    toast("Programa eliminado", { description: "Sus episodios y notas se conservan, sin programa.", action: { label: "Deshacer", onClick: () => libraryActions.undo(r.undo) } })
  }
  return (
    <Chrome snap={snap} back={{ href: PODCASTS_HREF, label: "Podcasts" }}>
      <header className="mb-6 flex gap-4">
        <div className="w-32 shrink-0 sm:w-40">
          <CoverArt seed={show.id} title={show.title} byline={show.publisher} kind="show" size="lg" />
        </div>
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance">{show.title}</h1>
          {show.publisher && <p className="text-sm text-text-secondary">{show.publisher}</p>}
          <p className="num text-xs text-text-tertiary">
            {episodes.length} {episodes.length === 1 ? "episodio" : "episodios"} · {notes.length} {notes.length === 1 ? "nota" : "notas"}
          </p>
          {topics.length > 0 && <p className="text-xs text-text-tertiary">{topics.slice(0, 6).join(" · ")}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {show.sourceUrl && (
              <Button variant="outline" asChild>
                <a href={show.sourceUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden /> Abrir el programa
                </a>
              </Button>
            )}
            <Button variant="outline" onClick={() => form.open({ kind: "show", show })}>
              <Pencil aria-hidden /> Editar
            </Button>
            <DeleteButton label="programa" notes={0} onConfirm={remove} />
          </div>
        </div>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="eps" className="min-w-0 space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="eps" className="text-base font-semibold">
              Episodios
            </h2>
            <Button onClick={() => form.open({ kind: "episode", showId: id })} data-testid="add-episode">
              <Plus aria-hidden /> Añadir episodio
            </Button>
          </div>
          {episodes.length === 0 ? (
            <p className="panel rounded-2xl p-5 text-sm text-text-secondary">Aún no hay episodios de este programa.</p>
          ) : (
            <ul className="panel divide-y divide-border/70 rounded-2xl">
              {episodes.map((ep) => (
                <li key={ep.id}>
                  <Link href={itemHref(ep.id)} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-raised/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{ep.title}</span>
                      <span className="num block text-xs text-text-tertiary">{[ep.episode.episodeNumber ? `Nº ${ep.episode.episodeNumber}` : null, ep.episode.durationSeconds ? formatTimestamp(ep.episode.durationSeconds) : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <StatusPill kind="episode" status={ep.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="show-notes" className="min-w-0 space-y-3">
          <h2 id="show-notes" className="text-base font-semibold">
            Ideas de este programa
          </h2>
          {notes.length === 0 ? (
            <p className="panel rounded-2xl p-5 text-sm text-text-secondary">Las ideas que guardes en sus episodios aparecerán aquí.</p>
          ) : (
            notes.map((n) => {
              const ep = n.itemId ? snap.state.items[n.itemId] : null
              return <NoteCard key={n.id} note={n} snap={snap} kind="episode" origin={ep ? { id: ep.id, title: ep.title } : null} />
            })
          )}
        </section>
      </div>
      {form.sheet}
    </Chrome>
  )
}
