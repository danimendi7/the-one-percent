"use client"

import Link from "next/link"
import { AlertTriangle, CloudDownload, CloudOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ContentItem, PodcastShow } from "@/features/knowledge/domain/types"
import type { LibraryOp } from "@/features/sync/domain/types"
import { libraryActions } from "../store/use-library"
import type { ConflictChoice, LibrarySnapshot } from "../store/types"
import { itemHref, showHref } from "./library-ui"

/**
 * How the Library stands with the account (M4d): the first download with its progress, an account
 * whose server cannot store the library yet, or a device copy that failed. Nothing in the demo.
 */
export function LibrarySyncBanner({ snap, className }: { snap: LibrarySnapshot; className?: string }) {
  const s = snap.sync
  if (!s) return null
  if (s.phase !== "idle") {
    const pct = s.progress === null ? null : Math.round(s.progress * 100)
    return (
      <div role="status" className={cn("panel flex items-center gap-3 rounded-2xl px-4 py-3 text-sm", className)} data-testid="library-download">
        <CloudDownload className="size-4 shrink-0 text-text-secondary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p>{s.phase === "rebuilding" ? "Preparando tu biblioteca en este dispositivo…" : "Trayendo los últimos cambios…"}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Progreso de la descarga" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
            <div className="h-full rounded-full bg-signal transition-[width] motion-reduce:transition-none" style={{ width: `${pct ?? 5}%` }} />
          </div>
        </div>
        {pct !== null && <span className="num text-xs text-text-tertiary">{pct} %</span>}
      </div>
    )
  }
  if (!s.enabled && s.pending > 0)
    return (
      <p role="status" className={cn("flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning", className)}>
        <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        Tu cuenta aún no guarda la biblioteca: lo que añadas se queda en este dispositivo y se enviará cuando esté disponible.
      </p>
    )
  if (s.state === "error")
    return (
      <p role="alert" className={cn("flex items-start gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning", className)}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        No se pudo guardar en este dispositivo o en la nube. Tus textos siguen aquí; se reintentará solo.
      </p>
    )
  return null
}

const MESSAGE: Record<string, string> = {
  field_conflict: "Se cambió a la vez en otro dispositivo. Elige qué versión se queda.",
  deleted: "Se eliminó en otro dispositivo mientras lo editabas aquí.",
  item_deleted: "Su libro o episodio se eliminó en otro dispositivo.",
  duplicate_external: "Ya estaba en tu Biblioteca: lo añadiste en otro dispositivo. No se ha creado una segunda copia, y lo que escribiste en esta se conserva aquí para que decidas dónde guardarlo.",
  show_not_found: "Su programa ya estaba en tu Biblioteca desde otro dispositivo, así que este episodio no se guardó. Se conserva entero aquí: elige dónde añadirlo.",
}

type Notice = LibrarySnapshot["notices"][number]
const fieldsOf = (n: Notice): Record<string, unknown> => (n.op && "fields" in n.op ? (n.op.fields as Record<string, unknown>) : {})
const idOf = (n: Notice): string | null => (n.op && "id" in n.op ? String(n.op.id) : null)
const entityOfNotice = (n: Notice): string | null => (n.op && n.op.type !== "library.link.set" ? n.op.type.split(".")[1] : null)

/** The live content or show of the same provider and external id as a refused duplicate. */
function sameExternal<T extends { external: ContentItem["external"] }>(list: T[], refused: Notice | undefined): T | null {
  const f = refused ? fieldsOf(refused) : {}
  if (typeof f.external_id !== "string") return null
  return list.find((x) => x.external?.provider === f.external_provider && x.external?.id === f.external_id) ?? null
}

/**
 * Where the content of a refused write can go (M4g.3/M4g.4). Nothing here writes: it only finds
 * the existing records the user may choose, and says when another decision must come first.
 */
function resolutionOf(snap: LibrarySnapshot, n: Notice) {
  const entity = entityOfNotice(n)
  const refusedDuplicate = (id: unknown) => snap.notices.find((x) => x.code === "duplicate_external" && idOf(x) === id)
  // The existing content (book or episode) a refused one stands for.
  let item: ContentItem | null = null
  // The existing show for a refused show, or for an episode refused because of its show.
  let show: PodcastShow | null = null
  // A note waiting for its episode to be placed first.
  let waiting = false
  if (n.code === "duplicate_external" && entity === "item") item = sameExternal(Object.values(snap.state.items), n)
  if (n.code === "duplicate_external" && entity === "show") show = sameExternal(Object.values(snap.state.shows), n)
  if (n.code === "show_not_found") show = sameExternal(Object.values(snap.state.shows), refusedDuplicate(fieldsOf(n).show_id))
  if (n.code === "item_deleted" && entity === "note") {
    const itemId = fieldsOf(n).item_id
    const dup = refusedDuplicate(itemId)
    if (dup) item = sameExternal(Object.values(snap.state.items), dup)
    else if (snap.notices.some((x) => x.code === "show_not_found" && idOf(x) === itemId)) waiting = true
    // Its episode, written again on a show (M4g.4), once the server has it.
    else if (typeof itemId === "string" && snap.state.items[itemId] && libraryActions.syncStateOf("item", itemId) === "synced") item = snap.state.items[itemId]
  }
  let message = MESSAGE[n.code ?? ""] ?? "El servidor no aceptó este cambio. Tu texto se conserva."
  if (n.code === "item_deleted" && item) message = `Su libro o episodio ya está en tu Biblioteca: puedes guardarla en «${item.title}».`
  if (n.code === "item_deleted" && waiting) message = "Su episodio está pendiente de decidir (arriba). Cuando lo añadas a un programa, podrás guardar aquí esta nota."
  if (n.code === "duplicate_external" && entity === "show") message = "Este programa ya estaba en tu Biblioteca: lo añadiste en otro dispositivo. No se ha creado una segunda copia."
  return { entity, item, show, waiting, message }
}

