"use client"

import { useEffect } from "react"

/** Marks the document as hydrated; the CSS-only fallback below stays hidden from then on. */
export function HydrationMark() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1"
  }, [])
  return null
}

/**
 * Pure HTML/CSS fallback: visible only if React never hydrates (for example a
 * dev server opened from another device, a blocked script or a very old
 * browser). Better an explanation than empty skeleton blocks.
 */
export function BootFallback() {
  return (
    <div
      role="alert"
      className="boot-fallback fixed inset-x-4 bottom-[calc(var(--bottom-tabs-h)+1rem)] z-50 items-start gap-3 rounded-2xl border border-warning/40 bg-popover p-4 text-sm shadow-lg md:inset-x-auto md:right-6 md:bottom-6 md:max-w-sm"
    >
      <div>
        <p className="font-semibold text-foreground">La app no ha terminado de cargar</p>
        <p className="mt-1 leading-relaxed text-text-secondary">
          Los datos se muestran cuando arranca el JavaScript. Recarga la página; si persiste, comprueba la conexión con el
          servidor o usa un navegador actualizado.
        </p>
      </div>
    </div>
  )
}
