"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ArrowLeft, CloudOff, Loader2, Search } from "lucide-react"
import { toast } from "sonner"
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useHabits } from "@/features/habits/store/habit-store"
import type { ItemPatch, ShowInput } from "@/features/knowledge/domain/ops"
import { cn } from "@/lib/utils"
import type { ContentKind, CoverRef, KnowledgeState } from "@/features/knowledge/domain/types"
import { metadataClient } from "../metadata/client"
import { defaultSelection, diffTarget, directLookup, patchOf, staleFields, updateLabel, withDetail, type DiffField, type DiffRow, type Lookup, type Proposal, type UpdateTarget } from "../metadata/diff"
import { cleanQuery } from "../metadata/query"
import { createSearchController, type SearchState } from "../metadata/search-controller"
import { showResultOf } from "../metadata/to-input"
import type { BookResult, EpisodeResult, MetadataErrorCode, MetadataResponse, ShowResult } from "../metadata/types"
import { libraryActions } from "../store/use-library"
import { AssistantSheet, OFFLINE_TEXT, searchErrorText } from "./assistant-ui"
import { DeviceSaveNotice, SAVING_LABEL, useDeviceSave } from "./device-save"
import { refusalText } from "./knowledge-notes"
import { CoverArt } from "./library-ui"

/**
 * «Buscar datos» / «Actualizar datos» of something already saved (M4g.5, docs/m4g-plan.md §5.13 y
 * §6.6). Finds it on the provider, shows a comparison field by field (metadata/diff.ts) and applies
 * only what is marked, in one update through the same operations as any edit: queue, device copy,
 * sync and conflicts are the usual ones. Nothing is refreshed on its own.
 */
const client = metadataClient()

const NOT_FOUND = { ok: false, error: { code: "not_found" } } as const

type Step =
  | { name: "lookup"; lookup: Lookup }
  | { name: "search" }
  | { name: "episodes"; show: ShowResult }
  | { name: "detail"; chosen: BookResult }
  | { name: "compare"; proposal: Proposal; note: string | null; back: Step | null }

function recordOf(state: KnowledgeState, target: UpdateTarget) {
  if (target.entity === "show") return Object.hasOwn(state.shows, target.id) ? state.shows[target.id] : null
  return Object.hasOwn(state.items, target.id) ? state.items[target.id] : null
}

/** An episode of a show that came from Apple starts at that show's episodes. */
function searchStep(state: KnowledgeState, target: UpdateTarget): Step {
  const r = target.entity === "item" ? recordOf(state, target) : null
  const show = r && "kind" in r && r.kind === "episode" && r.episode.showId ? state.shows[r.episode.showId] : undefined
  const apple = show ? showResultOf(show) : null
  return apple ? { name: "episodes", show: apple } : { name: "search" }
}

async function fetchLookup(lookup: Lookup, title: string, signal: AbortSignal): Promise<MetadataResponse<Proposal>> {
  if (lookup.kind === "book") {
    const r = await client.bookDetail(lookup.work, lookup.edition, signal)
    return r.ok ? { ok: true, data: { kind: "book", result: r.data } } : r
  }
  const r = await client.showEpisodes(lookup.kind === "show" ? lookup.id : lookup.show, signal, lookup.kind === "episode" ? title : undefined)
  if (!r.ok) return r
  if (lookup.kind === "show") return r.data.show ? { ok: true, data: { kind: "show", result: r.data.show } } : NOT_FOUND
  const found = r.data.episodes.find((e) => e.id === lookup.id)
  return found ? { ok: true, data: { kind: "episode", result: found } } : NOT_FOUND
}

const bookQuery = (isbn13: string | null, isbn10: string | null, title: string) => isbn13 ?? isbn10 ?? title
const yearOf = (b: BookResult) => b.year ?? b.firstPublishedYear
const providerOf = (kind: ContentKind | "show") => (kind === "book" ? "Open Library" : "Apple Podcasts")

