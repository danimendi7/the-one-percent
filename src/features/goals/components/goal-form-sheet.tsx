"use client"

import { useId, useMemo, useState } from "react"
import { Gauge, ListChecks, Minus, Plus, Target, Trash2, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { uuidv4 } from "@/lib/ids"
import { addDays, diffDays, type LocalDate } from "@/features/habits/domain/dates"
import type { DimensionId, Habit } from "@/features/habits/domain/types"
import { DIMENSION_COLOR, HabitIcon } from "@/features/habits/components/habit-icon"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { habitActions, useHabits } from "@/features/habits/store/habit-store"
import { validateGoal, type GoalField, type GoalInput } from "../domain/ops"
import { horizonOf } from "../domain/progress"
import { DEFAULT_THRESHOLD, type Aggregation, type Checkpoint, type Goal, type GoalDirection, type GoalKind, type GoalPriority, type Horizon, type NumericSource } from "../domain/types"
import { formatRate, HORIZON_HINT, HORIZON_LABEL } from "./goal-ui"

const KINDS: { id: GoalKind; title: string; text: string; icon: LucideIcon }[] = [
  { id: "numeric", title: "Numérico", text: "Mover una cifra: peso, tiempo, km, ahorro.", icon: Gauge },
  { id: "milestones", title: "Por hitos", text: "Un proyecto dividido en pasos.", icon: ListChecks },
  { id: "habits", title: "Por hábitos", text: "Sostener tus hábitos por encima de un umbral.", icon: Target },
]

const DIMENSIONS: { id: DimensionId; name: string }[] = [
  { id: "body", name: "Cuerpo" },
  { id: "mind", name: "Mente" },
  { id: "learn", name: "Aprendizaje" },
  { id: "work", name: "Trabajo" },
]

const STEPS = ["Qué", "Cómo se mide", "Sistema"] as const
const FIELD_STEP: Record<GoalField, number> = {
  title: 0,
  dates: 1,
  "numeric.habit": 1,
  "numeric.unit": 1,
  "numeric.values": 1,
  threshold: 1,
  checkpoints: 1,
  habits: 2,
  parent: 2,
}

export function GoalFormSheet({ open, onOpenChange, goal }: { open: boolean; onOpenChange: (o: boolean) => void; goal?: Goal | null }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-lg" : "max-h-[94dvh] rounded-t-3xl border-x-0")}>
        {open && <GoalForm key={goal?.id ?? "new"} goal={goal ?? null} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

const toText = (n: number | undefined | null) => (n === undefined || n === null ? "" : String(n).replace(".", ","))
const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")))

function GoalForm({ goal, onDone }: { goal: Goal | null; onDone: () => void }) {
  const snap = useHabits()!
  const { state, today } = snap
  const editing = goal !== null
  const ids = { title: useId(), why: useId(), unit: useId(), base: useId(), target: useId(), start: useId(), due: useId(), threshold: useId() }

  const [step, setStep] = useState(0)
  const [title, setTitle] = useState(goal?.title ?? "")
  const [why, setWhy] = useState(goal?.why ?? "")
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "numeric")
  const [priority, setPriority] = useState<GoalPriority>(goal?.priority ?? (state.goals.some((g) => g.priority === "primary" && g.state === "active") ? "secondary" : "primary"))
  const [dimensionId, setDimension] = useState<DimensionId | null>(goal?.dimensionId ?? null)
  const [source, setSource] = useState<NumericSource>(goal?.numeric?.source ?? "manual")
  const [habitId, setHabitId] = useState<string>(goal?.numeric?.habitId ?? "")
  const [aggregation, setAggregation] = useState<Aggregation>(goal?.numeric?.aggregation ?? "last")
  const [direction, setDirection] = useState<GoalDirection>(goal?.numeric?.direction ?? "up")
  const [unit, setUnit] = useState(goal?.numeric?.unit ?? "")
  const [baseline, setBaseline] = useState(toText(goal?.numeric?.baseline ?? (goal ? undefined : 0)))
  const [target, setTarget] = useState(toText(goal?.numeric?.target))
  const [threshold, setThreshold] = useState(String(Math.round((goal?.threshold ?? DEFAULT_THRESHOLD) * 100)))
  const [startDate, setStart] = useState<LocalDate>(goal?.startDate ?? today)
  const [dueDate, setDue] = useState<LocalDate>(goal?.dueDate ?? addDays(today, 90))
  const [horizonOverride, setHorizonOverride] = useState<Horizon | null>(goal?.horizonOverride ?? null)
  const [links, setLinks] = useState(goal?.habits ?? [])
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(goal?.checkpoints ?? [])
  const [parentId, setParentId] = useState<string | null>(goal?.parentId ?? null)
  const [aggregateChildren, setAggregate] = useState(!!goal?.aggregateChildren)
  const [errors, setErrors] = useState<Partial<Record<GoalField, string>>>({})

  const activeHabits = state.habits.filter((h) => !h.archivedOn || h.archivedOn > today || links.some((l) => l.habitId === h.id))
  const numericHabits = activeHabits.filter((h) => h.type !== "binary")
  const sourceHabit = state.habits.find((h) => h.id === habitId)
  const effectiveUnit = source === "habit" ? (sourceHabit?.unit ?? (sourceHabit?.type === "duration" ? "min" : "")) : unit
  const hasChildren = editing && state.goals.some((g) => g.parentId === goal.id)

  const input: GoalInput = {
    title,
    why,
    dimensionId,
    parentId,
    kind,
    numeric:
      kind === "numeric"
        ? { source, habitId: source === "habit" ? habitId || null : null, aggregation, unit: effectiveUnit, baseline: toNum(baseline), target: toNum(target), direction }
        : null,
    threshold: kind === "habits" ? toNum(threshold) / 100 : null,
    startDate,
    dueDate,
    horizonOverride,
    priority,
    aggregateChildren,
    habits: links,
    checkpoints,
  }

  const preview = useMemo(() => {
    const days = diffDays(today > startDate ? today : startDate, dueDate)
    if (kind !== "numeric" || days <= 0) return null
    const b = toNum(baseline)
    const t = toNum(target)
    if (!Number.isFinite(b) || !Number.isFinite(t) || b === t) return null
    return `Ritmo necesario desde hoy: ${formatRate(Math.abs(t - b) / days, effectiveUnit)} durante ${days} días.`
  }, [kind, baseline, target, startDate, dueDate, today, effectiveUnit])

  const parentOptions = state.goals.filter((g) => g.id !== goal?.id && !g.archivedOn && !isUnder(state.goals, g.id, goal?.id))

  function submit() {
    const errs = validateGoal(input, state, goal?.id)
    setErrors(errs)
    const first = (Object.keys(errs) as GoalField[]).map((k) => FIELD_STEP[k]).sort()[0]
    if (first !== undefined) {
      setStep(first)
      return
    }
    if (goal) {
      habitActions.updateGoal(goal.id, input)
      toast.success("Objetivo actualizado")
    } else {
      habitActions.addGoal(input)
      toast.success(`«${title.trim()}» creado`, { description: "El progreso se calcula con tus registros desde la fecha de inicio." })
    }
    onDone()
  }

  function next() {
    const errs = validateGoal(input, state, goal?.id)
    const here = (Object.keys(errs) as GoalField[]).filter((k) => FIELD_STEP[k] === step)
    setErrors(Object.fromEntries(here.map((k) => [k, errs[k]])))
    if (here.length === 0) setStep(step + 1)
  }

  const link = (h: Habit) => links.find((l) => l.habitId === h.id)
  const toggle = (h: Habit) => setLinks(link(h) ? links.filter((l) => l.habitId !== h.id) : [...links, { habitId: h.id, weight: 1 }])
  const weigh = (h: Habit, w: number) => setLinks(links.map((l) => (l.habitId === h.id ? { ...l, weight: w } : l)))

  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (step < STEPS.length - 1) next()
        else submit()
      }}
    >
      <SheetHeader className="border-b border-border px-5 pt-5 pb-3">
        <SheetTitle className="text-lg">{editing ? "Editar objetivo" : "Nuevo objetivo"}</SheetTitle>
        <SheetDescription>
          Paso {step + 1} de {STEPS.length} · {STEPS[step]}
        </SheetDescription>
        <ol className="mt-2 grid grid-cols-3 gap-1.5" aria-label="Pasos">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => (i < step || editing ? setStep(i) : undefined)}
                aria-current={i === step ? "step" : undefined}
                aria-label={`Paso ${i + 1}: ${s}`}
                className={cn("flex h-6 w-full items-center", i > step && !editing && "cursor-default")}
              >
                <span className={cn("h-1 w-full rounded-full", i <= step ? "bg-signal" : "bg-surface-raised")} />
              </button>
            </li>
          ))}
        </ol>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {step === 0 && (
          <>
            <div className="space-y-2">
              <Label htmlFor={ids.title}>Objetivo</Label>
              <Input
                id={ids.title}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
                placeholder="Correr 10 km en menos de 50 minutos"
                aria-invalid={!!errors.title}
                aria-describedby={errors.title ? `${ids.title}-err` : undefined}
                className="h-11"
                autoComplete="off"
              />
              {errors.title && <FieldError id={`${ids.title}-err`}>{errors.title}</FieldError>}
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Cómo se mide</legend>
              <div role="radiogroup" aria-label="Tipo de objetivo" className="grid gap-2">
                {KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    role="radio"
                    aria-checked={kind === k.id}
                    disabled={editing}
                    onClick={() => setKind(k.id)}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
                      kind === k.id ? "border-signal/50 bg-signal/8" : "border-border hover:bg-surface-raised disabled:opacity-50"
                    )}
                  >
                    <k.icon className={cn("size-5 shrink-0", kind === k.id ? "text-signal" : "text-text-tertiary")} aria-hidden />
                    <span>
                      <span className="block text-sm font-medium">{k.title}</span>
                      <span className="block text-xs text-text-secondary">{k.text}</span>
                    </span>
                  </button>
                ))}
              </div>
              {editing && <p className="mt-2 text-xs text-text-tertiary">El tipo no se cambia para no alterar el historial.</p>}
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Prioridad</legend>
              <Segmented
                label="Prioridad"
                value={priority}
                onChange={(v) => setPriority(v as GoalPriority)}
                options={[
                  { value: "primary", label: "Principal" },
                  { value: "secondary", label: "Secundario" },
                ]}
              />
              <p className="mt-2 text-xs text-text-tertiary">Los principales aparecen en el Resumen; los secundarios solo aquí.</p>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Dimensión (opcional)</legend>
              <div role="radiogroup" aria-label="Dimensión" className="grid grid-cols-2 gap-2">
                {DIMENSIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={dimensionId === d.id}
                    onClick={() => setDimension(dimensionId === d.id ? null : d.id)}
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
          </>
        )}

        {step === 1 && (
          <>
            {kind === "numeric" && (
              <>
                <fieldset className="space-y-3">
                  <legend className="mb-2 text-sm font-medium">De dónde sale la cifra</legend>
                  <Segmented
                    label="Origen del dato"
                    value={source}
                    onChange={(v) => setSource(v as NumericSource)}
                    options={[
                      { value: "manual", label: "Mediciones" },
                      { value: "habit", label: "Un hábito" },
                    ]}
                    disabled={editing}
                  />
                  <p className="text-xs text-text-tertiary">
                    {source === "habit"
                      ? "Se calcula con los registros del hábito: no hay que registrar nada más."
                      : "Registrarás el valor cuando lo midas (una medición por día)."}
                  </p>
                  {source === "habit" &&
                    (numericHabits.length === 0 ? (
                      <FieldError>No tienes hábitos numéricos o de duración. Crea uno o usa mediciones.</FieldError>
                    ) : (
                      <Select value={habitId} onValueChange={setHabitId} disabled={editing}>
                        <SelectTrigger className="h-11! w-full" aria-label="Hábito que alimenta el objetivo" aria-invalid={!!errors["numeric.habit"]}>
                          <SelectValue placeholder="Elige un hábito" />
                        </SelectTrigger>
                        <SelectContent>
                          {numericHabits.map((h) => (
                            <SelectItem key={h.id} value={h.id}>
                              {h.name} ({h.type === "duration" ? "min" : h.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ))}
                  {errors["numeric.habit"] && <FieldError>{errors["numeric.habit"]}</FieldError>}
                </fieldset>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Segmented
                      label="Cómo se cuenta"
                      value={aggregation}
                      onChange={(v) => setAggregation(v as Aggregation)}
                      options={[
                        { value: "last", label: "Último valor" },
                        { value: "sum", label: "Acumulado" },
                      ]}
                    />
                    <p className="mt-2 text-xs text-text-tertiary">
                      {aggregation === "last" ? "Cuenta el valor más reciente (peso, tiempo en 10 km)." : "Suma todo desde el inicio (km del año, ahorro)."}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <Segmented
                      label="Dirección"
                      value={direction}
                      onChange={(v) => setDirection(v as GoalDirection)}
                      options={[
                        { value: "up", label: "Subir" },
                        { value: "down", label: "Bajar" },
                      ]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={ids.base}>Punto de partida</Label>
                    <Input id={ids.base} inputMode="decimal" value={baseline} onChange={(e) => setBaseline(e.target.value.replace(/[^\d.,-]/g, ""))} className="num h-11" aria-invalid={!!errors["numeric.values"]} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={ids.target}>Meta</Label>
                    <Input id={ids.target} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.,-]/g, ""))} className="num h-11" aria-invalid={!!errors["numeric.values"]} />
                  </div>
                  {errors["numeric.values"] && <FieldError className="col-span-2">{errors["numeric.values"]}</FieldError>}
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor={ids.unit}>Unidad</Label>
                    <Input id={ids.unit} value={effectiveUnit} onChange={(e) => setUnit(e.target.value)} disabled={source === "habit"} maxLength={24} placeholder="kg, km, min, €" className="h-11" aria-invalid={!!errors["numeric.unit"]} />
                    {errors["numeric.unit"] && <FieldError>{errors["numeric.unit"]}</FieldError>}
                  </div>
                </div>
              </>
            )}

            {kind === "habits" && (
              <div className="space-y-2">
                <Label htmlFor={ids.threshold}>Umbral de cumplimiento (%)</Label>
                <Input id={ids.threshold} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, "").slice(0, 3))} className="num h-11 w-32" aria-invalid={!!errors.threshold} />
                <p className="text-xs text-text-tertiary">El objetivo va en ritmo mientras el cumplimiento de sus hábitos esté por encima de este umbral. Los hábitos se eligen en el paso 3.</p>
                {errors.threshold && <FieldError>{errors.threshold}</FieldError>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={ids.start}>Inicio</Label>
                <Input id={ids.start} type="date" value={startDate} onChange={(e) => e.target.value && setStart(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-2">
                <Label htmlFor={ids.due}>Fecha límite</Label>
                <Input id={ids.due} type="date" value={dueDate} min={startDate} onChange={(e) => e.target.value && setDue(e.target.value)} className="h-11" aria-invalid={!!errors.dates} />
              </div>
              {errors.dates && <FieldError className="col-span-2">{errors.dates}</FieldError>}
              <p className="col-span-2 text-xs text-text-tertiary">
                Plazo: {HORIZON_LABEL[horizonOf({ dueDate, horizonOverride }, today)].toLowerCase()}
                {horizonOverride ? " (fijado a mano)" : " (automático por la fecha)"}.
              </p>
            </div>

            {preview && <p className="rounded-xl border border-border bg-surface-raised/50 px-3.5 py-3 text-sm text-text-secondary">{preview}</p>}

            <MilestoneEditor kind={kind} items={checkpoints} onChange={setCheckpoints} error={errors.checkpoints} unit={effectiveUnit} />
          </>
        )}

        {step === 2 && (
          <>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Hábitos que forman el sistema</legend>
              <p className="mb-3 text-xs text-text-tertiary">
                {kind === "habits" ? "Su cumplimiento es el resultado del objetivo." : "Miden el esfuerzo, por separado del resultado. Peso 1–3: cuánto cuenta cada uno."}
              </p>
              {activeHabits.length === 0 ? (
                <p className="text-sm text-text-secondary">Aún no tienes hábitos. Puedes vincularlos más tarde.</p>
              ) : (
                <ul className="divide-y divide-border/70 rounded-xl border border-border">
                  {activeHabits.map((h) => {
                    const l = link(h)
                    return (
                      <li key={h.id} className="flex items-center gap-3 px-3 py-1.5">
                        <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                          <Switch checked={!!l} onCheckedChange={() => toggle(h)} aria-label={`Vincular ${h.name}`} />
                          <HabitIcon icon={h.icon} dimensionId={h.dimensionId} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm">{h.name}</span>
                        </label>
                        {l && kind !== "habits" && (
                          <div className="flex items-center gap-1" role="group" aria-label={`Peso de ${h.name}`}>
                            <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Menos peso" onClick={() => weigh(h, Math.max(1, l.weight - 1))} disabled={l.weight <= 1}>
                              <Minus />
                            </Button>
                            <span className="num w-5 text-center text-sm" aria-live="polite">
                              {l.weight}
                            </span>
                            <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="Más peso" onClick={() => weigh(h, Math.min(3, l.weight + 1))} disabled={l.weight >= 3}>
                              <Plus />
                            </Button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {errors.habits && <FieldError className="mt-2">{errors.habits}</FieldError>}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor={ids.why}>Por qué importa (opcional)</Label>
              <Input id={ids.why} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={160} className="h-11" autoComplete="off" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Plazo</Label>
                <Select value={horizonOverride ?? "auto"} onValueChange={(v) => setHorizonOverride(v === "auto" ? null : (v as Horizon))}>
                  <SelectTrigger className="h-11! w-full" aria-label="Plazo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automático por la fecha</SelectItem>
                    {(["short", "medium", "long"] as Horizon[]).map((h) => (
                      <SelectItem key={h} value={h}>
                        {HORIZON_LABEL[h]} ({HORIZON_HINT[h]})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Objetivo superior (opcional)</Label>
                <Select value={parentId ?? "none"} onValueChange={(v) => setParentId(v === "none" ? null : v)}>
                  <SelectTrigger className="h-11! w-full" aria-label="Objetivo superior" aria-invalid={!!errors.parent}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguno</SelectItem>
                    {parentOptions.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.parent && <FieldError>{errors.parent}</FieldError>}
              </div>
            </div>
            {hasChildren && (
              <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2">
                <span>
                  <span className="block text-sm">Calcular el resultado con sus subobjetivos</span>
                  <span className="block text-xs text-text-tertiary">Media del resultado de los subobjetivos activos con datos.</span>
                </span>
                <Switch checked={aggregateChildren} onCheckedChange={setAggregate} />
              </label>
            )}
          </>
        )}
      </div>

      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        {step > 0 && (
          <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>
            Atrás
          </Button>
        )}
        {editing && step < STEPS.length - 1 && (
          <Button type="button" variant="outline" onClick={submit} className="ml-auto">
            Guardar
          </Button>
        )}
        <Button type="submit" className={cn("min-w-32", !(editing && step < STEPS.length - 1) && "ml-auto")}>
          {step < STEPS.length - 1 ? "Siguiente" : editing ? "Guardar cambios" : "Crear objetivo"}
        </Button>
      </SheetFooter>
    </form>
  )
}

function isUnder(goals: Goal[], candidate: string, ancestor?: string): boolean {
  if (!ancestor) return false
  const seen = new Set<string>()
  let cur = goals.find((g) => g.id === candidate)
  while (cur?.parentId && !seen.has(cur.id)) {
    if (cur.parentId === ancestor) return true
    seen.add(cur.id)
    cur = goals.find((g) => g.id === cur!.parentId)
  }
  return false
}

/** Flat list of intermediate milestones; on numeric goals each can carry a value reached from data. */
function MilestoneEditor({ kind, items, onChange, error, unit }: { kind: GoalKind; items: Checkpoint[]; onChange: (c: Checkpoint[]) => void; error?: string; unit: string }) {
  const set = (id: string, patch: Partial<Checkpoint>) => onChange(items.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">Hitos {kind === "milestones" ? "" : "intermedios (opcional)"}</legend>
      <p className="mb-3 text-xs text-text-tertiary">
        {kind === "numeric"
          ? `Con un valor se cumplen solos cuando tus datos lo alcanzan${unit ? ` (en ${unit})` : ""}. Sin valor, los marcas tú.`
          : kind === "milestones"
            ? "El progreso es hitos cumplidos / hitos totales. Sin dependencias entre ellos."
            : "Pasos que marcas al cumplirlos; no cambian el cálculo del cumplimiento."}
      </p>
      <ul className="space-y-2">
        {items.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2">
            <Input value={c.title} onChange={(e) => set(c.id, { title: e.target.value })} maxLength={80} placeholder={`Hito ${i + 1}`} aria-label={`Hito ${i + 1}`} className="h-11 flex-1" />
            {kind === "numeric" && (
              <Input
                inputMode="decimal"
                value={toText(c.value)}
                onChange={(e) => {
                  const v = toNum(e.target.value.replace(/[^\d.,-]/g, ""))
                  set(c.id, { value: Number.isFinite(v) ? v : null })
                }}
                placeholder="Valor"
                aria-label={`Valor del hito ${i + 1}`}
                className="num h-11 w-24"
              />
            )}
            <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`Quitar hito ${i + 1}`} onClick={() => onChange(items.filter((x) => x.id !== c.id))}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" className="mt-2 h-11" onClick={() => onChange([...items, { id: uuidv4(), title: "", doneOn: null, value: null }])} disabled={items.length >= 20}>
        <Plus />
        Añadir hito
      </Button>
      {error && <FieldError className="mt-2">{error}</FieldError>}
    </fieldset>
  )
}

function FieldError({ children, id, className }: { children: React.ReactNode; id?: string; className?: string }) {
  return (
    <p id={id} role="alert" className={cn("text-xs text-error", className)}>
      {children}
    </p>
  )
}
