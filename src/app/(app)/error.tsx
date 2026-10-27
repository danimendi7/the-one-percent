"use client"

import { useEffect } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/common/empty-state"

/**
 * Error boundary for a screen. It sits below the app shell, so navigation and the data source
 * (sync engine, offline queue) stay mounted: pending work keeps syncing and nothing local is
 * cleared. The user can retry or move to another screen.
 */
export default function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div role="alert" className="panel mx-auto mt-6 max-w-lg rounded-2xl">
      <EmptyState
        icon={AlertTriangle}
        title="No se pudo mostrar esta pantalla"
        description="Tus datos están a salvo: lo pendiente se sigue sincronizando y no se ha borrado nada de este dispositivo."
        action={
          <Button onClick={() => retry()}>
            <RotateCcw /> Reintentar
          </Button>
        }
      />
    </div>
  )
}
