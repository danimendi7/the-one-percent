"use client"

import { useId } from "react"
import { Info } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { SourceBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { BrandMark } from "@/components/shell/brand-mark"
import { cn } from "@/lib/utils"
import { WEEKDAY_LONG, WEEKDAY_SHORT, type Weekday } from "@/features/habits/domain/dates"
import { habitActions, useHabits, type HabitsSnapshot } from "@/features/habits/store/habit-store"
import { RULE_LABEL, RULE_ORDER, type MotivationSettings, type Tone } from "./domain/motivation"
import { normalizeMotivation, sampleNudge } from "./domain/settings"
import { PushSection } from "./push/push-section"

const TONES: Record<Tone, { name: string; desc: string }> = {
  calm: { name: "Calma", desc: "Recordatorios suaves, sin presión." },
  balanced: { name: "Equilibrado", desc: "Directo y claro, sin dramatismo." },
  hardcore: { name: "Hardcore", desc: "Exigente y sin rodeos. Opcional." },
}
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]

export function NotificationSettings() {
  const snap = useHabits()
  return (
    <>
      <PageHeader
        title="Notificaciones"
        meta={<SourceBadge source={snap?.source}>Demo · ajustes guardados en este navegador</SourceBadge>}
        description="Mensajes contextuales que respetan tus horarios, días de descanso y lo que ya has hecho. Se guardan y se sincronizan entre tus dispositivos."
      />
      {snap ? <Settings snap={snap} /> : <div className="panel h-96 animate-pulse rounded-2xl motion-reduce:animate-none" role="status" aria-busy="true" aria-label="Cargando los ajustes" />}
    </>
  )
}

