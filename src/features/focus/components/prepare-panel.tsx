"use client"

import Link from "next/link"
import { useId, useState } from "react"
import { Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { HabitIcon } from "@/features/habits/components/habit-icon"
import { focusHabits, projectSuggestions } from "../domain/ops"
import { MAX_PLANNED_MINUTES } from "../domain/types"
import type { FocusModel } from "../use-focus"
import { ProjectField, reasonText } from "./focus-ui"

const NONE = "none"

/** «Preparar»: duration, planned outcome, project and the habit it feeds. Starting is one tap. */
export function PreparePanel({ fm }: { fm: FocusModel }) {
  const ids = { plan: useId(), custom: useId(), project: useId() }
  const habits = focusHabits(fm.state, fm.today)
  const [preset, setPreset] = useState("50")
  const [custom, setCustom] = useState("")
  const [plan, setPlan] = useState("")
  const [project, setProject] = useState("")
  const [habitId, setHabitId] = useState<string>(fm.saved && habits[0] ? habits[0].id : NONE)
  const [error, setError] = useState<string | null>(null)

  const minutes = preset === "custom" ? Number(custom) : Number(preset)
  const validMinutes = Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_PLANNED_MINUTES

  function start() {
    if (!validMinutes) return setError("Escribe una duración de 1 a 720 minutos.")
    const r = fm.api.startFocus({
      habitId: habitId === NONE ? null : habitId,
      project: project || null,
      plannedOutput: plan || null,
      plannedMinutes: minutes,
    })
    if (!r.ok) {
      setError(null)
      toast.error(reasonText(r.reason))
    }
  }

  return (
    <div className="w-full max-w-md space-y-5">
      <div>
        <Segmented
          label="Duración"
          value={preset}
          onChange={(v) => {
            setPreset(v)
            setError(null)
          }}
          options={[
            { value: "25", label: "25 min" },
            { value: "50", label: "50 min" },
            { value: "90", label: "90 min" },
            { value: "custom", label: "Otra" },
          ]}
        />
        {preset === "custom" && (
          <div className="mt-3 flex items-center gap-3">
            <Label htmlFor={ids.custom} className="shrink-0">
              Minutos
            </Label>
            <Input
              id={ids.custom}
              inputMode="numeric"
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 3))}
              placeholder="p. ej. 40"
              aria-invalid={!!error}
              className="num h-11 w-28"
              autoFocus
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={ids.plan}>
          Resultado previsto <span className="font-normal text-text-tertiary">(opcional)</span>
        </Label>
        <Input id={ids.plan} value={plan} onChange={(e) => setPlan(e.target.value)} maxLength={200} placeholder="Qué quieres tener al terminar" className="h-11" />
      </div>

      <ProjectField id={ids.project} value={project} onChange={setProject} suggestions={projectSuggestions(fm.state)} />

      {fm.saved && (
        <div className="space-y-2">
          <p className="text-sm font-medium" id={`${ids.plan}-habit`}>
            Hábito que alimenta
          </p>
          {habits.length > 0 ? (
            <Select value={habitId} onValueChange={setHabitId}>
              <SelectTrigger className="h-11! w-full" aria-labelledby={`${ids.plan}-habit`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {habits.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    <span className="flex items-center gap-2">
                      <HabitIcon icon={h.icon} dimensionId={h.dimensionId} size="sm" />
                      {h.name}
                    </span>
                  </SelectItem>
                ))}
                <SelectItem value={NONE}>Ninguno</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs leading-relaxed text-text-tertiary">
              Ningún hábito se alimenta de Enfoque. En{" "}
              <Link href="/habits" className="text-text-secondary underline underline-offset-4 hover:text-foreground">
                Hábitos
              </Link>
              , edita un hábito de duración y activa «Se alimenta de sesiones de enfoque» para que se complete solo.
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <Button size="lg" onClick={start} className="h-12 w-full text-base">
        <Play /> Empezar {validMinutes ? `${minutes} min` : ""}
      </Button>
    </div>
  )
}