export function MetadataUpdateSheet({ open, onOpenChange, target, state }: { open: boolean; onOpenChange: (v: boolean) => void; target: UpdateTarget; state: KnowledgeState }) {
  const habits = useHabits()
  const timeZone = habits?.state.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <AssistantSheet open={open} onOpenChange={onOpenChange} testId="metadata-update-sheet">
      {({ close }) => <Flow target={target} state={state} timeZone={timeZone} onClose={close} />}
    </AssistantSheet>
  )
}

function Flow({ target, state, timeZone, onClose }: { target: UpdateTarget; state: KnowledgeState; timeZone: string; onClose: () => void }) {
  const [step, setStep] = useState<Step>(() => {
    const lookup = directLookup(state, target)
    return lookup ? { name: "lookup", lookup } : searchStep(state, target)
  })
  const record = recordOf(state, target)
  if (!record) return null
  const kind: ContentKind | "show" = "kind" in record ? record.kind : "show"
  const heading = updateLabel(record)
  const provider = providerOf(kind)
  const compare = (proposal: Proposal, back: Step | null, note: string | null = null) => setStep({ name: "compare", proposal, note, back })
  const toSearch = () => setStep(searchStep(state, target))

  if (step.name === "lookup")
    return <Loading key="lookup" heading={heading} load={(signal) => fetchLookup(step.lookup, cleanQuery(record.title), signal)} provider={provider} onData={(p) => compare(p, null)} onSearch={toSearch} />

  if (step.name === "detail")
    return (
      <Loading
        key="detail"
        heading={heading}
        provider={provider}
        load={(signal) => client.bookDetail(step.chosen.workId!, step.chosen.editionId, signal)}
        onData={(detail) => compare({ kind: "book", result: withDetail(step.chosen, detail) }, { name: "search" })}
        onFailed={() => compare({ kind: "book", result: step.chosen }, { name: "search" }, "No se pudieron traer más datos: se compara con lo que dio la búsqueda.")}
      />
    )

  if (step.name === "compare") return <Compare key={JSON.stringify(step.proposal.result)} heading={heading} target={target} state={state} timeZone={timeZone} proposal={step.proposal} note={step.note} provider={provider} onBack={step.back ? () => setStep(step.back!) : toSearch} canSearch={!step.back} onClose={onClose} />

  if (step.name === "episodes") {
    const show = step.show
    return (
      <Picker<EpisodeResult>
        key={`episodes-${show.id}`}
        heading={heading}
        description={`Elige el episodio en ${show.title}.`}
        label="Título del episodio"
        initial={record.title}
        provider={provider}
        run={async (q, signal) => {
          const r = await client.showEpisodes(show.id, signal, q)
          return r.ok ? { ok: true, data: r.data.episodes } : r
        }}
        view={(e) => ({ key: e.id, title: e.title, line: e.showTitle, meta: e.publishedAt?.slice(0, 10) ?? null, cover: e.cover, seed: e.id, kind: "episode" })}
        onChoose={(result) => compare({ kind: "episode", result }, step)}
      />
    )
  }

  if (kind === "book") {
    const b = "book" in record ? record.book : null
    return (
      <Picker<BookResult>
        key="books"
        heading={heading}
        description="Busca la edición que tienes; compararás sus datos antes de cambiar nada."
        label="Título, autor o ISBN"
        initial={bookQuery(b?.isbn13 ?? null, b?.isbn10 ?? null, record.title)}
        provider={provider}
        run={(q, signal) => client.searchBooks(q, signal, { by: "any", lang: "es" })}
        view={(r) => ({ key: `${r.workId}-${r.editionId}`, title: r.title, line: (r.creators ?? []).join(", ") || "Autor desconocido", meta: [yearOf(r), r.publisher].filter(Boolean).join(" · ") || null, cover: r.cover, seed: r.workId ?? r.title, kind: "book" })}
        onChoose={(r) => (r.workId ? setStep({ name: "detail", chosen: r }) : compare({ kind: "book", result: r }, { name: "search" }))}
      />
    )
  }

  const showTitle = "kind" in record && record.kind === "episode" && record.episode.showId ? state.shows[record.episode.showId]?.title : undefined
  return (
    <Picker<ShowResult>
      key="shows"
      heading={heading}
      description={kind === "show" ? "Busca este programa; compararás sus datos antes de cambiar nada." : "Busca su programa y después elige el episodio."}
      label="Programa o creador"
      initial={showTitle ?? record.title}
      provider={provider}
      run={(q, signal) => client.searchShows(q, signal)}
      view={(s) => ({ key: s.id, title: s.title, line: s.publisher ?? "Creador desconocido", meta: s.episodeCount ? `${s.episodeCount} episodios` : null, cover: s.cover, seed: s.id, kind: "show" })}
      onChoose={(result) => (kind === "show" ? compare({ kind: "show", result }, { name: "search" }) : setStep({ name: "episodes", show: result }))}
    />
  )
}

