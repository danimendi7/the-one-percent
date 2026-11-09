"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { libraryActions } from "../store/use-library"

/** After this long still saving on the device, the assistant says so (it keeps waiting). */
const SLOW_SAVE_MS = 3000

export type DeviceSaveState = "saving" | "slow" | "failed" | null

/**
 * M4-H1 in the assistants (M4g): what was just created opens only once it is stored on this device.
 * Offline, opening a page reloads the app, and a write still in progress was lost with it.
 * - `begin(value)`: after the create; `onSaved(value)` runs once the device copy is written;
 * - a refused write leaves `failed`; `retry()` writes the copy again, never a second create;
 * - `written`: what was created, so the assistant neither creates it again nor lists it as a duplicate.
 */
export function useDeviceSave(onSaved: (value: string) => void) {
  const [state, setState] = useState<DeviceSaveState>(null)
  const [written, setWritten] = useState<string | null>(null)
  const pending = useRef<string | null>(null)
  const alive = useRef(true)
  const done = useRef(onSaved)
  useEffect(() => {
    done.current = onSaved
  }, [onSaved])
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])

  async function settle(value: string) {
    pending.current = value
    setWritten(value)
    setState("saving")
    const slow = setTimeout(() => setState((s) => (s === "saving" ? "slow" : s)), SLOW_SAVE_MS)
    const ok = await libraryActions.saved()
    clearTimeout(slow)
    if (!alive.current) return
    if (!ok) return setState("failed")
    done.current(value)
  }

  return {
    state,
    written,
    /** Saving or failed: what was written must not be written, left or opened elsewhere again. */
    locked: state !== null,
    waiting: state === "saving" || state === "slow",
    /** Synchronous: a second tap in the same moment already sees the first create. */
    started: () => pending.current !== null,
    begin: (value: string) => void settle(value),
    retry: () => void (state === "failed" && pending.current && settle(pending.current)),
  }
}

export const SAVING_LABEL = "Guardando en este dispositivo…"

/**
 * M4g.5 · what a deleted page shows until the deletion is on the device: leaving earlier could lose it
 * offline, and the deleted content would come back without warning.
 */
export function RemovalPending({ state, onRetry }: { state: DeviceSaveState; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-3 py-10">
      {state === "failed" ? null : (
        <p role="status" className="text-sm text-text-secondary" data-testid="removal-saving">
          {SAVING_LABEL}
        </p>
      )}
      <DeviceSaveNotice state={state} failedText="No se ha podido guardar el borrado en este dispositivo (puede que falte espacio). Si cierras la app, volverá a aparecer: pulsa «Reintentar»." />
      {state === "failed" ? (
        <Button onClick={onRetry} data-testid="removal-retry">
          Reintentar
        </Button>
      ) : null}
    </div>
  )
}

const FAILED_TEXT = "No se ha podido guardar en este dispositivo (puede que falte espacio). Lo elegido sigue aquí: no cierres ni recargues la app y pulsa «Reintentar»."

export function DeviceSaveNotice({ state, failedText = FAILED_TEXT }: { state: DeviceSaveState; failedText?: string }) {
  if (state === "failed")
    return (
      <p role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning" data-testid="form-error">
        {failedText}
      </p>
    )
  if (state === "slow")
    return (
      <p role="status" className="rounded-xl border border-border px-3 py-2 text-sm text-text-secondary" data-testid="form-slow">
        Está tardando más de lo normal. Seguimos esperando a que quede guardado: no cierres ni recargues la app.
      </p>
    )
  return null
}
