import type { Metadata } from "next"
import { Suspense } from "react"
import { GoalsSkeleton, GoalsView } from "@/features/goals/goals-view"

export const metadata: Metadata = { title: "Objetivos" }

// The horizon filter lives in the URL (useSearchParams), so the view renders behind this boundary.
export default function GoalsPage() {
  return (
    <Suspense fallback={<GoalsSkeleton />}>
      <GoalsView />
    </Suspense>
  )
}
