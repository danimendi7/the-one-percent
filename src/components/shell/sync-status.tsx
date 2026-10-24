"use client"

import { CloudCheck, CloudOff, HardDrive, LoaderCircle, RefreshCw, TriangleAlert, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { habitActions, useHabits, type SyncInfo } from "@/features/habits/store/habit-store"
import { cn } from "@/lib/utils"

function since(ts: number | null): string {
  if (!ts) return "todavía no"
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 10) return "ahora mismo"
  if (s < 60) return `hace ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(ts)
}

export function SyncStatusLabel({ info }: { info: SyncInfo }) {
  switch (info.status) {
    case "synced":
      return <>Sincronizado · {since(info.lastSyncedAt)}</>
    case "syncing":
      return <>Sincronizando…</>
    case "pending":
      return <>{info.pending} {info.pending === 1 ? "cambio pendiente" : "cambios pendientes"}</>
    case "offline":
      return <>Sin conexión · {info.pending} en cola</>
    case "error":
      return <>Error al sincronizar · se reintentará</>
  }
}

const VIEW = {
  synced: { icon: CloudCheck, label: "Sincronizado", tone: "ok" },
  syncing: { icon: LoaderCircle, label: "Sincronizando", tone: "ok" },
  pending: { icon: UploadCloud, label: "Pendiente", tone: "pending" },
  offline: { icon: CloudOff, label: "Sin conexión", tone: "warn" },
  error: { icon: TriangleAlert, label: "Error", tone: "warn" },
} as const

/**
 * Honest data-freshness indicator (PRD §6: synced, pending, failed, conflict).
 * Demo mode says so explicitly; it never claims "synced" without a server.
 */
export function SyncStatus({ compact = false, className }: { compact?: boolean; className?: string }) {
  const snap = useHabits()
  const account = snap?.source === "account" && snap.sync
  const storageFailed = snap !== null && !snap.persisted

  let Icon: React.ComponentType<{ className?: string }> = HardDrive
  let label = snap ? "Local · demo" : "…"
  let tone: "ok" | "pending" | "warn" = "ok"
  if (account) {
    const v = VIEW[account.status]
    Icon = v.icon
    label = account.status === "pending" ? `${account.pending} pendiente${account.pending === 1 ? "" : "s"}` : v.label
    tone = v.tone
  }
  if (storageFailed) {
    Icon = TriangleAlert
    label = "Sin guardar"
    tone = "warn"
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "relative inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors after:absolute after:-inset-1 after:content-[''] md:h-9 md:min-w-9",
          tone === "warn"
            ? "border-warning/40 bg-warning/10 text-warning"
            : tone === "pending"
              ? "border-border bg-surface text-foreground"
              : "border-border bg-surface text-text-secondary hover:text-foreground",
          compact && "px-0 md:px-3",
          className
        )}
        aria-label={`Estado de datos: ${label}`}
      >
        <Icon className={cn("size-3.5", account && account.status === "syncing" && "animate-spin")} />
        <span className={cn(compact && "sr-only md:not-sr-only")}>{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-sm">
        {storageFailed ? (
          <>
            <p className="font-semibold text-foreground">No se puede guardar en este navegador</p>
            <p className="mt-1.5 leading-relaxed text-text-secondary">
              El navegador ha bloqueado el almacenamiento local (modo privado o sin espacio).
              {account ? " Los cambios se envían al servidor, pero no quedan copias offline." : " Los cambios se perderán al recargar."}
            </p>
          </>
        ) : account ? (
          <>
            <p className="font-semibold text-foreground">
              <SyncStatusLabel info={account} />
            </p>
            <p className="mt-1.5 leading-relaxed text-text-secondary">
              {account.status === "offline"
                ? "Tus cambios están guardados en este dispositivo y se enviarán solos al recuperar la conexión."
                : account.status === "error"
                  ? "El servidor no ha respondido como se esperaba. Tus cambios siguen en este dispositivo y se reintentará."
                  : "Tus datos se guardan en tu cuenta y se sincronizan con tus otros dispositivos."}
            </p>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => habitActions.syncNow?.()}>
              <RefreshCw /> Sincronizar ahora
            </Button>
          </>
        ) : (
          <>
            <p className="font-semibold text-foreground">Datos de demostración locales</p>
            <p className="mt-1.5 leading-relaxed text-text-secondary">
              Los cambios se guardan solo en este navegador y no se sincronizan. Entra con tu cuenta desde Ajustes para usar tus datos
              reales.
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
