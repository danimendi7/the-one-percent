"use client"

import { useId, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { DemoBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { Segmented } from "@/features/habits/components/habit-form-sheet"

const SCALE = ["Muy bajo", "Bajo", "Normal", "Alto", "Muy alto"]

export function MindView() {
  const [phase, setPhase] = useState<"am" | "pm">("am")
  return (
    <>
      <PageHeader
        title="Mente y energía"
        meta={<DemoBadge>Demo · no se guarda</DemoBadge>}
        description="Un check-in de 15 segundos, opcional e independiente de tu puntuación de hábitos. No es un diagnóstico."
      />
      <div className="mx-auto max-w-xl">
        <Segmented
          label="Momento del día"
          value={phase}
          onChange={(v) => setPhase(v as "am" | "pm")}
          options={[
            { value: "am", label: "Mañana" },
            { value: "pm", label: "Noche" },
          ]}
          className="mb-4"
        />
        <CheckinForm key={phase} phase={phase} />
      </div>
    </>
  )
}

function CheckinForm({ phase }: { phase: "am" | "pm" }) {
  const noteId = useId()
  const [values, setValues] = useState({ mood: 3, energy: 3, stress: 2, sleep: 7 })
  const set = (k: keyof typeof values) => (v: number[]) => setValues({ ...values, [k]: v[0] })

  return (
    <form
      className="panel space-y-7 rounded-2xl p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault()
        toast("Check-in no guardado", { description: "Demo: el guardado de check-ins llega en M3." })
      }}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        {phase === "am" ? <Sun className="size-4 text-dim-learn" aria-hidden /> : <Moon className="size-4 text-dim-mind" aria-hidden />}
        {phase === "am" ? "¿Cómo empiezas el día?" : "¿Cómo cierras el día?"}
      </p>
      <ScaleField label="Ánimo" value={values.mood} onChange={set("mood")} />
      <ScaleField label="Energía" value={values.energy} onChange={set("energy")} />
      <ScaleField label="Estrés" value={values.stress} onChange={set("stress")} />
      {phase === "am" && (
        <Field label="Horas de sueño" valueText={`${values.sleep} h`}>
          <Slider min={3} max={11} step={0.5} value={[values.sleep]} onValueChange={set("sleep")} aria-label="Horas de sueño" />
        </Field>
      )}
      <div className="space-y-2">
        <Label htmlFor={noteId}>Nota (opcional)</Label>
        <Textarea id={noteId} rows={3} placeholder="Una línea basta" />
        <p className="text-xs text-text-tertiary">Privado. Nunca se envía a modelos de IA ni aparece en notificaciones.</p>
      </div>
      <Button type="submit" className="w-full">
        Guardar check-in
      </Button>
    </form>
  )
}

function ScaleField({ label, value, onChange }: { label: string; value: number; onChange: (v: number[]) => void }) {
  return (
    <Field label={label} valueText={SCALE[value - 1]}>
      <Slider min={1} max={5} step={1} value={[value]} onValueChange={onChange} aria-label={label} aria-valuetext={SCALE[value - 1]} />
    </Field>
  )
}

function Field({ label, valueText, children }: { label: string; valueText: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="num text-text-secondary">{valueText}</span>
      </div>
      {children}
    </div>
  )
}
