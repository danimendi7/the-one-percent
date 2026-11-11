"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { CloudOff, Lock, LoaderCircle, RotateCcw, Trash2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { CloseIntent } from "@/features/sync/domain/types"
import type { CloseRequest } from "@/features/sync/engine"
import { normalizeContent } from "../domain/content"
import { QUESTION_KEYS, QUESTION_LABEL, type Review, type ReviewKind } from "../domain/types"
import type { Period } from "../domain/periods"
import type { ReviewsModel } from "../use-reviews"

const BLOCKED: Record<Extract<CloseRequest, { ok: false }>["reason"], string> = {
  already_closed: "Esta revisión ya está cerrada.",
  invalid_period: "Este periodo no existe.",
  not_available: "Este periodo aún no ha terminado.",
  invalid_content: "Hay un texto demasiado largo o una decisión incompleta. Revísalo antes de cerrar.",
  conflicts: "Hay cambios que esperan tu decisión. Decide qué versión se queda antes de cerrar.",
  no_server_support: "Tu cuenta aún no guarda revisiones: el borrador sigue en este dispositivo y se podrá cerrar más adelante.",
}

/** What closing will do now, in words (plan §4.3). */
function syncNote(m: ReviewsModel): string | null {
  if (m.source === "demo") return null
  const sync = m.snap.sync
  if (sync?.status === "offline") return "Sin conexión: el cierre quedará guardado en este dispositivo y se hará al recuperar la conexión, después de sincronizar. Puedes cancelarlo mientras tanto."
  if ((sync?.pending ?? 0) > 0) return "Antes de congelar las cifras se enviarán tus cambios pendientes y se descargarán los de tus otros dispositivos."
  return "Antes de congelar las cifras se comprobará que todo está sincronizado."
}

