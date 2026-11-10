import type { Weekday } from "@/features/habits/domain/dates"
import { DEFAULT_SETTINGS, nudgeCopy, type MotivationSettings, type RuleId, type Tone } from "./motivation"

/**
 * Notification settings as stored (profile `settings_json.motivation`, E6) may come from an older or
 * newer version, or be written directly by the owner: each field is checked on its own and an
 * invalid one falls back to its default, so the rest of what the user chose is kept.
 */
const TONES: Tone[] = ["calm", "balanced", "hardcore"]
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)
const int = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null)

export function normalizeMotivation(raw: unknown): MotivationSettings {
  const r = isObj(raw) ? raw : {}
  const d = DEFAULT_SETTINGS
  const tone = TONES.includes(r.tone as Tone) ? (r.tone as Tone) : d.tone
  const rules = { ...d.rules }
  if (isObj(r.rules)) for (const k of Object.keys(d.rules) as RuleId[]) if (typeof r.rules[k] === "boolean") rules[k] = r.rules[k] as boolean
  const times = { ...d.times }
  if (isObj(r.times)) for (const k of Object.keys(d.times) as (keyof typeof times)[]) if (typeof r.times[k] === "string" && HHMM.test(r.times[k] as string)) times[k] = r.times[k] as string
  const daysOff = Array.isArray(r.daysOff) ? [...new Set(r.daysOff.filter((x): x is Weekday => int(x, 1, 7) !== null))].sort() : d.daysOff
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    tone,
    profanity: tone === "hardcore" && r.profanity === true,
    dailyCap: int(r.dailyCap, 1, 10) ?? d.dailyCap,
    quietStart: typeof r.quietStart === "string" && HHMM.test(r.quietStart) ? r.quietStart : d.quietStart,
    quietEnd: typeof r.quietEnd === "string" && HHMM.test(r.quietEnd) ? r.quietEnd : d.quietEnd,
    minGapMinutes: int(r.minGapMinutes, 0, 720) ?? d.minGapMinutes,
    daysOff,
    rules,
    times,
  }
}

/** The preview of the settings screen: the evening reminder with two example habits. */
export function sampleNudge(s: MotivationSettings): { title: string; body: string } {
  return nudgeCopy("late", s, 2, "Leer, Correr")
}
