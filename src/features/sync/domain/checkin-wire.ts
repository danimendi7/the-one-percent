import type { Checkin, CheckinField, CheckinValues } from "@/features/mind/domain/types"
import type { WireCheckin, WireCheckinFields } from "./types"

/** Field names on the wire (the columns of public.daily_checkins). */
export const WIRE_FIELD: Record<CheckinField, keyof WireCheckinFields> = {
  sleep: "sleep_hours",
  energy: "energy",
  mood: "mood",
  stress: "stress",
  note: "note",
}

const FROM_WIRE = Object.fromEntries(Object.entries(WIRE_FIELD).map(([k, v]) => [v, k])) as Record<keyof WireCheckinFields, CheckinField>

export function valuesToWire(values: CheckinValues): WireCheckinFields {
  const out: WireCheckinFields = {}
  for (const [f, v] of Object.entries(values) as [CheckinField, number | string | null][]) {
    ;(out as Record<string, number | string | null>)[WIRE_FIELD[f]] = v
  }
  return out
}

export function wireToValues(fields: WireCheckinFields): CheckinValues {
  const out: CheckinValues = {}
  for (const [k, v] of Object.entries(fields) as [keyof WireCheckinFields, number | string | null][]) {
    const f = FROM_WIRE[k]
    if (f) (out as Record<string, number | string | null>)[f] = v
  }
  return out
}

const num = (v: number | string | null) => (v === null ? null : Number(v))

export function toCheckin(w: WireCheckin): Checkin {
  const stamps: Checkin["stamps"] = {}
  for (const [k, v] of Object.entries(w.field_stamps ?? {})) {
    const f = FROM_WIRE[k as keyof WireCheckinFields]
    if (f && typeof v === "string") stamps[f] = v
  }
  return {
    date: w.local_date,
    phase: w.phase,
    sleep: num(w.sleep_hours),
    energy: num(w.energy),
    mood: num(w.mood),
    stress: num(w.stress),
    note: w.note,
    stamps,
    noteSeq: w.note_seq,
    updatedAt: w.updated_at,
  }
}
