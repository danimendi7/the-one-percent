"use client"

import Link from "next/link"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { ArrowRightLeft, GraduationCap, Lightbulb, Link2, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react"
import { RecallCardSheet } from "@/features/recall/components/recall-card-sheet"
import { NoteRecallChip } from "@/features/recall/components/note-recall-chip"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { formatTimestamp, parseTimestamp } from "@/features/knowledge/domain/text"
import { APPLICATION_LABEL, APPLICATION_STATUSES, NOTE_TYPES, noteLabel, type ApplicationStatus, type ContentKind, type KnowledgeNote, type Locator, type NoteType } from "@/features/knowledge/domain/types"
import { linkedTo } from "@/features/knowledge/domain/relations"
import type { MatchField } from "@/features/knowledge/domain/search"
import { libraryActions } from "../store/use-library"
import type { LibraryRefusal, LibrarySnapshot } from "../store/types"
import { brainNoteHref, itemHref, SyncLine } from "./library-ui"
import { KnowledgePicker, Marked } from "./knowledge-links"

const MATCH_LABEL: Record<MatchField, string> = { text: "el texto", topics: "los temas", locator: "la referencia", source: "su origen" }

export const DEBOUNCE_MS = 800

const REFUSAL: Record<string, string> = {
  invalid: "No se pudo guardar: revisa el texto (una cita admite hasta 2.000 caracteres y una nota hasta 10.000).",
  kind_mismatch: "La página es para libros y el minuto para episodios.",
  not_found: "Ese contenido ya no existe en este dispositivo.",
  pending: "Hay cambios de sus notas sin enviar: espera a que se sincronicen para borrarlo.",
  in_flight: "Se está enviando ahora mismo: inténtalo en unos segundos.",
  duplicate: "Ya existe.",
}
export const refusalText = (e: LibraryRefusal) =>
  e.code === "invalid" && /locator\.page/.test(e.detail) ? "Esa página está fuera del libro." : e.code === "invalid" && /positionSeconds/.test(e.detail) ? "Ese minuto está fuera del episodio." : (REFUSAL[e.code] ?? "No se pudo guardar.")

/**
 * Autosave of one text (D57 precedent): 800 ms after the last keystroke, on leaving the field, and
 * on pagehide / hidden tab, so at most the last 800 ms are at risk if the system kills the tab. A
 * refused save keeps the text on screen; it is never replaced by the stored value while dirty.
 */
export function useAutosaveText(stored: string, save: (v: string) => string | null) {
  const [value, setValue] = useState(stored)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState(stored)
  if (seen !== stored) {
    setSeen(stored)
    if (!dirty) setValue(stored)
  }
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const v = pending.current
    if (v === null) return
    pending.current = null
    const err = saveRef.current(v)
    setError(err)
    if (!err) setDirty(false)
  }, [])
  useEffect(() => {
    const onHide = () => flush()
    const onVis = () => document.visibilityState === "hidden" && flush()
    window.addEventListener("pagehide", onHide)
    document.addEventListener("visibilitychange", onVis)
    return () => {
      window.removeEventListener("pagehide", onHide)
      document.removeEventListener("visibilitychange", onVis)
      flush()
    }
  }, [flush])
  const change = useCallback(
    (v: string) => {
      setValue(v)
      setDirty(true)
      pending.current = v
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, DEBOUNCE_MS)
    },
    [flush]
  )
  return { value, change, flush, dirty, error, reset: (v: string) => (setValue(v), setSeen(v), setDirty(false), (pending.current = null)) }
}

/** Type chips: one tap, no form. «Cita» reads «Momento destacado» on an episode. */
export function NoteTypePicker({ value, onChange, kind, className }: { value: NoteType; onChange: (t: NoteType) => void; kind: ContentKind | null; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Tipo de nota" className={cn("flex flex-wrap gap-1.5", className)}>
      {NOTE_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(t)}
          className={cn(
            "min-h-11 md:min-h-10 shrink-0 rounded-full border px-3 text-[0.8125rem] font-medium transition-colors motion-reduce:transition-none",
            value === t ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary hover:bg-surface-raised hover:text-foreground"
          )}
        >
          {noteLabel(t, kind)}
        </button>
      ))}
    </div>
  )
}

function locatorText(l: Locator | null): string {
  if (!l) return ""
  if (l.page !== null) return String(l.page)
  if (l.positionSeconds !== null) return formatTimestamp(l.positionSeconds)
  return ""
}

function parseLocator(kind: ContentKind | null, text: string): Partial<Locator> | null | "invalid" {
  const t = text.trim()
  if (!t || !kind) return null
  if (kind === "book") return /^\d{1,6}$/.test(t) ? { page: Number(t) } : "invalid"
  const s = parseTimestamp(t)
  return s === null ? "invalid" : { positionSeconds: s }
}

/**
 * Quick capture (plan §4.5, the core of M4d): «Añadir idea», type, and it is saved on this device on
 * its own — also offline. The first pause creates the note; later pauses update it. «Nueva idea»
 * leaves it ready for the next one. Optional fields never block saving.
 */