function Settings({ snap }: { snap: HabitsSnapshot }) {
  const ids = { quietStart: useId(), quietEnd: useId(), cap: useId(), gap: useId() }
  const s = snap.state.motivation
  const save = (patch: Partial<MotivationSettings>) => habitActions.setMotivationSettings(normalizeMotivation({ ...s, ...patch }))
  const sample = sampleNudge(s)
  const off = !s.enabled

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <section className="panel flex items-center justify-between gap-4 rounded-2xl px-5 py-4" aria-label="Avisos">
          <Label htmlFor="motivation-enabled" className="flex-1 leading-snug">
            Avisos activados
            <span className="block text-xs font-normal text-text-tertiary">Apágalos y no se calculará ninguno.</span>
          </Label>
          <Switch id="motivation-enabled" checked={s.enabled} onCheckedChange={(v) => save({ enabled: v })} data-testid="motivation-enabled" />
        </section>

        <PushSection demo={snap.source === "demo"} />

        <section aria-labelledby="tone-title" className={cn(off && "opacity-60")}>
          <h2 id="tone-title" className="mb-3 text-base font-semibold">
            Tono
          </h2>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Tono">
            {(Object.keys(TONES) as Tone[]).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={s.tone === t}
                onClick={() => save({ tone: t, profanity: t === "hardcore" ? s.profanity : false })}
                className={cn("panel min-h-11 rounded-2xl p-4 text-left transition-colors motion-reduce:transition-none", s.tone === t ? "border-signal/50! bg-surface-raised!" : "hover:bg-surface-raised/60")}
              >
                <p className="font-semibold">{TONES[t].name}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">{TONES[t].desc}</p>
              </button>
            ))}
          </div>
          <div className={cn("mt-3 flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3", s.tone !== "hardcore" && "opacity-60")}>
            <Label htmlFor="profanity" className="flex-1 leading-snug">
              Lenguaje fuerte
              <span className="block text-xs font-normal text-text-tertiary">Solo disponible en modo Hardcore.</span>
            </Label>
            <Switch id="profanity" checked={s.profanity} onCheckedChange={(v) => save({ profanity: v })} disabled={s.tone !== "hardcore"} />
          </div>
        </section>

        <section className="panel space-y-6 rounded-2xl p-5" aria-labelledby="limits-title">
          <h2 id="limits-title" className="text-base font-semibold">
            Límites
          </h2>
          <div>
            <div className="mb-3 flex justify-between text-sm">
              <Label htmlFor={ids.cap}>Máximo diario</Label>
              <span className="num text-text-secondary" data-testid="motivation-cap">
                {s.dailyCap} {s.dailyCap === 1 ? "mensaje" : "mensajes"}
              </span>
            </div>
            <Slider id={ids.cap} min={1} max={10} step={1} value={[s.dailyCap]} onValueChange={(v) => save({ dailyCap: v[0] })} aria-label="Máximo de mensajes al día" />
          </div>
          <div>
            <div className="mb-3 flex justify-between text-sm">
              <Label htmlFor={ids.gap}>Separación mínima</Label>
              <span className="num text-text-secondary">{s.minGapMinutes} min</span>
            </div>
            <Slider id={ids.gap} min={0} max={240} step={15} value={[s.minGapMinutes]} onValueChange={(v) => save({ minGapMinutes: v[0] })} aria-label="Minutos mínimos entre dos mensajes" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor={ids.quietStart}>Silencio desde</Label>
              <Input id={ids.quietStart} type="time" value={s.quietStart} onChange={(e) => e.target.value && save({ quietStart: e.target.value })} className="num h-11" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.quietEnd}>Hasta</Label>
              <Input id={ids.quietEnd} type="time" value={s.quietEnd} onChange={(e) => e.target.value && save({ quietEnd: e.target.value })} className="num h-11" />
            </div>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm">Días sin avisos</legend>
            {/* -mx-3 and a 2 px gap: at 375 px each day gets 44 px to tap instead of 38. */}
            <div className="-mx-3 grid grid-cols-7 gap-0.5 sm:mx-0 sm:gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = s.daysOff.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${WEEKDAY_LONG[d]} sin avisos`}
                    onClick={() => save({ daysOff: on ? s.daysOff.filter((x) => x !== d) : [...s.daysOff, d] })}
                    className={cn("num min-h-11 rounded-xl border text-sm font-medium", on ? "border-signal/60 bg-signal/12 text-foreground" : "border-border text-text-secondary")}
                  >
                    {WEEKDAY_SHORT[d]}
                  </button>
                )
              })}
            </div>
          </fieldset>
        </section>

        <section className="panel rounded-2xl" aria-labelledby="trig-title">
          <h2 id="trig-title" className="px-5 pt-5 pb-2 text-base font-semibold">
            Avisos
          </h2>
          <ul className="divide-y divide-border/70">
            {RULE_ORDER.map((r) => (
              <li key={r} className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-2">
                <Label htmlFor={`trig-${r}`} className="flex-1 font-normal">
                  {RULE_LABEL[r]}
                </Label>
                {r !== "allDone" && (
                  <Input
                    type="time"
                    aria-label={`Hora de ${RULE_LABEL[r].toLowerCase()}`}
                    value={s.times[r]}
                    onChange={(e) => e.target.value && save({ times: { ...s.times, [r]: e.target.value } })}
                    className="num h-11 w-28"
                    disabled={!s.rules[r]}
                  />
                )}
                <Switch id={`trig-${r}`} checked={s.rules[r]} onCheckedChange={(v) => save({ rules: { ...s.rules, [r]: v } })} data-testid={`motivation-rule-${r}`} />
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
            <p className="mt-2 text-sm font-semibold">{sample.title}</p>
            <p className="mt-0.5 text-sm leading-snug text-foreground/85" data-testid="motivation-sample">
              {sample.body}
            </p>
          </div>
        </div>
        <p className="flex items-start gap-1.5 px-1 text-xs leading-relaxed text-text-tertiary">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Antes de enviar se comprueba de nuevo si el hábito ya está hecho, si es día de descanso o si estás en horas de silencio. Nunca se muestran datos del check-in en la pantalla de bloqueo.
        </p>
      </aside>
    </div>
  )
}
