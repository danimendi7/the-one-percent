import type { Metadata } from "next"
import { RecallView } from "@/features/recall/recall-view"

export const metadata: Metadata = { title: "Repaso" }

export default function RecallPage() {
  return <RecallView />
}
