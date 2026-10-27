"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { addDays, type LocalDate } from "@/features/habits/domain/dates"
import { habitActions } from "@/features/habits/store/habit-store"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { measurementKey, type Goal, type MeasurementMap } from "../domain/types"
import { formatValue } from "./goal-ui"

const REASONS: Record<string, string> = {
  future: "No se puede registrar un día futuro.",
  before_start: "La fecha es anterior al inicio del objetivo.",
  invalid_value: "Escribe un número válido.",
  not_manual: "Este objetivo se alimenta de un hábito: registra en el hábito.",
  unknown_goal: "El objetivo ya no existe.",
}

/** Measurement in ≤ 3 taps: value (focused), day (today by default), save. One per day: saving again replaces it. */
export function MeasureSheet({
  goal,
  today,
  measurements,
  initialDate,
  onOpenChange,
}: {
  goal: Goal | null
  today: LocalDate
  measurements: MeasurementMap
  initialDate?: LocalDate
  onOpenChange: (open: boolean) => void
}) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={goal !== null} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-sm" : "rounded-t-3xl border-x-0")}>
        {goal && <MeasureForm key={goal.id + (initialDate ?? "")} goal={goal} today={today} measurements={measurements} initialDate={initialDate} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function MeasureForm({ goal, today, measurements, initialDate, onDone }: { goal: Goal; today: LocalDate; measurements: MeasurementMap; initialDate?: LocalDate; onDone: () => void }) {
  const ids = { value: useId(), date: useId(), note: useId() }
  const unit = goal.numeric?.unit ?? ""
  const [date, setDate] = useState<LocalDate>(initialDate ?? today)
  const existing = measurements[measurementKey(goal.id, date)]
  const [value, setValue] = useState(existing ? String(existing.value).replace(".", ",") : "")
  const [note, setNote] = useState(existing?.note ?? "")
  const [error, setError] = useState<string | null>(null)
  const preset = date === today ? "today" : date === addDays(today, -1) ? "yesterday" : "other"
  const last = Object.values(measurements)
    .filter((m) => m.goalId === goal.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]

  function pick(d: LocalDate) {
    setDate(d)
    const m = measurements[measurementKey(goal.id, d)]
    setValue(m ? String(m.value).replace(".", ",") : "")
    setNote(m?.note ?? "")
    setError(null)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(value.replace(",", "."))
    if (value.trim() === "" || !Number.isFinite(n)) return setError("Escribe un número válido.")
    const r = habitActions.setMeasurement(goal.id, date, n, note)
    if (!r.ok) return setError(REASONS[r.reason] ?? "No se pudo guardar.")
    toast.success(`${formatValue(n, unit)} registrado`, { description: existing ? "Sustituye al valor anterior de ese día." : undefined })
    onDone()
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
        <SheetTitle className="text-lg">Registrar medición</SheetTitle>
        <SheetDescription className="line-clamp-2">
          {goal.title}
          {last && ` · última: ${formatValue(last.value, unit)}`}
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-5 py-5">
        <div className="space-y-2">
          <Label htmlFor={ids.value}>Valor{unit && ` (${unit})`}</Label>
          <Input
            id={ids.value}
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,-]/g, ""))}
            aria-invalid={!!error}
            aria-describedby={error ? `${ids.value}-err` : undefined}
            className="num h-12 text-lg"
          />
          {error && (
            <p id={`${ids.value}-err`} role="alert" className="text-xs text-error">
              {error}
            </p>
          )}
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Día</legend>
          <Segmented
            label="Día"
            value={preset}
            onChange={(v) => (v === "today" ? pick(today) : v === "yesterday" ? pick(addDays(today, -1)) : pick(date))}
            options={[
              { value: "today", label: "Hoy" },
              { value: "yesterday", label: "Ayer" },
              { value: "other", label: "Otro día" },
            ]}
          />
          {preset === "other" && (
            <Input id={ids.date} type="date" aria-label="Fecha de la medición" value={date} min={goal.startDate} max={today} onChange={(e) => e.target.value && pick(e.target.value)} className="h-11" />
          )}
          {existing && <p className="text-xs text-text-tertiary">Ya hay {formatValue(existing.value, unit)} ese día: se sustituirá.</p>}
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor={ids.note}>Nota (opcional)</Label>
          <Input id={ids.note} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className="h-11" autoComplete="off" />
        </div>
      </div>
      <SheetFooter className="pb-safe border-t border-border px-5 py-4">
        <Button type="submit" className="h-11 w-full">
          Guardar
        </Button>
      </SheetFooter>
    </form>
  )
}
