"use client"

import { useId, useState } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { num } from "@/components/common/format"
import { formatDate, type LocalDate } from "../domain/dates"
import type { Habit } from "../domain/types"
import { targetLabel } from "./cell-state"

function stepFor(habit: Habit): number {
  if (habit.unit === "pasos") return 500
  if (habit.type === "duration") return 5
  return 1
}

/** QuantitativeQuickEntry (DESIGN_SYSTEM): stepper + direct entry for numeric/duration habits. */
export function QuickEntry({
  habit,
  date,
  initial,
  onSave,
  onClear,
}: {
  habit: Habit
  date: LocalDate
  initial: number | null
  onSave: (value: number) => void
  onClear: () => void
}) {
  const id = useId()
  const step = stepFor(habit)
  const [raw, setRaw] = useState(initial !== null ? String(initial) : "")
  const value = raw === "" ? null : Number(raw.replace(",", "."))
  const valid = value !== null && Number.isFinite(value) && value >= 0
  const met =
    valid && habit.target !== undefined &&
    (habit.direction === "at_most" ? value! <= habit.target : value! >= habit.target)

  const bump = (delta: number) => {
    const base = valid ? value! : 0
    setRaw(String(Math.max(0, Math.round((base + delta) * 100) / 100)))
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave(value!)
      }}
    >
      <div>
        <p className="text-sm font-semibold">{habit.name}</p>
        <p className="text-xs text-text-secondary">
          {formatDate(date, { weekday: "long", day: "numeric", month: "long" })} · objetivo {targetLabel(habit)}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" onClick={() => bump(-step)} aria-label={`Restar ${num(step)}`}>
          <Minus />
        </Button>
        <div className="relative flex-1">
          <Label htmlFor={id} className="sr-only">
            Valor en {habit.unit}
          </Label>
          <Input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={raw}
            onChange={(e) => setRaw(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0"
            className="num h-11 pr-16 text-center text-lg font-semibold"
            aria-invalid={raw !== "" && !valid}
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-text-tertiary">
            {habit.unit}
          </span>
        </div>
        <Button type="button" variant="outline" size="icon" onClick={() => bump(step)} aria-label={`Sumar ${num(step)}`}>
          <Plus />
        </Button>
      </div>

      <p className="min-h-5 text-xs" aria-live="polite">
        {valid ? (
          met ? (
            <span className="text-signal">Objetivo cumplido</span>
          ) : (
            <span className="text-warning">
              {habit.direction === "at_most" ? "Por encima del límite" : "Por debajo del objetivo"}: se guarda igualmente
            </span>
          )
        ) : (
          <span className="text-text-tertiary">Introduce la cantidad exacta.</span>
        )}
      </p>

      <div className="flex gap-2">
        {initial !== null && (
          <Button type="button" variant="ghost" onClick={onClear} className="text-text-secondary">
            Borrar
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={!valid}>
          Guardar
        </Button>
      </div>
    </form>
  )
}
