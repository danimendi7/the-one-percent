"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { CloudOff, Lock, PenLine } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import type { LocalDate } from "@/features/habits/domain/dates"
import { dailyRates } from "@/features/habits/domain/metrics"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { minutesLabel } from "@/features/focus/components/focus-ui"
import { checkinDate, checkinFor, previousValue, visibleFields } from "../domain/ops"
import { focusMinutesByDay } from "../domain/metrics"
import { INDICATOR_LABEL, NOTE_MAX, type CheckinField, type CheckinPhase, type CheckinValues } from "../domain/types"
import { saveStatus, type MindModel } from "../use-mind"
import { dayLabel, phaseTitle, REASON, ScaleInput, SleepInput } from "./mind-ui"

export interface CheckinTarget {
  date: LocalDate
  phase: CheckinPhase
  /** "now": switching phase recomputes the day from the clock (04:00 rule); "day": the day is fixed (history). */
  mode: "now" | "day"
}

/**
 * The 15–30 s check-in (plan §2.1). Every tap is saved at once as its own desired state; there is
 * no «Guardar». The day it counts for is always written out (decision 2).
 */
export function CheckinSheet({ m, target, onOpenChange }: { m: MindModel; target: CheckinTarget | null; onOpenChange: (open: boolean) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[94dvh] rounded-t-3xl border-x-0")}>
        {target && <CheckinForm m={m} initial={target} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function CheckinForm({ m, initial, onDone }: { m: MindModel; initial: CheckinTarget; onDone: () => void }) {
  const [target, setTarget] = useState(initial)
  const [confirmClear, setConfirmClear] = useState(false)
  // Inline undo (inside the dialog, so it is reachable by keyboard and screen readers).
  const [undo, setUndo] = useState<{ field: Exclude<CheckinField, "note">; value: number } | null>(null)
  const { date, phase } = target
  const c = checkinFor(m.state, date, phase)
  const fields = visibleFields(m.state, phase, c)
  const disabled = !m.saved

  function switchPhase(p: CheckinPhase) {
    setConfirmClear(false)
    setUndo(null)
    setTarget({ ...target, phase: p, date: target.mode === "now" ? checkinDate(m.clockNow(), p, m.timezone) : target.date })
  }

  function set(values: CheckinValues) {
    const r = m.api.setCheckin(date, phase, values)
    if (!r.ok) toast.error(REASON[r.reason] ?? "No se pudo guardar.")
    return r.ok
  }

  function setField(field: Exclude<CheckinField, "note">, v: number | null) {
    const before = c?.[field] ?? null
    if (!set({ [field]: v })) return
    setUndo(v === null && before !== null ? { field, value: before } : null)
  }

  function clearAll() {
    set({ sleep: null, energy: null, mood: null, stress: null, note: null })
    setConfirmClear(false)
    toast("Check-in borrado")
  }

  const isToday = date === m.today
  return (
    <>
      <SheetHeader className="border-b border-border/70 px-5 pt-5 pb-4">
        <SheetTitle>{phaseTitle(phase)}</SheetTitle>
        <SheetDescription data-testid="checkin-date">
          {isToday ? "Hoy, " : ""}
          {isToday ? dayLabel(date).toLocaleLowerCase("es-ES") : dayLabel(date)}
          {phase === "pm" && target.mode === "now" && !isToday && " · cierras ese día"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <Segmented
          label="Momento del día"
          value={phase}
          onChange={(v) => switchPhase(v as CheckinPhase)}
          options={[
            { value: "am", label: "Mañana" },
            { value: "pm", label: "Noche" },
          ]}
        />
        {disabled && (
          <p role="note" className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/8 px-3.5 py-3 text-sm leading-relaxed text-warning">
            <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
            Tu cuenta aún no guarda check-ins. Estarán disponibles cuando se active Mente y energía en el servidor.
          </p>
        )}
        {phase === "pm" && <DayContext m={m} date={date} />}

        {fields.map((f) =>
          f === "note" ? (
            <NoteField key={`${date}:${phase}:note`} phase={phase} value={c?.note ?? null} disabled={disabled} onSave={(text) => set({ note: text })} />
          ) : f === "sleep" ? (
            <SleepInput key={f} value={c?.sleep ?? null} previous={previousValue(m.state, date, phase, "sleep")} onChange={(v) => setField("sleep", v)} disabled={disabled} />
          ) : (
            <ScaleInput key={f} field={f} value={c?.[f] ?? null} previous={previousValue(m.state, date, phase, f)} onChange={(v) => setField(f, v)} disabled={disabled} />
          )
        )}
        {!fields.includes("note") && (
          <p className="text-xs text-text-tertiary">La reflexión está oculta en este momento del día. Puedes activarla en «Indicadores».</p>
        )}
      </div>

      <div className="border-t border-border/70 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex min-h-5 items-center justify-between gap-3">
          <p className="text-xs text-text-tertiary" role="status" aria-live="polite">
            {undo ? `${INDICATOR_LABEL[undo.field]}: valor borrado` : c && !disabled ? saveStatus(m) : "Cada toque se guarda al momento"}
          </p>
          {undo && (
            <Button
              variant="ghost"
              size="sm"
              className="-my-2 h-11 shrink-0"
              onClick={() => {
                set({ [undo.field]: undo.value })
                setUndo(null)
              }}
            >
              Deshacer
            </Button>
          )}
        </div>
        {confirmClear ? (
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setConfirmClear(false)}>
              Volver
            </Button>
            <Button variant="destructive" className="flex-1" onClick={clearAll}>
              Borrar este check-in
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            {c && !disabled && (
              <Button variant="ghost" onClick={() => setConfirmClear(true)}>
                Borrar
              </Button>
            )}
            <Button className="flex-1" onClick={onDone}>
              Listo
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

/** Read-only evening context: what the day held, so the reflection needs no new data. */
function DayContext({ m, date }: { m: MindModel; date: LocalDate }) {
  const s = m.state
  const r = dailyRates(s.habits, { from: date, to: date }, { entries: s.entries, restDays: new Set(s.restDays), today: m.today })[0]
  const focus = Math.round(focusMinutesByDay(s, { from: date, to: date }).get(date) ?? 0)
  const parts = [r && r.applicable > 0 ? `${r.fulfilled} de ${r.applicable} hábitos` : "Sin hábitos programados", focus > 0 ? `${minutesLabel(focus)} de enfoque` : "sin enfoque"]
  return (
    <p className="rounded-xl bg-surface-raised/60 px-3.5 py-2.5 text-sm text-text-secondary" data-testid="checkin-context">
      <span className="text-text-tertiary">{date === m.today ? "Hoy" : "Ese día"}: </span>
      {parts.join(" · ")}
    </p>
  )
}

/** Optional, private, folded by default. Saved 800 ms after typing stops and when leaving the field. */
function NoteField({ phase, value, disabled, onSave }: { phase: CheckinPhase; value: string | null; disabled: boolean; onSave: (text: string) => void }) {
  const id = useId()
  const [open, setOpen] = useState(value !== null)
  const [text, setText] = useState(value ?? "")
  const [editing, setEditing] = useState(false)
  const [seen, setSeen] = useState(value)
  // Another device changed the reflection: adopt it unless the user is typing right now.
  if (value !== seen) {
    setSeen(value)
    if (!editing) setText(value ?? "")
  }
  const pending = useRef<{ text: string; timer: number | null }>({ text: value ?? "", timer: null })
  const save = useRef(onSave)
  useEffect(() => {
    save.current = onSave
  })
  const flush = useCallback(() => {
    const p = pending.current
    if (p.timer === null) return
    window.clearTimeout(p.timer)
    p.timer = null
    save.current(p.text)
  }, [])
  // Closing the sheet never loses what was typed.
  useEffect(() => flush, [flush])

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-border px-3.5 text-sm text-text-secondary hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
      >
        <PenLine className="size-4" aria-hidden /> Añadir reflexión <span className="text-text-tertiary">(opcional)</span>
      </button>
    )
  }
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        Reflexión <span className="font-normal text-text-tertiary">(opcional)</span>
      </label>
      <Textarea
        id={id}
        rows={3}
        maxLength={NOTE_MAX}
        disabled={disabled}
        autoFocus={value === null}
        placeholder={phase === "am" ? "¿Qué importa hoy?" : "¿Qué ha ido bien? ¿Qué cambiarías?"}
        value={text}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false)
          flush()
        }}
        onChange={(e) => {
          const v = e.target.value
          setText(v)
          const p = pending.current
          p.text = v
          if (p.timer !== null) window.clearTimeout(p.timer)
          p.timer = window.setTimeout(() => {
            p.timer = null
            save.current(p.text)
          }, 800)
        }}
      />
      <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
        <Lock className="size-3" aria-hidden /> Privada: no aparece en notificaciones, IA ni estadísticas.
      </p>
    </div>
  )
}
