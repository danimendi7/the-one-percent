import type { Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import { expect, FIXED_NOW, isMobile, test } from "./fixtures"

/**
 * M3.3 · Mind & Energy in the demo. FIXED_NOW is Wednesday 21/10/2026 18:30 Madrid: the evening
 * check-in is due and today's morning one exists in the demo data.
 */

const KEY = "the-one-percent:demo:habits:v1"
const madrid = (iso: string) => new Date(`${iso}+02:00`)

async function demoReady(page: Page) {
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) !== null, KEY)).toBe(true)
}

/** Keep only the check-ins whose date passes `keep` (to show the «none» / «few» states). */
async function keepCheckins(page: Page, keep: string[]) {
  await demoReady(page)
  await page.evaluate(
    ({ k, keep }) => {
      const s = JSON.parse(localStorage.getItem(k)!)
      s.checkins = Object.fromEntries(Object.entries(s.checkins).filter(([key]) => keep.includes(key.slice(0, 10))))
      localStorage.setItem(k, JSON.stringify(s))
    },
    { k: KEY, keep }
  )
}

const sheet = (page: Page) => page.getByRole("dialog")
const scale = (page: Page, name: string) => sheet(page).getByRole("radiogroup", { name })

test.describe("mind & energy (demo)", () => {
  test("the evening check-in from Resumen in 3 taps, saved at once, with the day written out and the day's context", async ({ page, consoleErrors }, info) => {
    await page.goto("/")
    const card = page.getByTestId("overview-checkin")
    await expect(card).toContainText("Check-in de noche")
    await card.click()
    await expect(page).toHaveURL(/\/mind\?checkin=pm$/)
    await expect(sheet(page).getByTestId("checkin-date")).toHaveText("Hoy, miércoles 21 de octubre")
    await expect(sheet(page).getByTestId("checkin-context")).toContainText(/Hoy: \d+ de \d+ hábitos/)
    // The reflection is folded by default, and «Listo» is reachable without scrolling on a phone.
    await expect(sheet(page).getByRole("button", { name: /Añadir reflexión/ })).toBeVisible()
    if (isMobile(info.project.name)) await expect(sheet(page).getByRole("button", { name: "Listo" })).toBeInViewport()

    await scale(page, "Energía").getByRole("radio", { name: "3, Normal" }).click()
    await scale(page, "Ánimo").getByRole("radio", { name: "4, Bueno" }).click()
    await scale(page, "Estrés").getByRole("radio", { name: "2, Poco" }).click()
    await expect(scale(page, "Estrés").getByRole("radio", { name: "2, Poco" })).toHaveAttribute("aria-checked", "true")
    await expect(sheet(page).getByRole("status")).toHaveText("Guardado en este dispositivo")
    await sheet(page).getByRole("button", { name: "Listo" }).click()

    await expect(page.getByTestId("mind-card-pm")).toContainText("Energía 3 · Ánimo 4 · Estrés 2")
    // No «Guardar» was needed: a reload keeps it.
    await page.reload()
    await expect(page.getByTestId("mind-card-pm")).toContainText("Energía 3 · Ánimo 4 · Estrés 2")
    await page.goto("/")
    await expect(page.getByTestId("overview-checkin")).toContainText("Energía 3 · Ánimo 4 · Estrés 2")
    expect(consoleErrors).toEqual([])
  })

  test("before 04:00 the evening check-in closes the previous day, and says so; at 04:10 it is the new morning", async ({ page }) => {
    await page.clock.setFixedTime(madrid("2026-10-22T00:40:00"))
    await page.goto("/mind")
    await expect(page.getByTestId("mind-card-pm")).toContainText("mié 21")
    await page.getByTestId("mind-card-pm").click()
    await expect(sheet(page).getByTestId("checkin-date")).toHaveText("Miércoles 21 de octubre · cierras ese día")
    await scale(page, "Energía").getByRole("radio", { name: "2, Baja" }).click()
    await sheet(page).getByRole("button", { name: "Listo" }).click()
    const saved = await page.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k)!).checkins).filter((c) => c.endsWith(":pm")).sort().at(-1), KEY)
    expect(saved).toBe("2026-10-21:pm")

    await page.clock.setFixedTime(madrid("2026-10-22T04:10:00"))
    await page.goto("/")
    await expect(page.getByTestId("overview-checkin")).toContainText("Check-in de mañana")
  })

  test("yesterday's value is a discreet marker, never pre-filled; clearing a value can be undone", async ({ page }) => {
    await page.goto("/mind")
    await page.getByTestId("mind-card-pm").click()
    const energy = scale(page, "Energía")
    await expect(energy.getByRole("radio", { checked: true })).toHaveCount(0)
    const yesterday = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).checkins["2026-10-20:pm"]?.energy ?? null, KEY)
    if (yesterday !== null) await expect(sheet(page).getByText(`Ayer: ${yesterday}`).first()).toBeVisible()

    await energy.getByRole("radio", { name: "5, Muy alta" }).click()
    await energy.getByRole("radio", { name: "5, Muy alta" }).click() // tapping the selected value clears it
    await expect(energy.getByRole("radio", { checked: true })).toHaveCount(0)
    await expect(sheet(page).getByRole("status")).toHaveText("Energía: valor borrado")
    await sheet(page).getByRole("button", { name: "Deshacer" }).click()
    await expect(energy.getByRole("radio", { name: "5, Muy alta" })).toHaveAttribute("aria-checked", "true")
  })

  test("the scale is a keyboard radiogroup", async ({ page }, info) => {
    test.skip(isMobile(info.project.name), "keyboard on desktop")
    await page.goto("/mind?checkin=pm")
    await scale(page, "Ánimo").getByRole("radio", { name: "3, Normal" }).focus()
    await page.keyboard.press("ArrowRight")
    await expect(scale(page, "Ánimo").getByRole("radio", { name: "4, Bueno" })).toHaveAttribute("aria-checked", "true")
    await expect(scale(page, "Ánimo").getByRole("radio", { name: "4, Bueno" })).toBeFocused()
  })

  test("the reflection is optional, private, saved without a button and never shown in the history list", async ({ page }) => {
    await page.goto("/mind?checkin=pm")
    await sheet(page).getByRole("button", { name: /Añadir reflexión/ }).click()
    await sheet(page).getByLabel(/Reflexión/).fill("Buen cierre; mañana, primero lo difícil.")
    await expect(sheet(page).getByText(/Privada: no aparece/)).toBeVisible()
    await sheet(page).getByRole("button", { name: "Listo" }).click()
    await expect(page.getByText("Buen cierre; mañana, primero lo difícil.")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Noche del Miércoles 21 de octubre: Solo reflexión, con reflexión/ })).toBeVisible()
    await page.getByTestId("mind-card-pm").click()
    await expect(sheet(page).getByLabel(/Reflexión/)).toHaveValue("Buen cierre; mañana, primero lo difícil.")
  })

  test("past days are editable from the history and the 7-day strip", async ({ page }) => {
    await page.goto("/mind")
    await page.getByRole("button", { name: /^Lunes 19 de octubre: mañana/ }).click()
    await expect(sheet(page).getByTestId("checkin-date")).toHaveText("Lunes 19 de octubre")
    await sheet(page).getByRole("radio", { name: "Mañana" }).click()
    // Pick a quick value different from the demo's (tapping the selected one would clear it).
    const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).checkins["2026-10-19:am"]?.sleep ?? null, KEY)
    const quick = before === 5 ? 6 : 5
    await sheet(page).getByRole("button", { name: `${quick} horas` }).click()
    await sheet(page).getByRole("button", { name: "15 minutos más" }).click()
    await expect(sheet(page).getByText(`${quick} h 15 min`).first()).toBeVisible()
    await sheet(page).getByRole("button", { name: "Listo" }).click()
    const sleep = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).checkins["2026-10-19:am"].sleep, KEY)
    expect(sleep).toBe(quick + 0.25)
  })

  test("hiding an indicator hides it from new check-ins but never deletes its history", async ({ page }) => {
    await page.goto("/mind")
    await page.getByRole("button", { name: "Indicadores" }).click()
    const noche = page.getByRole("dialog").getByRole("group", { name: "Noche" })
    await noche.getByRole("switch", { name: "Estrés" }).click()
    await expect(noche.getByRole("switch", { name: "Estrés" })).toHaveAttribute("aria-checked", "false")
    await page.keyboard.press("Escape")
    await page.getByTestId("mind-card-pm").click()
    await expect(scale(page, "Estrés")).toHaveCount(0)
    await sheet(page).getByRole("button", { name: "Listo" }).click()
    // A past evening that recorded stress still shows (and keeps) it.
    const withStress = await page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k)!)
      // The most recent evening with stress (the history shows the latest days first).
      return Object.values(s.checkins as Record<string, { date: string; phase: string; stress: number | null }>)
        .filter((c) => c.phase === "pm" && c.stress !== null)
        .map((c) => c.date)
        .sort()
        .at(-1)!
    }, KEY)
    await page.goto(`/mind`)
    await page.evaluate(() => window.scrollTo(0, 0))
    const day = await page.evaluate((d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).replace(",", ""), withStress)
    const label = day.charAt(0).toUpperCase() + day.slice(1)
    await page.getByRole("button", { name: new RegExp(`^Noche del ${label}:`) }).click()
    await expect(scale(page, "Estrés")).toBeVisible()
    // At least one indicator per phase.
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Indicadores" }).click()
    const manana = page.getByRole("dialog").getByRole("group", { name: "Mañana" })
    await manana.getByRole("switch", { name: "Sueño" }).click()
    await manana.getByRole("switch", { name: "Energía" }).click()
    await manana.getByRole("switch", { name: "Ánimo" }).click()
    await expect(page.getByText("Deja al menos un indicador activo en cada momento del día.").first()).toBeVisible()
    await expect(manana.getByRole("switch", { name: "Ánimo" })).toHaveAttribute("aria-checked", "true")
  })

  test("three data states: none, few and enough", async ({ page }) => {
    await page.goto("/mind")
    await expect(page.getByTestId("mind-state-enough")).toBeVisible()
    await expect(page.getByRole("img", { name: /^Energía por día/ })).toBeVisible()
    await keepCheckins(page, ["2026-10-20", "2026-10-21"])
    await page.reload()
    await expect(page.getByTestId("mind-state-few")).toBeVisible()
    await expect(page.getByText(/Pocos datos: con menos de 7 días/)).toBeVisible()
    await expect(page.getByTestId("mind-avg-energy")).toContainText("n = 2 días")
    await expect(page.getByRole("img", { name: /^Energía por día/ })).toHaveCount(0)
    await keepCheckins(page, [])
    await page.reload()
    await expect(page.getByTestId("mind-state-none")).toBeVisible()
    await page.getByRole("button", { name: "Hacer el check-in de ahora" }).click()
    await expect(sheet(page).getByRole("heading", { name: "Check-in de noche" })).toBeVisible()
  })

  test("Life Analytics: averages with n, filters in the URL, every figure opens its days, comparisons are descriptive", async ({ page, consoleErrors }) => {
    await page.goto("/analytics?periodo=90#mente")
    const section = page.getByRole("region", { name: /^Mente y energía/ })
    await expect(section.getByText("Descriptivo, no causal")).toBeVisible()
    await expect(section.getByText(/no relaciones de causa y efecto/)).toBeVisible()
    await section.getByRole("combobox", { name: "Indicador" }).click()
    await page.getByRole("option", { name: "Estrés" }).click()
    await expect(page).toHaveURL(/indicador=estres/)
    await section.getByRole("combobox", { name: "Momento del día" }).click()
    await page.getByRole("option", { name: "Solo noche" }).click()
    await expect(page).toHaveURL(/fase=noche/)
    await section.getByRole("button", { name: /^Estrés/ }).click()
    await expect(page.getByRole("dialog", { name: /Estrés · solo noche/ })).toBeVisible()
    await expect(page.getByRole("dialog").getByRole("listitem").first()).toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test("a11y: /mind, the check-in sheet and the indicators sheet", async ({ page }) => {
    await page.goto("/mind")
    await expect(page.getByTestId("mind-state-enough")).toBeVisible()
    const scan = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
    expect(await scan()).toEqual([])
    await page.getByTestId("mind-card-pm").click()
    await expect(scale(page, "Energía")).toBeVisible()
    await sheet(page).getByRole("button", { name: /Añadir reflexión/ }).click()
    expect(await scan()).toEqual([])
    await sheet(page).getByRole("button", { name: "Listo" }).click()
    await page.getByRole("button", { name: "Indicadores" }).click()
    await expect(page.getByRole("dialog", { name: "Indicadores visibles" })).toBeVisible()
    expect(await scan()).toEqual([])
  })
})

