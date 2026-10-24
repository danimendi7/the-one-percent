"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Bell, ChevronRight, CloudUpload, Download, LogIn, LogOut, RefreshCw, RotateCcw, Trash2 } from "lucide-react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DemoBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { SyncStatusLabel } from "@/components/shell/sync-status"
import { habitActions } from "@/features/habits/store/habit-store"
import { clearDemoState, readDemoState } from "@/features/habits/store/demo-store"
import type { HabitsState } from "@/features/habits/domain/types"
import { useHabitsModel } from "@/features/habits/components/use-habits-model"
import { useHabits } from "@/features/habits/store/habit-store"
import { DEMO_COOKIE, isSupabaseConfigured } from "@/lib/supabase/env"
import { DemoImportSheet, downloadJson } from "./demo-import-sheet"

const TIMEZONES = [
  "Europe/Madrid",
  "Atlantic/Canary",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Mexico_City",
  "America/Bogota",
  "America/Buenos_Aires",
  "UTC",
]

export function SettingsView() {
  const snap = useHabits()
  const model = useHabitsModel()
  const account = snap?.source === "account"

  return (
    <>
      <PageHeader title="Ajustes" meta={snap && !account ? <DemoBadge /> : undefined} />
      <div className="mx-auto max-w-2xl space-y-6">
        {!snap ? (
          <div className="panel h-48 animate-pulse rounded-2xl" aria-busy="true" />
        ) : account ? (
          <AccountSection />
        ) : (
          <DemoModeSection />
        )}

        <Group title="Notificaciones">
          <Link href="/settings/notifications" className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-surface-raised/50">
            <Bell className="size-4 text-text-secondary" aria-hidden />
            <span className="flex-1 text-sm font-medium">Tono, horarios y avisos</span>
            <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
          </Link>
        </Group>

        {account && model && <BrowserDemoData userId={snap!.account!.userId} today={model.today} />}
      </div>
    </>
  )
}

