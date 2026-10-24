/**
 * Integration test helpers. Requires the LOCAL stack (`npm run db:start`).
 * Connection details come from `supabase status`, so no secrets live in the repo.
 * Refuses to run against anything that is not a loopback host.
 */
import { execSync } from "node:child_process"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import pg from "pg"

interface LocalStatus {
  API_URL: string
  DB_URL: string
  PUBLISHABLE_KEY: string
  SECRET_KEY: string
}

let cached: LocalStatus | null = null

export function localStatus(): LocalStatus {
  if (cached) return cached
  const raw = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  const json = JSON.parse(raw.slice(raw.indexOf("{")))
  const s: LocalStatus = { API_URL: json.API_URL, DB_URL: json.DB_URL, PUBLISHABLE_KEY: json.PUBLISHABLE_KEY, SECRET_KEY: json.SECRET_KEY }
  for (const url of [s.API_URL, s.DB_URL]) {
    const host = new URL(url.replace(/^postgresql:/, "http:")).hostname
    if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Refusing to run integration tests against ${host}`)
  }
  cached = s
  return s
}

export async function db<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: localStatus().DB_URL })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

export function adminClient(): SupabaseClient {
  const s = localStatus()
  return createClient(s.API_URL, s.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function anonClient(): SupabaseClient {
  const s = localStatus()
  return createClient(s.API_URL, s.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

export interface TestUser {
  id: string
  email: string
  client: SupabaseClient
}

/** Allowlist + create a confirmed user, then sign in (password auth is local-test only). */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `it-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@theonepercent.local`
  const password = `pw-${Math.random().toString(36).slice(2)}-A1!`
  await db((c) => c.query("insert into private.allowed_emails (email, note) values ($1, 'integration test')", [email]))
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("createUser failed")
  const client = anonClient()
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  return { id: data.user.id, email, client }
}

export async function deleteTestUser(u: TestUser): Promise<void> {
  await adminClient().auth.admin.deleteUser(u.id)
  await db((c) => c.query("delete from private.allowed_emails where email = $1", [u.email]))
}

let opCounter = 0
export function opId(prefix = "it"): string {
  return `${prefix}-${Date.now().toString(36)}-${(++opCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}
