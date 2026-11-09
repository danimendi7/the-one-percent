"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { addDays, formatDate, type LocalDate } from "@/features/habits/domain/dates"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { projectSuggestions } from "../domain/ops"
import { activeSeconds, hhmm, minutesOf, retime, zonedInstant } from "../domain/time"
import type { FocusSession } from "../domain/types"
import type { FocusModel } from "../use-focus"
import { InterruptionsInput, ProjectField, RatingInput, reasonText } from "./focus-ui"

const NONE = "none"

/** Edit a finished session after the fact (plan §2 «Historial»): hours, texts, rating, habit; or discard it. */
export function EditSheet({ fm, session, onOpenChange }: { fm: FocusModel; session: FocusSession | null; onOpenChange: (open: boolean) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={session !== null} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl border-x-0")}>
        {session && <EditForm key={session.id + (session.version ?? 0)} fm={fm} session={session} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function EditForm({ fm, session, onDone }: { fm: FocusModel; session: FocusSession; onDone: () => void }) {
  const ids = { date: useId(), time: useId(), minutes: useId(), plan: useId(), actual: useId(), project: useId(), habit: useId() }
  const tz = fm.timezone
  const [date, setDate] = useState<LocalDate>(session.localDate)
  const [time, setTime] = useState(hhmm(session.segments[0].start, tz))
  const [minutes, setMinutes] = useState(String(minutesOf(activeSeconds(session.segments))))
  const [project, setProject] = useState(session.project ?? "")
  const [plan, setPlan] = useState(session.plannedOutput ?? "")
  const [actual, setActual] = useState(session.actualOutput ?? "")
  const [rating, setRating] = useState<number | null>(session.rating)
  const [interruptions, setInterruptions] = useState<number | null>(session.interruptions ?? null)
  const habits = fm.state.habits.filter((h) => h.type === "duration" && (h.activitySource === "focus" || h.id === session.habitId))
  const [habitId, setHabitId] = useState(session.habitId ?? NONE)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const preset = date === fm.today ? "today" : date === addDays(fm.today, -1) ? "yesterday" : "other"

  function save(e: React.FormEvent) {
    e.preventDefault()
    const m = Number(minutes)
    if (!Number.isInteger(m) || m < 1 || m > 720) return setError("Los minutos efectivos van de 1 a 720.")
    if (!/^\d{2}:\d{2}$/.test(time)) return setError("Indica la hora de inicio.")
    // Untouched times keep the exact segments (no rounding to whole minutes).
    const sameTimes = date === session.localDate && time === hhmm(session.segments[0].start, tz) && m === minutesOf(activeSeconds(session.segments))
    const segments = sameTimes ? session.segments : retime(session.segments, zonedInstant(date, time, tz), m)
    const r = fm.api.editFocus(session.id, {
      segments,
      habitId: habitId === NONE ? null : habitId,
      project: project || null,
      plannedOutput: plan || null,
      actualOutput: actual || null,
      rating,
      interruptions,
    })
    if (!r.ok) return setError(reasonText(r.reason))
    toast.success("Sesión actualizada")
    onDone()
  }

  function discard() {
    fm.api.discardFocus(session.id)
    toast("Sesión descartada", { description: "Sus minutos dejan de contar, también en el hábito que alimentaba." })
    onDone()
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
        <SheetTitle className="text-lg">Editar sesión</SheetTitle>
        <SheetDescription>Cuenta en el día en que empezó. Los cambios recalculan el hábito que alimenta.</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-medium">Inicio</legend>
          <Segmented
            label="Día"
            value={preset}
            onChange={(v) => setDate(v === "today" ? fm.today : v === "yesterday" ? addDays(fm.today, -1) : date)}
            options={[
              { value: "today", label: "Hoy" },
              { value: "yesterday", label: "Ayer" },
              { value: "other", label: preset === "other" ? formatDate(date, { day: "numeric", month: "short" }) : "Otro día" },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={ids.date}>Fecha</Label>
              <Input id={ids.date} type="date" value={date} max={fm.today} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.time}>Hora</Label>
              <Input id={ids.time} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="num h-11" />
            </div>
          </div>
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor={ids.minutes}>Minutos efectivos</Label>
          <Input id={ids.minutes} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} className="num h-11 w-32" />
          <p className="text-xs text-text-tertiary">Las pausas conservan su lugar; el final se ajusta a estos minutos.</p>
        </div>
        <ProjectField id={ids.project} value={project} onChange={setProject} suggestions={projectSuggestions(fm.state)} />
        <div className="space-y-2">
          <Label htmlFor={ids.plan}>Resultado previsto</Label>
          <Input id={ids.plan} value={plan} onChange={(e) => setPlan(e.target.value)} maxLength={200} className="h-11" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.actual}>Resultado real</Label>
          <Textarea id={ids.actual} value={actual} onChange={(e) => setActual(e.target.value)} maxLength={500} rows={2} />
        </div>
        <RatingInput value={rating} onChange={setRating} />
        <InterruptionsInput value={interruptions} onChange={setInterruptions} />
        {fm.saved && habits.length > 0 && (
          <div className="space-y-2">
            <p id={ids.habit} className="text-sm font-medium">
              Hábito que alimenta
            </p>
            <Select value={habitId} onValueChange={setHabitId}>
              <SelectTrigger className="h-11! w-full" aria-labelledby={ids.habit}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {habits.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
                <SelectItem value={NONE}>Ninguno</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
      </div>
      <SheetFooter className="pb-safe flex-row items-center gap-2 border-t border-border px-5 py-4">
        {confirmDiscard ? (
          <>
            <span className="mr-auto text-sm text-text-secondary">¿Descartar esta sesión?</span>
            <Button type="button" variant="ghost" onClick={() => setConfirmDiscard(false)}>
              No
            </Button>
            <Button type="button" variant="destructive" onClick={discard}>
              Descartar
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" className="text-text-secondary" onClick={() => setConfirmDiscard(true)}>
              Descartar
            </Button>
            <Button type="submit" className="ml-auto min-w-32">
              Guardar cambios
            </Button>
          </>
        )}
      </SheetFooter>
    </form>
  )
}
