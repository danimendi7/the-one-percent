"use client"

import { useMemo, useState } from "react"
import { Check, Download, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { uuidv5 } from "@/lib/ids"
import type { LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import { HabitIcon } from "@/features/habits/components/habit-icon"
import { habitActions } from "@/features/habits/store/habit-store"
import { importCandidates, planDemoImport } from "@/features/sync/domain/demo-import"

export function downloadJson(json: string, filename: string) {
  download(json, "application/json", filename)
}

export function download(text: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Explicit, selective import of this browser's demo data into the account.
 * Nothing is preselected; fictional seeded records are never imported.
 */
export function DemoImportSheet({
  open,
  onOpenChange,
  demo,
  userId,
  today,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  demo: HabitsState
  userId: string
  today: LocalDate
}) {
  const desktop = useMediaQuery("(min-width: 768px)")
  const candidates = useMemo(() => importCandidates(demo, today), [demo, today])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [withEntries, setWithEntries] = useState(true)
  const [busy, setBusy] = useState(false)

  const plan = useMemo(
    () => planDemoImport(demo, { selected, includeUserEntries: withEntries, today, idFor: (id) => id }),
    [demo, selected, withEntries, today]
  )
  const realEntries = candidates.filter((c) => selected.has(c.habit.id)).reduce((n, c) => n + c.userEntries.length, 0)

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function confirm() {
    setBusy(true)
    try {
      const ids = new Map<string, string>()
      for (const id of selected) ids.set(id, await uuidv5(`${userId}:${id}`))
      const final = planDemoImport(demo, { selected, includeUserEntries: withEntries, today, idFor: (id) => ids.get(id)! })
      habitActions.submitOps?.(final.ops)
      toast.success(`${final.habits} ${final.habits === 1 ? "hábito importado" : "hábitos importados"}`, {
        description: final.entries > 0 ? `${final.entries} registros reales incluidos. Se sincronizarán en segundo plano.` : "Se sincronizarán en segundo plano.",
      })
      onOpenChange(false)
      setSelected(new Set())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl")}
      >
        <SheetHeader className="border-b border-border px-5 pt-5 pb-4">
          <SheetTitle className="text-lg">Importar desde la demo</SheetTitle>
          <SheetDescription>
            Elige qué hábitos pasar a tu cuenta. Los datos de ejemplo generados por la demo nunca se importan.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised/40 p-3.5 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
            <p className="leading-relaxed text-text-secondary">
              Las plantillas de la demo se crean <strong className="font-medium text-foreground">desde hoy y sin historial</strong>. Los
              hábitos que creaste tú conservan sus horarios y, si quieres, los registros que hiciste. Tus datos de la demo no se borran.
            </p>
          </div>

          <Button variant="outline" className="w-full" onClick={() => downloadJson(JSON.stringify(demo, null, 2), `the-one-percent-demo-${today}.json`)}>
            <Download />
            Exportar copia de la demo (recomendado)
          </Button>

          {candidates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-text-secondary">
              No hay hábitos activos en la demo de este navegador.
            </p>
          ) : (
            <ul className="space-y-2" aria-label="Hábitos de la demo">
              {candidates.map((c) => {
                const on = selected.has(c.habit.id)
                return (
                  <li key={c.habit.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(c.habit.id)}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        on ? "border-signal/50 bg-signal/[0.06]" : "border-border hover:bg-surface-raised/50"
                      )}
                    >
                      <HabitIcon icon={c.habit.icon} dimensionId={c.habit.dimensionId} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.habit.name}</span>
                        <span className="block text-xs text-text-tertiary">
                          {c.template
                            ? "Plantilla demo · empieza hoy"
                            : `Creado por ti · ${c.userEntries.length} ${c.userEntries.length === 1 ? "registro" : "registros"}`}
                          {c.template && c.userEntries.length > 0 ? ` · ${c.userEntries.length} de hoy` : ""}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-md border",
                          on ? "border-transparent bg-signal text-signal-foreground" : "border-text-tertiary/60"
                        )}
                        aria-hidden
                      >
                        {on && <Check className="size-4" strokeWidth={3} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
            <Label htmlFor="import-entries" className="flex-1 leading-snug">
              Incluir mis registros reales
              <span className="block text-xs font-normal text-text-tertiary">
                {realEntries} en la selección. Nunca los generados por la demo.
              </span>
            </Label>
            <Switch id="import-entries" checked={withEntries} onCheckedChange={setWithEntries} />
          </div>
        </div>

        <SheetFooter className="pb-safe gap-2 border-t border-border px-5 py-4">
          <p className="text-xs text-text-tertiary" aria-live="polite">
            {plan.habits === 0
              ? "Selecciona al menos un hábito."
              : `Se crearán ${plan.habits} ${plan.habits === 1 ? "hábito" : "hábitos"} y ${plan.entries} registros. ${plan.skippedSeeded} registros de ejemplo no se importarán.`}
          </p>
          <Button onClick={confirm} disabled={plan.habits === 0 || busy} className="w-full">
            {busy ? "Preparando…" : "Importar a mi cuenta"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
