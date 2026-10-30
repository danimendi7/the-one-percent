import type { Metadata } from "next"
import { BrainView } from "@/features/library/brain-view"

export const metadata: Metadata = { title: "Cerebro" }

export default function BrainPage() {
  return <BrainView />
}
