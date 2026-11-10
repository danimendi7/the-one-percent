import type { Metadata } from "next"
import { IntelligenceView } from "@/features/intelligence/intelligence-view"
import { readAiConfig } from "@/features/intelligence/domain/ai-provider"

export const metadata: Metadata = { title: "Inteligencia" }

export default function IntelligencePage() {
  // Read on the server; the status never carries the key (E4).
  return <IntelligenceView ai={readAiConfig(process.env)} />
}
