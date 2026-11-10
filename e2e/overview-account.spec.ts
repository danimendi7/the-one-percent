import type { Page, Route } from "@playwright/test"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"

/**
 * F1 · Command Center states that need an account (Plan §5.1): no data yet, and a sync error,
 * which must not read as «nothing done». The other two (planned rest, undone yesterday) are in
 * overview.spec.ts.
 */
test.use({ mode: "account" })
test.setTimeout(90_000)

let account: Account
test.beforeEach(async () => {
  account = await newAccount("overview")
})
test.afterEach(async () => {
  await removeAccount(account)
})

const liveEntries = () => countRows("select count(*)::int n from public.habit_entries where user_id = $1 and deleted_at is null", [account.id])

async function createHabit(page: Page, name: string) {
  await page.goto("/habits")
  await page.getByRole("button", { name: /^(Nuevo|Crear) hábito$/ }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Nombre").fill(name)
  await dialog.getByRole("button", { name: "Crear hábito" }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => countRows("select count(*)::int n from public.habits where user_id = $1 and title = $2", [account.id, name])).toBe(1)
}

/** The server answers with an error (not a lost connection): PostgREST's error body, status 500. */
const outage = (route: Route) =>
  route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "simulated outage", details: null, hint: null }) })

test("no data yet: a first step instead of zeros, and nothing reads as undone or failing", async ({ page, consoleErrors }) => {
  await signIn(page, account)
  const day = page.getByTestId("overview-day")
  await expect(day).toHaveAttribute("data-state", "no_habits")
  await expect(day).toContainText("Empieza por tu primer hábito")
  await expect(page.getByText("Aún no hay datos de los últimos 30 días")).toBeVisible()
  await expect(page.getByTestId("overview-missed")).toHaveCount(0)
  await expect(page.getByTestId("overview-sync-error")).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})

test("a sync error is told apart from «nothing done»: the tap stays on the device and reaches the server once", async ({ page }) => {
  await signIn(page, account)
  await createHabit(page, "Escribir")
  await page.goto("/")
  await expect(page.getByTestId("overview-day")).toHaveAttribute("data-state", "active")
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("overview-sync-error")).toHaveCount(0)

  await page.route("**/rest/v1/rpc/apply_ops", outage)
  await page.route("**/rest/v1/rpc/pull_changes", outage)
  const tap = page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /^Escribir, / })
  await tap.click()
  await expect(tap).toHaveAttribute("aria-pressed", "true")

  const alert = page.getByTestId("overview-sync-error")
  await expect(alert).toBeVisible()
  await expect(alert).toContainText("No se pudo sincronizar")
  await expect(alert).toContainText(/\d+ cambios? esperan? aquí/)
  // The figures keep what was done on this device: it is not «nothing done».
  await expect(page.getByTestId("overview-done")).toHaveText("1")
  await expect(page.getByTestId("overview-pending")).toHaveText("0")
  expect(await liveEntries()).toBe(0)

  // Retrying while the server still fails keeps saying so (it never claims success).
  await alert.getByRole("button", { name: "Reintentar" }).click()
  await expect(alert).toBeVisible()
  expect(await liveEntries()).toBe(0)

  // The server is back: the change goes, once, and the alert is gone.
  await page.unrouteAll({ behavior: "ignoreErrors" })
  await page.reload()
  await expect.poll(liveEntries, { timeout: 15_000 }).toBe(1)
  await expect(page.getByRole("button", { name: /Estado de datos: Sincronizado/ }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("overview-sync-error")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Hoy" }).getByRole("button", { name: /^Escribir, / })).toHaveAttribute("aria-pressed", "true")
  expect(await countRows("select count(*)::int n from public.sync_operations where user_id = $1 and operation_type = 'entry.set'", [account.id])).toBe(1)
})
