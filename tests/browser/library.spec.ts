import { writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { expect, test, type Browser, type Page } from "@playwright/test"
import { build } from "rolldown"
import { adminClient, anonClient, db, localStatus } from "../integration/setup"

/**
 * M4c in real Chromium: the per-row IndexedDB copy (atomic page + cursor, real aborts), reloading
 * mid-download, two tabs of one browser, a lost library database with edits waiting, and the volume
 * benchmark. Real engine, real stores, real Supabase transport against the LOCAL stack only.
 *
 *   npx playwright test --config playwright.browser.config.ts
 */

// The page is served by a real loopback server: Chromium's Local Network Access only lets a page on a
// loopback address call the loopback Supabase stack (a page fulfilled by page.route() has no address).
let ORIGIN = ""
let server: Server
let bundle = ""
let user: { id: string; email: string; password: string }

test.beforeAll(async () => {
  // Run from the repository root (npx playwright test --config playwright.browser.config.ts).
  const root = process.cwd()
  const out = await build({
    input: join(root, "tests", "browser", "library-harness.entry.ts"),
    resolve: { alias: { "@": join(root, "src") } },
    platform: "browser",
    write: false,
    output: { format: "iife" },
    logLevel: "warn",
  })
  bundle = out.output[0].code
  server = createServer((req, res) => {
    if (req.url?.endsWith(".js")) res.writeHead(200, { "content-type": "text/javascript" }).end(bundle)
    else res.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><meta charset="utf-8"><script src="/h.js"></script>')
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  ORIGIN = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const email = `it-browser-${Date.now()}@theonepercent.local`
  const password = `pw-${Math.random().toString(36).slice(2)}-A1!`
  await db((c) => c.query("insert into private.allowed_emails (email, note) values ($1, 'browser test')", [email]))
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("createUser failed")
  user = { id: data.user.id, email, password }
  // 300 notes on the server, written through apply_ops as another device would.
  const sb = anonClient()
  await sb.auth.signInWithPassword({ email, password })
  const at = new Date().toISOString()
  const book = crypto.randomUUID()
  const ops: unknown[] = [{ type: "library.item.create", op_id: `b-${Date.now()}`, id: book, kind: "book", fields: { title: "Libro" }, at }]
  for (let i = 0; i < 300; i++) ops.push({ type: "library.note.create", op_id: `n-${Date.now()}-${i}`, id: crypto.randomUUID(), fields: { item_id: book, note_type: "idea", body: `Idea ${i}` }, at })
  for (let i = 0; i < ops.length; i += 100) {
    const r = await sb.rpc("apply_ops", { p_device_id: "seed", p_ops: ops.slice(i, i + 100) })
    if (r.error) throw r.error
  }
})

test.afterAll(async () => {
  await new Promise((r) => server.close(r))
  await adminClient().auth.admin.deleteUser(user.id)
  await db((c) => c.query("delete from private.allowed_emails where email = $1", [user.email]))
})

async function open(browser: Browser, context?: Awaited<ReturnType<Browser["newContext"]>>): Promise<Page> {
  const ctx = context ?? (await browser.newContext())
  const page = await ctx.newPage()
  await page.goto(`${ORIGIN}/`)
  return page
}

const setup = (extra: Record<string, unknown> = {}) => ({ url: localStatus().API_URL, key: localStatus().PUBLISHABLE_KEY, email: user.email, password: user.password, ...extra })
type H = { h: Record<string, (...a: unknown[]) => unknown> }
const h = <T,>(page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (globalThis as unknown as H).h[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>

test("the per-row store on real IndexedDB: newest row wins, forward-only cursor, tombstones, per-user isolation, real aborts", async ({ browser }) => {
  const page = await open(browser)
  const r = await h<Record<string, boolean>>(page, "storeContract")
  expect(r).toEqual({ newestKept: true, cursorForward: true, tombstones: true, isolation: true, abortBeforeCommit: true, afterCommitStored: true })
})

test("D · a real abort of the page transaction moves nothing; the next cycle stores it", async ({ browser }) => {
  const page = await open(browser)
  await h(page, "start", setup({ faults: { failBeforeCommit: 1 } }))
  expect(await h(page, "stored", user.id)).toMatchObject({ notes: 0, meta: null })
  expect((await h<{ sync: { state: string } }>(page, "snapshot")).sync.state).toBe("error")
  await h(page, "settle")
  expect(await h(page, "stored", user.id)).toMatchObject({ notes: 300, meta: { complete: true } })
  expect((await h<{ sync: { state: string } }>(page, "snapshot")).sync.state).toBe("synced")
  await page.evaluate(() => indexedDB.deleteDatabase("the-one-percent-library"))
})

test("E · reloading the page mid-download keeps the stored pages and resumes from them with the rebuild's limit", async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await open(browser, ctx)
  await h(page, "startNoWait", setup({ pageSize: 50, pageDelay: 400 }))
  await expect.poll(async () => (await h<{ meta: { cursor: number; complete: boolean } | null }>(page, "stored", user.id)).meta?.cursor ?? 0, { timeout: 15_000 }).toBeGreaterThan(0)
  const before = await h<{ notes: number; meta: { cursor: number; complete: boolean; rebuildUpto: number | null } }>(page, "stored", user.id)
  expect(before.meta.complete).toBe(false)
  await page.reload()
  const after = await h<{ startMs: number }>(page, "start", setup({ pageSize: 50 }))
  const pulls = await h<{ since: number; upto: number | null }[]>(page, "pulls")
  expect(pulls[0].since).toBeGreaterThanOrEqual(before.meta.cursor)
  expect(pulls[0].upto).toBe(before.meta.rebuildUpto)
  expect((await h<{ notes: unknown[] }>(page, "snapshot")).notes).toHaveLength(300)
  expect(after.startMs).toBeGreaterThan(0)
  await page.evaluate(() => indexedDB.deleteDatabase("the-one-percent-library"))
  await ctx.close()
})

test("I · two tabs writing offline at once, the first one closed before sending: both notes reach the server once", async ({ browser }) => {
  const ctx = await browser.newContext()
  const t1 = await open(browser, ctx)
  const t2 = await open(browser, ctx)
  await h(t1, "start", setup())
  await h(t2, "start", setup())
  await h(t1, "setOnline", false)
  await h(t2, "setOnline", false)
  const [a, b] = await Promise.all([h<string>(t1, "createNote", { item_id: null, note_type: "idea", body: "Pestaña 1" }), h<string>(t2, "createNote", { item_id: null, note_type: "idea", body: "Pestaña 2" })])
  await t1.waitForTimeout(300)
  await t1.close()
  await h(t2, "setOnline", true)
  await h(t2, "settle")
  const rows = await db((c) => c.query("select id from public.knowledge_notes where id = any($1::uuid[]) and deleted_at is null", [[a, b]]))
  expect(rows.rows.map((r) => r.id).sort()).toEqual([a, b].sort())
  // Each create applied exactly once (a replay would be answered from the ledger, not applied again).
  const applied = await db((c) => c.query("select count(*)::int n from public.sync_operations s where s.user_id = $1 and s.operation_type = 'library.note.create' and s.outcome = 'applied' and (s.result ->> 'seq') in (select server_seq::text from public.knowledge_notes where id = any($2::uuid[]))", [user.id, [a, b]]))
  expect(applied.rows[0].n).toBe(2)
  await t2.evaluate(() => indexedDB.deleteDatabase("the-one-percent-library"))
  await ctx.close()
})

test("K · the library database is lost while an edit waits offline: rebuilt, and the edit still reaches the server", async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await open(browser, ctx)
  await h(page, "start", setup())
  await h(page, "setOnline", false)
  const id = await h<string>(page, "createNote", { item_id: null, note_type: "question", body: "Espera sin copia" })
  await page.waitForTimeout(300)
  await page.reload()
  // The library database disappears (cleared site data); the main record with the queue stays.
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("the-one-percent-library"); q.onsuccess = q.onerror = q.onblocked = () => r(null) }))
  await h(page, "start", setup())
  const snap = await h<{ notes: { id: string; body: string }[]; sync: { state: string } }>(page, "snapshot")
  expect(snap.notes.find((n) => n.id === id)?.body).toBe("Espera sin copia")
  expect(snap.sync.state).toBe("synced")
  const row = await db((c) => c.query("select body from public.knowledge_notes where id = $1", [id]))
  expect(row.rows[0].body).toBe("Espera sin copia")
  await ctx.close()
})

