"use client"

import { Star } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { FocusRejection } from "../domain/ops"

export const FOCUS_REASON: Record<string, string> = {
  session_active: "Ya hay un bloque en curso. Termínalo o descártalo antes de empezar otro.",
  session_not_found: "La sesión ya no existe.",
  not_active: "La sesión ya estaba terminada.",
  not_finished: "Solo se pueden editar sesiones terminadas.",
  invalid_minutes: "La duración va de 1 a 720 minutos.",
  invalid_habit: "Solo se pueden vincular hábitos de duración.",
  too_short: "Menos de 1 minuto efectivo: no se guarda.",
  invalid_rating: "La valoración va de 1 a 5.",
  segments_future: "Las horas no pueden estar en el futuro.",
  segments_order: "La hora de fin no puede ser anterior a la de inicio.",
  segments_overlap: "Los tramos de la sesión se solapan.",
  segments_too_long: "Una sesión dura como máximo 12 horas efectivas.",
  segments_empty: "La sesión no tiene tiempo.",
  segments_open: "La sesión tiene un tramo sin cerrar.",
}

export function reasonText(r: FocusRejection | string): string {
  return FOCUS_REASON[r] ?? "No se pudo guardar."
}

/** Minutes as «1 h 05 min» / «45 min». */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`
}

export const NO_PROJECT_LABEL = "Sin proyecto"

/** Optional 1–5 rating. Tapping the selected value clears it. ≥ 44 px targets. */
export function RatingInput({ value, onChange, label = "Valoración (opcional)" }: { value: number | null; onChange: (v: number | null) => void; label?: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value !== null && n <= value
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} de 5`}
              onClick={() => onChange(value === n ? null : n)}
              className={cn(
                "grid size-11 place-items-center rounded-xl border transition-colors",
                on ? "border-signal/50 bg-signal/10 text-signal" : "border-border text-text-tertiary hover:bg-surface-raised"
              )}
            >
              <Star className="size-[18px]" fill={on ? "currentColor" : "none"} strokeWidth={1.75} aria-hidden />
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Read-only rating (history rows). */
export function RatingStars({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-text-tertiary">Sin valorar</span>
  return (
    <span className="inline-flex items-center gap-0.5 text-signal" role="img" aria-label={`Valoración ${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("size-3", n > value && "text-text-tertiary/50")} fill={n <= value ? "currentColor" : "none"} strokeWidth={1.75} aria-hidden />
      ))}
    </span>
  )
}

/** Project input with one-tap suggestions from history (decision 4). */
export function ProjectField({
  id,
  value,
  onChange,
  suggestions,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  suggestions: string[]
}) {
  const q = value.trim().toLocaleLowerCase("es-ES")
  const shown = suggestions.filter((s) => s.toLocaleLowerCase("es-ES") !== q && (!q || s.toLocaleLowerCase("es-ES").includes(q))).slice(0, 5)
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        Proyecto <span className="font-normal text-text-tertiary">(opcional)</span>
      </label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={60} autoComplete="off" placeholder="Tesis, Producto…" className="h-11" />
      {shown.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Proyectos anteriores">
          {shown.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className="inline-flex min-h-11 items-center rounded-full border border-border px-3.5 text-xs text-text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