export function CloseDialog({ m, period, review, open, onOpenChange, conflicts }: { m: ReviewsModel; period: Period; review: Review | undefined; open: boolean; onOpenChange: (o: boolean) => void; conflicts: number }) {
  const [error, setError] = useState<string | null>(null)
  const content = normalizeContent(review?.content ?? {})
  const unanswered = QUESTION_KEYS[period.kind].filter((q) => !content[q])
  const decisions = review?.decisions.length ?? 0
  const note = syncNote(m)
  function confirm() {
    const r = m.api.closeReview(period.kind, period.from)
    if (!r.ok) {
      setError(BLOCKED[r.reason])
      return
    }
    setError(null)
    onOpenChange(false)
    if (m.source === "demo") toast("Revisión cerrada", { description: "Demo: las cifras quedan congeladas en este navegador." })
    else if (r.deferred) toast("Se cerrará al recuperar la conexión")
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setError(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cerrar la revisión</DialogTitle>
          <DialogDescription>Las cifras quedarán congeladas tal como están ahora y la revisión pasará a ser de solo lectura.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <ul className="num space-y-1 rounded-xl border border-border bg-background/40 p-3 text-text-secondary">
            <li>
              {QUESTION_KEYS[period.kind].length - unanswered.length} de {QUESTION_KEYS[period.kind].length} preguntas respondidas
            </li>
            {period.kind !== "day" && <li>{decisions === 1 ? "1 decisión" : `${decisions} decisiones`} para el próximo periodo</li>}
          </ul>
          {unanswered.length > 0 && (
            <p className="text-xs leading-relaxed text-text-tertiary">
              Sin responder: {unanswered.map((q) => `«${QUESTION_LABEL[q]}»`).join(", ")}. Puedes cerrar igualmente.
            </p>
          )}
          <p className="text-xs leading-relaxed text-text-tertiary">No se puede reabrir.{period.kind !== "day" && " Las correcciones se hacen al evaluar las decisiones en la próxima revisión."}</p>
          {note && <p className="text-xs leading-relaxed text-text-secondary">{note}</p>}
          {conflicts > 0 && <p className="text-xs text-warning">{BLOCKED.conflicts}</p>}
          {error && (
            <p role="alert" className="text-xs text-warning">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Seguir editando
          </Button>
          <Button onClick={confirm} disabled={conflicts > 0} data-testid="review-close-confirm">
            <Lock aria-hidden />
            Cerrar y congelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A close the user asked for and that has not run yet (durable, M3.4c): what it waits for and how to undo it. */
export function CloseIntentBanner({ m, intent, kind, start }: { m: ReviewsModel; intent: CloseIntent; kind: ReviewKind; start: string }) {
  const offline = m.snap.sync?.status === "offline"
  const cancel = () => m.api.cancelReviewClose(kind, start)
  const retry = () => {
    const r = m.api.closeReview(kind, start)
    if (!r.ok) toast.error(BLOCKED[r.reason])
  }
  if (intent.state === "waiting") {
    return (
      <Banner icon={offline ? CloudOff : LoaderCircle} spin={!offline} tone="pending" testId="review-closing">
        <p className="font-medium">{offline ? "Se cerrará al recuperar la conexión" : "Cerrando la revisión…"}</p>
        <p className="text-text-secondary">
          {offline ? "Tu borrador está guardado. Las cifras se congelarán después de sincronizar con tus otros dispositivos." : "Sincronizando antes de congelar las cifras."}
        </p>
        {!intent.opId && (
          <Button variant="outline" size="sm" className="mt-2 h-11 md:h-9" onClick={cancel}>
            Cancelar el cierre
          </Button>
        )}
      </Banner>
    )
  }
  if (intent.state === "needs_confirmation") {
    return (
      <Banner icon={TriangleAlert} tone="warn" testId="review-close-changed">
        <p className="font-medium">La revisión cambió en otro dispositivo</p>
        <p className="text-text-secondary">Desde que pediste cerrarla cambiaron sus textos o los datos del periodo. Revísala y confirma de nuevo; no se ha cerrado nada.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" className="h-11 md:h-9" onClick={retry}>
            Cerrar ahora
          </Button>
          <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={cancel}>
            Seguir editando
          </Button>
        </div>
      </Banner>
    )
  }
  return (
    <Banner icon={TriangleAlert} tone="warn" testId="review-close-failed">
      <p className="font-medium">No se pudo cerrar la revisión</p>
      <p className="text-text-secondary">Tu borrador está intacto{intent.code ? ` (motivo: ${intent.code})` : ""}.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" className="h-11 md:h-9" onClick={retry}>
          <RotateCcw aria-hidden />
          Reintentar
        </Button>
        <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={cancel}>
          Descartar el cierre
        </Button>
      </div>
    </Banner>
  )
}

function Banner({ icon: Icon, spin, tone, testId, children }: { icon: React.ComponentType<{ className?: string }>; spin?: boolean; tone: "pending" | "warn"; testId: string; children: React.ReactNode }) {
  return (
    <div role="status" data-testid={testId} className={tone === "warn" ? "flex gap-3 rounded-2xl border border-warning/40 bg-warning/6 p-4 text-sm" : "panel flex gap-3 rounded-2xl p-4 text-sm"}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone === "warn" ? "text-warning" : "text-text-secondary"} ${spin ? "animate-spin motion-reduce:animate-none" : ""}`} />
      <div className="min-w-0 space-y-0.5">{children}</div>
    </div>
  )
}

const DELETE_REFUSED: Record<string, string> = {
  not_synced: "Espera a que la revisión esté sincronizada para borrarla.",
  pending: "Hay cambios de esta revisión sin enviar. Espera a que se sincronicen.",
  closing: "La revisión se está cerrando. Cancela el cierre antes de borrarla.",
  confirmation_required: "Escribe «borrar» para confirmar.",
}

/** Exceptional delete (D52): never automatic, typed confirmation, on the exact synced version. */
export function DeleteDialog({ m, period, label, open, onOpenChange, onDeleted }: { m: ReviewsModel; period: Period; label: string; open: boolean; onOpenChange: (o: boolean) => void; onDeleted: () => void }) {
  const id = useId()
  const [typed, setTyped] = useState("")
  const [error, setError] = useState<string | null>(null)
  const ok = typed.trim().toLowerCase() === "borrar"
  function confirm() {
    if (!ok) return
    const r = m.api.deleteReview(period.kind, period.from, "delete")
    if (!r.ok) {
      setError(DELETE_REFUSED[r.reason])
      return
    }
    onOpenChange(false)
    toast("Revisión borrada")
    onDeleted()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setTyped("")
        setError(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Borrar la revisión</DialogTitle>
          <DialogDescription>
            {label}. Se borra en todos tus dispositivos, con sus respuestas{period.kind === "day" ? "" : ", decisiones y evaluaciones"}. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor={id} className="text-sm">
            Escribe <span className="font-semibold">borrar</span> para confirmar
          </label>
          <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-11 md:h-10" />
          {error && (
            <p role="alert" className="text-xs text-warning">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={!ok} data-testid="review-delete-confirm">
            <Trash2 aria-hidden />
            Borrar definitivamente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