export function QuickCapture({
  itemId,
  kind,
  snap,
  defaultOpen = false,
  className,
}: {
  itemId: string | null
  kind: ContentKind | null
  snap: LibrarySnapshot
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [type, setType] = useState<NoteType>("idea")
  const [noteId, setNoteId] = useState<string | null>(null)
  const [locator, setLocator] = useState("")
  const [locError, setLocError] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const idRef = useRef<string | null>(null)
  const fieldId = useId()

  const save = useCallback(
    (body: string): string | null => {
      if (!body.trim()) return null
      const loc = parseLocator(kind, locator)
      const where = loc === "invalid" ? null : loc
      if (!idRef.current) {
        const r = libraryActions.createNote({ itemId, type, body, locator: where })
        if (!r.ok) return refusalText(r.error)
        idRef.current = r.id
        setNoteId(r.id)
        return null
      }
      const r = libraryActions.updateNote(idRef.current, { body })
      return r.ok ? null : refusalText(r.error)
    },
    [itemId, kind, locator, type]
  )
  const text = useAutosaveText("", save)

  function chooseType(t: NoteType) {
    setType(t)
    if (idRef.current) libraryActions.updateNote(idRef.current, { type: t })
  }
  function commitLocator() {
    const loc = parseLocator(kind, locator)
    if (loc === "invalid") return setLocError(kind === "book" ? "Escribe un número de página." : "Escribe el minuto como 12:34.")
    setLocError(null)
    if (idRef.current) {
      const r = libraryActions.updateNote(idRef.current, { locator: loc })
      if (!r.ok) setLocError(refusalText(r.error))
    }
  }
  function next() {
    text.flush()
    idRef.current = null
    setNoteId(null)
    text.reset("")
    setLocator("")
    setType("idea")
    area.current?.focus()
  }

  if (!open) {
    return (
      <Button size="lg" className={cn("w-full", className)} onClick={() => (setOpen(true), setTimeout(() => area.current?.focus(), 0))} data-testid="capture-open">
        <Lightbulb aria-hidden />
        Añadir idea
      </Button>
    )
  }
  return (
    <section aria-label="Añadir idea" className={cn("panel space-y-3 rounded-2xl p-4", className)} data-testid="capture">
      <NoteTypePicker value={type} onChange={chooseType} kind={kind} />
      <label htmlFor={fieldId} className="sr-only">
        Texto de la idea
      </label>
      <Textarea
        id={fieldId}
        ref={area}
        value={text.value}
        onChange={(e) => text.change(e.target.value)}
        onBlur={() => text.flush()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            next()
          }
        }}
        placeholder={kind === "episode" ? "¿Qué te llevas de este episodio?" : kind === "book" ? "¿Qué te llevas de este libro?" : "Escribe una idea…"}
        rows={4}
        className="min-h-28 text-[0.9375rem]"
        data-testid="capture-text"
      />
      <div className="flex flex-wrap items-end gap-3">
        {kind && (
          <div className="w-32">
            <label htmlFor={`${fieldId}-loc`} className="mb-1 block text-xs text-text-tertiary">
              {kind === "book" ? "Página (opcional)" : "Minuto (opcional)"}
            </label>
            <input
              id={`${fieldId}-loc`}
              value={locator}
              onChange={(e) => setLocator(e.target.value)}
              onBlur={commitLocator}
              inputMode={kind === "book" ? "numeric" : "text"}
              placeholder={kind === "book" ? "Ej. 214" : "Ej. 12:34"}
              className="num h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              data-testid="capture-locator"
            />
          </div>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => (text.flush(), setOpen(false))}>
            Cerrar
          </Button>
          <Button variant="outline" onClick={next} disabled={!noteId && !text.value.trim()} data-testid="capture-next">
            <Plus aria-hidden />
            Nueva idea
          </Button>
        </div>
      </div>
      {(text.error || locError) && (
        <p role="alert" className="text-xs text-warning">
          {text.error ?? locError}
        </p>
      )}
      {noteId ? (
        <SyncLine state={libraryActions.syncStateOf("note", noteId)} snap={snap} testId="capture-save" />
      ) : (
        <p className="text-xs text-text-tertiary">Se guarda solo mientras escribes, también sin conexión.</p>
      )}
    </section>
  )
}