function AccountSection() {
  const snap = useHabits()!
  const sync = snap.sync!
  const [confirmOut, setConfirmOut] = useState(false)
  const tz = snap.state.timezone
  const zones = TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]

  const exportAccount = () => downloadJson(habitActions.exportJson(), `the-one-percent-${snap.today}.json`)

  return (
    <>
      <Group title="Cuenta">
        <Row label="Email" value={snap.account?.email ?? "Sin email"} />
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <p className="text-sm font-medium">Sincronización</p>
            <p className="mt-0.5 text-xs text-text-tertiary">
              <SyncStatusLabel info={sync} />
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => habitActions.syncNow?.()}>
            <RefreshCw /> Sincronizar ahora
          </Button>
        </div>
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <p className="text-sm font-medium">Zona horaria</p>
            <p className="mt-0.5 text-xs text-text-tertiary">Define qué es «hoy» en todos tus dispositivos.</p>
          </div>
          <Select
            value={tz}
            onValueChange={(v) => {
              habitActions.setTimezone?.(v)
              toast("Zona horaria actualizada", { description: v })
            }}
          >
            <SelectTrigger className="h-11! w-56" aria-label="Zona horaria">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zones.map((z) => (
                <SelectItem key={z} value={z}>
                  {z.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <Button variant="outline" onClick={exportAccount}>
            <Download /> Exportar mis datos (JSON)
          </Button>
          <Button
            variant="ghost"
            className="text-text-secondary"
            onClick={() => (sync.pending > 0 ? setConfirmOut(true) : signOut())}
          >
            <LogOut /> Cerrar sesión
          </Button>
        </div>
      </Group>

      <Dialog open={confirmOut} onOpenChange={setConfirmOut}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hay cambios sin sincronizar</DialogTitle>
            <DialogDescription>
              {sync.pending} {sync.pending === 1 ? "cambio está" : "cambios están"} solo en este dispositivo. Siguen guardados aquí y se
              enviarán cuando vuelvas a entrar con esta cuenta, pero no estarán en tus otros dispositivos hasta entonces.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button variant="outline" onClick={() => habitActions.syncNow?.()}>
              <RefreshCw /> Reintentar
            </Button>
            <Button variant="destructive" onClick={signOut}>
              Cerrar sesión igualmente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function signOut() {
  const form = document.createElement("form")
  form.method = "post"
  form.action = "/auth/signout"
  document.body.appendChild(form)
  form.submit()
}

function DemoModeSection() {
  const snap = useHabits()!
  const router = useRouter()
  const [confirmReset, setConfirmReset] = useState(false)
  const exportDemo = () => downloadJson(habitActions.exportJson(), `the-one-percent-demo-${snap.today}.json`)

  return (
    <>
      <Group title="Modo demo">
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-relaxed text-text-secondary">
            Estás explorando con datos de ejemplo guardados solo en este navegador ({Object.keys(snap.state.entries).length} registros,{" "}
            {snap.state.habits.length} hábitos).
            {isSupabaseConfigured && " Entra con tu email para usar tus datos reales sincronizados."}
          </p>
          <div className="flex flex-wrap gap-2">
            {isSupabaseConfigured && (
              <Button
                onClick={() => {
                  document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0`
                  router.push("/login")
                }}
              >
                <LogIn /> Entrar con mi cuenta
              </Button>
            )}
            <Button variant="outline" onClick={exportDemo}>
              <Download /> Exportar JSON
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReset(true)} className="text-text-secondary">
              <RotateCcw /> Restablecer demo
            </Button>
          </div>
        </div>
      </Group>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Restablecer los datos de demostración?</DialogTitle>
            <DialogDescription>
              Se borrarán los hábitos y registros que hayas creado en la demo de este navegador y se regenerará el historial de ejemplo.
              Exporta antes si quieres conservarlos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button variant="outline" onClick={exportDemo}>
              <Download /> Exportar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                habitActions.resetDemo?.()
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

/** Account mode: demo data still in this browser can be imported, exported or removed (never automatically). */
function BrowserDemoData({ userId, today }: { userId: string; today: string }) {
  const [demo, setDemo] = useState<HabitsState | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    // Read once on mount; localStorage is client-only.
    const read = () => setDemo(readDemoState())
    read()
    window.addEventListener("storage", read)
    return () => window.removeEventListener("storage", read)
  }, [])

  if (!demo) return null
  const exportDemo = () => downloadJson(JSON.stringify(demo, null, 2), `the-one-percent-demo-${today}.json`)

  return (
    <>
      <Group title="Datos de la demo en este navegador">
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-relaxed text-text-secondary">
            Este navegador conserva {demo.habits.length} hábitos de la demo. No se han importado a tu cuenta: puedes elegir cuáles pasar,
            sin los registros de ejemplo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setImportOpen(true)}>
              <CloudUpload /> Importar a mi cuenta…
            </Button>
            <Button variant="outline" onClick={exportDemo}>
              <Download /> Exportar JSON
            </Button>
            <Button variant="ghost" className="text-text-secondary" onClick={() => setConfirmClear(true)}>
              <Trash2 /> Eliminar del navegador
            </Button>
          </div>
        </div>
      </Group>

      <DemoImportSheet open={importOpen} onOpenChange={setImportOpen} demo={demo} userId={userId} today={today} />

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar la demo de este navegador?</DialogTitle>
            <DialogDescription>
              Solo afecta a los datos de demostración guardados aquí. Tu cuenta no cambia. Exporta una copia si quieres conservarla.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancelar</Button>
            </DialogClose>
            <Button variant="outline" onClick={exportDemo}>
              <Download /> Exportar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                clearDemoState()
                setDemo(null)
                setConfirmClear(false)
                toast("Demo eliminada de este navegador")
              }}
            >
              Eliminar
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
      <p className="truncate text-right text-sm text-text-secondary">{value}</p>
    </div>
  )
}
