import type { Review } from "@/features/reviews/domain/types"
import type { WireReview } from "./types"

/** A review row from pull_changes, with its section versions (conflict bases for later edits). */
export function toReview(w: WireReview): Review {
  return {
    kind: w.kind,
    periodStart: w.period_start,
    periodEnd: w.period_end,
    status: w.status,
    content: w.content ?? {},
    decisions: w.decisions ?? [],
    evaluations: w.evaluations ?? [],
    snapshot: w.snapshot,
    closedAt: w.closed_at,
    updatedAt: w.updated_at,
    fieldSeqs: w.field_seqs ?? {},
    serverSeq: w.server_seq,
  }
}
