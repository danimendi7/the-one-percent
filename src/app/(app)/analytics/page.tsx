import type { Metadata } from "next"
import { AnalyticsView } from "@/features/analytics/analytics-view"

export const metadata: Metadata = { title: "Analítica" }

export default function AnalyticsPage() {
  return <AnalyticsView />
}
