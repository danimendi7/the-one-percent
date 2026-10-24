"use client"

import { useId, useState } from "react"
import { Archive, Minus, Plus } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { WEEKDAY_LONG, WEEKDAY_SHORT, type Weekday } from "../domain/dates"
import type { HabitInput } from "../domain/ops"
import type { DimensionId, Habit, HabitType, ScheduleRule, TargetDirection } from "../domain/types"
import { habitActions } from "../store/habit-store"
import { DIMENSION_COLOR, HABIT_ICONS } from "./habit-icon"

const DIMENSIONS: { id: DimensionId; name: string }[] = [
  { id: "body", name: "Cuerpo" },
  { id: "mind", name: "Mente" },
  { id: "learn", name: "Aprendizaje" },
  { id: "work", name: "Trabajo" },
]

const TYPES: { id: HabitType; name: string; hint: string }[] = [
  { id: "binary", name: "Sí / No", hint: "Un toque para completarlo" },
  { id: "numeric", name: "Cantidad", hint: "Pasos, vasos, páginas…" },
  { id: "duration", name: "Duración", hint: "Minutos dedicados" },
]

type FreqKind = ScheduleRule["kind"]
const FREQS: { id: FreqKind; name: string }[] = [
  { id: "daily", name: "Cada día" },
  { id: "weekdays", name: "Días concretos" },
  { id: "weekly_count", name: "Veces por semana" },
]

const formSchema = z
  .object({
    name: z.string().trim().min(1, "Ponle un nombre.").max(60, "Máximo 60 caracteres."),
    type: z.enum(["binary", "numeric", "duration"]),
    target: z.number().optional(),
    unit: z.string().trim().max(24).optional(),
    weekdays: z.array(z.number()),
    freq: z.enum(["daily", "weekdays", "weekly_count"]),
  })
  .superRefine((v, ctx) => {
    if (v.type !== "binary") {
      if (v.target === undefined || !Number.isFinite(v.target) || v.target < 0) {
        ctx.addIssue({ code: "custom", path: ["target"], message: "Indica un objetivo numérico." })
      }
      if (v.type === "numeric" && !v.unit) {
        ctx.addIssue({ code: "custom", path: ["unit"], message: "Indica la unidad (p. ej. pasos)." })
      }
    }
    if (v.freq === "weekdays" && v.weekdays.length === 0) {
      ctx.addIssue({ code: "custom", path: ["weekdays"], message: "Elige al menos un día." })
    }
  })

type Errors = Partial<Record<"name" | "target" | "unit" | "weekdays", string>>