test("volume: 5.000 notes in the per-row copy (CPU ×1 and ×4)", async ({ browser }) => {
  test.setTimeout(600_000)
  const results: Record<string, unknown> = { date: new Date().toISOString(), chromium: browser.version() }
  for (const rate of [1, 4]) {
    const ctx = await browser.newContext()
    const page = await open(browser, ctx)
    const cdp = await ctx.newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate })
    const r = await h<Record<string, number>>(page, "bench")
    // A figure is only valid if the engine really opened the 5.000 stored notes.
    expect(r.engineNotes).toBe(5_000)
    expect(r.loadedNotes).toBe(5_000)
    results[`x${rate}`] = r
    await ctx.close()
  }
  // Two tabs of one user saving at the same time, over a 5.000-note copy (CPU ×1).
  const ctx = await browser.newContext()
  const [p1, p2] = [await open(browser, ctx), await open(browser, ctx)]
  const uid = "tabs-" + Date.now()
  await h(p1, "fill", uid)
  const alone = await h<{ median: number; max: number }>(p1, "saves", uid, 20)
  const [t1, t2] = await Promise.all([h<{ median: number; max: number; notes: number }>(p1, "saves", uid, 20), h<{ median: number; max: number; notes: number }>(p2, "saves", uid, 20)])
  results.twoTabs = { oneTab: alone, tab1: t1, tab2: t2 }
  await p1.evaluate(() => indexedDB.deleteDatabase("the-one-percent-library"))
  await ctx.close()
  console.log(JSON.stringify(results, null, 2))
  if (process.env.M4C_BENCH_OUT) writeFileSync(process.env.M4C_BENCH_OUT, JSON.stringify(results, null, 2) + "\n")
})
