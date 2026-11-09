"use client"

import { useEffect, useState } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { METADATA_ERROR_TEXT, type MetadataErrorCode } from "../metadata/types"
import { DiscardPrompt } from "./content-form"

/**
 * Shared pieces of the search assistants (books M4g.3, podcasts M4g.4): the sheet with its
 * «¿Descartar lo escrito?» guard and its place above the iPhone keyboard, and the texts of the
 * search errors. One look and one behaviour for both.
 */

/** Bottom sheet above the iPhone keyboard: the visual viewport says how much room is left. */
function useKeyboardInset(active: boolean): { bottom: number; height: number } | null {
  const [v, setV] = useState<{ bottom: number; height: number } | null>(null)
  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport
    if (!active || !vv) return
    const update = () => setV({ bottom: Math.max(0, window.innerHeight - vv.height - vv.offsetTop), height: vv.height })
    update()
    vv.addEventListener("resize", update)
    vv.addEventListener("scroll", update)
    return () => {
      vv.removeEventListener("resize", update)
      vv.removeEventListener("scroll", update)
    }
  }, [active])
  return active ? v : null
}

/**
 * The assistant's sheet: bottom on the phone, side on the desktop. Closing with something typed
 * asks first; `children` gets `setDirty` and `close` (after a save or a hand-over to manual entry).
 */
export function AssistantSheet({
  open,
  onOpenChange,
  testId,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  testId: string
  children: (api: { setDirty: (v: boolean) => void; close: () => void }) => React.ReactNode
}) {
  const desktop = useMediaQuery("(min-width: 768px)")
  const inset = useKeyboardInset(open && !desktop)
  const [dirty, setDirty] = useState(false)
  const [asking, setAsking] = useState(false)
  const close = () => (setDirty(false), setAsking(false), onOpenChange(false))
  return (
    <Sheet open={open} onOpenChange={(v) => (v ? onOpenChange(true) : dirty ? setAsking(true) : close())}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl border-x-0")}
        style={inset ? { bottom: inset.bottom, maxHeight: Math.round(inset.height * 0.92) } : undefined}
        data-testid={testId}
      >
        {asking && <DiscardPrompt onKeep={() => setAsking(false)} onDiscard={close} />}
        {open && children({ setDirty, close })}
      </SheetContent>
    </Sheet>
  )
}

/** What a failed search says; the manual entry is always offered next to it (D8). */
export function searchErrorText(code: MetadataErrorCode, provider: string, retryAfter?: number): string {
  if (code === "unauthorized") return "Tu sesión ha caducado. Vuelve a entrar para buscar; mientras, puedes introducirlo manualmente."
  if (code === "network") return "No se pudo conectar con la app. Tu búsqueda sigue aquí: inténtalo de nuevo o introdúcelo manualmente."
  const base = code === "provider_unavailable" ? `${provider} no responde ahora.` : METADATA_ERROR_TEXT[code]
  return retryAfter ? `${base} Vuelve a intentarlo en ${retryAfter} s.` : base
}

export const OFFLINE_TEXT = "Sin conexión. Tu búsqueda sigue aquí; puedes introducirlo manualmente y se sincronizará al volver la red."
