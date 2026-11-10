import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test"
import { expect, test } from "./fixtures"
import { countRows, newAccount, removeAccount, signIn, type Account } from "./support/account"
import { deviceEndpoint, fakePushDevice, permissionRequests } from "./support/push"

/**
 * E8 · Push on each device, with an account on the local stack. Each browser context is a device;
 * its PushManager is the stand-in of support/push.ts, everything else (app, route, database) is
 * real. The PRD (§5.3, criterion 7): permission only after a clear tap, opt-in and revoke work, and
 * each device's subscription is independent of the others.
 */
test.use({ mode: "account", serviceWorkers: "allow" })
test.setTimeout(90_000)

let account: Account
test.beforeEach(async () => {
  account = await newAccount("push")
})
test.afterEach(async () => {
  await removeAccount(account)
})

const rows = () => countRows("select count(*)::int n from public.push_subscriptions where user_id = $1", [account.id])
const section = (page: Page) => page.getByTestId("push-section")
const status = (page: Page) => section(page).getByTestId("push-status")

async function openSettings(page: Page) {
  await page.goto("/settings/notifications")
  await expect(status(page)).toBeVisible()
  await expect(status(page)).not.toHaveText("comprobando…")
}

async function secondDevice(browser: Browser, info: TestInfo): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, serviceWorkers: "allow" })
  await fakePushDevice(ctx)
  const page = await ctx.newPage()
  await signIn(page, account)
  return { ctx, page }
}

test("each device turns push on and off by itself, and the permission is asked only after a tap", async ({ page, context, browser, consoleErrors }, info) => {
  await fakePushDevice(context)
  await signIn(page, account)
  await openSettings(page)
  await expect(status(page)).toHaveText("desactivadas")
  expect(await permissionRequests(context)).toBe(0)

  await section(page).getByRole("button", { name: "Activar en este dispositivo" }).click()
  await expect(status(page)).toHaveText("activadas")
  expect(await permissionRequests(context)).toBe(1)
  await expect.poll(rows).toBe(1)
  await expect(section(page).getByTestId("push-devices").getByRole("listitem")).toHaveCount(1)
  await expect(section(page).getByTestId("push-devices")).toContainText("Este dispositivo")

  // A second device: the first one being on does not turn it on.
  const two = await secondDevice(browser, info)
  try {
    await openSettings(two.page)
    await expect(status(two.page)).toHaveText("desactivadas")
    await expect(section(two.page).getByTestId("push-devices").getByRole("listitem")).toHaveCount(1)
    expect(await permissionRequests(two.ctx)).toBe(0)
    await section(two.page).getByRole("button", { name: "Activar en este dispositivo" }).click()
    await expect(status(two.page)).toHaveText("activadas")
    await expect.poll(rows).toBe(2)
    await expect(section(two.page).getByTestId("push-devices").getByRole("listitem")).toHaveCount(2)
    expect(await deviceEndpoint(two.ctx)).not.toBe(await deviceEndpoint(context))

    // The first device turns itself off: its browser drops the subscription, the second stays on.
    await page.reload()
    await expect(status(page)).toHaveText("activadas")
    await section(page).getByRole("button", { name: "Desactivar en este dispositivo" }).click()
    await expect(status(page)).toHaveText("desactivadas")
    await expect(section(page).getByTestId("push-message")).toContainText("Los demás dispositivos no cambian")
    await expect.poll(rows).toBe(1)
    expect(await deviceEndpoint(context)).toBeNull()
    await two.page.reload()
    await expect(status(two.page)).toHaveText("activadas")
    await expect(section(two.page).getByTestId("push-devices").getByRole("listitem")).toHaveCount(1)

    // On again on the first; then the second removes it from its list (a lost phone).
    await section(page).getByRole("button", { name: "Activar en este dispositivo" }).click()
    await expect(status(page)).toHaveText("activadas")
    await expect.poll(rows).toBe(2)
    await two.page.reload()
    const other = section(two.page).getByTestId("push-devices").getByRole("listitem").filter({ hasNotText: "Este dispositivo" })
    await other.getByRole("button", { name: /^Quitar / }).click()
    await expect(section(two.page).getByTestId("push-devices").getByRole("listitem")).toHaveCount(1)
    await expect.poll(rows).toBe(1)
    await page.reload()
    await expect(status(page)).toHaveText("desactivadas")
    await expect(status(two.page)).toHaveText("activadas")
  } finally {
    await two.ctx.close()
  }
  expect(consoleErrors).toEqual([])
})

test("the test notification goes through the server, which says sending is not configured here", async ({ page, context }) => {
  await fakePushDevice(context)
  await signIn(page, account)
  await openSettings(page)
  await section(page).getByRole("button", { name: "Activar en este dispositivo" }).click()
  await expect(status(page)).toHaveText("activadas")
  await expect(section(page)).toContainText("el envío programado de los avisos está pendiente de autorización")
  await section(page).getByRole("button", { name: "Enviar prueba" }).click()
  await expect(section(page).getByTestId("push-message")).toHaveText("El servidor aún no tiene configurado el envío (pendiente de autorización).")
})

test("signing out stops this browser's push: the server forgets it and the browser drops it", async ({ page, context }) => {
  await fakePushDevice(context)
  await signIn(page, account)
  await openSettings(page)
  await section(page).getByRole("button", { name: "Activar en este dispositivo" }).click()
  await expect.poll(rows).toBe(1)

  await page.goto("/settings")
  await page.getByRole("button", { name: "Cerrar sesión" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar sesión" }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await rows()).toBe(0)
  expect(await deviceEndpoint(context)).toBeNull()
})

test("on an iPhone outside the home screen it explains how to install, and nothing is asked", async ({ browser }, info) => {
  const ctx = await browser.newContext({
    ...info.project.use,
    baseURL: info.project.use.baseURL,
    serviceWorkers: "allow",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  })
  // Safari tabs on iOS have no PushManager and no Notification.
  await ctx.addInitScript(() => {
    delete (window as Partial<Window & typeof globalThis>).PushManager
    delete (window as Partial<Window & typeof globalThis>).Notification
  })
  try {
    const page = await ctx.newPage()
    await signIn(page, account)
    await page.goto("/settings/notifications")
    const note = section(page).getByTestId("push-unavailable")
    await expect(note).toHaveAttribute("data-reason", "install")
    await expect(note).toContainText("Añadir a pantalla de inicio")
    await expect(section(page).getByRole("button")).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})
