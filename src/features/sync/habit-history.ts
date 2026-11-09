import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuditRow } from "@/features/habits/domain/history"

/** Newest changes read at once. The screen says so when a habit reaches it. */
export const HABIT_HISTORY_LIMIT = 200

/** The change history of a habit, newest first. RLS limits it to the signed-in user's rows. */
export async function fetchHabitHistory(sb: SupabaseClient, habitId: string, limit = HABIT_HISTORY_LIMIT): Promise<AuditRow[]> {
  const { data, error } = await sb
    .from("audit_logs")
    .select("id, entity_type, action, occurred_at, metadata_json")
    .in("entity_type", ["habit", "habit_entry"])
    .eq("entity_id", habitId)
    .order("occurred_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data as AuditRow[]
}
