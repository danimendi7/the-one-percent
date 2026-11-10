import { expect, test } from "./fixtures"

/** E1–E2 · Intelligence by rules, in demo mode (fixed clock: Wednesday 21 Oct 2026). */
test.describe("intelligence by rules (demo)", () => {
  test("each finding says its period, variables, data and limits; the page says rules, not AI", async ({ page, consoleErrors }) => {
    await page.goto("/intelligence")
    await expect(page.getByTestId("insights-rules-badge")).toHaveText("Reglas · sin IA")
    const first = page.getByTestId("insight").first()
    await expect(first).toBeVisible()
    for (const label of ["Periodo", "Variables", "Datos"]) await expect(first).toContainText(label)
    await expect(first).toContainText(/n = \d+/)
    await expect(first.getByRole("list", { name: "Limitaciones" })).toContainText("no indica la causa")
    await expect(page.getByText(/Llega en la fase M6/)).toHaveCount(0)
    await page.getByTestId("insight-rules").locator("summary").click()
    await expect(page.getByTestId("insight-rules")).toContainText("al menos 14 días con ambos datos")
    expect(consoleErrors).toEqual([])
  })
})
