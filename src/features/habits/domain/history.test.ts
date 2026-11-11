import { describe, expect, it } from "vitest"
import { buildHabitHistory, type AuditRow } from "./history"

let n = 0
function row(action: string, metadata: unknown, at: string, entityType = "habit"): AuditRow {
  return { id: `a-${++n}`, entity_type: entityType, action, occurred_at: `2026-10-${at}Z`, metadata_json: metadata }
}
const update = (patch: Record<string, unknown>, at: string, schedule: unknown = null) => row("update", { ...patch, schedule }, at)
const FULL = { icon: "book", dimension: "mind" }
const names = { dimensionName: (id: string) => ({ mind: "Mente", body: "Cuerpo" })[id] ?? id }
const build = (rows: AuditRow[]) => buildHabitHistory(rows, names)
const titles = (rows: AuditRow[]) => build(rows).map((i) => i.title)

describe("habit history: what happened, newest first", () => {
  it("starts with the creation and its name", () => {
    expect(build([row("create", { title: "Leer" }, "01T08:00:00")])).toMatchObject([{ title: "Creado", details: ["«Leer»"] }])
  })

  it("orders by time whatever order the rows arrive in", () => {
    const rows = [row("archive", { archived_on: "2026-10-03" }, "03T08:00:00"), row("create", { title: "Leer" }, "01T08:00:00"), row("restore", {}, "05T08:00:00")]
    expect(titles(rows)).toEqual(["Restaurado", "Archivado", "Creado"])
  })

  it("with equal times the creation still comes first in the walk", () => {
    const at = "01T08:00:00"
    const items = build([update({ title: "Leer más", ...FULL }, at), row("create", { title: "Leer" }, at)])
    expect(items.map((i) => i.title)).toEqual(["Editado", "Creado"])
    expect(items[0].details).toEqual(["Nombre: «Leer» → «Leer más»"])
  })

  it("names archiving, restoring and the link with Deep Work", () => {
    expect(build([row("archive", { archived_on: "2026-10-03" }, "03T08:00:00")])).toMatchObject([{ title: "Archivado", details: ["Desde el 3 de octubre"] }])
    expect(titles([row("source", { source: "focus" }, "04T08:00:00")])).toEqual(["Vinculado a Deep Work"])
    expect(titles([row("source", { source: null }, "04T08:00:00")])).toEqual(["Desvinculado de Deep Work"])
  })

  it("names a day recorded afterwards, and whether it was done, measured or cleared", () => {
    const backfill = (value: unknown) => row("backfill", { local_date: "2026-10-02", value }, "03T08:00:00", "habit_entry")
    expect(build([backfill(true)])).toMatchObject([{ title: "Día pasado registrado", details: ["2 de octubre · hecho"] }])
    expect(build([backfill(30)])).toMatchObject([{ details: ["2 de octubre · valor 30"] }])
    expect(build([backfill(false)])).toMatchObject([{ details: ["2 de octubre · borrado"] }])
    expect(build([backfill(null)])).toMatchObject([{ details: ["2 de octubre · borrado"] }])
  })
})

describe("an edit only claims what really changed (the app always sends the whole form)", () => {
  const created = row("create", { title: "Leer" }, "01T08:00:00")

  it("shows a change of name from the creation on", () => {
    expect(build([created, update({ title: "Leer en papel", ...FULL }, "02T08:00:00")])[0]).toMatchObject({ title: "Editado", details: ["Nombre: «Leer» → «Leer en papel»"] })
  })

  it("the first edit cannot know what the other fields were: no claim, but it is not hidden", () => {
    expect(build([created, update({ title: "Leer", ...FULL }, "02T08:00:00")])[0]).toEqual(expect.objectContaining({ title: "Edición guardada", details: [] }))
  })

  it("later edits compare with the one before, field by field", () => {
    const items = build([created, update({ title: "Leer", ...FULL }, "02T08:00:00"), update({ title: "Leer", icon: "run", dimension: "body" }, "03T08:00:00")])
    expect(items[0].details).toEqual(["Icono cambiado", "Dimensión: Mente → Cuerpo"])
  })

  it("compares target, unit and direction", () => {
    const base = { title: "Leer", ...FULL, unit: "min", target_value: 30, target_direction: "at_least" }
    const items = build([created, update(base, "02T08:00:00"), update({ ...base, unit: "páginas", target_value: 45, target_direction: "at_most" }, "03T08:00:00")])
    expect(items[0].details).toEqual(["Objetivo: 30 → 45", "Unidad: min → páginas", "Sentido: al menos → como máximo"])
  })

  it("a save that changed nothing is not a change", () => {
    const same = { title: "Leer", ...FULL }
    expect(titles([created, update(same, "02T08:00:00"), update(same, "03T08:00:00")])).toEqual(["Edición guardada", "Creado"])
  })

  it("a new frequency is always a real change, with its date", () => {
    const same = { title: "Leer", ...FULL }
    expect(build([created, update(same, "02T08:00:00", { effective_from: "2026-10-02", rule: { kind: "daily" } })])[0]).toMatchObject({ title: "Editado", details: ["Frecuencia: cada día, desde el 2 de octubre"] })
    expect(build([update(same, "02T08:00:00", { effective_from: "2026-10-02", rule: { kind: "weekly_count", timesPerWeek: 3 } })])[0].details).toEqual(["Frecuencia: 3 veces por semana, desde el 2 de octubre"])
    expect(build([update(same, "02T08:00:00", { effective_from: "2026-10-02", rule: { kind: "weekdays", weekdays: [1, 3, 5] } })])[0].details).toEqual(["Frecuencia: L, X, V, desde el 2 de octubre"])
  })
})

describe("what the log holds is not trusted", () => {
  it("an unknown action is shown as a change, without inventing what it was", () => {
    expect(build([row("merge", { a: 1 }, "02T08:00:00")])).toMatchObject([{ title: "Cambio registrado", details: [] }])
  })

  it("malformed details lose the detail, never the row", () => {
    expect(build([row("create", { title: 7 }, "02T08:00:00")])).toMatchObject([{ title: "Creado", details: [] }])
    expect(build([row("archive", "x", "02T08:00:00")])).toMatchObject([{ title: "Archivado", details: [] }])
    expect(build([row("backfill", { local_date: "ayer" }, "02T08:00:00", "habit_entry")])).toMatchObject([{ title: "Día pasado registrado", details: [] }])
    expect(build([row("update", null, "02T08:00:00")])).toMatchObject([{ title: "Edición guardada", details: [] }])
    expect(build([update({ title: "Leer" }, "02T08:00:00", { effective_from: "x", rule: { kind: "nope" } })])).toMatchObject([{ title: "Edición guardada", details: [] }])
  })
})
