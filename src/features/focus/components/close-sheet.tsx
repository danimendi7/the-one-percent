"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { activeMs, instantAtActive } from "../domain/time"
import { MIN_ACTIVE_SECONDS, type FocusSession } from "../domain/types"
import type { FocusModel } from "../use-focus"
import { InterruptionsInput, minutesLabel, RatingInput, reasonText } from "./focus-ui"

/**
 * «Cierre». Opened after «Terminar», which pauses the session first so its time freezes on
 * every device. Closing the sheet without choosing leaves it paused, ready to resume.
 */
export function CloseSheet({ fm, session, onOpenChange }: { fm: FocusModel; session: FocusSession | null; onOpenChange: (open: boolean) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={session !== null} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl border-x-0")}>
        {session && <CloseForm key={session.id} fm={fm} session={session} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function CloseForm({ fm, session, onDone }: { fm: FocusModel; session: FocusSession; onDone: () => void }) {
  const ids = { minutes: useId(), actual: useId() }
  // Paused before opening: this is the session's final effective time.
  const [frozenAt] = useState(() => fm.api.clockNow())
  const realSeconds = Math.floor(activeMs(session.segments, frozenAt) / 1000)
  const realMinutes = Math.floor(realSeconds / 60)
  // Capped at the 12 h limit, so a forgotten timer can be saved by cutting it.
  const [minutes, setMinutes] = useState(String(Math.min(720, Math.max(1, Math.round(realSeconds / 60)))))
  const [actual, setActual] = useState("")
  const [rating, setRating] = useState<number | null>(null)
  const [interruptions, setInterruptions] = useState<number | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const tooShort = realSeconds < MIN_ACTIVE_SECONDS
  const m = Number(minutes)
  const minutesError = !Number.isInteger(m) || m < 1 ? "Escribe los minutos efectivos." : m > Math.max(1, Math.round(realSeconds / 60)) ? `Como máximo ${minutesLabel(Math.round(realSeconds / 60))}: solo se puede ajustar a la baja.` : null

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (tooShort || minutesError) return
    // Lowering the minutes cuts the session at the moment it reached them.
    const trim = m * 60 < realSeconds - 30 ? instantAtActive(session.segments, m * 60, frozenAt) : null
    const r = fm.api.finishFocus(session.id, { trimTo: trim === null ? null : new Date(trim).toISOString(), actualOutput: actual || null, rating, interruptions })
    if (!r.ok) return toast.error(reasonText(r.reason))
    toast.success(`Bloque guardado · ${minutesLabel(m)}`, { description: fm.saved ? undefined : "Sin guardar en tu cuenta: el servidor aún no admite sesiones." })
    onDone()
  }

  function discard() {
    fm.api.discardFocus(session.id)
    toast("Sesión descartada", { description: "No cuenta en ningún dato." })
    onDone()
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
        <SheetTitle className="text-lg">Terminar bloque</SheetTitle>
        <SheetDescription>
          {session.project ? `${session.project} · ` : ""}
          {minutesLabel(realMinutes)} efectivos de {session.plannedMinutes} previstos. La sesión está en pausa.
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {tooShort ? (
          <p role="alert" className="rounded-xl border border-warning/40 bg-warning/8 px-4 py-3 text-sm text-warning">
            Menos de 1 minuto efectivo: no se puede guardar. Descártala o cierra esta hoja y reanúdala.
          </p>
        ) : (
          <div className="space-y-2">
            <Label htmlFor={ids.minutes}>Minutos efectivos</Label>
            <Input
              id={ids.minutes}
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))}
              aria-invalid={!!minutesError}
              aria-describedby={`${ids.minutes}-hint`}
              className="num h-11 w-32"
            />
            <p id={`${ids.minutes}-hint`} className={cn("text-xs", minutesError ? "text-error" : "text-text-tertiary")}>
              {minutesError ?? "Bájalos si dejaste el temporizador en marcha sin trabajar."}
            </p>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={ids.actual}>
            Resultado real <span className="font-normal text-text-tertiary">(opcional)</span>
          </Label>
          {session.plannedOutput && <p className="text-xs text-text-tertiary">Previsto: {session.plannedOutput}</p>}
          <Textarea id={ids.actual} value={actual} onChange={(e) => setActual(e.target.value)} maxLength={500} rows={2} placeholder="Qué has conseguido" />
        </div>
        <RatingInput value={rating} onChange={setRating} />
        <InterruptionsInput value={interruptions} onChange={setInterruptions} />
      </div>
      <SheetFooter className="pb-safe flex-row items-center gap-2 border-t border-border px-5 py-4">
        {confirmDiscard ? (
          <>
            <span className="mr-auto text-sm text-text-secondary">¿Descartar sin contar tiempo?</span>
            <Button type="button" variant="ghost" onClick={() => setConfirmDiscard(false)}>
              No
            </Button>
            <Button type="button" variant="destructive" onClick={discard}>
              Descartar
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" className="text-text-secondary" onClick={() => setConfirmDiscard(true)}>
              Descartar sesión
            </Button>
            <Button type="submit" className="ml-auto min-w-32" disabled={tooShort}>
              Guardar
            </Button>
          </>
        )}
      </SheetFooter>
    </form>
  )
}
