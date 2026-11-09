"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { formatTimestamp, parseTimestamp } from "@/features/knowledge/domain/text"
import { PLATFORMS, PLATFORM_LABEL, STATUSES, STATUS_LABEL, type ContentItem, type ContentKind, type ContentStatus, type KnowledgeState, type Platform, type PodcastShow } from "@/features/knowledge/domain/types"
import { libraryActions } from "../store/use-library"
import { refusalText } from "./knowledge-notes"
import { RatingInput } from "./library-ui"
import { settleDeviceSave } from "./device-save-flow"
import { warnNotOnDevice } from "./device-save"

/** `draft`: what was typed in the book assistant (M4g.3), kept when switching to manual entry. */
export type FormTarget = { kind: ContentKind; item?: ContentItem; showId?: string | null; draft?: { title?: string; isbn?: string } } | { kind: "show"; show?: PodcastShow; draft?: { title?: string } }

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean)
const num = (s: string) => (s.trim() === "" ? null : Number(s))
const text = (s: string) => (s.trim() === "" ? null : s)
const date = (s: string) => (s === "" ? null : s)

/** Create or edit a book, an episode or a show (manual entry; external search arrives in M4g). Only the title is required. */
export function ContentFormSheet({ target, state, open, onOpenChange, onDone }: { target: FormTarget; state: KnowledgeState; open: boolean; onOpenChange: (v: boolean) => void; onDone?: (id: string) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  // Closing with Esc, outside or a swipe never drops what was typed without asking.
  const [dirty, setDirty] = useState(false)
  const [asking, setAsking] = useState(false)
  const close = () => (setDirty(false), setAsking(false), onOpenChange(false))
  // Inside the sheet, not a second modal on top of it (two focus traps would fight).
  return (
    <Sheet open={open} onOpenChange={(v) => (v ? onOpenChange(true) : dirty ? setAsking(true) : close())}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl border-x-0")}>
        {asking && <DiscardPrompt onKeep={() => setAsking(false)} onDiscard={close} />}
        {open && <ContentForm key={target.kind + ("item" in target ? (target.item?.id ?? "") : "show" in target ? (target.show?.id ?? "") : "")} target={target} state={state} onDirty={setDirty} onDone={(id) => (close(), onDone?.(id))} />}
      </SheetContent>
    </Sheet>
  )
}

export function DiscardPrompt({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => keep.current?.focus(), [])
  return (
    <div role="alertdialog" aria-labelledby="discard-title" aria-describedby="discard-desc" className="border-b border-warning/40 bg-warning/10 px-5 py-4">
      <p id="discard-title" className="font-medium">
        ¿Descartar lo escrito?
      </p>
      <p id="discard-desc" className="mt-0.5 text-sm text-text-secondary">
        Hay cambios sin guardar en este formulario.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button ref={keep} variant="outline" onClick={onKeep} data-testid="form-keep">
          Seguir editando
        </Button>
        <Button variant="destructive" onClick={onDiscard} data-testid="form-discard">
          Descartar
        </Button>
      </div>
    </div>
  )
}

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-text-tertiary">{hint}</p>}
    </div>
  )
}

const selectClass = "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
/** After this long still saving on the device, the form says so (it keeps waiting). */
const SLOW_SAVE_MS = 3000

