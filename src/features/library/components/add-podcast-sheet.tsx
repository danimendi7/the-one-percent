"use client"

import Link from "next/link"
import { memo, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, PenLine, Search } from "lucide-react"
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { STATUSES, STATUS_LABEL, type ContentStatus, type KnowledgeState } from "@/features/knowledge/domain/types"
import { metadataClient } from "../metadata/client"
import { existingShow, findEpisodeMatches, findShowMatches } from "../metadata/duplicates"
import { createEpisodeDraft, durationLabel, editEpisodeField, episodeDraftErrors, episodeDraftInput, localDayOf, type EpisodeDraft, type EpisodeErrors, type EpisodeField } from "../metadata/episode-draft"
import { filterEpisodes } from "../metadata/rank"
import { createSearchController, type SearchState } from "../metadata/search-controller"
import { toShowInput } from "../metadata/to-input"
import type { EpisodeList, EpisodeResult, MetadataErrorCode, ShowResult } from "../metadata/types"
import { libraryActions } from "../store/use-library"
import { AssistantSheet, OFFLINE_TEXT, searchErrorText } from "./assistant-ui"
import { DeviceSaveNotice, SAVING_LABEL, useDeviceSave } from "./device-save"
import { refusalText } from "./knowledge-notes"
import { CoverArt, itemHref, RatingInput, showHref } from "./library-ui"

/**
 * «Añadir podcast» / «Añadir episodio» with an account (M4g.4, docs/m4g-plan.md §20): find the show
 * on Apple Podcasts through the app's server (M4g.1), browse its recent episodes (Apple gives at
 * most 200: said, never presented as the whole catalogue) or search older ones, review the episode
 * and save it with the same operations as a manual entry. The show is reused when it is already in
 * the Library. Manual entry is one tap away at every step. Covers never block (D97).
 */
const client = metadataClient()
const PROVIDER = "Apple Podcasts"
const errorText = (code: MetadataErrorCode, retryAfter?: number) => searchErrorText(code, PROVIDER, retryAfter)

/** Episodes drawn at a time: a long list grows on demand instead of 200 rows at once. */
export const EPISODE_PAGE = 30

const dayLabel = (day: string | null) => (day ? new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)) : "")

export type ManualTarget = { kind: "episode"; title?: string; showId?: string | null } | { kind: "show"; title?: string }

export function AddPodcastSheet({
  open,
  onOpenChange,
  state,
  timeZone,
  initialShow,
  onManual,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  state: KnowledgeState
  timeZone: string
  /** Opened from a show's page: start at its episodes. */
  initialShow?: ShowResult | null
  onManual: (t: ManualTarget) => void
  /** Where to go after saving (the episode's or the show's page). */
  onCreated: (href: string) => void
}) {
  return (
    <AssistantSheet open={open} onOpenChange={onOpenChange} testId="add-podcast-sheet">
      {({ setDirty, close }) => (
        <Assistant state={state} timeZone={timeZone} initialShow={initialShow ?? null} onDirty={setDirty} onManual={(t) => (close(), onManual(t))} onCreated={(h) => (close(), onCreated(h))} />
      )}
    </AssistantSheet>
  )
}

function Assistant({
  state,
  timeZone,
  initialShow,
  onDirty,
  onManual,
  onCreated,
}: {
  state: KnowledgeState
  timeZone: string
  initialShow: ShowResult | null
  onDirty: (v: boolean) => void
  onManual: (t: ManualTarget) => void
  onCreated: (href: string) => void
}) {
  const [text, setText] = useState("")
  const [search, setSearch] = useState<SearchState<ShowResult[]>>({ status: "idle" })
  const [show, setShow] = useState<ShowResult | null>(initialShow)
  const [episode, setEpisode] = useState<EpisodeResult | null>(null)
  const controller = useRef<ReturnType<typeof createSearchController<ShowResult[]>> | null>(null)

  useEffect(() => {
    const c = createSearchController<ShowResult[]>({ run: (q, signal) => client.searchShows(q, signal), onChange: setSearch })
    controller.current = c
    return () => c.dispose()
  }, [])
  useEffect(() => onDirty(text.trim() !== "" || episode !== null), [text, episode, onDirty])

  const localShowId = show ? (existingShow(state, show.id)?.id ?? null) : null

  if (show && episode)
    return (
      <ConfirmEpisode
        key={episode.id}
        show={show}
        episode={episode}
        state={state}
        timeZone={timeZone}
        onBack={() => setEpisode(null)}
        onManual={() => onManual({ kind: "episode", title: episode.title, showId: localShowId })}
        onCreated={onCreated}
      />
    )
  if (show)
    return (
      <EpisodesStep
        show={show}
        state={state}
        timeZone={timeZone}
        canGoBack={!initialShow}
        onBack={() => setShow(null)}
        onChoose={setEpisode}
        onManual={(title) => onManual({ kind: "episode", title, showId: localShowId })}
        onCreated={onCreated}
      />
    )
  return (
    <ShowsStep
      text={text}
      search={search}
      state={state}
      timeZone={timeZone}
      onText={(t) => (setText(t), controller.current?.search(t))}
      onRetry={() => controller.current?.retry()}
      onChoose={setShow}
      onManualShow={() => onManual({ kind: "show", title: text.trim() || undefined })}
      onManualEpisode={() => onManual({ kind: "episode" })}
    />
  )
}

