import type { Metadata } from "next"
import { Suspense } from "react"
import { ItemDetail } from "@/features/library/item-detail"
import { LibrarySkeleton } from "@/features/library/library-views"

export const metadata: Metadata = { title: "Biblioteca" }

// The library lives in the client data store (demo or synced account): the id is runtime data,
// so it is read behind Suspense and the shell stays prerendered (Cache Components).
export default function ItemPage({ params }: PageProps<"/knowledge/library/items/[id]">) {
  return <Suspense fallback={<LibrarySkeleton />}>{params.then(({ id }) => <ItemDetail id={id} />)}</Suspense>
}