function ContentForm({ target, state, onDone, onDirty }: { target: FormTarget; state: KnowledgeState; onDone: (id: string) => void; onDirty: (dirty: boolean) => void }) {
  const id = useId()
  const f = (k: string) => `${id}-${k}`
  const item = "item" in target ? target.item : undefined
  const show = target.kind === "show" ? target.show : undefined
  const editing = !!(item || show)
  const book = item?.kind === "book" ? item.book : null
  const ep = item?.kind === "episode" ? item.episode : null
  const draft: { title?: string; isbn?: string } | undefined = "draft" in target ? target.draft : undefined
  const [v, setV] = useState({
    title: item?.title ?? show?.title ?? draft?.title ?? "",
    creators: (item?.creators ?? []).join(", "),
    publisher: show?.publisher ?? book?.publisher ?? "",
    status: (item?.status ?? "planned") as ContentStatus,
    rating: item?.rating ?? null,
    favorite: item?.favorite ?? false,
    topics: (item?.topics ?? show?.topics ?? []).join(", "),
    description: item?.description ?? show?.description ?? "",
    subtitle: item?.subtitle ?? "",
    startedOn: item?.startedOn ?? "",
    finishedOn: item?.finishedOn ?? "",
    pageCount: book?.pageCount?.toString() ?? "",
    currentPage: book?.currentPage?.toString() ?? "",
    year: book?.publishedYear?.toString() ?? "",
    isbn: book?.isbn13 ?? book?.isbn10 ?? draft?.isbn ?? "",
    showId: ep?.showId ?? ("showId" in target ? (target.showId ?? "") : ""),
    platform: (ep?.platform ?? "") as Platform | "",
    sourceUrl: item?.sourceUrl ?? show?.sourceUrl ?? "",
    duration: ep?.durationSeconds ? formatTimestamp(ep.durationSeconds) : "",
    position: ep?.positionSeconds != null ? formatTimestamp(ep.positionSeconds) : "",
    publishedOn: ep?.publishedOn ?? "",
    episodeNumber: ep?.episodeNumber?.toString() ?? "",
  })
  // A carried-over draft counts as typed: closing asks before dropping it.
  const [initial] = useState(draft ? { ...v, title: "", isbn: "" } : v)
  const dirty = JSON.stringify(v) !== JSON.stringify(initial)
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  const [more, setMore] = useState(editing || !!draft?.isbn)
  const [error, setError] = useState<string | null>(null)
  // M4-H1: the form closes, and a new page opens, only once the write is stored on this device.
  // Offline, opening the page reloads the app, and a write still in progress was lost with it.
  const [saving, setSaving] = useState<"saving" | "slow" | "failed" | null>(null)
  const written = useRef<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value })
  const shows = Object.values(state.shows).sort((a, b) => a.title.localeCompare(b.title, "es"))
  const kindName = target.kind === "book" ? "libro" : target.kind === "episode" ? "episodio" : "programa"

  function secs(s: string, label: string): number | null | "bad" {
    if (!s.trim()) return null
    const t = /^\d+$/.test(s.trim()) && label === "duración" ? Number(s.trim()) * 60 : parseTimestamp(s)
    return t === null ? "bad" : t
  }

  async function settle(savedId: string) {
    written.current = savedId
    setSaving("saving")
    const slow = setTimeout(() => setSaving((s) => (s === "saving" ? "slow" : s)), SLOW_SAVE_MS)
    const outcome = await settleDeviceSave(libraryActions.saved, () => alive.current)
    clearTimeout(slow)
    if (outcome === "warn") return warnNotOnDevice()
    if (outcome === "done") return
    if (outcome === "retry") return setSaving("failed")
    onDone(savedId)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // Already written: only the device copy is awaited or retried, never a second create.
    if (written.current) return void (saving === "failed" && settle(written.current))
    setError(null)
    if (!v.title.trim()) return setError("Escribe al menos el título.")
    if (target.kind === "show") {
      const input = { title: v.title, publisher: text(v.publisher), description: text(v.description), topics: list(v.topics), sourceUrl: text(v.sourceUrl) }
      const r = show ? libraryActions.updateShow(show.id, input) : libraryActions.createShow(input)
      if (!r.ok) return setError(refusalText(r.error))
      return void settle(show?.id ?? (r as unknown as { id: string }).id)
    }
    const common = {
      title: v.title,
      subtitle: text(v.subtitle),
      creators: list(v.creators),
      description: text(v.description),
      topics: list(v.topics),
      status: v.status,
      rating: v.rating,
      favorite: v.favorite,
      startedOn: date(v.startedOn),
      finishedOn: date(v.finishedOn),
      sourceUrl: text(v.sourceUrl),
    }
    let r
    if (target.kind === "book") {
      const isbn = v.isbn.replace(/[\s-]/g, "")
      const details = {
        pageCount: num(v.pageCount),
        currentPage: num(v.currentPage),
        publisher: text(v.publisher),
        publishedYear: num(v.year),
        isbn13: isbn.length === 13 ? isbn : null,
        isbn10: isbn.length === 10 ? isbn : null,
      }
      if (isbn && isbn.length !== 10 && isbn.length !== 13) return setError("El ISBN tiene 10 o 13 cifras.")
      r = item ? libraryActions.updateItem(item.id, { ...common, book: details }) : libraryActions.createItem("book", { ...common, book: details })
    } else {
      const duration = secs(v.duration, "duración")
      const position = secs(v.position, "minuto")
      if (duration === "bad") return setError("Escribe la duración en minutos (45) o como 1:02:30.")
      if (position === "bad") return setError("Escribe dónde te quedaste como 12:34.")
      const details = {
        showId: v.showId || null,
        platform: (v.platform || null) as Platform | null,
        durationSeconds: duration,
        positionSeconds: position,
        publishedOn: date(v.publishedOn),
        episodeNumber: num(v.episodeNumber),
      }
      r = item ? libraryActions.updateItem(item.id, { ...common, episode: details }) : libraryActions.createItem("episode", { ...common, episode: details })
    }
    if (!r.ok) return setError(refusalText(r.error))
    void settle(item?.id ?? (r as unknown as { id: string }).id)
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
        <SheetTitle className="text-lg">{editing ? `Editar ${kindName}` : `Nuevo ${kindName}`}</SheetTitle>
        <SheetDescription>Solo el título es obligatorio. Puedes completar el resto cuando quieras.</SheetDescription>
      </SheetHeader>
      <fieldset disabled={saving !== null} className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <Field id={f("title")} label="Título">
          <Input id={f("title")} value={v.title} onChange={set("title")} autoFocus={!editing} maxLength={300} data-testid="form-title" />
        </Field>
        {target.kind !== "show" && (
          <Field id={f("creators")} label={target.kind === "book" ? "Autor o autores" : "Invitados"} hint="Separados por comas.">
            <Input id={f("creators")} value={v.creators} onChange={set("creators")} />
          </Field>
        )}
        {target.kind === "show" && (
          <Field id={f("publisher")} label="Presentador o productora">
            <Input id={f("publisher")} value={v.publisher} onChange={set("publisher")} />
          </Field>
        )}
        {target.kind === "episode" && (
          <Field id={f("show")} label="Programa">
            <select id={f("show")} value={v.showId} onChange={set("showId")} className={selectClass}>
              <option value="">Sin programa</option>
              {shows.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        {target.kind !== "show" && (
          <>
            <Field id={f("status")} label="Estado">
              <select id={f("status")} value={v.status} onChange={set("status")} className={selectClass}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[target.kind as ContentKind][s]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Valoración (opcional)</p>
              <RatingInput value={v.rating} onChange={(rating) => setV({ ...v, rating })} />
            </div>
          </>
        )}
        {target.kind === "episode" && (
          <div className="grid grid-cols-2 gap-3">
            <Field id={f("platform")} label="Plataforma">
              <select id={f("platform")} value={v.platform} onChange={set("platform")} className={selectClass}>
                <option value="">—</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={f("duration")} label="Duración">
              <Input id={f("duration")} value={v.duration} onChange={set("duration")} placeholder="45 o 1:02:30" className="num" />
            </Field>
          </div>
        )}
        {target.kind === "book" && (
          <div className="grid grid-cols-2 gap-3">
            <Field id={f("pages")} label="Páginas">
              <Input id={f("pages")} value={v.pageCount} onChange={set("pageCount")} inputMode="numeric" className="num" />
            </Field>
            <Field id={f("current")} label="Página actual">
              <Input id={f("current")} value={v.currentPage} onChange={set("currentPage")} inputMode="numeric" className="num" />
            </Field>
          </div>
        )}
        {target.kind !== "book" && (
          <Field id={f("url")} label={target.kind === "show" ? "Enlace del programa" : "Enlace al episodio"} hint="Spotify, Apple Podcasts, YouTube u otra web.">
            <Input id={f("url")} value={v.sourceUrl} onChange={set("sourceUrl")} inputMode="url" placeholder="https://" />
          </Field>
        )}
        <Field id={f("topics")} label="Temas" hint="Libres, separados por comas.">
          <Input id={f("topics")} value={v.topics} onChange={set("topics")} />
        </Field>
        <button type="button" className="text-sm text-text-secondary underline-offset-2 hover:text-foreground hover:underline" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? "Menos detalles" : "Más detalles"}
        </button>
        {more && (
          <div className="space-y-4">
            {target.kind !== "show" && (
              <>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="checkbox" checked={v.favorite} onChange={(e) => setV({ ...v, favorite: e.target.checked })} className="size-5 accent-[var(--color-signal)]" />
                  Favorito
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <Field id={f("start")} label="Inicio">
                    <Input id={f("start")} type="date" value={v.startedOn} onChange={set("startedOn")} />
                  </Field>
                  <Field id={f("end")} label={target.kind === "book" ? "Fin" : "Escuchado o visto"}>
                    <Input id={f("end")} type="date" value={v.finishedOn} onChange={set("finishedOn")} />
                  </Field>
                </div>
              </>
            )}
            {target.kind === "episode" && (
              <div className="grid grid-cols-2 gap-3">
                <Field id={f("position")} label="Te quedaste en">
                  <Input id={f("position")} value={v.position} onChange={set("position")} placeholder="12:34" className="num" />
                </Field>
                <Field id={f("published")} label="Publicado">
                  <Input id={f("published")} type="date" value={v.publishedOn} onChange={set("publishedOn")} />
                </Field>
                <Field id={f("number")} label="Nº de episodio">
                  <Input id={f("number")} value={v.episodeNumber} onChange={set("episodeNumber")} inputMode="numeric" className="num" />
                </Field>
              </div>
            )}
            {target.kind === "book" && (
              <>
                <Field id={f("subtitle")} label="Subtítulo">
                  <Input id={f("subtitle")} value={v.subtitle} onChange={set("subtitle")} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field id={f("publisher2")} label="Editorial">
                    <Input id={f("publisher2")} value={v.publisher} onChange={set("publisher")} />
                  </Field>
                  <Field id={f("year")} label="Año">
                    <Input id={f("year")} value={v.year} onChange={set("year")} inputMode="numeric" className="num" />
                  </Field>
                </div>
                <Field id={f("isbn")} label="ISBN">
                  <Input id={f("isbn")} value={v.isbn} onChange={set("isbn")} className="num" />
                </Field>
              </>
            )}
            <Field id={f("description")} label={target.kind === "book" ? "Sinopsis" : "Descripción"}>
              <Textarea id={f("description")} value={v.description} onChange={set("description")} rows={4} />
            </Field>
          </div>
        )}
        {(error || saving === "failed") && (
          <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" data-testid="form-error">
            {saving === "failed" ? "No se ha podido guardar en este dispositivo (puede que falte espacio). Lo escrito sigue aquí: no cierres ni recargues la app y pulsa «Reintentar»." : error}
          </p>
        )}
        {saving === "slow" && (
          <p role="status" className="rounded-xl border border-border px-3 py-2 text-sm text-text-secondary" data-testid="form-slow">
            Está tardando más de lo normal. Seguimos esperando a que quede guardado: no cierres ni recargues la app.
          </p>
        )}
      </fieldset>
      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        <Button type="submit" className="flex-1" disabled={saving === "saving" || saving === "slow"} aria-busy={saving === "saving" || saving === "slow"} data-testid="form-save">
          {saving === "saving" || saving === "slow" ? "Guardando en este dispositivo…" : saving === "failed" ? "Reintentar" : editing ? "Guardar" : `Añadir ${kindName}`}
        </Button>
      </SheetFooter>
    </form>
  )
}
