import type { Metadata } from "next"
import { DecisionLogView } from "@/features/reviews/decision-log"

export const metadata: Metadata = { title: "Registro de decisiones" }

export default function DecisionsPage() {
  return <DecisionLogView />
}