/** One note: read view, inline edit with autosave, star, type, application status, delete with «Deshacer» (P14). */
export function NoteCard({
  note,
  snap,
  kind,
  origin,
  terms,
  matched,
  className,
}: {
  note: KnowledgeNote
  snap: LibrarySnapshot
  kind: ContentKind | null
  origin?: { id: string; title: string } | null
  /** Search terms to highlight (Cerebro, M4e). */
  terms?: string[]
  /** Where the search matched, said under the note. */
  matched?: MatchField[]
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [picker, setPicker] = useState<"link" | "move" | null>(null)
  const [cardOpen, setCardOpen] = useState(false)
  const connections = linkedTo(snap.state, { type: "note", id: note.id }).length
  const text = useAutosaveText(note.body, (v) => {
    if (!v.trim()) return "Una nota no puede quedar vacía: escribe algo o elimínala."
    const r = libraryActions.updateNote(note.id, { body: v })
    return r.ok ? null : refusalText(r.error)
  })
  const sync = libraryActions.syncStateOf("note", note.id)
  const loc = locatorText(note.locator)
  function remove() {
    text.flush()
    const r = libraryActions.deleteNote(note.id)
    if (!r.ok) return void toast.error(refusalText(r.error))
    toast("Nota eliminada", { action: { label: "Deshacer", onClick: () => libraryActions.undo(r.undo) } })
  }
  return (
    <article id={`note-${note.id}`} className={cn("group scroll-mt-20 rounded-xl border border-border/80 bg-background/30 p-4", className)} data-testid="note" data-note-type={note.type}>
      <header className="mb-2 flex items-center gap-2 text-xs text-text-tertiary">
        <span className="font-medium text-text-secondary">{noteLabel(note.type, kind)}</span>
        {loc && <span className="num">· {note.locator?.page !== null && note.locator?.page !== undefined ? `p. ${loc}` : `min. ${loc}`}</span>}
        {note.locator?.label && <span>· {note.locator.label}</span>}
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={note.starred}
          aria-label={note.starred ? "Quitar de destacadas" : "Destacar"}
          onClick={() => libraryActions.updateNote(note.id, { starred: !note.starred })}
          className="grid size-11 md:size-10 place-items-center rounded-lg hover:bg-surface-raised"
        >
          <Star className={cn("size-4", note.starred ? "fill-current text-signal" : "text-text-tertiary")} aria-hidden />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Más acciones de la nota" className="grid size-11 md:size-10 place-items-center rounded-lg hover:bg-surface-raised">
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil aria-hidden /> Editar
            </DropdownMenuItem>
            {NOTE_TYPES.filter((t) => t !== note.type).map((t) => (
              <DropdownMenuItem key={t} onSelect={() => libraryActions.updateNote(note.id, { type: t })}>
                Cambiar a {noteLabel(t, kind).toLowerCase()}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setPicker("link")}>
              <Link2 aria-hidden /> Conectar con…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPicker("move")}>
              <ArrowRightLeft aria-hidden /> Mover a…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCardOpen(true)} data-testid="note-create-card">
              <GraduationCap aria-hidden /> Crear tarjeta de repaso
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={remove} className="text-warning">
              <Trash2 aria-hidden /> Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <RecallCardSheet open={cardOpen} onOpenChange={setCardOpen} draft={{ answer: note.body, sourceNoteId: note.id }} />
      {editing ? (
        <div className="space-y-2">
          <label htmlFor={`edit-${note.id}`} className="sr-only">
            Texto de la nota
          </label>
          <Textarea id={`edit-${note.id}`} value={text.value} onChange={(e) => text.change(e.target.value)} onBlur={() => text.flush()} rows={4} autoFocus data-testid="note-edit" />
          {text.error && (
            <p role="alert" className="text-xs text-warning">
              {text.error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => (text.flush(), !text.dirty && setEditing(false))}>
              Listo
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="block w-full text-left text-[0.9375rem] leading-relaxed whitespace-pre-wrap">
          <span className="sr-only">Editar nota: </span>
          {terms?.length ? <Marked text={note.body} terms={terms} /> : note.body}
        </button>
      )}
      {matched && matched.length > 0 && !(matched.length === 1 && matched[0] === "text") && (
        <p className="mt-2 text-xs text-text-tertiary" data-testid="note-match">
          Coincide en {matched.map((m) => MATCH_LABEL[m]).join(" y ")}
        </p>
      )}
      {note.type === "application" && (
        <div role="radiogroup" aria-label="Estado de la aplicación" className="mt-3 flex flex-wrap gap-1.5">
          {APPLICATION_STATUSES.map((s: ApplicationStatus) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={note.applicationStatus === s}
              onClick={() => libraryActions.updateNote(note.id, { applicationStatus: s })}
              className={cn(
                "min-h-11 md:min-h-10 rounded-full border px-3 text-xs font-medium",
                note.applicationStatus === s ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary hover:bg-surface-raised"
              )}
            >
              {APPLICATION_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        {origin && (
          <Link href={itemHref(origin.id)} className="inline-flex min-h-11 md:min-h-10 min-w-0 items-center truncate text-xs text-text-secondary underline-offset-2 hover:text-foreground hover:underline">
            {origin.title}
          </Link>
        )}
        {connections > 0 && (
          <Link href={brainNoteHref(note.id)} className="inline-flex min-h-11 items-center gap-1 text-xs text-text-secondary underline-offset-2 hover:text-foreground hover:underline md:min-h-10" data-testid="note-connections">
            <Link2 className="size-3.5" aria-hidden />
            {connections} {connections === 1 ? "conexión" : "conexiones"}
          </Link>
        )}
        <NoteRecallChip noteId={note.id} />
        <SyncLine state={sync} snap={snap} className="ml-auto" />
      </footer>
      {picker && <KnowledgePicker from={{ type: "note", id: note.id }} mode={picker} snap={snap} open onOpenChange={(v) => !v && setPicker(null)} />}
    </article>
  )
}
