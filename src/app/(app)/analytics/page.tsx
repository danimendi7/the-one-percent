import type { Metadata } from "next"
import { Suspense } from "react"
import { AnalyticsSkeleton, AnalyticsView } from "@/features/analytics/analytics-view"

export const metadata: Metadata = { title: "Analítica" }

// The view reads its filters from the URL (useSearchParams), so it renders on the client
// behind this boundary while the rest of the shell is prerendered.
export default function AnalyticsPage() {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <AnalyticsView />
    </Suspense>
  )
}
