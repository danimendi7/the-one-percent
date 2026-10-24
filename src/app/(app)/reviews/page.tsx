import type { Metadata } from "next"
import { ReviewsView } from "@/features/reviews/reviews-view"

export const metadata: Metadata = { title: "Revisiones" }

export default function ReviewsPage() {
  return <ReviewsView />
}