/** Kept texts waiting for a decision (D68/D75): nothing is dropped until the user chooses. */
export function LibraryConflicts({ snap, className }: { snap: LibrarySnapshot; className?: string }) {
  if (snap.notices.length === 0) return null
  return (
    <section aria-label="Textos pendientes de decidir" className={cn("space-y-3", className)} data-testid="library-conflicts">
      {snap.notices.map((n) => {
        const op = n.op as LibraryOp | undefined
        const fields = op && "fields" in op ? op.fields : {}
        const mine = (fields.body ?? fields.description ?? fields.title) as string | undefined
        const id = op && "id" in op ? op.id : null
        const { entity, item, show, message } = resolutionOf(snap, n)
        const theirs = entity === "note" && id ? snap.state.notes[id]?.body : entity === "item" && id ? snap.state.items[id]?.description : null
        const choose = (c: ConflictChoice, target?: string) => libraryActions.resolveText(n.id, c, target)
        const refusedDuplicate = n.code === "duplicate_external"
        return (
          <article key={n.id} className="rounded-2xl border border-warning/40 bg-warning/5 p-4" data-testid="library-conflict" data-code={n.code}>
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <AlertTriangle className="size-4" aria-hidden />
              {n.subject ?? "Un texto"}
            </p>
            <p className="mt-1 text-sm text-text-secondary">{message}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {mine && !refusedDuplicate && (
                <div>
                  <p className="mb-1 text-xs text-text-tertiary">Tu versión</p>
                  <p className="rounded-xl border border-border bg-background/40 p-3 text-sm whitespace-pre-wrap" data-testid="conflict-mine">
                    {mine}
                  </p>
                </div>
              )}
              {n.code === "field_conflict" && theirs && (
                <div>
                  <p className="mb-1 text-xs text-text-tertiary">La otra versión</p>
                  <p className="rounded-xl border border-border bg-background/40 p-3 text-sm whitespace-pre-wrap">{theirs}</p>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {n.code === "field_conflict" && (
                <>
                  <Button onClick={() => choose("mine")}>
                    Aplicar la mía
                  </Button>
                  <Button variant="outline" onClick={() => choose("theirs")}>
                    Mantener la otra
                  </Button>
                  {entity === "note" && (
                    <Button variant="outline" onClick={() => choose("both")}>
                      Guardar las dos
                    </Button>
                  )}
                </>
              )}
              {n.code === "deleted" && (
                <Button onClick={() => choose("restore")}>
                  Restaurar con mi texto
                </Button>
              )}
              {n.code === "show_not_found" && (
                <>
                  {show && (
                    <Button onClick={() => choose("show", show.id)} data-testid="conflict-show">
                      Añadir a «{show.title}»
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => choose("show")} data-testid="conflict-no-show">
                    Guardar sin programa
                  </Button>
                </>
              )}
              {n.code === "item_deleted" && entity === "note" && item && (
                <Button onClick={() => choose("existing", item.id)} data-testid="conflict-existing">
                  Guardar en «{item.title}»
                </Button>
              )}
              {refusedDuplicate && entity === "item" && item && (
                <Button asChild>
                  <Link href={itemHref(item.id)}>Abrir el existente</Link>
                </Button>
              )}
              {refusedDuplicate && entity === "show" && show && (
                <Button asChild>
                  <Link href={showHref(show.id)}>Abrir el existente</Link>
                </Button>
              )}
              {(n.code === "deleted" || n.code === "item_deleted") && entity === "note" && (
                <Button variant="outline" onClick={() => choose("free")}>
                  Guardar como idea suelta
                </Button>
              )}
              {refusedDuplicate ? (
                <Button variant="ghost" onClick={() => choose("theirs")}>
                  Entendido
                </Button>
              ) : (
                n.code !== "field_conflict" && (
                  <Button variant="ghost" onClick={() => choose("theirs")}>
                    {n.code === "show_not_found" ? "Descartar el episodio" : "Descartar mi texto"}
                  </Button>
                )
              )}
            </div>
          </article>
        )
      })}
    </section>
  )
}
