import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"
import { NetworkError, type LibraryPage, type SyncTransport } from "./engine"
import type { Op, OpResult, PullPayload } from "./domain/types"
import type { LocalDate } from "@/features/habits/domain/dates"

/** PostgREST errors without a SQLSTATE/PGRST code are transport failures (offline, gateway). */
function classify(error: PostgrestError): Error {
  if (!error.code || /fetch|network|timeout/i.test(error.message)) return new NetworkError(error.message)
  return new Error(`${error.code}: ${error.message}`)
}

export function supabaseTransport(sb: SupabaseClient): SyncTransport {
  return {
    async applyOps(deviceId: string, ops: Op[]) {
      const { data, error } = await sb.rpc("apply_ops", { p_device_id: deviceId, p_ops: ops })
      if (error) throw classify(error)
      return data as { results: OpResult[]; server_today: LocalDate }
    },
    async pull(since: number) {
      const { data, error } = await sb.rpc("pull_changes", { p_since: since })
      if (error) throw classify(error)
      return data as PullPayload
    },
    async pullLibrary(since: number, limit: number, skipDeletedUpto: number | null) {
      const { data, error } = await sb.rpc("pull_library", { p_since: since, p_limit: limit, p_skip_deleted_upto: skipDeletedUpto })
      if (error) throw classify(error)
      return data as LibraryPage
    },
  }
}
