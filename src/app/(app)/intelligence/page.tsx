import type { Metadata } from "next"
import { IntelligenceView } from "@/features/intelligence/intelligence-view"

export const metadata: Metadata = { title: "Inteligencia" }

export default function IntelligencePage() {
  return <IntelligenceView />
}
