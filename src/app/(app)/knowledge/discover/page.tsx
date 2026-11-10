import type { Metadata } from "next"
import { Suspense } from "react"
import { DiscoverSkeleton, DiscoverView } from "@/features/discover/discover-view"

export const metadata: Metadata = { title: "Descubrir" }

// The open topic lives in the URL: read on the client behind Suspense, so the page stays one
// static, prefetched page that opens offline.
export default function DiscoverPage() {
  return (
    <Suspense fallback={<DiscoverSkeleton />}>
      <DiscoverView />
    </Suspense>
  )
}
