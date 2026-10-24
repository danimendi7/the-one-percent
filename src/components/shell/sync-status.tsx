"use client"

import { HardDrive, TriangleAlert } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useHabits } from "@/features/habits/store/habit-store"
import { cn } from "@/lib/utils"

/**
 * Honest data-freshness indicator. In M1 there is no backend, so this never
 * claims "synced": it reports local-only storage (or that storage failed).
 */
export function SyncStatus({ compact = false, className }: { compact?: boolean; className?: string }) {
  const snap = useHabits()
  const failed = snap !== null && !snap.persisted
  const label = failed ? "Sin guardar" : "Local · demo"

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "relative inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors after:absolute after:-inset-1 after:content-[''] md:h-9 md:min-w-9",
          failed
            ? "border-warning/40 bg-warning/10 text-warning"
            : "border-border bg-surface text-text-secondary hover:text-foreground",
          compact && "px-0 md:px-3",
          className
        )}
        aria-label={`Estado de datos: ${label}`}
      >
        {failed ? <TriangleAlert className="size-3.5" /> : <HardDrive className="size-3.5" />}
        <span className={cn(compact && "sr-only md:not-sr-only")}>{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-sm">
        <p className="font-semibold text-foreground">
          {failed ? "No se pudo guardar en este navegador" : "Datos de demostración locales"}
        </p>
        <p className="mt-1.5 leading-relaxed text-text-secondary">
          {failed
            ? "El navegador ha bloqueado el almacenamiento (modo privado o sin espacio). Los cambios se perderán al recargar."
            : "Los cambios se guardan solo en este navegador. Todavía no hay cuenta ni sincronización entre dispositivos: llegan en la fase M2."}
        </p>
      </PopoverContent>
    </Popover>
  )
}
