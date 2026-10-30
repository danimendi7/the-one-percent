import type { Metadata } from "next"
import { Suspense } from "react"
import { BrainView } from "@/features/library/brain-view"
import { LibrarySkeleton } from "@/features/library/library-views"

export const metadata: Metadata = { title: "Cerebro" }

// Search, filters and the open note live in the URL (M4e): read on the client behind Suspense, so
// the page stays one static, prefetched page that opens offline (D79).
export default function BrainPage() {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <BrainView />
    </Suspense>
  )
}