test.describe("deep work: a paused session asks «¿Sigue en curso?» (M3.3 decision 6)", () => {
  const at = (minutes: number) => new Date(FIXED_NOW.getTime() + minutes * 60_000)

  async function pausedBlock(page: Page) {
    await page.goto("/focus")
    await page.getByRole("radiogroup", { name: "Duración" }).getByRole("radio", { name: "50 min" }).click()
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await page.clock.setFixedTime(at(12))
    await page.getByRole("button", { name: "Pausar" }).click()
    await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible()
  }

  test("after 30 min of pause: never closed on its own; Continuar resumes", async ({ page }) => {
    await pausedBlock(page)
    await page.clock.setFixedTime(at(12 + 30))
    await page.goto("/")
    await expect(page.getByRole("dialog", { name: "¿Sigue en curso?" })).toHaveCount(0)
    await page.clock.setFixedTime(at(12 + 31))
    await page.reload()
    const d = page.getByRole("dialog", { name: "¿Sigue en curso?" })
    await expect(d).toContainText("está en pausa desde las 18:42, con 12 min registrados")
    await expect(d.getByRole("button", { name: "Continuar" })).toBeFocused()
    await expect(d.getByRole("button", { name: "Terminar con 12 min" })).toBeVisible()
    await d.getByRole("button", { name: "Continuar" }).click()
    await page.goto("/focus")
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible()
  })

  test("a pause that crosses midnight asks too; Terminar keeps exactly the time recorded", async ({ page }) => {
    await page.clock.setFixedTime(madrid("2026-10-21T23:40:00"))
    await page.goto("/focus")
    await page.getByRole("radiogroup", { name: "Duración" }).getByRole("radio", { name: "25 min" }).click()
    await page.getByRole("button", { name: /^Empezar/ }).click()
    await page.clock.setFixedTime(madrid("2026-10-21T23:50:00"))
    await page.getByRole("button", { name: "Pausar" }).click()
    await page.clock.setFixedTime(madrid("2026-10-22T00:05:00"))
    await page.goto("/")
    const d = page.getByRole("dialog", { name: "¿Sigue en curso?" })
    await d.getByRole("button", { name: "Terminar con 10 min" }).click()
    await expect(page.getByText("Bloque guardado · 10 min")).toBeVisible()
    await page.goto("/focus")
    await expect(page.getByRole("region", { name: "Preparar bloque" })).toBeVisible()
  })

  test("dismissing keeps it paused (asked once per pause in a tab); Descartar asks for confirmation and counts nothing", async ({ page, context }) => {
    await pausedBlock(page)
    await page.clock.setFixedTime(at(12 + 45))
    await page.goto("/")
    const d = page.getByRole("dialog", { name: "¿Sigue en curso?" })
    await expect(d).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(d).toHaveCount(0)
    await page.goto("/focus")
    await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible()
    await page.goto("/habits")
    await expect(page.getByRole("dialog", { name: "¿Sigue en curso?" })).toHaveCount(0)

    // Reopening the app (a new tab) asks again.
    const p = await context.newPage()
    await p.clock.setFixedTime(at(12 + 50))
    await p.goto("/")
    const d2 = p.getByRole("dialog", { name: "¿Sigue en curso?" })
    await d2.getByRole("button", { name: "Descartar" }).click()
    await d2.getByRole("button", { name: "Descartar sin contar tiempo" }).click()
    await expect(p.getByText("Sesión descartada")).toBeVisible()
    await p.goto("/focus")
    await expect(p.getByRole("region", { name: "Preparar bloque" })).toBeVisible()
  })
})
