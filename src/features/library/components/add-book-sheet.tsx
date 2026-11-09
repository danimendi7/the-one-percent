"use client"

import Link from "next/link"
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, Check, CloudOff, ExternalLink, Loader2, PenLine, Search } from "lucide-react"
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { compactIsbn } from "@/features/knowledge/domain/text"
import { STATUSES, STATUS_LABEL, type ContentStatus, type KnowledgeState } from "@/features/knowledge/domain/types"
import { applyDetail, applyEdition, createDraft, draftErrors, draftResult, editField, setKeepDescription, setUseCover, type BookDraft, type DraftErrors, type DraftField } from "../metadata/book-draft"
import { metadataClient } from "../metadata/client"
import { findBookMatches, type Match } from "../metadata/duplicates"
import { clearAssistantDraft, draftStorage } from "../metadata/assistant-draft"
import { detectIsbn } from "../metadata/query"
import { createSearchController, type SearchState } from "../metadata/search-controller"
import { toBookInput } from "../metadata/to-input"
import type { BookResult, MetadataErrorCode } from "../metadata/types"
import { libraryActions } from "../store/use-library"
import { RecoverDraft, useAssistantDraft } from "./assistant-draft-ui"
import { AssistantSheet, OFFLINE_TEXT, searchErrorText } from "./assistant-ui"
import { DeviceSaveNotice, SAVING_LABEL, useDeviceSave } from "./device-save"
import { refusalText } from "./knowledge-notes"
import { CoverArt, itemHref, RatingInput } from "./library-ui"

/**
 * «Añadir libro» with an account (M4g.3, docs/m4g-plan.md §17): search Open Library through the
 * app's own server (M4g.1), pick the work and, when there are several, the edition, review every
 * field and save with the same operation as a manual entry (queue, device copy, sync, conflicts).
 * Manual entry is one tap away at every step and keeps what was typed. Covers never block (D97).
 */
type By = "any" | "title" | "author"
const BY_OPTIONS: { value: By; label: string }[] = [
  { value: "any", label: "Todo" },
  { value: "title", label: "Título" },
  { value: "author", label: "Autor" },
]

const client = metadataClient()

/** 10 or 13 digits typed as an ISBN whose check digit fails: said, not searched. */
function invalidIsbn(text: string): boolean {
  const v = compactIsbn(text.trim())
  return /^\d{9}[\dX]$|^\d{13}$/.test(v) && !detectIsbn(v)
}

const yearOf = (b: BookResult) => b.year ?? b.firstPublishedYear
const LANGUAGE: Record<string, string> = { es: "Español", en: "Inglés", fr: "Francés", de: "Alemán", it: "Italiano", pt: "Portugués", ca: "Catalán", eu: "Euskera", gl: "Gallego" }
const languageName = (code: string | null) => (code ? (LANGUAGE[code] ?? code.toUpperCase()) : null)

const errorText = (code: MetadataErrorCode, retryAfter?: number) => searchErrorText(code, "Open Library", retryAfter)

/** What a reload must not lose (M4g.5, D102). */
type ConfirmDraft = { draft: BookDraft; detailDone: boolean; status: ContentStatus; rating: number | null; favorite: boolean; topics: string[]; separate: boolean }
type AssistantDraft = { text: string; by: By; chosen: BookResult | null; confirm: ConfirmDraft | null }
const worthKeeping = (d: AssistantDraft) => d.text.trim() !== "" || d.chosen !== null

export function AddBookSheet({
  open,
  onOpenChange,
  state,
  userId,
  onManual,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  state: KnowledgeState
  /** Whose draft this is (D102). */
  userId: string | null
  /** Manual entry with what was typed (title, or the ISBN). */
  onManual: (draft: { title?: string; isbn?: string }) => void
  onCreated: (id: string) => void
}) {
  return (
    <AssistantSheet open={open} onOpenChange={onOpenChange} testId="add-book-sheet" onDiscard={() => userId && clearAssistantDraft(draftStorage(), "book", userId)}>
      {({ setDirty, close }) => <Assistant state={state} userId={userId} onDirty={setDirty} onManual={(d) => (close(), onManual(d))} onCreated={(id) => (close(), onCreated(id))} />}
    </AssistantSheet>
  )
}

