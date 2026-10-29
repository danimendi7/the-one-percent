import type { Metadata } from "next"
import { Suspense } from "react"
import { ReviewsSkeleton, ReviewsView } from "@/features/reviews/reviews-view"

export const metadata: Metadata = { title: "Revisiones" }

// The weekly / monthly switch lives in the URL (useSearchParams), so the view renders behind this boundary.
export default function ReviewsPage() {
  return (
    <Suspense fallback={<ReviewsSkeleton />}>
      <ReviewsView />
    </Suspense>
  )
}
