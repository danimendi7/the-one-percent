import { describe, expect, it } from "vitest"
import type { FocusSession } from "@/features/focus/domain/types"
import type { Checkin } from "@/features/mind/domain/types"
import { entries, makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import { checkinsCsv, focusCsv, habitsCsv, toCsv } from "./csv"

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter(Boolean)

describe("CSV format (RFC 4180)", () => {
  it("starts with a UTF-8 mark and ends every line with CRLF", () => {
    const out = toCsv([["a", "b"], [1, 2]])
    expect(out.startsWith("﻿")).toBe(true)
    expect(out).toBe("﻿a,b\r\n1,2\r\n")
  })

  it("quotes commas, quotes and line breaks, and doubles the quotes inside", () => {
    expect(lines(toCsv([["uno, dos", 'di "hola"', "línea 1\nlínea 2", "llano"]]))).toEqual(['"uno, dos","di ""hola""","línea 1\nlínea 2",llano'])
  })

  it("never lets a spreadsheet run a text as a formula", () => {
    expect(lines(toCsv([["=HYPERLINK(\"x\")", "+1", "-resta", "@SUM(A1)", -3]]))).toEqual([`"'=HYPERLINK(""x"")",'+1,'-resta,'@SUM(A1),-3`])
  })

  it("writes nothing for a missing value, sí/no for booleans and a point for decimals", () => {
    expect(lines(toCsv([[null, undefined, true, false, 7.5]]))).toEqual([",,sí,no,7.5"])
  })
})

describe("habit records", () => {
  it("one row per recorded value, oldest first, with what met the target", () => {
    const run = makeHabit({ id: "run", name: "Correr", dimensionId: "body" })
    const water = makeHabit({ id: "water", name: "Agua", type: "numeric", target: 8, direction: "at_least", unit: "vasos", dimensionId: "body" })
    const coffee = makeHabit({ id: "coffee", name: "Café", type: "numeric", target: 2, direction: "at_most", unit: "tazas", dimensionId: "mind" })
    const state = {
      ...makeState([run, water, coffee], { ...entries("run", { "2026-10-21": true, "2026-10-20": false }), ...entries("water", { "2026-10-20": 5.5 }), ...entries("coffee", { "2026-10-21": 3 }) }),
      dimensions: [
        { id: "body" as const, name: "Cuerpo" },
        { id: "mind" as const, name: "Mente" },
      ],
    }
    expect(lines(habitsCsv(state))).toEqual([
      "fecha,hábito,dimensión,tipo,valor,unidad,objetivo,sentido,cumplido",
      "2026-10-20,Agua,Cuerpo,numérico,5.5,vasos,8,al menos,no",
      "2026-10-20,Correr,Cuerpo,binario,no,,,,no",
      "2026-10-21,Café,Mente,numérico,3,tazas,2,como máximo,no",
      "2026-10-21,Correr,Cuerpo,binario,sí,,,,sí",
    ])
  })

  it("skips records of a habit that no longer exists and keeps those of archived ones", () => {
    const old = makeHabit({ id: "old", name: "Antiguo", archivedOn: "2026-10-15" })
    const state = makeState([old], { ...entries("old", { "2026-10-10": true }), ...entries("gone", { "2026-10-10": true }) })
    expect(lines(habitsCsv(state)).slice(1)).toEqual(["2026-10-10,Antiguo,body,binario,sí,,,,sí"])
  })
})

describe("check-ins", () => {
  it("morning before evening, empty for what was not recorded, the note quoted", () => {
    const c = (date: string, phase: "am" | "pm", over: Partial<Checkin>): Checkin => ({ date, phase, sleep: null, energy: null, mood: null, stress: null, note: null, stamps: {}, updatedAt: "2026-10-21T20:00:00.000Z", ...over })
    const state = { ...makeState([]), checkins: { b: c("2026-10-21", "pm", { mood: 4, stress: 2, note: "Bien, aunque cansado" }), a: c("2026-10-21", "am", { sleep: 7.25, energy: 3 }) } }
    expect(lines(checkinsCsv(state))).toEqual([
      "fecha,momento,sueño_horas,energía_1_5,ánimo_1_5,estrés_1_5,nota",
      "2026-10-21,mañana,7.25,3,,,",
      '2026-10-21,noche,,,4,2,"Bien, aunque cansado"',
    ])
  })
})

describe("focus sessions", () => {
  const session = (id: string, start: string, end: string | null, over: Partial<FocusSession> = {}): FocusSession => ({
    id,
    habitId: null,
    project: null,
    plannedOutput: null,
    actualOutput: null,
    plannedMinutes: 50,
    segments: [{ start, end }],
    state: end ? "finished" : "running",
    localDate: start.slice(0, 10),
    rating: null,
    createdAt: start,
    updatedAt: start,
    ...over,
  })

  it("finished sessions with their minutes and seconds; a running one without them; «not noted» stays empty", () => {
    const state = {
      ...makeState([]),
      focusSessions: [
        session("b", "2026-10-21T16:00:00.000Z", null, { project: "Tesis" }),
        session("a", "2026-10-21T08:00:00.000Z", "2026-10-21T08:45:30.000Z", { project: "Tesis, cap. 2", interruptions: 0, rating: 4 }),
      ],
    }
    expect(lines(focusCsv(state))).toEqual([
      "fecha,inicio_utc,fin_utc,minutos,segundos_activos,minutos_previstos,proyecto,interrupciones,valoración,estado",
      '2026-10-21,2026-10-21T08:00:00.000Z,2026-10-21T08:45:30.000Z,46,2730,50,"Tesis, cap. 2",0,4,terminada',
      "2026-10-21,2026-10-21T16:00:00.000Z,,,,50,Tesis,,,en curso",
    ])
  })
})
