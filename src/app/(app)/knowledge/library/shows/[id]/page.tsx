import type { Metadata } from "next"
import { Suspense } from "react"
import { ShowDetail } from "@/features/library/item-detail"
import { LibrarySkeleton } from "@/features/library/library-views"

export const metadata: Metadata = { title: "Programa" }

// Same as a content page: the id is runtime data, read behind Suspense (Cache Components).
export default function ShowPage({ params }: PageProps<"/knowledge/library/shows/[id]">) {
  return <Suspense fallback={<LibrarySkeleton />}>{params.then(({ id }) => <ShowDetail id={id} />)}</Suspense>
}