export function HabitFormSheet({
  open,
  onOpenChange,
  habit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit mode when provided */
  habit?: Habit | null
}) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "gap-0 p-0",
          desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl border-x-0"
        )}
      >
        {/* Remount per open so the form resets cleanly */}
        {open && <HabitForm key={habit?.id ?? "new"} habit={habit ?? null} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function HabitForm({ habit, onDone }: { habit: Habit | null; onDone: () => void }) {
  const editing = habit !== null
  const current = habit?.schedule[habit.schedule.length - 1]?.rule
  const ids = { name: useId(), target: useId(), unit: useId() }

  const [name, setName] = useState(habit?.name ?? "")
  const [icon, setIcon] = useState(habit?.icon ?? "check")
  const [dimensionId, setDimension] = useState<DimensionId>(habit?.dimensionId ?? "body")
  const [type, setType] = useState<HabitType>(habit?.type ?? "binary")
  const [target, setTarget] = useState(habit?.target !== undefined ? String(habit.target) : "")
  const [unit, setUnit] = useState(habit?.unit ?? "")
  const [direction, setDirection] = useState<TargetDirection>(habit?.direction ?? "at_least")
  const [freq, setFreq] = useState<FreqKind>(current?.kind ?? "daily")
  const [weekdays, setWeekdays] = useState<Weekday[]>(
    current?.kind === "weekdays" ? current.weekdays : [1, 2, 3, 4, 5]
  )
  const [times, setTimes] = useState(current?.kind === "weekly_count" ? current.timesPerWeek : 3)
  const [errors, setErrors] = useState<Errors>({})
  const [confirmArchive, setConfirmArchive] = useState(false)

  const effectiveUnit = type === "duration" ? "min" : unit

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = formSchema.safeParse({
      name,
      type,
      target: target === "" ? undefined : Number(target.replace(",", ".")),
      unit: effectiveUnit,
      weekdays,
      freq,
    })
    if (!parsed.success) {
      const next: Errors = {}
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof Errors
        if (!next[k]) next[k] = issue.message
      }
      setErrors(next)
      return
    }
    const rule: ScheduleRule =
      freq === "daily"
        ? { kind: "daily" }
        : freq === "weekdays"
          ? { kind: "weekdays", weekdays: [...weekdays].sort() }
          : { kind: "weekly_count", timesPerWeek: times }
    const input: HabitInput = {
      name: parsed.data.name,
      icon,
      dimensionId,
      type,
      rule,
      ...(type !== "binary" ? { target: parsed.data.target, unit: effectiveUnit, direction } : {}),
    }
    if (habit) {
      habitActions.updateHabit(habit.id, input)
      toast.success("Hábito actualizado", {
        description: "Los cambios de frecuencia se aplican desde hoy. El historial no se recalcula.",
      })
    } else {
      habitActions.addHabit(input)
      toast.success(`«${input.name}» creado`, { description: "Empieza a contar desde hoy." })
    }
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
        <SheetTitle className="text-lg">{editing ? "Editar hábito" : "Nuevo hábito"}</SheetTitle>
        <SheetDescription>
          {editing
            ? "El nombre y el icono se actualizan en todo el historial. La frecuencia cambia solo desde hoy."
            : "Datos locales de demostración. Se guardan en este navegador."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="space-y-2">
          <Label htmlFor={ids.name}>Nombre</Label>
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="off"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? `${ids.name}-err` : undefined}
            className="h-11"
          />
          {errors.name && <FieldError id={`${ids.name}-err`}>{errors.name}</FieldError>}
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Icono</legend>
          <div role="radiogroup" aria-label="Icono" className="grid grid-cols-6 gap-2 sm:grid-cols-9">
            {Object.entries(HABIT_ICONS).map(([key, { icon: Icon, label }]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={icon === key}
                aria-label={label}
                onClick={() => setIcon(key)}
                className={cn(
                  "grid aspect-square place-items-center rounded-xl border transition-colors",
                  icon === key
                    ? "border-signal/60 bg-signal/10 text-signal"
                    : "border-border text-text-secondary hover:bg-surface-raised"
                )}
              >
                <Icon className="size-[18px]" strokeWidth={1.85} />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Dimensión</legend>
          <div role="radiogroup" aria-label="Dimensión" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {DIMENSIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={dimensionId === d.id}
                onClick={() => setDimension(d.id)}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-xl border px-3 text-sm transition-colors",
                  dimensionId === d.id ? "border-foreground/40 bg-surface-raised text-foreground" : "border-border text-text-secondary hover:bg-surface-raised"
                )}
              >
                <span className="size-2 rounded-full" style={{ background: DIMENSION_COLOR[d.id] }} aria-hidden />
                {d.name}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Tipo de registro</legend>
          <Segmented
            label="Tipo de registro"
            value={type}
            onChange={(v) => setType(v as HabitType)}
            options={TYPES.map((t) => ({ value: t.id, label: t.name }))}
            disabled={editing}
          />
          <p className="mt-2 text-xs text-text-tertiary">
            {editing ? "El tipo no se puede cambiar para no alterar el historial." : TYPES.find((t) => t.id === type)?.hint}
          </p>
        </fieldset>

        {type !== "binary" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Segmented
                label="Dirección del objetivo"
                value={direction}
                onChange={(v) => setDirection(v as TargetDirection)}
                options={[
                  { value: "at_least", label: "Al menos" },
                  { value: "at_most", label: "Como máximo" },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.target}>Objetivo</Label>
              <Input
                id={ids.target}
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value.replace(/[^\d.,]/g, ""))}
                aria-invalid={!!errors.target}
                className="num h-11"
              />
              {errors.target && <FieldError>{errors.target}</FieldError>}
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.unit}>Unidad</Label>
              <Input
                id={ids.unit}
                value={effectiveUnit}
                onChange={(e) => setUnit(e.target.value)}
                disabled={type === "duration"}
                maxLength={24}
                aria-invalid={!!errors.unit}
                className="h-11"
              />
              {errors.unit && <FieldError>{errors.unit}</FieldError>}
            </div>
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Frecuencia</legend>
          <Segmented
            label="Frecuencia"
            value={freq}
            onChange={(v) => setFreq(v as FreqKind)}
            options={FREQS.map((f) => ({ value: f.id, label: f.name }))}
          />
          {freq === "weekdays" && (
            <div className="mt-3">
              <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Días de la semana">
                {([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((d) => {
                  const on = weekdays.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      aria-label={WEEKDAY_LONG[d]}
                      onClick={() => setWeekdays(on ? weekdays.filter((w) => w !== d) : [...weekdays, d])}
                      className={cn(
                        "h-11 rounded-xl border text-sm font-semibold transition-colors",
                        on ? "border-transparent bg-signal text-signal-foreground" : "border-border text-text-secondary hover:bg-surface-raised"
                      )}
                    >
                      {WEEKDAY_SHORT[d]}
                    </button>
                  )
                })}
              </div>
              {errors.weekdays && <FieldError className="mt-2">{errors.weekdays}</FieldError>}
            </div>
          )}
          {freq === "weekly_count" && (
            <div className="mt-3 flex items-center gap-3">
              <Button type="button" variant="outline" size="icon" aria-label="Menos veces" onClick={() => setTimes(Math.max(1, times - 1))} disabled={times <= 1}>
                <Minus />
              </Button>
              <p className="num min-w-24 text-center text-sm" aria-live="polite">
                <span className="text-xl font-semibold text-foreground">{times}</span> / semana
              </p>
              <Button type="button" variant="outline" size="icon" aria-label="Más veces" onClick={() => setTimes(Math.min(6, times + 1))} disabled={times >= 6}>
                <Plus />
              </Button>
            </div>
          )}
          <p className="mt-2 text-xs text-text-tertiary">
            {freq === "weekly_count"
              ? "Se evalúa por semana: cualquier día cuenta y no hay penalización diaria."
              : "Solo los días programados cuentan en el porcentaje."}
          </p>
        </fieldset>
      </div>

      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        {editing && (
          <Button type="button" variant="ghost" onClick={() => setConfirmArchive(true)} className="text-text-secondary">
            <Archive />
            Archivar
          </Button>
        )}
        <Button type="submit" className="ml-auto min-w-32">
          {editing ? "Guardar cambios" : "Crear hábito"}
        </Button>
      </SheetFooter>

      {habit && (
        <Dialog open={confirmArchive} onOpenChange={setConfirmArchive}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>¿Archivar «{habit.name}»?</DialogTitle>
              <DialogDescription>
                Dejará de aparecer desde hoy. Su historial se conserva en la analítica y podrás restaurarlo cuando quieras.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancelar</Button>
              </DialogClose>
              <Button
                onClick={() => {
                  habitActions.archiveHabit(habit.id)
                  toast(`«${habit.name}» archivado`, {
                    action: { label: "Deshacer", onClick: () => habitActions.restoreHabit(habit.id) },
                  })
                  setConfirmArchive(false)
                  onDone()
                }}
              >
                Archivar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </form>
  )
}

function FieldError({ children, id, className }: { children: React.ReactNode; id?: string; className?: string }) {
  return (
    <p id={id} role="alert" className={cn("text-xs text-error", className)}>
      {children}
    </p>
  )
}

export function Segmented({
  label,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid gap-1 rounded-xl border border-border bg-background p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-9 truncate rounded-lg px-2 text-[0.8125rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            value === o.value ? "bg-surface-raised text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]" : "text-text-secondary hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
