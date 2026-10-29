import type { Metadata } from "next"
import { Suspense } from "react"
import { ReviewEditor, ReviewEditorSkeleton } from "@/features/reviews/components/review-editor"

export const metadata: Metadata = { title: "Revisión" }

// Reviews live in the client data store (demo or synced account): the period is runtime data,
// so it is read behind Suspense and the shell stays prerendered (Cache Components).
export default function ReviewPage({ params }: PageProps<"/reviews/[kind]/[start]">) {
  return <Suspense fallback={<ReviewEditorSkeleton />}>{params.then(({ kind, start }) => <ReviewEditor kind={kind} start={start} />)}</Suspense>
}
