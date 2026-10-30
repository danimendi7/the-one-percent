import type { Metadata } from "next"
import { Suspense } from "react"
import { ShowDetailFromUrl } from "@/features/library/item-detail"
import { LibrarySkeleton } from "@/features/library/library-views"

export const metadata: Metadata = { title: "Programa" }

// Same as a content page: one static page (`?id=`), usable offline once prefetched.
export default function ShowPage() {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <ShowDetailFromUrl />
    </Suspense>
  )
}
