import type { Page } from "@playwright/test"
import { adminClient, db } from "../../tests/integration/setup"

export interface Account {
  id: string
  email: string
}

/** Allowlisted, confirmed account on the LOCAL stack (no password: magic link only). */
export async function newAccount(label: string): Promise<Account> {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@theonepercent.local`
  await db((c) => c.query("insert into private.allowed_emails (email, note) values ($1, 'e2e')", [email]))
  const { data, error } = await adminClient().auth.admin.createUser({ email, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("createUser failed")
  return { id: data.user.id, email }
}

export async function removeAccount(a: Account): Promise<void> {
  await adminClient().auth.admin.deleteUser(a.id)
  await db((c) => c.query("delete from private.allowed_emails where email = $1", [a.email]))
}

/** Sign in through the real /auth/confirm route with a server-issued magic-link token. */
export async function signIn(page: Page, a: Account): Promise<void> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "magiclink", email: a.email })
  if (error) throw error
  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`)
  await page.waitForURL((u) => u.pathname === "/")
}

export async function countRows(sql: string, params: unknown[]): Promise<number> {
  return db(async (c) => (await c.query(sql, params)).rows[0].n as number)
}
