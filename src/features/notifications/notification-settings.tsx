"use client"

import { useId, useState, useSyncExternalStore } from "react"
import { BellOff, BellRing, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { DemoBadge, DemoNote } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { BrandMark } from "@/components/shell/brand-mark"
import { cn } from "@/lib/utils"

type Tone = "calm" | "balanced" | "hardcore"

/** Original copy (no attributed quotes). Profanity variant only exists behind the Hardcore opt-in. */
const TONES: Record<Tone, { name: string; desc: string; sample: string; sampleProfane?: string }> = {
  calm: {
    name: "Calma",
    desc: "Recordatorios suaves, sin presión.",
    sample: "Cuando puedas: te quedan 2 hábitos para hoy. Uno pequeño también cuenta.",
  },
  balanced: {
    name: "Equilibrado",
    desc: "Directo y claro, sin dramatismo.",
    sample: "Quedan 2 hábitos por hoy. 10 minutos ahora y el día queda cerrado.",
  },
  hardcore: {
    name: "Hardcore",
    desc: "Exigente y sin rodeos. Opcional.",
    sample: "2 hábitos pendientes. Nadie lo va a hacer por ti. Ahora.",
    sampleProfane: "2 hábitos pendientes. Deja de marear la perdiz y hazlo. Ahora.",
  },
}

const TRIGGERS = [
  { id: "morning", label: "Activación matinal", def: true },
  { id: "due", label: "Hábito programado", def: true },
  { id: "late", label: "Hábitos críticos pendientes por la tarde", def: true },
  { id: "allDone", label: "Todos los objetivos del día cumplidos", def: false },
  { id: "review", label: "Revisión semanal pendiente", def: true },
  { id: "recall", label: "Tarjetas de repaso pendientes", def: false },
  { id: "focus", label: "Recordatorio de bloque de enfoque", def: false },
]

function usePermission(): NotificationPermission | "unsupported" | null {
  return useSyncExternalStore(
    () => () => {},
    () => ("Notification" in window ? Notification.permission : "unsupported"),
    () => null
  )
}

export function NotificationSettings() {
  const ids = { quietStart: useId(), quietEnd: useId(), cap: useId() }
  const [tone, setTone] = useState<Tone>("balanced")
  const [profanity, setProfanity] = useState(false)
  const [cap, setCap] = useState(4)
  const [triggers, setTriggers] = useState<Record<string, boolean>>(Object.fromEntries(TRIGGERS.map((t) => [t.id, t.def])))
  const permission = usePermission()

  const sample = tone === "hardcore" && profanity ? TONES.hardcore.sampleProfane! : TONES[tone].sample

  return (
    <>
      <PageHeader
        title="Notificaciones"
        meta={<DemoBadge>Demo · no se envía nada</DemoBadge>}
        description="Mensajes contextuales que respetan tus horarios, días de descanso y lo que ya has hecho."
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="panel rounded-2xl p-5" aria-labelledby="perm-title">
            <div className="flex items-start gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-raised">
                {permission === "granted" ? <BellRing className="size-5 text-signal" aria-hidden /> : <BellOff className="size-5 text-text-secondary" aria-hidden />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="perm-title" className="font-semibold">
                  Notificaciones push en este dispositivo
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                  Estado del navegador:{" "}
                  <strong className="font-medium text-foreground">
                    {permission === null
                      ? "comprobando…"
                      : permission === "unsupported"
                        ? "no compatible (recibirás avisos dentro de la app)"
                        : permission === "granted"
                          ? "permitidas"
                          : permission === "denied"
                            ? "bloqueadas en el navegador"
                            : "sin decidir"}
                  </strong>
                  . El permiso solo se pedirá cuando pulses activar; en iPhone requiere instalar la app en la pantalla de inicio.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled>Activar notificaciones</Button>
                  <Button variant="outline" disabled>
                    Enviar prueba
                  </Button>
                </div>
                <p className="mt-2 text-xs text-text-tertiary">Suscripción, envío y registro de entregas llegan en M5.</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="tone-title">
            <h2 id="tone-title" className="mb-3 text-base font-semibold">
              Tono
            </h2>
            <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Tono">
              {(Object.keys(TONES) as Tone[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={tone === t}
                  onClick={() => {
                    setTone(t)
                    if (t !== "hardcore") setProfanity(false)
                  }}
                  className={cn(
                    "panel rounded-2xl p-4 text-left transition-colors",
                    tone === t ? "border-signal/50! bg-surface-raised!" : "hover:bg-surface-raised/60"
                  )}
                >
                  <p className="font-semibold">{TONES[t].name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">{TONES[t].desc}</p>
                </button>
              ))}
            </div>
            <div className={cn("mt-3 flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3", tone !== "hardcore" && "opacity-60")}>
              <Label htmlFor="profanity" className="flex-1 leading-snug">
                Lenguaje fuerte
                <span className="block text-xs font-normal text-text-tertiary">Solo disponible en modo Hardcore.</span>
              </Label>
              <Switch id="profanity" checked={profanity} onCheckedChange={setProfanity} disabled={tone !== "hardcore"} />
            </div>
          </section>

          <section className="panel space-y-6 rounded-2xl p-5" aria-labelledby="limits-title">
            <h2 id="limits-title" className="text-base font-semibold">
              Límites
            </h2>
            <div>
              <div className="mb-3 flex justify-between text-sm">
                <Label htmlFor={ids.cap}>Máximo diario</Label>
                <span className="num text-text-secondary">{cap} mensajes</span>
              </div>
              <Slider id={ids.cap} min={1} max={10} step={1} value={[cap]} onValueChange={(v) => setCap(v[0])} aria-label="Máximo de mensajes al día" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={ids.quietStart}>Silencio desde</Label>
                <Input id={ids.quietStart} type="time" defaultValue="22:30" className="num h-11" />
              </div>
              <div className="space-y-2">
                <Label htmlFor={ids.quietEnd}>Hasta</Label>
                <Input id={ids.quietEnd} type="time" defaultValue="07:30" className="num h-11" />
              </div>
            </div>
          </section>

          <section className="panel rounded-2xl" aria-labelledby="trig-title">
            <h2 id="trig-title" className="px-5 pt-5 pb-2 text-base font-semibold">
              Avisos
            </h2>
            <ul className="divide-y divide-border/70">
              {TRIGGERS.map((t) => (
                <li key={t.id} className="flex min-h-14 items-center justify-between gap-4 px-5 py-2">
                  <Label htmlFor={`trig-${t.id}`} className="flex-1 font-normal">
                    {t.label}
                  </Label>
                  <Switch id={`trig-${t.id}`} checked={triggers[t.id]} onCheckedChange={(v) => setTriggers({ ...triggers, [t.id]: v })} />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-8">
          <p className="px-1 text-xs font-medium text-text-tertiary">Vista previa</p>
          <div className="rounded-3xl border border-border bg-[linear-gradient(160deg,var(--surface-raised),var(--background))] p-4">
            <div className="rounded-2xl bg-white/[0.07] p-3.5 backdrop-blur">
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <BrandMark className="size-4" />
                <span className="font-medium">THE ONE PERCENT</span>
                <span className="ml-auto">ahora</span>
              </div>
              <p className="mt-2 text-sm font-semibold">Quedan hábitos por hoy</p>
              <p className="mt-0.5 text-sm leading-snug text-foreground/85">{sample}</p>
            </div>
          </div>
          <DemoNote>
            <span className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Antes de enviar se comprobará de nuevo si el hábito ya está hecho, si es día de descanso o si estás en horas de silencio. Nunca
              se mostrarán datos sensibles en la pantalla de bloqueo.
            </span>
          </DemoNote>
        </aside>
      </div>
    </>
  )
}
