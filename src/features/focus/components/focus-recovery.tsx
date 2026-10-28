"use client"

import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { activeMs, hhmm, minutesOf, needsRecovery, plannedEndAt } from "../domain/time"
import { useFocusModel, useNow } from "../use-focus"
import { minutesLabel, reasonText } from "./focus-ui"

const KEY = "the-one-percent:focus:recovery-dismissed"

function dismissed(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}

function remember(id: string) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify([...dismissed(), id]))
  } catch {
    // per-tab convenience only
  }
}

/**
 * «¿Sigue en curso?» (decision 5): an active session never closes on its own. When the app is
 * opened with a running session past its plan + 30 min, the user chooses what really happened.
 */
export function FocusRecovery() {
  const fm = useFocusModel()
  const router = useRouter()
  const session = fm?.active ?? null
  const now = useNow(false, fm?.api.clockNow ?? Date.now)
  const [handled, setHandled] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const continueRef = useRef<HTMLButtonElement>(null)
  if (!fm || !session || handled === session.id || !needsRecovery(session, now) || dismissed().has(session.id)) return null

  const end = plannedEndAt(session, now)
  const elapsed = minutesOf(activeMs(session.segments, now) / 1000)
  const close = () => {
    setHandled(session.id)
    setConfirmDiscard(false)
  }

  function keep() {
    remember(session!.id)
    close()
  }

  function finishAt() {
    const r = fm!.api.finishFocus(session!.id, { trimTo: end === null ? null : new Date(end).toISOString() })
    close()
    if (!r.ok) return toast.error(reasonText(r.reason))
    toast.success(`Bloque guardado · ${minutesLabel(session!.plannedMinutes)}`, {
      description: "Puedes añadir el resultado y la valoración desde el historial.",
      action: { label: "Añadir", onClick: () => router.push(`/focus?sesion=${session!.id}`) },
    })
  }

  function discard() {
    fm!.api.discardFocus(session!.id)
    close()
    toast("Sesión descartada", { description: "No cuenta en ningún dato." })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && keep()}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          // The safe choice gets the initial focus, never the destructive one.
          e.preventDefault()
          continueRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>¿Sigue en curso?</DialogTitle>
          <DialogDescription>
            El bloque{session.project ? ` de «${session.project}»` : ""} lleva {minutesLabel(elapsed)} en marcha; lo previsto eran {session.plannedMinutes} min. Nada se
            ha cerrado solo.
          </DialogDescription>
        </DialogHeader>
        {confirmDiscard ? (
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Volver
            </Button>
            <Button variant="destructive" onClick={discard}>
              Descartar sin contar tiempo
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
              Descartar
            </Button>
            {end !== null && (
              <Button variant="outline" onClick={finishAt}>
                Terminar a las {hhmm(end, fm.timezone)}
              </Button>
            )}
            <Button ref={continueRef} onClick={keep}>
              Continuar
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
