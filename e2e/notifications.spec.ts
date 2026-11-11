import { expect, test } from "./fixtures"

/** E6 · Notification settings, saved for real (demo: in this browser). */
test.describe("notification settings (demo)", () => {
  test("changes are kept after reloading, and the preview follows the tone", async ({ page, consoleErrors }) => {
    await page.goto("/settings/notifications")
    const sample = page.getByTestId("motivation-sample")
    await expect(sample).toBeVisible()
    const before = await sample.innerText()
    await page.getByRole("radio", { name: /^Calma/ }).click()
    await expect(sample).not.toHaveText(before)
    await page.getByTestId("motivation-rule-recall").click()
    await page.getByRole("button", { name: "domingo sin avisos" }).click()
    await page.getByLabel("Silencio desde").fill("21:30")

    await page.reload()
    await expect(page.getByRole("radio", { name: /^Calma/ })).toHaveAttribute("aria-checked", "true")
    await expect(page.getByTestId("motivation-rule-recall")).toHaveAttribute("aria-checked", "true")
    await expect(page.getByRole("button", { name: "domingo sin avisos" })).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByLabel("Silencio desde")).toHaveValue("21:30")
    await expect(page.getByText("no se envía nada")).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  })

  test("push: the demo registers no device and says the reminders go to the inbox", async ({ page }) => {
    await page.goto("/settings/notifications")
    const note = page.getByTestId("push-section").getByTestId("push-unavailable")
    await expect(note).toHaveAttribute("data-reason", "demo")
    await expect(note).toContainText("bandeja")
    await expect(page.getByTestId("push-section").getByRole("button")).toHaveCount(0)
  })

  test("strong language only exists with Hardcore", async ({ page }) => {
    await page.goto("/settings/notifications")
    await expect(page.getByRole("switch", { name: /Lenguaje fuerte/ })).toBeDisabled()
    await page.getByRole("radio", { name: /^Hardcore/ }).click()
    await page.getByRole("switch", { name: /Lenguaje fuerte/ }).click()
    await expect(page.getByTestId("motivation-sample")).toContainText("marear la perdiz")
    await page.getByRole("radio", { name: /^Equilibrado/ }).click()
    await expect(page.getByRole("switch", { name: /Lenguaje fuerte/ })).toHaveAttribute("aria-checked", "false")
  })
})
