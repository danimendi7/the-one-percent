"use client"

import { useRef } from "react"
import { ArrowDownRight, ArrowUpRight, CircleDashed, CloudCheck, CloudOff, Lock, LoaderCircle, Minus, PenLine, TriangleAlert, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDate, type LocalDate } from "@/features/habits/domain/dates"
import type { Period } from "../domain/periods"
import type { ReviewPhase } from "../domain/overview"
import type { ReviewKind } from "../domain/types"

export const KIND_LABEL: Record<ReviewKind, { title: string; noun: string; previous: string; next: string }> = {
  day: { title: "Revisión diaria", noun: "día", previous: "día anterior", next: "mañana" },
  week: { title: "Revisión semanal", noun: "semana", previous: "semana anterior", next: "la próxima semana" },
  month: { title: "Revisión mensual", noun: "mes", previous: "mes anterior", next: "el próximo mes" },
}

export function reviewHref(kind: ReviewKind, start: LocalDate): string {
  return `/reviews/${kind}/${start}`
}

/** The Revisiones page, on the tab of this kind. */
export function reviewsHomeHref(kind: ReviewKind): string {
  return kind === "month" ? "/reviews?tipo=mensual" : kind === "day" ? "/reviews?tipo=diaria" : "/reviews"
}

/** «mié, 21» / «19–25 oct» / «octubre» (compact, for rows). */
export function shortPeriod(p: Period): string {
  if (p.kind === "day") return formatDate(p.from, { weekday: "short", day: "numeric" })
  if (p.kind === "month") return formatDate(p.from, { month: "long" })
  const sameMonth = p.from.slice(0, 7) === p.to.slice(0, 7)
  const from = formatDate(p.from, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })
  return `${from}–${formatDate(p.to, { day: "numeric", month: "short" })}`
}

type BadgeId = ReviewPhase | "closing" | "late"
const BADGE: Record<BadgeId, { label: string; icon: LucideIcon; tone: string }> = {
  ready: { label: "Lista para revisar", icon: CircleDashed, tone: "border-signal/35 bg-signal/10 text-signal" },
  draft: { label: "Borrador", icon: PenLine, tone: "border-border bg-surface-raised/70 text-foreground" },
  closing: { label: "Cerrando", icon: LoaderCircle, tone: "border-warning/35 bg-warning/10 text-warning" },
  closed: { label: "Cerrada", icon: Lock, tone: "border-border bg-surface-raised/70 text-text-secondary" },
  late: { label: "Cerrada más tarde", icon: Lock, tone: "border-border bg-surface-raised/70 text-text-secondary" },
}

/** Review state as icon + text (never colour alone). */
export function StatusBadge({ phase, className }: { phase: BadgeId; className?: string }) {
  const b = BADGE[phase]
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[0.6875rem] font-medium", b.tone, className)}>
      <b.icon className="size-3" aria-hidden />
      {b.label}
    </span>
  )
}

const SAVE_ICON = { ok: CloudCheck, pending: LoaderCircle, warn: TriangleAlert } as const

/** The save line, announced politely. «Sincronizado» only when the server has it (see saveLine). */
export function SaveIndicator({ text, tone, offline, className }: { text: string; tone: "ok" | "pending" | "warn"; offline?: boolean; className?: string }) {
  const Icon = offline && tone !== "ok" ? CloudOff : SAVE_ICON[tone]
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="review-save"
      className={cn("flex min-w-0 items-center gap-1.5 text-xs", tone === "warn" ? "text-warning" : "text-text-tertiary", className)}
    >
      <Icon className={cn("size-3.5 shrink-0", tone === "pending" && !offline && "animate-spin motion-reduce:animate-none")} aria-hidden />
      <span className="truncate">{text}</span>
    </p>
  )
}

/** Signed change in points or units, with an arrow and words (never colour alone). */
export function Delta({ value, unit, against, compact, className }: { value: number | null; unit: string; against: string; compact?: boolean; className?: string }) {
  if (value === null) return null
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±"
  return (
    <span className={cn("num inline-flex items-center gap-0.5 text-xs text-text-secondary", className)}>
      <Icon className="size-3.5" aria-hidden />
      {sign}
      {Math.abs(value).toLocaleString("es-ES", { maximumFractionDigits: 1 })} {unit} <span className={compact ? "sr-only" : "text-text-tertiary"}>vs {against}</span>
    </span>
  )
}

/** «N/D» with its reason, for a figure without enough data. */
export function NotAvailable({ reason, className }: { reason: string; className?: string }) {
  return (
    <span className={cn("text-xs text-text-tertiary", className)}>
      <span className="num font-medium text-text-secondary">N/D</span> · {reason}
    </span>
  )
}

/**
 * Options as a ≥ 44 px radiogroup with roving focus and arrow keys (plan §6.3). Tapping the
 * selected option clears it when `clearable`.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  clearable,
  className,
}: {
  label: string
  value: T | null
  options: { value: T; label: string }[]
  onChange: (v: T | null) => void
  disabled?: boolean
  clearable?: boolean
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(0, options.findIndex((o) => o.value === value))
  function onKey(e: React.KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + options.length) % options.length
    refs.current[next]?.focus()
    onChange(options[next].value)
  }
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-1.5", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          tabIndex={i === current ? 0 : -1}
          disabled={disabled}
          onKeyDown={(e) => onKey(e, i)}
          onClick={() => onChange(value === o.value && clearable ? null : o.value)}
          className={cn(
            "min-h-11 rounded-xl border px-1.5 text-[0.8125rem] leading-tight font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
            value === o.value ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary hover:bg-surface-raised hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
