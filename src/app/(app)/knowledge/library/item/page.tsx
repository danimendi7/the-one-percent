import type { Metadata } from "next"
import { Suspense } from "react"
import { ItemDetailFromUrl } from "@/features/library/item-detail"
import { LibrarySkeleton } from "@/features/library/library-views"

export const metadata: Metadata = { title: "Biblioteca" }

// One static page for every book and episode (`?id=`), not a dynamic segment: it is prefetched
// once, so a content opens with no connection too (the data lives in the client store). The id is
// read on the client behind Suspense.
export default function ItemPage() {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <ItemDetailFromUrl />
    </Suspense>
  )
}