// ---------- a request, then the next step ----------

function Loading<T>({ heading, load, provider, onData, onFailed, onSearch }: { heading: string; load: (signal: AbortSignal) => Promise<MetadataResponse<T>>; provider: string; onData: (data: T) => void; onFailed?: () => void; onSearch?: () => void }) {
  const [error, setError] = useState<{ code: MetadataErrorCode; retryAfter?: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef({ load, onData, onFailed })
  useEffect(() => {
    latest.current = { load, onData, onFailed }
  })
  useEffect(() => {
    const ac = new AbortController()
    latest.current.load(ac.signal).then(
      (r) => {
        if (r.ok) return latest.current.onData(r.data)
        if (latest.current.onFailed) return latest.current.onFailed()
        setError(r.error)
      },
      () => {}
    )
    return () => ac.abort()
  }, [attempt])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
        <SheetTitle className="text-lg">{heading}</SheetTitle>
        <SheetDescription>Datos de {provider}. Nada cambia hasta que lo apliques.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5">
        {error ? (
          <>
            <p role="alert" className="text-sm text-warning" data-testid="update-lookup-error">
              {error.code === "not_found" ? `No se ha encontrado en ${provider}. Puedes buscarlo tú.` : searchErrorText(error.code, provider, error.retryAfter)}
            </p>
            <div className="flex flex-wrap gap-2">
              {error.code !== "not_found" && error.code !== "unauthorized" && (
                <Button variant="outline" onClick={() => (setError(null), setAttempt((a) => a + 1))} data-testid="update-lookup-retry">
                  Reintentar
                </Button>
              )}
              {onSearch && (
                <Button variant="outline" onClick={onSearch} data-testid="update-lookup-search">
                  <Search aria-hidden /> Buscar
                </Button>
              )}
            </div>
          </>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-text-secondary" data-testid="update-loading">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Buscando…
          </p>
        )}
      </div>
    </div>
  )
}

// ---------- search and choose ----------

interface PickerRow {
  key: string
  title: string
  line: string | null
  meta: string | null
  cover: string | null
  seed: string
  kind: ContentKind | "show"
}