// ---------- shows ----------

function ShowsStep({
  text,
  search,
  state,
  timeZone,
  onText,
  onRetry,
  onChoose,
  onManualShow,
  onManualEpisode,
}: {
  text: string
  search: SearchState<ShowResult[]>
  state: KnowledgeState
  timeZone: string
  onText: (t: string) => void
  onRetry: () => void
  onChoose: (s: ShowResult) => void
  onManualShow: () => void
  onManualEpisode: () => void
}) {
  const id = useId()
  const [active, setActive] = useState(-1)
  const trimmed = text.trim()
  const current = "query" in search && search.query === trimmed
  const results = current && search.status === "done" ? search.data : null
  const busy = current && (search.status === "waiting" || search.status === "loading")
  const failed = current && (search.status === "error" || search.status === "offline")
  const optionId = (i: number) => `${id}-s${i}`

  let status = ""
  if (busy) status = "Buscando…"
  else if (results) status = results.length === 0 ? `Sin resultados para «${trimmed}».` : `${results.length} ${results.length === 1 ? "programa" : "programas"}`
  else if (current && search.status === "error") status = errorText(search.code, search.retryAfter)
  else if (current && search.status === "offline") status = OFFLINE_TEXT

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!results?.length) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(-1, a - 1))
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault()
      onChoose(results[active])
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
        <SheetTitle className="text-lg">Añadir podcast</SheetTitle>
        <SheetDescription>Busca el programa por nombre o creador; después eliges el episodio.</SheetDescription>
        <form role="search" aria-label="Buscar programas" className="relative mt-3" onSubmit={(e) => (e.preventDefault(), onRetry())}>
          <Label htmlFor={`${id}-q`} className="sr-only">
            Programa o creador
          </Label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
          <Input
            id={`${id}-q`}
            value={text}
            onChange={(e) => (setActive(-1), onText(e.target.value))}
            onKeyDown={onKeyDown}
            placeholder="Programa o creador"
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="search"
            enterKeyHint="search"
            maxLength={100}
            role="combobox"
            aria-expanded={!!results?.length}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            aria-describedby={`${id}-status`}
            className="h-12 pr-10 pl-9 text-base"
            data-testid="show-search"
          />
          {busy && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-text-tertiary motion-reduce:animate-none" aria-hidden />}
        </form>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p id={`${id}-status`} role="status" aria-live="polite" className={cn("px-2 pb-2 text-sm", failed ? "text-warning" : "text-text-secondary")} data-testid="show-search-status">
          {status}
        </p>
        {current && search.status === "error" && search.code !== "unauthorized" && (
          <Button variant="outline" size="sm" className="mx-2 mb-2" onClick={onRetry} data-testid="show-search-retry">
            Reintentar
          </Button>
        )}
        {!trimmed && <p className="px-2 text-sm text-text-tertiary">Por ejemplo: «La Ruina», «Huberman Lab» o el nombre de quien lo presenta.</p>}
        {busy && <SkeletonRows square />}
        {results && results.length > 0 && (
          <ul id={`${id}-list`} role="listbox" aria-label="Programas" className="space-y-1" data-testid="show-results">
            {results.map((s, i) => {
              const owned = existingShow(state, s.id)
              const maybe = !owned && findShowMatches(state, s).some((m) => m.level === "possible")
              return (
                <li
                  key={s.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={active === i}
                  tabIndex={-1}
                  onClick={() => onChoose(s)}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex min-h-16 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-raised/60", active === i && "bg-surface-raised/60 outline-2 outline-signal")}
                  data-testid="show-result"
                >
                  <div className="w-12 shrink-0">
                    <CoverArt seed={s.id} title={s.title} kind="show" size="sm" cover={s.cover ? { source: "external", url: s.cover } : null} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.title}</p>
                    <p className="truncate text-sm text-text-secondary">{s.publisher ?? "Creador desconocido"}</p>
                    <p className="truncate text-xs text-text-tertiary">
                      {[s.episodeCount ? `${s.episodeCount} episodios` : null, s.latestReleaseAt ? `último: ${dayLabel(localDayOf(s.latestReleaseAt, timeZone))}` : null, s.topicSuggestions.slice(0, 2).join(", ") || null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {(owned || maybe) && (
                    <span className="shrink-0 rounded-full border border-signal/40 px-2 py-0.5 text-xs text-signal" data-testid="show-owned">
                      {owned ? "En tu Biblioteca" : "¿Ya lo tienes?"}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="px-2 pt-3 text-xs text-text-tertiary">Datos: Apple Podcasts</p>
      </div>
      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        <Button variant={failed ? "default" : "outline"} className="flex-1" onClick={onManualEpisode} data-testid="add-manual-episode">
          <PenLine aria-hidden /> Episodio a mano
        </Button>
        <Button variant="outline" className="flex-1" onClick={onManualShow} data-testid="add-manual-show">
          Programa a mano
        </Button>
      </SheetFooter>
    </div>
  )
}

function SkeletonRows({ square }: { square?: boolean }) {
  return (
    <ul aria-hidden className="space-y-1">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl px-2 py-2">
          {square && <div className="aspect-square w-12 animate-pulse rounded-md bg-surface-raised motion-reduce:animate-none" />}
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------- episodes ----------

type ListState = { status: "loading" } | { status: "done"; list: EpisodeList } | { status: "error"; code: MetadataErrorCode; retryAfter?: number }

function EpisodesStep({
  show,
  state,
  timeZone,
  canGoBack,
  onBack,
  onChoose,
  onManual,
  onCreated,
}: {
  show: ShowResult
  state: KnowledgeState
  timeZone: string
  canGoBack: boolean
  onBack: () => void
  onChoose: (e: EpisodeResult) => void
  onManual: (title?: string) => void
  onCreated: (href: string) => void
}) {
  const id = useId()
  const [recent, setRecent] = useState<ListState>({ status: "loading" })
  const [older, setOlder] = useState<{ query: string; state: ListState } | null>(null)
  const [filter, setFilter] = useState("")
  const [attempt, setAttempt] = useState(0)
  const owned = existingShow(state, show.id)
  const heading = useRef<HTMLHeadingElement>(null)
  const olderAbort = useRef<AbortController | null>(null)
  const device = useDeviceSave(onCreated)

  useEffect(() => heading.current?.focus(), [])
  useEffect(() => {
    const ac = new AbortController()
    client.showEpisodes(show.id, ac.signal).then(
      (r) => setRecent(r.ok ? { status: "done", list: r.data } : { status: "error", code: r.error.code, retryAfter: r.error.retryAfter }),
      () => {}
    )
    return () => ac.abort()
  }, [show.id, attempt])
  useEffect(() => () => olderAbort.current?.abort(), [])

  function searchOlder() {
    const q = filter.trim()
    if (q.length < 2) return
    olderAbort.current?.abort()
    const ac = new AbortController()
    olderAbort.current = ac
    setOlder({ query: q, state: { status: "loading" } })
    client.showEpisodes(show.id, ac.signal, q).then(
      (r) => setOlder({ query: q, state: r.ok ? { status: "done", list: r.data } : { status: "error", code: r.error.code, retryAfter: r.error.retryAfter } }),
      () => {}
    )
  }

  // «Seguir el programa»: its page opens once the show is stored on this device (M4-H1); a retry
  // only writes the device copy again.
  function saveShowOnly() {
    if (device.started()) return device.retry()
    if (owned) return device.begin(showHref(owned.id))
    const r = libraryActions.createShow(toShowInput(show))
    if (r.ok) device.begin(showHref(r.id))
  }

  const list = older ? older.state : recent
  const episodes = list.status === "done" ? list.list.episodes : []
  const ownedIds = useMemo(() => new Set(Object.values(state.items).flatMap((i) => (i.kind === "episode" && i.external?.provider === "itunes" ? [i.external.id] : []))), [state.items])
  const total = recent.status === "done" ? recent.list.total : show.episodeCount

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border px-5 pt-4 pb-3">
        {canGoBack && (
          <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onBack} disabled={device.locked} data-testid="episodes-back">
            <ArrowLeft aria-hidden /> Programas
          </Button>
        )}
        <div className="flex items-center gap-3">
          <div className="w-14 shrink-0">
            <CoverArt seed={show.id} title={show.title} kind="show" size="sm" cover={show.cover ? { source: "external", url: show.cover } : null} />
          </div>
          <div className="min-w-0 flex-1">
            <SheetTitle asChild>
              <h2 ref={heading} tabIndex={-1} className="truncate text-lg outline-none">
                {show.title}
              </h2>
            </SheetTitle>
            <SheetDescription className="truncate">{show.publisher ?? "Creador desconocido"}</SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {device.locked ? (
            <Button variant="outline" size="sm" onClick={saveShowOnly} disabled={device.waiting} aria-busy={device.waiting} data-testid="save-show">
              {device.waiting && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />}
              {device.waiting ? SAVING_LABEL : "Reintentar"}
            </Button>
          ) : owned ? (
            <Button asChild variant="outline" size="sm">
              <Link href={showHref(owned.id)} data-testid="open-show">
                En tu Biblioteca · abrir
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={saveShowOnly} data-testid="save-show">
              Seguir el programa
            </Button>
          )}
        </div>
        <div className="relative mt-2">
          <Label htmlFor={`${id}-f`} className="sr-only">
            Filtrar episodios
          </Label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
          <Input
            id={`${id}-f`}
            value={filter}
            onChange={(e) => (setFilter(e.target.value), setOlder(null))}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), searchOlder())}
            placeholder="Filtrar por título"
            autoComplete="off"
            inputMode="search"
            enterKeyHint="search"
            maxLength={100}
            className="h-11 pl-9"
            data-testid="episode-filter"
          />
        </div>
        <DeviceSaveNotice state={device.state} />
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" inert={device.locked}>
        {list.status === "loading" && <SkeletonRows />}
        {list.status === "error" && (
          <div className="space-y-2 px-2">
            <p role="alert" className="text-sm text-warning" data-testid="episodes-error">
              {errorText(list.code, list.retryAfter)}
            </p>
            {list.code !== "unauthorized" && (
              <Button variant="outline" size="sm" onClick={() => (older ? searchOlder() : (setRecent({ status: "loading" }), setAttempt((a) => a + 1)))}>
                Reintentar
              </Button>
            )}
          </div>
        )}
        {list.status === "done" && (
          <EpisodePicker
            key={older ? `older:${older.query}` : "recent"}
            episodes={episodes}
            filter={older ? "" : filter}
            heading={
              older
                ? `Resultados en Apple para «${older.query}», incluidos episodios anteriores`
                : total && total > episodes.length
                  ? `Los ${episodes.length} más recientes de ${total}. Si no está, búscalo abajo.`
                  : `${episodes.length} ${episodes.length === 1 ? "episodio" : "episodios"}`
            }
            timeZone={timeZone}
            ownedIds={ownedIds}
            onChoose={onChoose}
          />
        )}
        {list.status === "done" && filter.trim().length >= 2 && !older && (
          <Button variant="outline" className="mx-2 mt-3" onClick={searchOlder} data-testid="search-older">
            <Search aria-hidden /> Buscar episodios anteriores en Apple
          </Button>
        )}
        {older && (
          <Button variant="ghost" size="sm" className="mx-2 mt-3" onClick={() => setOlder(null)} data-testid="back-recent">
            Ver los recientes
          </Button>
        )}
        <p className="px-2 pt-3 text-xs text-text-tertiary">Datos: Apple Podcasts</p>
      </div>
      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        <Button variant={list.status === "error" ? "default" : "outline"} className="flex-1" onClick={() => onManual(filter.trim() || undefined)} disabled={device.locked} data-testid="add-manual-episode">
          <PenLine aria-hidden /> Añadir episodio manualmente
        </Button>
      </SheetFooter>
    </div>
  )
}

/**
 * The episode list: filtered as you type without blocking the field (deferred value), drawn
 * EPISODE_PAGE rows at a time, no images per row (the show's cover is above). Exported for the
 * development diagnostics (`/dev/podcasts`), which time it with synthetic data.
 */
export function EpisodePicker({
  episodes,
  filter,
  heading,
  timeZone,
  ownedIds,
  onChoose,
}: {
  episodes: EpisodeResult[]
  filter: string
  heading: string
  timeZone: string
  /** Apple ids of the episodes already in the Library. */
  ownedIds?: ReadonlySet<string>
  onChoose: (e: EpisodeResult) => void
}) {
  const deferred = useDeferredValue(filter)
  const filtered = useMemo(() => filterEpisodes(episodes, deferred), [episodes, deferred])
  const [shown, setShown] = useState({ filter: deferred, count: EPISODE_PAGE })
  // A new filter starts again from the first page (no effect: derived from the filter it belongs to).
  const count = shown.filter === deferred ? shown.count : EPISODE_PAGE
  const visible = filtered.slice(0, count)
  return (
    <div data-testid="episode-picker">
      <p role="status" aria-live="polite" className="px-2 pb-2 text-sm text-text-secondary" data-testid="episodes-status">
        {deferred.trim() ? (filtered.length ? `${filtered.length} de ${episodes.length} coinciden` : `Ninguno de estos ${episodes.length} coincide con «${deferred.trim()}».`) : heading}
      </p>
      {visible.length > 0 && (
        <ul aria-label="Episodios" className="space-y-1">
          {visible.map((e) => (
            <EpisodeRow key={e.id} episode={e} timeZone={timeZone} mine={ownedIds?.has(e.id) ?? false} onChoose={onChoose} />
          ))}
        </ul>
      )}
      {filtered.length > count && (
        <Button variant="ghost" className="mx-2 mt-2" onClick={() => setShown({ filter: deferred, count: count + EPISODE_PAGE })} data-testid="more-episodes">
          Mostrar {Math.min(EPISODE_PAGE, filtered.length - count)} más ({filtered.length - count} restantes)
        </Button>
      )}
    </div>
  )
}

/** One row; memoised, so typing in the filter redraws only what changed. */
const EpisodeRow = memo(function EpisodeRow({ episode: e, timeZone, mine, onChoose }: { episode: EpisodeResult; timeZone: string; mine: boolean; onChoose: (e: EpisodeResult) => void }) {
  const day = localDayOf(e.publishedAt, timeZone)
  return (
    <li>
      <button type="button" onClick={() => onChoose(e)} className="flex min-h-14 w-full flex-col items-start gap-0.5 rounded-xl px-2 py-2 text-left hover:bg-surface-raised/60" data-testid="episode-row">
        <span className="line-clamp-2 font-medium">{e.title}</span>
        <span className="text-xs text-text-tertiary">
          {[dayLabel(day), durationLabel(e.durationSeconds)].filter(Boolean).join(" · ") || "Sin fecha ni duración"}
          {mine && <span className="ml-2 text-signal">· En tu Biblioteca</span>}
        </span>
        {e.description && <span className="line-clamp-2 text-sm text-text-secondary">{e.description}</span>}
      </button>
    </li>
  )
})

// ---------- confirmation ----------

const FIELD_LABEL: Record<EpisodeField, string> = {
  title: "Título del episodio",
  creators: "Invitados",
  publishedOn: "Publicado",
  duration: "Duración",
  episodeNumber: "Nº de episodio",
  description: "Descripción",
  sourceUrl: "Enlace oficial",
}

const NEW_SHOW = "__new__"
const NO_SHOW = "__none__"

function ConfirmEpisode({
  show,
  episode,
  state,
  timeZone,
  onBack,
  onManual,
  onCreated,
}: {
  show: ShowResult
  episode: EpisodeResult
  state: KnowledgeState
  timeZone: string
  onBack: () => void
  onManual: () => void
  onCreated: (href: string) => void
}) {
  const id = useId()
  const f = (k: string) => `${id}-${k}`
  const owned = existingShow(state, show.id)
  const [draft, setDraft] = useState<EpisodeDraft>(() => createEpisodeDraft(episode, timeZone, show.cover))
  const [program, setProgram] = useState<string>(owned?.id ?? NEW_SHOW)
  const [status, setStatus] = useState<ContentStatus>("planned")
  const [rating, setRating] = useState<number | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [errors, setErrors] = useState<EpisodeErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const device = useDeviceSave((episodeId) => onCreated(itemHref(episodeId)))
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])

  const localShowId = program === NEW_SHOW ? (owned?.id ?? null) : program === NO_SHOW ? null : program
  // The episode just written is not a duplicate of itself while its device copy is awaited.
  const matches = findEpisodeMatches(state, { id: episode.id, localShowId, title: draft.values.title }).filter((m) => m.id !== device.written)
  const exact = matches.find((m) => m.level === "exact")
  // A show written by hand with the same name: only a warning, the user picks it if it is the same.
  const manualTwin = owned ? null : findShowMatches(state, show).find((m) => m.level === "possible")
  const twin = manualTwin ? state.shows[manualTwin.id] : null
  const otherShows = Object.values(state.shows)
    .filter((s) => s.id !== owned?.id)
    .sort((a, b) => a.title.localeCompare(b.title, "es"))
  const edit = (field: EpisodeField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => (setErrors((x) => ({ ...x, [field]: undefined })), setDraft((d) => editEpisodeField(d, field, e.target.value)))

  function save() {
    // Already written: only the device copy is awaited or retried, never a second create.
    if (device.started()) return device.retry()
    setFailure(null)
    const errs = episodeDraftErrors(draft)
    setErrors(errs)
    const first = Object.keys(errs)[0]
    if (first) return document.getElementById(f(first))?.focus()
    if (exact) return setFailure("Este episodio ya está en tu Biblioteca.")
    let showId: string | null = localShowId
    // The show is created only when it is not there yet (a retry after a failure finds it).
    if (program === NEW_SHOW && !showId) {
      const s = libraryActions.createShow(toShowInput(show))
      if (!s.ok) return setFailure(refusalText(s.error))
      showId = s.id
    }
    const r = libraryActions.createItem("episode", episodeDraftInput(draft, showId, { status, rating, favorite }))
    if (!r.ok) {
      if (showId && program === NEW_SHOW) setProgram(showId)
      return setFailure(refusalText(r.error))
    }
    // One device write holds both, in queue order: the show before its episode (M4-H1).
    device.begin(r.id)
  }

  const field = (k: EpisodeField, extra: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={f(k)}>{FIELD_LABEL[k]}</Label>
      <Input id={f(k)} value={draft.values[k]} onChange={edit(k)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? f(`${k}-err`) : undefined} {...extra} />
      {errors[k] && (
        <p id={f(`${k}-err`)} className="text-xs text-warning">
          {errors[k]}
        </p>
      )}
    </div>
  )
  const top = exact ?? matches[0]
  const topItem = top ? state.items[top.id] : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border px-5 pt-4 pb-3">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onBack} disabled={device.locked} data-testid="confirm-back">
          <ArrowLeft aria-hidden /> Episodios
        </Button>
        <SheetTitle asChild>
          <h2 ref={heading} tabIndex={-1} className="text-lg outline-none">
            Revisa y añade
          </h2>
        </SheetTitle>
        <SheetDescription>Todo es editable. Lo que Apple no da queda vacío.</SheetDescription>
      </SheetHeader>
      {/* Locked while written: nothing in it may write it again or open another page first. */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5" data-testid="episode-confirm" inert={device.locked}>
        <div className="flex gap-4">
          <div className="w-24 shrink-0 space-y-2">
            <CoverArt seed={episode.id} title={draft.values.title || "Sin título"} kind="episode" cover={draft.useCover && draft.cover ? { source: "external", url: draft.cover } : null} />
            {draft.cover && (
              <label className="flex min-h-11 items-center gap-2 text-xs">
                <input type="checkbox" checked={draft.useCover} onChange={(e) => setDraft((d) => ({ ...d, useCover: e.target.checked }))} className="size-5 accent-[var(--color-signal)]" data-testid="use-cover" />
                Usar esta imagen
              </label>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor={f("program")}>Programa</Label>
            <select id={f("program")} value={program} onChange={(e) => setProgram(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm" data-testid="confirm-program">
              {owned ? <option value={owned.id}>{owned.title} (en tu Biblioteca)</option> : <option value={NEW_SHOW}>{show.title} (nuevo)</option>}
              {otherShows.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
              <option value={NO_SHOW}>Sin programa</option>
            </select>
            {twin && program === NEW_SHOW && (
              <div className="space-y-2 rounded-xl border border-signal/40 bg-signal/5 p-3 text-xs" role="status" data-testid="show-twin">
                <p>Ya tienes un programa «{twin.title}» creado a mano. ¿Es el mismo?</p>
                <Button size="sm" variant="outline" onClick={() => setProgram(twin.id)} data-testid="use-twin">
                  Usar «{twin.title}»
                </Button>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {field("title", { maxLength: 300, "data-testid": "confirm-title" } as React.ComponentProps<typeof Input>)}
          {field("creators", { placeholder: "Separados por comas" })}
          <div className="grid grid-cols-2 gap-3">
            {field("publishedOn", { type: "date", "data-testid": "confirm-date" } as React.ComponentProps<typeof Input>)}
            {field("duration", { placeholder: "45 o 1:02:30", className: "num", "data-testid": "confirm-duration" } as React.ComponentProps<typeof Input>)}
          </div>
          {field("episodeNumber", { inputMode: "numeric", className: "num" })}
          <div className="space-y-1.5">
            <Label htmlFor={f("description")}>{FIELD_LABEL.description}</Label>
            <Textarea id={f("description")} value={draft.values.description} onChange={edit("description")} rows={4} disabled={!draft.keepDescription} data-testid="confirm-description" />
            {draft.values.description && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.keepDescription} onChange={(e) => setDraft((d) => ({ ...d, keepDescription: e.target.checked }))} className="size-5 accent-[var(--color-signal)]" />
                Guardar la descripción
              </label>
            )}
          </div>
          {field("sourceUrl", { inputMode: "url", placeholder: "https://", "data-testid": "confirm-url" } as React.ComponentProps<typeof Input>)}
        </div>
        <div className="space-y-4 rounded-2xl border border-border p-4">
          <p className="text-sm font-medium">Tu escucha</p>
          <div className="space-y-1.5">
            <Label htmlFor={f("status")}>Estado</Label>
            <select id={f("status")} value={status} onChange={(e) => setStatus(e.target.value as ContentStatus)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm" data-testid="confirm-status">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL.episode[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Valoración (opcional)</p>
            <RatingInput value={rating} onChange={setRating} />
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} className="size-5 accent-[var(--color-signal)]" data-testid="confirm-favorite" />
            Favorito
          </label>
        </div>
        <p className="text-xs text-text-tertiary">
          {episode.attribution}
          {episode.sourceUrl && (
            <>
              {" · "}
              <a href={episode.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                ver en Apple Podcasts <ExternalLink className="inline size-3" aria-hidden />
              </a>
            </>
          )}
        </p>
        {top && topItem && (
          <div role="status" className="space-y-3 rounded-2xl border border-signal/40 bg-signal/5 p-4 text-sm" data-testid="duplicate" data-level={top.level}>
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
              {top.level === "exact" ? `Este episodio ya está en tu Biblioteca: «${topItem.title}».` : `Puede que ya lo tengas: «${topItem.title}» en el mismo programa.`}
            </p>
            <Button asChild variant={top.level === "exact" ? "default" : "outline"} size="sm">
              <Link href={itemHref(topItem.id)} data-testid="open-existing">
                Abrir el existente
              </Link>
            </Button>
          </div>
        )}
        {failure && (
          <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" data-testid="confirm-error">
            {failure}
          </p>
        )}
      </div>
      {device.state && (
        <div className="px-5 pt-3">
          <DeviceSaveNotice state={device.state} />
        </div>
      )}
      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        <Button variant="ghost" onClick={onManual} disabled={device.locked} data-testid="confirm-manual">
          <PenLine aria-hidden /> Manual
        </Button>
        <Button className="flex-1" onClick={save} disabled={device.waiting || !!exact} aria-disabled={device.waiting || !!exact} aria-busy={device.waiting} data-testid="confirm-save">
          {device.waiting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {device.waiting ? SAVING_LABEL : device.state === "failed" ? "Reintentar" : matches.length && !exact ? "Añadir igualmente" : "Añadir episodio"}
        </Button>
      </SheetFooter>
    </div>
  )
}