type AssistantProps = { state: KnowledgeState; onDirty: (v: boolean) => void; onManual: (d: { title?: string; isbn?: string }) => void; onCreated: (id: string) => void }

function Assistant({ userId, ...props }: AssistantProps & { userId: string | null }) {
  const drafts = useAssistantDraft<AssistantDraft>("book", userId, worthKeeping)
  if (drafts.offer) return <RecoverDraft title="Añadir libro" what={drafts.offer.chosen?.title ?? drafts.offer.text.trim()} onRecover={drafts.recover} onStartOver={drafts.startOver} />
  return <AssistantBody {...props} initial={drafts.restored} persist={drafts.persist} onCreated={(id) => (drafts.clear(), props.onCreated(id))} />
}

function AssistantBody({ state, initial, persist, onDirty, onManual, onCreated }: AssistantProps & { initial: AssistantDraft | null; persist: (d: AssistantDraft) => void }) {
  const [text, setText] = useState(initial?.text ?? "")
  const [by, setBy] = useState<By>(initial?.by ?? "any")
  const [search, setSearch] = useState<SearchState<BookResult[]>>({ status: "idle" })
  const [chosen, setChosen] = useState<BookResult | null>(initial?.chosen ?? null)
  const [confirm, setConfirm] = useState<ConfirmDraft | null>(initial?.confirm ?? null)
  const controller = useRef<ReturnType<typeof createSearchController<BookResult[]>> | null>(null)
  // What is typed, for the new controller when «by» changes (written in the handler, not on render).
  const typed = useRef(initial?.text ?? "")

  // One controller per «by»: its session cache is per kind of search. Disposed on close.
  useEffect(() => {
    const c = createSearchController<BookResult[]>({ run: (q, signal) => client.searchBooks(q, signal, { by, lang: "es" }), onChange: setSearch })
    controller.current = c
    const t = typed.current
    if (t.trim() && !invalidIsbn(t)) c.search(t)
    return () => c.dispose()
  }, [by])

  useEffect(() => onDirty(text.trim() !== "" || chosen !== null), [text, chosen, onDirty])
  // Layout effects: the draft is written in the same task that shows the change, so a reload cannot beat it (D102).
  useLayoutEffect(() => persist({ text, by, chosen, confirm: chosen ? confirm : null }), [text, by, chosen, confirm, persist])

  const manual = () => {
    const isbn = detectIsbn(text) ?? (invalidIsbn(text) ? compactIsbn(text) : null)
    onManual(isbn ? { isbn } : text.trim() ? { title: text.trim() } : {})
  }

  if (chosen)
    return <Confirm key={chosen.editionId ?? chosen.workId ?? chosen.title} result={chosen} state={state} initial={confirm} onChange={setConfirm} onBack={() => (setChosen(null), setConfirm(null))} onManual={manual} onCreated={onCreated} />

  return (
    <SearchStep
      text={text}
      by={by}
      search={search}
      state={state}
      onText={(t) => {
        typed.current = t
        setText(t)
        if (invalidIsbn(t)) controller.current?.search("")
        else controller.current?.search(t)
      }}
      onBy={setBy}
      onRetry={() => controller.current?.retry()}
      onChoose={setChosen}
      onManual={manual}
    />
  )
}

// ---------- search ----------

