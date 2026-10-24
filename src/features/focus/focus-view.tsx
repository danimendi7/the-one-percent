"use client"

import { useEffect, useId, useState } from "react"
import { Pause, Play, RotateCcw, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DemoBadge, DemoNote } from "@/components/common/demo-note"
import { ProgressRing } from "@/components/common/progress-ring"
import { PageHeader } from "@/components/shell/page-header"
import { Segmented } from "@/features/habits/components/habit-form-sheet"

type Status = "idle" | "running" | "paused" | "done"

/**
 * Focus timer. Elapsed time derives from wall-clock timestamps, so it stays
 * correct when the tab is backgrounded or throttled (PRD §3.5). Sessions are
 * not stored yet (M3).
 */
export function FocusView() {
  const ids = { plan: useId() }
  const [minutes, setMinutes] = useState("50")
  const [status, setStatus] = useState<Status>("idle")
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [accumulated, setAccumulated] = useState(0)
  const [now, setNow] = useState(0)
  const [plan, setPlan] = useState("")

  const totalMs = Number(minutes) * 60_000
  const elapsed = accumulated + (status === "running" && startedAt ? Math.max(0, now - startedAt) : 0)
  const remaining = Math.max(0, totalMs - elapsed)
  const finished = status === "running" && remaining === 0

  useEffect(() => {
    if (status !== "running") return
    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, 500)
    document.addEventListener("visibilitychange", tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [status])

  const shown = finished ? "done" : status

  const start = () => {
    const t = Date.now()
    setStartedAt(t)
    setNow(t)
    setStatus("running")
  }
  const pause = () => {
    setAccumulated(elapsed)
    setStartedAt(null)
    setStatus("paused")
  }
  const reset = () => {
    setAccumulated(0)
    setStartedAt(null)
    setStatus("idle")
  }

  const mm = String(Math.floor(remaining / 60_000)).padStart(2, "0")
  const ss = String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")

  return (
    <>
      <PageHeader title="Enfoque" meta={<DemoBadge>Demo · no se guarda</DemoBadge>} />
      <div className="mx-auto grid max-w-4xl grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_320px]">
        <section className="panel flex flex-col items-center rounded-2xl px-5 py-8 sm:py-10" aria-label="Temporizador">
          <Segmented
            label="Duración"
            value={minutes}
            onChange={(v) => status === "idle" && setMinutes(v)}
            options={[
              { value: "25", label: "25 min" },
              { value: "50", label: "50 min" },
              { value: "90", label: "90 min" },
            ]}
            disabled={status !== "idle"}
            className="w-full max-w-xs"
          />
          <ProgressRing
            value={totalMs ? elapsed / totalMs : 0}
            size={248}
            stroke={10}
            className="mt-8"
            label={`Quedan ${mm} minutos y ${ss} segundos`}
          >
            <div className="text-center">
              <p className="num text-[3.25rem] leading-none font-semibold tracking-tight" aria-live="off">
                {mm}:{ss}
              </p>
              <p className="mt-2 text-sm text-text-secondary">
                {shown === "idle" ? "Listo" : shown === "running" ? "En foco" : shown === "paused" ? "En pausa" : "Bloque completado"}
              </p>
            </div>
          </ProgressRing>
          <div className="mt-8 flex gap-3">
            {shown === "idle" && (
              <Button size="lg" onClick={start} className="min-w-40">
                <Play /> Empezar
              </Button>
            )}
            {shown === "running" && (
              <>
                <Button size="lg" variant="secondary" onClick={pause} className="min-w-32">
                  <Pause /> Pausar
                </Button>
                <Button size="lg" variant="ghost" onClick={reset} aria-label="Terminar">
                  <Square />
                </Button>
              </>
            )}
            {shown === "paused" && (
              <>
                <Button size="lg" onClick={start} className="min-w-32">
                  <Play /> Reanudar
                </Button>
                <Button size="lg" variant="ghost" onClick={reset}>
                  <RotateCcw /> Reiniciar
                </Button>
              </>
            )}
            {shown === "done" && (
              <Button size="lg" variant="outline" onClick={reset}>
                <RotateCcw /> Nuevo bloque
              </Button>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="panel space-y-2 rounded-2xl p-5">
            <Label htmlFor={ids.plan}>Resultado previsto</Label>
            <Input
              id={ids.plan}
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="Qué quieres tener al terminar"
              className="h-11"
            />
            <p className="text-xs text-text-tertiary">Al terminar podrás anotar el resultado real y valorarlo (M3).</p>
          </div>
          <DemoNote>
            El temporizador funciona, pero las sesiones aún no se guardan ni alimentan la analítica o hábitos vinculados. Llega en M3.
          </DemoNote>
        </aside>
      </div>
    </>
  )
}
