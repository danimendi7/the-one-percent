import type { Metadata } from "next"
import { Suspense } from "react"
import { FocusView } from "@/features/focus/focus-view"

export const metadata: Metadata = { title: "Enfoque" }

// The view reads ?sesion= (link from the recovery toast), so it renders on the client behind this boundary.
export default function FocusPage() {
  return (
    <Suspense fallback={<div className="panel h-[520px] max-w-6xl animate-pulse rounded-2xl" aria-busy="true" />}>
      <FocusView />
    </Suspense>
  )
}
