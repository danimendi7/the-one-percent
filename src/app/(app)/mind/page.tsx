import type { Metadata } from "next"
import { Suspense } from "react"
import { MindView } from "@/features/mind/mind-view"

export const metadata: Metadata = { title: "Mente y energía" }

export default function MindPage() {
  // ?checkin=am|pm opens the check-in (links from Resumen); useSearchParams needs a Suspense boundary.
  return (
    <Suspense>
      <MindView />
    </Suspense>
  )
}
