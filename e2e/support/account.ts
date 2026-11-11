import type { Page } from "@playwright/test"
import pg from "pg"
import { adminClient, db, localStatus } from "../../tests/integration/setup"

export interface Account {
  id: string
  email: string
}

/**
 * Stage timings of the account being created (M4f: one creation stalled for 30 s in the Linux
 * container). Stage names and milliseconds only, never the address. When creation does not
 * finish, removeAccount (afterEach) reports the stage it stalled in and cleans up what was made.
 */
let creating: { email: string; stages: [string, number][]; stage: string; since: number } | null = null
const SLOW_MS = 3000

async function stage<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const c = creating!
  c.stage = name
  c.since = Date.now()
  const out = await fn()
  c.stages.push([name, Date.now() - c.since])
  return out
}

const report = (c: NonNullable<typeof creating>) => c.stages.map(([s, ms]) => `${s} ${ms}ms`).join(" · ")

/** Allowlisted, confirmed account on the LOCAL stack (no password: magic link only). */
export async function newAccount(label: string): Promise<Account> {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@theonepercent.local`
  creating = { email, stages: [], stage: "", since: Date.now() }
  const started = Date.now()
  await stage("status", () => localStatus())
  const c = new pg.Client({ connectionString: localStatus().DB_URL })
  await stage("db-connect", () => c.connect())
  try {
    await stage("db-insert", () => c.query("insert into private.allowed_emails (email, note) values ($1, 'e2e')", [email]))
  } finally {
    await stage("db-end", () => c.end())
  }
  const { data, error } = await stage("auth-createUser", () => adminClient().auth.admin.createUser({ email, email_confirm: true }))
  if (error || !data.user) throw error ?? new Error("createUser failed")
  if (Date.now() - started > SLOW_MS) console.warn(`[newAccount] slow: ${report(creating)}`)
  creating = null
  return { id: data.user.id, email }
}

/**
 * For a test whose moments lie hours before now but must count as today (a session begun 50 min ago,
 * a device 3 h behind): just after midnight in Madrid they are yesterday, and a session belongs to
 * the day it started. Between 00:00 and 04:00 such an account lives in a zone where it is still evening.
 * Call it before signing in. The rest of the day it changes nothing.
 */
export async function liveWellPastMidnight(a: Account): Promise<void> {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(new Date()))
  if (hour < 4) await db((c) => c.query("update public.profiles set timezone = 'America/New_York' where id = $1", [a.id]))
}

export async function removeAccount(a: Account | undefined): Promise<void> {
  // newAccount did not finish (its hook timed out or failed): say where, and remove its allowlist
  // row. `a` is then unset or still the previous test's account, already removed.
  if (creating) {
    console.warn(`[newAccount] stalled in ${creating.stage} after ${Date.now() - creating.since}ms; done: ${report(creating) || "nothing"}`)
    const email = creating.email
    creating = null
    await db((c) => c.query("delete from private.allowed_emails where email = $1", [email]))
    return
  }
  if (!a) return
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
