import { readFile } from "node:fs/promises"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures"

/**
 * F7 · The records download as CSV (PRD §7), one file per kind, demo mode (fixed clock: Wednesday
 * 21 Oct 2026). What the app shows is what the file holds: a tap made now is in the next download.
 */
async function downloadCsv(page: Page, label: string) {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label }).click()])
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, "utf8") }
}

test.describe("CSV export (demo)", () => {
  test("habit records, check-ins and focus sessions download as CSV, each with its own columns", async ({ page }) => {
    await page.goto("/settings")
    const habits = await downloadCsv(page, "CSV: hábitos")
    expect(habits.name).toBe("the-one-percent-demo-habitos-2026-10-21.csv")
    expect(habits.text.startsWith("﻿fecha,hábito,dimensión,tipo,valor,unidad,objetivo,sentido,cumplido\r\n")).toBe(true)
    // The same records the weekly matrix shows: 10.310 steps and 2 coffees on Tuesday 20.
    expect(habits.text).toMatch(/\r\n2026-10-20,Pasos,[^,\r\n]+,numérico,10310,pasos,8000,al menos,sí\r\n/)
    expect(habits.text).toMatch(/\r\n2026-10-20,Café,[^,\r\n]+,numérico,2,tazas,/)

    const checkins = await downloadCsv(page, "CSV: check-ins")
    expect(checkins.name).toBe("the-one-percent-demo-checkins-2026-10-21.csv")
    expect(checkins.text.startsWith("﻿fecha,momento,sueño_horas,energía_1_5,ánimo_1_5,estrés_1_5,nota\r\n")).toBe(true)
    expect(checkins.text.split("\r\n").length).toBeGreaterThan(3)

    const focus = await downloadCsv(page, "CSV: enfoque")
    expect(focus.name).toBe("the-one-percent-demo-enfoque-2026-10-21.csv")
    expect(focus.text.startsWith("﻿fecha,inicio_utc,fin_utc,minutos,segundos_activos,minutos_previstos,proyecto,interrupciones,valoración,estado\r\n")).toBe(true)
  })

  test("a habit marked now is in the next download", async ({ page }) => {
    await page.goto("/settings")
    expect((await downloadCsv(page, "CSV: hábitos")).text).not.toMatch(/\r\n2026-10-21,Entrenamiento de fuerza,/)
    await page.goto("/")
    await expect(page.getByTestId("overview-day")).toHaveAttribute("data-state", "active")
    const tap = page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /^Entrenamiento de fuerza, / })
    await tap.click()
    await expect(tap).toHaveAttribute("aria-pressed", "true")
    await page.goto("/settings")
    expect((await downloadCsv(page, "CSV: hábitos")).text).toMatch(/\r\n2026-10-21,Entrenamiento de fuerza,[^,\r\n]+,binario,sí,,,,sí\r\n/)
  })
})
