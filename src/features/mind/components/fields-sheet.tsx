"use client"

import { useId } from "react"
import { toast } from "sonner"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { CHECKIN_FIELDS, INDICATOR_LABEL, INDICATORS, PHASE_LABEL, type CheckinField, type CheckinPhase } from "../domain/types"
import type { MindModel } from "../use-mind"
import { REASON } from "./mind-ui"

/** «Indicadores visibles» (decision 4). Synced like any other setting; hiding never deletes history. */
export function FieldsSheet({ m, open, onOpenChange }: { m: MindModel; open: boolean; onOpenChange: (open: boolean) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  const config = m.state.checkinConfig

  function toggle(phase: CheckinPhase, field: CheckinField, on: boolean) {
    const next = { ...config, [phase]: on ? [...config[phase], field] : config[phase].filter((f) => f !== field) }
    if (!on && !next[phase].some((f) => (INDICATORS as readonly string[]).includes(f))) {
      toast.error(REASON.invalid_config)
      return
    }
    const r = m.api.setCheckinConfig(next)
    if (!r.ok) toast.error(REASON[r.reason] ?? "No se pudo guardar.")
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl border-x-0")}>
        <SheetHeader className="border-b border-border/70 px-5 pt-5 pb-4">
          <SheetTitle>Indicadores visibles</SheetTitle>
          <SheetDescription>Ocultar un indicador no borra lo que ya registraste: sigue en el historial y en Análisis.</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 overflow-y-auto px-5 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {(["am", "pm"] as const).map((phase) => (
            <fieldset key={phase}>
              <legend className="mb-2 text-sm font-semibold">{PHASE_LABEL[phase]}</legend>
              <ul className="divide-y divide-border/60 rounded-xl border border-border">
                {CHECKIN_FIELDS.map((f) => (
                  <FieldRow key={f} label={INDICATOR_LABEL[f]} checked={config[phase].includes(f)} disabled={!m.saved} onChange={(on) => toggle(phase, f, on)} />
                ))}
              </ul>
            </fieldset>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function FieldRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const id = useId()
  return (
    <li className="flex min-h-12 items-center justify-between gap-4 px-4">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </li>
  )
}
