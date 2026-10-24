"use client"

import Link from "next/link"
import { useState } from "react"
import { Bell, ChevronRight, Download, RotateCcw } from "lucide-react"
import { toast } from "sonner"
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
import { DemoBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { habitActions } from "@/features/habits/store/habit-store"
import { useHabitsModel } from "@/features/habits/components/use-habits-model"

export function SettingsView() {
  const model = useHabitsModel()
  const [confirmReset, setConfirmReset] = useState(false)

  const exportJson = () => {
    const blob = new Blob([habitActions.exportJson()], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `the-one-percent-demo-${model?.today ?? "export"}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader title="Ajustes" meta={<DemoBadge />} />
      <div className="mx-auto max-w-2xl space-y-6">
        <Group title="General">
          <Row label="Zona horaria" value={model?.state.timezone ?? "…"} hint="Las fechas se guardan en UTC y los días según esta zona." />
          <Row label="Idioma" value="Español" />
          <Row label="Cuenta" value="Sin cuenta (M2)" hint="Inicio de sesión privado y sincronización llegan en M2." />
        </Group>

        <Group title="Notificaciones">
          <Link href="/settings/notifications" className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-surface-raised/50">
            <Bell className="size-4 text-text-secondary" aria-hidden />
            <span className="flex-1 text-sm font-medium">Tono, horarios y avisos</span>
            <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
          </Link>
        </Group>

        <Group title="Datos">
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm leading-relaxed text-text-secondary">
              Los datos de esta demo viven solo en este navegador ({model ? Object.keys(model.state.entries).length : "…"} registros,{" "}
              {model?.state.habits.length ?? "…"} hábitos).
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportJson} disabled={!model}>
                <Download />
                Exportar JSON
              </Button>
              <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={!model} className="text-text-secondary">
                <RotateCcw />
                Restablecer demo
              </Button>
            </div>
          </div>
        </Group>
      </div>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Restablecer los datos de demostración?</DialogTitle>
            <DialogDescription>
              Se borrarán los hábitos y registros que hayas creado en este navegador y se regenerará el historial de ejemplo. Exporta antes si
              quieres conservarlos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button variant="outline" onClick={exportJson}>
              <Download /> Exportar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                habitActions.resetDemo()
                setConfirmReset(false)
                toast("Demo restablecida")
              }}
            >
              Restablecer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 px-1 text-xs font-medium text-text-tertiary">{title}</h2>
      <div className="panel divide-y divide-border/70 overflow-hidden rounded-2xl">{children}</div>
    </section>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 px-5 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-text-tertiary">{hint}</p>}
      </div>
      <p className="text-right text-sm text-text-secondary">{value}</p>
    </div>
  )
}
