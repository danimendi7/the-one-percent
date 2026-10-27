import type { Metadata } from "next"
import { Suspense } from "react"
import { GoalDetail } from "@/features/goals/goal-detail"
import { GoalsSkeleton } from "@/features/goals/goals-view"

export const metadata: Metadata = { title: "Objetivo" }

// Goals live in the client data store (demo or synced account): the id is runtime data,
// so it is read behind Suspense and the shell stays prerendered (Cache Components).
export default function GoalPage({ params }: PageProps<"/goals/[id]">) {
  return <Suspense fallback={<GoalsSkeleton />}>{params.then(({ id }) => <GoalDetail id={id} />)}</Suspense>
}
