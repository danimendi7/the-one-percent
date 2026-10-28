"use client"

import { useId, useRef } from "react"
import { Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { capitalize, formatDate, type LocalDate } from "@/features/habits/domain/dates"
import { INDICATOR_LABEL, SCALE_WORDS, SLEEP_MAX, SLEEP_STEP, type Checkin, type CheckinPhase, type Indicator } from "../domain/types"

export const REASON: Record<string, string> = {
  future_date: "No se pueden registrar días futuros.",
  invalid_date: "La fecha no es válida.",
  invalid_value: "El valor no es válido.",
  invalid_config: "Deja al menos un indicador activo en cada momento del día.",
}

/** Identity colour of each indicator in charts (tokens only; stress is neutral on purpose). */
export const INDICATOR_COLOR: Record<Indicator, string> = {
  sleep: "var(--dim-mind)",
  energy: "var(--dim-body)",
  mood: "var(--dim-learn)",
  stress: "var(--text-secondary)",
}

/** «7 h 15 min» / «7 h». */
export function sleepLabel(h: number | null): string {
  if (h === null) return "—"
  const whole = Math.floor(h)
  const min = Math.round((h - whole) * 60)
  return min ? `${whole} h ${String(min).padStart(2, "0")} min` : `${whole} h`
}

export function valueText(field: Indicator, v: number | null): string {
  if (v === null) return "Sin dato"
  if (field === "sleep") return sleepLabel(v)
  return `${v} · ${SCALE_WORDS[field][v - 1]}`
}

/** «Martes 28 de octubre» (Intl adds a comma after the weekday; the app writes dates without it). */
export function dayLabel(date: LocalDate): string {
  return capitalize(formatDate(date, { weekday: "long", day: "numeric", month: "long" }).replace(",", ""))
}

export function phaseTitle(phase: CheckinPhase): string {
  return phase === "am" ? "Check-in de mañana" : "Check-in de noche"
}

/** Compact summary of a check-in: «7 h 15 · Energía 4 · Ánimo 3». */
export function checkinSummary(c: Checkin | null): string {
  if (!c) return "Pendiente"
  const parts: string[] = []
  if (c.sleep !== null) parts.push(sleepLabel(c.sleep).replace(" min", ""))
  for (const f of ["energy", "mood", "stress"] as const) if (c[f] !== null) parts.push(`${INDICATOR_LABEL[f]} ${c[f]}`)
  if (!parts.length && c.note) parts.push("Solo reflexión")
  return parts.join(" · ")
}

/**
 * 1–5 scale as five ≥ 44 px buttons (decision 1). A radiogroup with arrow-key navigation;
 * tapping the selected value clears it. Yesterday's value is a discreet marker, never pre-filled.
 */
export function ScaleInput({
  field,
  value,
  previous,
  onChange,
  disabled,
}: {
  field: Exclude<Indicator, "sleep">
  value: number | null
  previous: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
}) {
  const words = SCALE_WORDS[field]
  const labelId = useId()
  const prevId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const focusable = value ?? 3

  function onKey(e: React.KeyboardEvent, n: number) {
    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? Math.min(5, n + 1) : e.key === "ArrowLeft" || e.key === "ArrowDown" ? Math.max(1, n - 1) : null
    if (next === null) return
    e.preventDefault()
    refs.current[next - 1]?.focus()
    onChange(next)
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span id={labelId} className="font-medium">
          {INDICATOR_LABEL[field]}
        </span>
        <span className="num text-text-secondary" aria-hidden>
          {value === null ? "—" : words[value - 1]}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={labelId} aria-describedby={previous !== null ? prevId : undefined} className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            ref={(el) => {
              refs.current[n - 1] = el
            }}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n}, ${words[n - 1]}`}
            tabIndex={n === focusable ? 0 : -1}
            disabled={disabled}
            onKeyDown={(e) => onKey(e, n)}
            onClick={() => onChange(value === n ? null : n)}
            className={cn(
              "num relative h-12 rounded-xl border text-base font-medium transition-colors active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100",
              value === n ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary hover:bg-surface-raised hover:text-foreground"
            )}
          >
            {n}
            {previous === n && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-text-tertiary" aria-hidden />}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[0.6875rem] text-text-tertiary">
        <span>{words[0]}</span>
        {previous !== null && (
          <span id={prevId}>
            <span className="mr-1 inline-block size-1.5 rounded-full bg-text-tertiary align-middle" aria-hidden />
            Ayer: {previous}
          </span>
        )}
        <span>{words[4]}</span>
      </div>
    </div>
  )
}

const QUICK_SLEEP = [5, 6, 7, 8, 9] as const

/** Hours slept: quick values plus a ±15 min stepper (0–16 h). Tapping the selected quick value clears it. */
export function SleepInput({ value, previous, onChange, disabled }: { value: number | null; previous: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const labelId = useId()
  const step = (d: number) => {
    const base = value ?? previous ?? 7
    onChange(Math.min(SLEEP_MAX, Math.max(0, Math.round((base + d) / SLEEP_STEP) * SLEEP_STEP)))
  }
  return (
    <div role="group" aria-labelledby={labelId}>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span id={labelId} className="font-medium">
          Sueño
        </span>
        <span className="num text-text-secondary">{value === null ? "—" : sleepLabel(value)}</span>
      </div>
      <div className="grid grid-cols-[repeat(5,minmax(0,1fr))_auto] gap-1.5">
        {QUICK_SLEEP.map((h) => (
          <button
            key={h}
            type="button"
            aria-pressed={value === h}
            aria-label={`${h} horas`}
            disabled={disabled}
            onClick={() => onChange(value === h ? null : h)}
            className={cn(
              "num relative h-12 rounded-xl border text-base font-medium transition-colors active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100",
              value === h ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary hover:bg-surface-raised hover:text-foreground"
            )}
          >
            {h}
            {previous === h && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-text-tertiary" aria-hidden />}
          </button>
        ))}
        <div className="flex rounded-xl border border-border">
          <button
            type="button"
            aria-label="15 minutos menos"
            disabled={disabled || value === 0}
            onClick={() => step(-SLEEP_STEP)}
            className="grid h-12 w-11 place-items-center rounded-l-xl text-text-secondary hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="15 minutos más"
            disabled={disabled || value === SLEEP_MAX}
            onClick={() => step(SLEEP_STEP)}
            className="grid h-12 w-11 place-items-center rounded-r-xl border-l border-border text-text-secondary hover:bg-surface-raised hover:text-foreground disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {previous !== null && (
        <p className="mt-1.5 text-right text-[0.6875rem] text-text-tertiary">
          <span className="mr-1 inline-block size-1.5 rounded-full bg-text-tertiary align-middle" aria-hidden />
          Ayer: {sleepLabel(previous)}
        </p>
      )}
    </div>
  )
}