function Picker<T>({ heading, description, label, initial, provider, run, view, onChoose }: { heading: string; description: string; label: string; initial: string; provider: string; run: (q: string, signal: AbortSignal) => Promise<MetadataResponse<T[]>>; view: (r: T) => PickerRow; onChoose: (r: T) => void }) {
  const id = useId()
  // A long title is cut as the server cuts it, so it is searched instead of refused.
  const [text, setText] = useState(() => cleanQuery(initial))
  const [search, setSearch] = useState<SearchState<T[]>>({ status: "idle" })
  const controller = useRef<ReturnType<typeof createSearchController<T[]>> | null>(null)
  const latest = useRef({ run, initial })
  useEffect(() => {
    latest.current = { run, initial }
  })
  useEffect(() => {
    const c = createSearchController<T[]>({ run: (q, signal) => latest.current.run(q, signal), onChange: setSearch })
    controller.current = c
    c.search(cleanQuery(latest.current.initial))
    return () => c.dispose()
  }, [])

  const trimmed = text.trim()
  const current = "query" in search && search.query === trimmed
  const results = current && search.status === "done" ? search.data : null
  const busy = current && (search.status === "waiting" || search.status === "loading")
  const failed = current && (search.status === "error" || search.status === "offline")

  let status = ""
  if (busy) status = "Buscando…"
  else if (results) status = results.length === 0 ? `Sin resultados para «${trimmed}».` : `${results.length} ${results.length === 1 ? "resultado" : "resultados"}`
  else if (current && search.status === "error") status = searchErrorText(search.code, provider, search.retryAfter)
  else if (current && search.status === "offline") status = OFFLINE_TEXT

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
        <SheetTitle className="text-lg">{heading}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
        <form role="search" aria-label={`Buscar en ${provider}`} className="relative mt-3" onSubmit={(e) => (e.preventDefault(), controller.current?.retry())}>
          <Label htmlFor={`${id}-q`} className="sr-only">
            {label}
          </Label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
          <Input id={`${id}-q`} value={text} onChange={(e) => (setText(e.target.value), controller.current?.search(e.target.value))} placeholder={label} autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="search" enterKeyHint="search" maxLength={100} aria-describedby={`${id}-status`} className="h-12 pr-10 pl-9 text-base" data-testid="update-search" />
          {busy && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-text-tertiary motion-reduce:animate-none" aria-hidden />}
        </form>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p id={`${id}-status`} role="status" aria-live="polite" className={cn("px-2 pb-2 text-sm", failed ? "text-warning" : "text-text-secondary")} data-testid="update-search-status">
          {current && search.status === "offline" && <CloudOff className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />}
          {status}
        </p>
        {current && search.status === "error" && search.code !== "unauthorized" && (
          <Button variant="outline" size="sm" className="mx-2 mb-2" onClick={() => controller.current?.retry()} data-testid="update-search-retry">
            Reintentar
          </Button>
        )}
        {results && results.length > 0 && (
          <ul aria-label="Resultados" className="space-y-1">
            {results.map((r) => {
              const v = view(r)
              return (
                <li key={v.key}>
                  <button type="button" onClick={() => onChoose(r)} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-raised/60" data-testid="update-result">
                    <span className="w-10 shrink-0">
                      <CoverArt seed={v.seed} title={v.title} kind={v.kind} size="sm" cover={v.cover ? { source: "external", url: v.cover } : null} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{v.title}</span>
                      {v.line && <span className="block truncate text-sm text-text-secondary">{v.line}</span>}
                      {v.meta && <span className="block truncate text-xs text-text-tertiary">{v.meta}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="px-2 pt-3 text-xs text-text-tertiary">Datos: {provider}</p>
      </div>
    </div>
  )
}

// ---------- the comparison ----------

function Compare({ heading, target, state, timeZone, proposal, note, provider, onBack, canSearch, onClose }: { heading: string; target: UpdateTarget; state: KnowledgeState; timeZone: string; proposal: Proposal; note: string | null; provider: string; onBack: () => void; canSearch: boolean; onClose: () => void }) {
  // What was shown stays as it was until «Aplicar» compares it with the record: a value must not change under the reader.
  const [shown, setShown] = useState<DiffRow[]>(() => diffTarget(state, target, proposal, timeZone) ?? [])
  const [selected, setSelected] = useState<Set<DiffField>>(() => defaultSelection(shown))
  const [message, setMessage] = useState<{ text: string; testId: string } | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const device = useDeviceSave(() => {
    onClose()
    toast.success("Datos actualizados")
  })
  useEffect(() => title.current?.focus(), [])

  const count = shown.filter((r) => selected.has(r.field) && !r.blocked).length

  function toggle(field: DiffField, on: boolean) {
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(field)
      else next.delete(field)
      return next
    })
  }

  function apply() {
    // Already written: only the device copy is awaited or retried, never a second update.
    if (device.started()) return device.retry()
    setMessage(null)
    const fresh = diffTarget(state, target, proposal, timeZone)
    if (!fresh) return setMessage({ text: "Ya no está en tu Biblioteca: se eliminó mientras lo revisabas.", testId: "update-error" })
    if (staleFields(shown, fresh, selected).length > 0) {
      setShown(fresh)
      setSelected(defaultSelection(fresh))
      return setMessage({ text: "Esta ficha ha cambiado mientras la revisabas. No se ha aplicado nada: comprueba de nuevo lo marcado.", testId: "update-stale" })
    }
    const patch = patchOf(shown, selected)
    const r = target.entity === "show" ? libraryActions.updateShow(target.id, patch as Partial<ShowInput>) : libraryActions.updateItem(target.id, patch as ItemPatch)
    if (!r.ok) return setMessage({ text: refusalText(r.error), testId: "update-error" })
    device.begin(target.id)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border px-5 pt-4 pb-3">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onBack} disabled={device.locked} data-testid="update-back">
          {canSearch ? <Search aria-hidden /> : <ArrowLeft aria-hidden />} {canSearch ? "Buscar otro" : "Resultados"}
        </Button>
        <SheetTitle asChild>
          <h2 ref={title} tabIndex={-1} className="text-lg outline-none">
            {heading} · {provider}
          </h2>
        </SheetTitle>
        <SheetDescription>Lo vacío viene marcado. Lo que ya tiene otro valor solo cambia si lo marcas.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5" inert={device.locked}>
        {note && (
          <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" data-testid="update-note">
            {note}
          </p>
        )}
        {shown.length === 0 ? (
          <p className="text-sm text-text-secondary" data-testid="update-none">
            Todo coincide con {provider}: no hay nada que actualizar.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Datos para comparar">
            {shown.map((r) => (
              <Row key={r.field} row={r} checked={selected.has(r.field) && !r.blocked} seed={target.id} onChange={(on) => toggle(r.field, on)} />
            ))}
          </ul>
        )}
        {message && (
          <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" data-testid={message.testId}>
            {message.text}
          </p>
        )}
      </div>
      {device.state && (
        <div className="px-5 pt-3">
          <DeviceSaveNotice state={device.state} />
        </div>
      )}
      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        {shown.length === 0 ? (
          <Button variant="outline" className="flex-1" onClick={onClose} data-testid="update-close">
            Cerrar
          </Button>
        ) : (
          <Button className="flex-1" onClick={apply} disabled={device.waiting || (count === 0 && !device.started())} aria-busy={device.waiting} data-testid="update-apply">
            {device.waiting ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {device.waiting ? SAVING_LABEL : device.state === "failed" ? "Reintentar" : count === 1 ? "Aplicar 1 cambio" : `Aplicar ${count} cambios`}
          </Button>
        )}
      </SheetFooter>
    </div>
  )
}

function Row({ row, checked, seed, onChange }: { row: DiffRow; checked: boolean; seed: string; onChange: (on: boolean) => void }) {
  const id = useId()
  return (
    <li className="rounded-2xl border border-border p-3" data-testid={`update-row-${row.field}`} data-kind={row.kind}>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
        <input type="checkbox" checked={checked} disabled={!!row.blocked} onChange={(e) => onChange(e.target.checked)} aria-describedby={id} className="size-5 shrink-0 accent-[var(--color-signal)]" />
        {row.label}
      </label>
      <div id={id} className="mt-1 space-y-1 pl-8 text-sm">
        {row.preview ? (
          <div className="flex items-end gap-3">
            <Thumb label="Ahora" seed={`${seed}-now`} cover={row.preview.current} />
            <Thumb label="Propuesta" seed={`${seed}-new`} cover={row.preview.proposed} />
          </div>
        ) : (
          <>
            <Value label="Ahora" value={row.current} />
            <Value label="Propuesta" value={row.proposed} />
          </>
        )}
        {row.blocked && (
          <p className="text-xs text-warning" data-testid="update-blocked">
            {row.blocked}
          </p>
        )}
      </div>
    </li>
  )
}

function Value({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="line-clamp-3 break-words text-text-secondary">
      <span className="text-text-tertiary">{label}: </span>
      {value ?? "vacío"}
    </p>
  )
}

function Thumb({ label, seed, cover }: { label: string; seed: string; cover: CoverRef | null }) {
  return (
    <span className="w-14 space-y-1">
      <CoverArt seed={seed} title={label} kind="book" size="sm" cover={cover} />
      <span className="block text-xs text-text-tertiary">{label}</span>
    </span>
  )
}