function SearchStep({
  text,
  by,
  search,
  state,
  onText,
  onBy,
  onRetry,
  onChoose,
  onManual,
}: {
  text: string
  by: By
  search: SearchState<BookResult[]>
  state: KnowledgeState
  onText: (t: string) => void
  onBy: (b: By) => void
  onRetry: () => void
  onChoose: (r: BookResult) => void
  onManual: () => void
}) {
  const id = useId()
  const [active, setActive] = useState(-1)
  const trimmed = text.trim()
  const badIsbn = invalidIsbn(text)
  // Only answers to what is typed now are shown: never an older search over a newer one.
  const current = "query" in search && search.query === trimmed
  const results = current && search.status === "done" ? search.data : null
  const busy = current && (search.status === "waiting" || search.status === "loading")
  const matches = useMemo(() => new Map((results ?? []).map((r) => [r, findBookMatches(state, r)[0] as Match | undefined])), [results, state])
  const optionId = (i: number) => `${id}-r${i}`

  let status = ""
  if (badIsbn) status = "Ese ISBN no es válido: revisa las cifras."
  else if (busy) status = "Buscando…"
  else if (results) status = results.length === 0 ? `Sin resultados para «${trimmed}».` : `${results.length} ${results.length === 1 ? "resultado" : "resultados"}`
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
        <SheetTitle className="text-lg">Añadir libro</SheetTitle>
        <SheetDescription className="max-md:sr-only">Busca por título, autor o ISBN. Revisarás los datos antes de guardarlo.</SheetDescription>
        <form role="search" aria-label="Buscar libros" className="mt-3 space-y-3" onSubmit={(e) => (e.preventDefault(), onRetry())}>
          <div className="relative">
            <Label htmlFor={`${id}-q`} className="sr-only">
              Título, autor o ISBN
            </Label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <Input
              id={`${id}-q`}
              value={text}
              onChange={(e) => (setActive(-1), onText(e.target.value))}
              onKeyDown={onKeyDown}
              placeholder="Título, autor o ISBN"
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
              data-testid="book-search"
            />
            {busy && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-text-tertiary motion-reduce:animate-none" aria-hidden />}
          </div>
          <Segmented label="Buscar en" value={by} onChange={(v) => onBy(v as By)} options={BY_OPTIONS} className="max-w-xs" />
        </form>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <p id={`${id}-status`} role="status" aria-live="polite" className={cn("px-2 pb-2 text-sm", current && (search.status === "error" || search.status === "offline") || badIsbn ? "text-warning" : "text-text-secondary")} data-testid="book-search-status">
          {current && search.status === "offline" && <CloudOff className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />}
          {status}
        </p>
        {current && (search.status === "error" || search.status === "offline") && search.status === "error" && search.code !== "unauthorized" && (
          <Button variant="outline" size="touch-sm" className="mx-2 mb-2" onClick={onRetry} data-testid="book-search-retry">
            Reintentar
          </Button>
        )}
        {!trimmed && <p className="px-2 text-sm text-text-tertiary">Por ejemplo: «Cien años de soledad», «Irene Vallejo» o un ISBN como 978-84-17860-79-0.</p>}
        {busy && (
          <ul aria-hidden className="space-y-1">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <div className="aspect-[2/3] w-10 animate-pulse rounded-md bg-surface-raised motion-reduce:animate-none" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-surface-raised motion-reduce:animate-none" />
                </div>
              </li>
            ))}
          </ul>
        )}
        {results && results.length > 0 && (
          <ul id={`${id}-list`} role="listbox" aria-label="Resultados" className="space-y-1" data-testid="book-results">
            {results.map((r, i) => {
              const m = matches.get(r)
              const year = yearOf(r)
              return (
                <li
                  key={`${r.workId}-${r.editionId}-${i}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={active === i}
                  tabIndex={-1}
                  onClick={() => onChoose(r)}
                  onMouseEnter={() => setActive(i)}
                  className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-raised/60", active === i && "bg-surface-raised/60 outline-2 outline-signal")}
                  data-testid="book-result"
                >
                  <div className="w-10 shrink-0">
                    <CoverArt seed={r.workId ?? r.title} title={r.title} kind="book" size="sm" cover={r.cover ? { source: "external", url: r.cover } : null} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.title}</p>
                    <p className="truncate text-sm text-text-secondary">{(r.creators ?? []).join(", ") || "Autor desconocido"}</p>
                    <p className="truncate text-xs text-text-tertiary">
                      {[year, r.publisher, languageName(r.language), r.workTitle ? `Obra: ${r.workTitle}` : null, r.editionCount && r.editionCount > 1 ? `${r.editionCount} ediciones` : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {m && (m.level === "exact" || m.level === "strong") && (
                    <span className="shrink-0 rounded-full border border-signal/40 px-2 py-0.5 text-xs text-signal" data-testid="result-owned">
                      {m.level === "exact" ? "En tu Biblioteca" : "Ya tienes esta edición"}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="px-2 pt-3 text-xs text-text-tertiary">Datos: Open Library</p>
      </div>
      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        <Button variant={current && (search.status === "error" || search.status === "offline") ? "default" : "outline"} className="flex-1" onClick={onManual} data-testid="add-manual">
          <PenLine aria-hidden /> Introducir manualmente
        </Button>
      </SheetFooter>
    </div>
  )
}

// ---------- confirmation ----------

const FIELD_LABEL: Record<DraftField, string> = {
  title: "Título",
  subtitle: "Subtítulo",
  creators: "Autor o autores",
  publisher: "Editorial",
  year: "Año",
  language: "Idioma",
  isbn: "ISBN",
  pageCount: "Páginas",
  description: "Descripción",
}

function Confirm({ result, state, initial, onChange, onBack, onManual, onCreated }: { result: BookResult; state: KnowledgeState; initial: ConfirmDraft | null; onChange: (d: ConfirmDraft) => void; onBack: () => void; onManual: () => void; onCreated: (id: string) => void }) {
  const id = useId()
  const f = (k: string) => `${id}-${k}`
  const [draft, setDraft] = useState<BookDraft>(() => initial?.draft ?? createDraft(result))
  // A recovered draft keeps its edition: asking for the first one's detail would overwrite it.
  const [start] = useState(() => ({ editionId: initial?.draft.source.editionId ?? result.editionId, detailDone: initial?.detailDone ?? false }))
  const [detail, setDetail] = useState<"loading" | "done" | MetadataErrorCode>(result.workId && !start.detailDone ? "loading" : "done")
  const [editions, setEditions] = useState<BookResult[] | null>(null)
  const [showEditions, setShowEditions] = useState(false)
  const [status, setStatus] = useState<ContentStatus>(initial?.status ?? "planned")
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null)
  const [favorite, setFavorite] = useState(initial?.favorite ?? false)
  const [topics, setTopics] = useState<string[]>(initial?.topics ?? [])
  const [separate, setSeparate] = useState(initial?.separate ?? false)
  const [errors, setErrors] = useState<DraftErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const device = useDeviceSave(onCreated)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => heading.current?.focus(), [])

  // The work's description and the edition's details, and the other editions: two requests, once.
  useEffect(() => {
    if (!result.workId) return
    const ac = new AbortController()
    if (!start.detailDone)
      client.bookDetail(result.workId, start.editionId, ac.signal).then(
        (r) => {
          if (r.ok) setDraft((d) => applyDetail(d, r.data))
          setDetail(r.ok ? "done" : r.error.code)
        },
        () => {}
      )
    client.bookEditions(result.workId, ac.signal, "es").then(
      (r) => setEditions(r.ok ? r.data : []),
      () => {}
    )
    return () => ac.abort()
  }, [result.workId, start])

  useLayoutEffect(() => onChange({ draft, detailDone: detail === "done", status, rating, favorite, topics, separate }), [draft, detail, status, rating, favorite, topics, separate, onChange])

  const candidate = draftResult(draft)
  // The book just written is not a duplicate of itself while its device copy is awaited.
  const matches = findBookMatches(state, { ...candidate, workId: separate ? null : candidate.workId }).filter((m) => m.id !== device.written)
  const exact = matches.find((m) => m.level === "exact")
  const owned = (m: Match | undefined) => (m ? state.items[m.id] : undefined)
  const edit = (field: DraftField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => (setErrors((x) => ({ ...x, [field]: undefined })), setDraft((d) => editField(d, field, e.target.value)))
  const otherEditions = (editions ?? []).filter((e) => e.editionId)

  function save() {
    // Already written: only the device copy is awaited or retried, never a second create.
    if (device.started()) return device.retry()
    setFailure(null)
    const errs = draftErrors(draft)
    setErrors(errs)
    const first = Object.keys(errs)[0]
    if (first) return document.getElementById(f(first))?.focus()
    if (exact) return setFailure("Ya está en tu Biblioteca. Ábrelo o añádelo como otra edición.")
    const r = libraryActions.createItem("book", toBookInput(draftResult(draft), { status, rating, favorite, topics, keepDescription: draft.keepDescription, separateEdition: separate }))
    if (!r.ok) return setFailure(refusalText(r.error))
    device.begin(r.id)
  }

  const field = (k: DraftField, extra: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={f(k)}>{FIELD_LABEL[k]}</Label>
      <Input id={f(k)} value={draft.values[k]} onChange={edit(k)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? f(`${k}-err`) : undefined} {...extra} className={cn("max-md:h-11", extra.className)} />
      {errors[k] && (
        <p id={f(`${k}-err`)} className="text-xs text-warning">
          {errors[k]}
        </p>
      )}
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border px-5 pt-4 pb-3">
        <Button variant="ghost" size="touch-sm" className="-ml-2 w-fit" onClick={onBack} disabled={device.locked} data-testid="confirm-back">
          <ArrowLeft aria-hidden /> Resultados
        </Button>
        <SheetTitle asChild>
          <h2 ref={heading} tabIndex={-1} className="text-lg outline-none">
            Revisa y añade
          </h2>
        </SheetTitle>
        <SheetDescription>Todo es editable. Lo que el proveedor no sabe queda vacío.</SheetDescription>
      </SheetHeader>
      {/* Locked while written: nothing in it may write it again or open another page first. */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5" data-testid="book-confirm" inert={device.locked}>
        <div className="flex gap-4">
          <div className="w-24 shrink-0 space-y-2">
            <CoverArt seed={draft.source.workId ?? draft.values.title} title={draft.values.title || "Sin título"} byline={draft.values.creators} kind="book" cover={draft.useCover && draft.cover ? { source: "external", url: draft.cover } : null} />
            {draft.cover && (
              <label className="flex min-h-11 items-center gap-2 text-xs">
                <input type="checkbox" checked={draft.useCover} onChange={(e) => setDraft((d) => setUseCover(d, e.target.checked))} className="size-5 accent-[var(--color-signal)]" data-testid="use-cover" />
                Usar esta portada
              </label>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <p className="text-text-secondary">Edición</p>
            <p data-testid="edition-summary">{[draft.values.publisher || "Editorial desconocida", draft.values.year, languageName(draft.values.language || null), draft.values.isbn ? `ISBN ${draft.values.isbn}` : null].filter(Boolean).join(" · ")}</p>
            {draft.source.workTitle && <p className="text-text-tertiary">Obra: {draft.source.workTitle}</p>}
            {editions === null && result.workId ? (
              <p className="flex items-center gap-1.5 text-text-tertiary">
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Buscando otras ediciones…
              </p>
            ) : (
              otherEditions.length > 1 && (
                <Button variant="outline" size="touch-sm" aria-expanded={showEditions} onClick={() => setShowEditions((v) => !v)} data-testid="change-edition">
                  {showEditions ? "Ocultar ediciones" : `Cambiar edición (${otherEditions.length})`}
                </Button>
              )
            )}
          </div>
        </div>

        {showEditions && (
          <div role="radiogroup" aria-label="Ediciones" className="space-y-1 rounded-2xl border border-border p-2" data-testid="editions">
            {otherEditions.map((e) => {
              const selected = e.editionId === draft.source.editionId
              return (
                <button
                  key={e.editionId}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => (setDraft((d) => applyEdition(d, e)), setShowEditions(false))}
                  className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-raised/60", selected && "bg-surface-raised/60")}
                  data-testid="edition-option"
                >
                  <Check className={cn("size-4 shrink-0", selected ? "text-signal" : "invisible")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{e.title}</span>
                    <span className="block text-xs break-words text-text-tertiary">{[e.publisher ?? "Editorial desconocida", e.year, languageName(e.language), e.pageCount ? `${e.pageCount} págs.` : null, e.isbn13 ?? e.isbn10].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {detail !== "loading" && detail !== "done" && (
          <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" data-testid="detail-error">
            {detail === "unauthorized" ? "Tu sesión ha caducado: no se pudo traer la descripción. Puedes guardar igualmente con estos datos." : "No se pudieron traer más datos. Puedes guardar igualmente con estos."}
          </p>
        )}

        <div className="space-y-4">
          {field("title", { maxLength: 300, "data-testid": "confirm-title" } as React.ComponentProps<typeof Input>)}
          {field("creators", { "data-testid": "confirm-creators" } as React.ComponentProps<typeof Input>)}
          {field("subtitle")}
          <div className="grid grid-cols-2 gap-3">
            {field("publisher", { "data-testid": "confirm-publisher" } as React.ComponentProps<typeof Input>)}
            {field("year", { inputMode: "numeric", className: "num" })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("pageCount", { inputMode: "numeric", className: "num", "data-testid": "confirm-pages" } as React.ComponentProps<typeof Input>)}
            {field("language", { maxLength: 3, placeholder: "es", autoCapitalize: "off" })}
          </div>
          {field("isbn", { className: "num", "data-testid": "confirm-isbn" } as React.ComponentProps<typeof Input>)}
          <div className="space-y-1.5">
            <Label htmlFor={f("description")}>{FIELD_LABEL.description}</Label>
            <Textarea id={f("description")} value={draft.values.description} onChange={edit("description")} rows={4} placeholder={detail === "loading" ? "Trayendo la descripción…" : undefined} disabled={!draft.keepDescription} />
            {draft.values.description && (
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.keepDescription} onChange={(e) => setDraft((d) => setKeepDescription(d, e.target.checked))} className="size-5 accent-[var(--color-signal)]" />
                Guardar la descripción
              </label>
            )}
          </div>
          {draft.topicSuggestions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Temas sugeridos</p>
              <p className="text-xs text-text-tertiary">Ninguno se guarda si no lo eliges.</p>
              <div className="flex flex-wrap gap-2">
                {draft.topicSuggestions.map((t) => {
                  const on = topics.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTopics((x) => (on ? x.filter((y) => y !== t) : [...x, t]))}
                      className={cn("min-h-11 rounded-full border px-3 text-sm md:min-h-9", on ? "border-signal bg-signal/15 text-foreground" : "border-border text-text-secondary hover:text-foreground")}
                    >
                      {on ? "✓ " : "+ "}
                      {t}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-2xl border border-border p-4">
          <p className="text-sm font-medium">Tu lectura</p>
          <div className="space-y-1.5">
            <Label htmlFor={f("status")}>Estado</Label>
            <select id={f("status")} value={status} onChange={(e) => setStatus(e.target.value as ContentStatus)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm" data-testid="confirm-status">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL.book[s]}
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
          {draft.source.attribution} ·{" "}
          <a href={draft.source.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 underline-offset-2 hover:underline md:min-h-0">
            ver en Open Library <ExternalLink className="inline size-3" aria-hidden />
          </a>
        </p>

        <Duplicates matches={matches} owned={owned} separate={separate} onSeparate={setSeparate} />

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
          {device.waiting ? SAVING_LABEL : device.state === "failed" ? "Reintentar" : separate ? "Añadir como otra edición" : matches.length ? "Añadir igualmente" : "Añadir a la Biblioteca"}
        </Button>
      </SheetFooter>
    </div>
  )
}

/**
 * What is already in the Library (M4g.3 §17.2). Only the same work blocks, and only the use of the
 * same reference: «Añadir como otra edición» saves it without it, which the server accepts.
 */
function Duplicates({ matches, owned, separate, onSeparate }: { matches: Match[]; owned: (m: Match | undefined) => { id: string; title: string } | undefined; separate: boolean; onSeparate: (v: boolean) => void }) {
  const exact = matches.find((m) => m.level === "exact")
  const top = exact ?? matches[0]
  const item = owned(top)
  if (!top && !separate) return null
  if (!item && !separate) return null
  const text = separate
    ? "Se guardará como otra edición, separada de la que ya tienes."
    : top.level === "exact"
      ? `Ya está en tu Biblioteca: «${item!.title}».`
      : top.level === "strong"
        ? `Ya tienes esta edición (mismo ISBN): «${item!.title}».`
        : `Puede que ya lo tengas: «${item!.title}».`
  return (
    <div role="status" className="space-y-3 rounded-2xl border border-signal/40 bg-signal/5 p-4 text-sm" data-testid="duplicate" data-level={separate ? "separate" : top.level}>
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
        {text}
      </p>
      <div className="flex flex-wrap gap-2">
        {item && (
          <Button asChild variant={exact && !separate ? "default" : "outline"} size="touch-sm">
            <Link href={itemHref(item.id)} data-testid="open-existing">
              Abrir el existente
            </Link>
          </Button>
        )}
        {exact && !separate && (
          <Button variant="outline" size="touch-sm" onClick={() => onSeparate(true)} data-testid="add-edition">
            Añadir como otra edición
          </Button>
        )}
        {separate && (
          <Button variant="ghost" size="touch-sm" onClick={() => onSeparate(false)}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  )
}
