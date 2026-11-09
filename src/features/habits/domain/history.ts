import { formatDate, isLocalDate, WEEKDAY_SHORT, type Weekday } from "./dates"

/**
 * The change history of a habit (Plan Maestro 5.2: «historial consultable, con auditoría de
 * cambios»), read from `audit_logs`. Two facts shape it:
 *
 * - The app sends the whole form on every edit, so an audit row says what the fields were after
 *   saving, not what changed. A change is only claimed by comparing with an earlier value; the first
 *   edit of a field has nothing to compare with and says so instead of guessing.
 * - An owner can insert rows into their own log, so the metadata is never trusted: anything
 *   malformed loses its detail, never its row.
 */
export interface AuditRow {
  id: string
  entity_type: string
  action: string
  occurred_at: string
  metadata_json: unknown
}

export interface HistoryItem {
  id: string
  /** Server instant (ISO). */
  at: string
  title: string
  details: string[]
}

export interface HistoryOptions {
  dimensionName: (id: string) => string
}

type Meta = Record<string, unknown>

const asMeta = (v: unknown): Meta => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Meta) : {})
const dayLabel = (d: string) => formatDate(d, { day: "numeric", month: "long" })
const DIRECTION: Record<string, string> = { at_least: "al menos", at_most: "como máximo" }

function ruleLabel(rule: unknown): string | null {
  const r = asMeta(rule)
  if (r.kind === "daily") return "cada día"
  if (r.kind === "weekly_count" && Number.isInteger(r.timesPerWeek)) return r.timesPerWeek === 1 ? "1 vez por semana" : `${r.timesPerWeek} veces por semana`
  if (r.kind === "weekdays" && Array.isArray(r.weekdays) && r.weekdays.length > 0 && r.weekdays.every((d) => WEEKDAY_SHORT[d as Weekday])) {
    return r.weekdays.map((d) => WEEKDAY_SHORT[d as Weekday]).join(", ")
  }
  return null
}

function scheduleDetail(schedule: unknown): string | null {
  const s = asMeta(schedule)
  const rule = ruleLabel(s.rule)
  return rule && isLocalDate(s.effective_from) ? `Frecuencia: ${rule}, desde el ${dayLabel(s.effective_from)}` : null
}

function entryDetail(meta: Meta): string[] {
  if (!isLocalDate(meta.local_date)) return []
  const v = meta.value
  const what = v === true ? "hecho" : typeof v === "number" ? `valor ${v}` : v === false || v === null ? "borrado" : null
  return what ? [`${dayLabel(meta.local_date)} · ${what}`] : []
}

/** Fields of an edit, in the order they are shown, with how each change reads. */
const FIELDS: { key: string; ok: (v: unknown) => boolean; describe: (from: unknown, to: unknown, o: HistoryOptions) => string }[] = [
  { key: "title", ok: (v) => typeof v === "string", describe: (a, b) => `Nombre: «${a}» → «${b}»` },
  { key: "icon", ok: (v) => typeof v === "string", describe: () => "Icono cambiado" },
  { key: "dimension", ok: (v) => typeof v === "string", describe: (a, b, o) => `Dimensión: ${o.dimensionName(String(a))} → ${o.dimensionName(String(b))}` },
  { key: "target_value", ok: (v) => typeof v === "number" || v === null, describe: (a, b) => `Objetivo: ${a ?? "sin objetivo"} → ${b ?? "sin objetivo"}` },
  { key: "unit", ok: (v) => typeof v === "string" || v === null, describe: (a, b) => `Unidad: ${a ?? "sin unidad"} → ${b ?? "sin unidad"}` },
  { key: "target_direction", ok: (v) => typeof v === "string" || v === null, describe: (a, b) => `Sentido: ${DIRECTION[String(a)] ?? a} → ${DIRECTION[String(b)] ?? b}` },
]

/** Oldest first. The server's order breaks ties: it is finer than the milliseconds of a JS date. */
function chronological(rows: readonly AuditRow[]): AuditRow[] {
  return rows
    .map((row, i) => ({ row, i, t: Date.parse(row.occurred_at) }))
    .sort((a, b) => a.t - b.t || Number(b.row.action === "create") - Number(a.row.action === "create") || b.i - a.i)
    .map((x) => x.row)
}

/** `rows` come newest first (as read from the server); so does the result. */
export function buildHabitHistory(rows: readonly AuditRow[], options: HistoryOptions): HistoryItem[] {
  const known = new Map<string, unknown>()
  const items: HistoryItem[] = []
  const add = (row: AuditRow, title: string, details: string[] = []) => items.push({ id: row.id, at: row.occurred_at, title, details })

  for (const row of chronological(rows)) {
    const meta = asMeta(row.metadata_json)
    switch (row.action) {
      case "create":
        if (typeof meta.title === "string") known.set("title", meta.title)
        add(row, "Creado", typeof meta.title === "string" ? [`«${meta.title}»`] : [])
        break
      case "archive":
        add(row, "Archivado", isLocalDate(meta.archived_on) ? [`Desde el ${dayLabel(meta.archived_on)}`] : [])
        break
      case "restore":
        add(row, "Restaurado")
        break
      case "source":
        add(row, meta.source === null ? "Desvinculado de Deep Work" : "Vinculado a Deep Work")
        break
      case "backfill":
        add(row, "Día pasado registrado", entryDetail(meta))
        break
      case "update": {
        const details: string[] = []
        let seen = 0
        let cannotCompare = false
        for (const f of FIELDS) {
          if (!(f.key in meta) || !f.ok(meta[f.key])) continue
          seen++
          if (!known.has(f.key)) cannotCompare = true
          else if (known.get(f.key) !== meta[f.key]) details.push(f.describe(known.get(f.key), meta[f.key], options))
          known.set(f.key, meta[f.key])
        }
        const hasSchedule = meta.schedule !== undefined && meta.schedule !== null
        const schedule = hasSchedule ? scheduleDetail(meta.schedule) : null
        if (schedule) details.push(schedule)
        if (details.length > 0) add(row, "Editado", details)
        else if (seen === 0 || cannotCompare || hasSchedule) add(row, "Edición guardada")
        break
      }
      default:
        add(row, "Cambio registrado")
    }
  }
  return items.reverse()
}
