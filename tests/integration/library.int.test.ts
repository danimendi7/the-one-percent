import { writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { demoLibrary } from "@/features/knowledge/demo"
import { syntheticLibrary, VOLUME_5K } from "@/features/knowledge/domain/synthetic"
import type { ContentItem, EntityRef, KnowledgeNote, KnowledgeState } from "@/features/knowledge/domain/types"
import { itemSchema, noteSchema, showSchema } from "@/features/knowledge/domain/validation"
import { itemFields, noteFields, rowToItem, rowToNote, rowToShow, showFields, type WireChange, type WireFields } from "@/features/sync/domain/library-wire"
import { adminClient, anonClient, db, opId } from "./setup"

/**
 * M4b · Library persistence (supabase/migrations/*_library.sql) against real PostgreSQL: the same
 * rules as the TypeScript domain, RLS and the write path, idempotency, field conflicts (D68),
 * deletes without resurrection, and the paged incremental pull (N2) under concurrent writes.
 * Each user signs in twice: two sessions are two devices. LOCAL stack only.
 */

type Result = { op_id: string; status: string; outcome?: string; code?: string | null; fields?: string[]; seq?: number }
type Page = { changes: WireChange[]; cursor: number; has_more: boolean; full: boolean; head: number }

interface User {
  id: string
  email: string
  d1: SupabaseClient
  d2: SupabaseClient
}

async function createUser(label: string): Promise<User> {
  const email = `it-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@theonepercent.local`
  const password = `pw-${Math.random().toString(36).slice(2)}-A1!`
  await db((c) => c.query("insert into private.allowed_emails (email, note) values ($1, 'integration test')", [email]))
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("createUser failed")
  const device = async () => {
    const c = anonClient()
    const s = await c.auth.signInWithPassword({ email, password })
    if (s.error) throw s.error
    return c
  }
  return { id: data.user.id, email, d1: await device(), d2: await device() }
}

async function removeUser(u: User) {
  await adminClient().auth.admin.deleteUser(u.id)
  await db((c) => c.query("delete from private.allowed_emails where email = $1", [u.email]))
}

async function apply(c: SupabaseClient, ops: unknown[]): Promise<Result[]> {
  const out: Result[] = []
  for (let i = 0; i < ops.length; i += 100) {
    const { data, error } = await c.rpc("apply_ops", { p_device_id: "it-library", p_ops: ops.slice(i, i + 100) })
    if (error) throw error
    out.push(...(data as { results: Result[] }).results)
  }
  return out
}
const applyOne = async (c: SupabaseClient, op: unknown) => (await apply(c, [op]))[0]

async function pullPage(c: SupabaseClient, since = 0, limit = 500, full = false): Promise<Page> {
  const { data, error } = await c.rpc("pull_library", { p_since: since, p_limit: limit, p_full: full })
  if (error) throw error
  return data as Page
}

/** Pages until done; the cursor only moves after a page is «stored» (here: kept in memory). A pull from 0 is a rebuild on every page. */
async function pullAll(c: SupabaseClient, since = 0, limit = 500) {
  const full = since === 0
  const changes: WireChange[] = []
  let cursor = since
  let pages = 0
  let bytes = 0
  for (;;) {
    const p = await pullPage(c, cursor, limit, full)
    bytes += JSON.stringify(p).length
    pages++
    changes.push(...p.changes)
    cursor = p.cursor
    if (!p.has_more) return { changes, cursor, pages, bytes, head: p.head }
  }
}

/** A device copy rebuilt from pulled changes: newest version of each row, tombstones removed. */
type Copy = Map<string, WireChange>
function applyChanges(copy: Copy, changes: WireChange[]): Copy {
  for (const ch of changes) {
    const k = `${ch.t}:${ch.row.id}`
    const prev = copy.get(k)
    if (prev && prev.seq >= ch.seq) continue
    if (ch.row.deleted) copy.delete(k)
    else copy.set(k, ch)
  }
  return copy
}
const live = (copy: Copy) => new Map([...copy].map(([k, v]) => [k, v.seq]))

const now = () => new Date().toISOString()
const create = (entity: "show" | "item" | "note", id: string, fields: WireFields, extra: Record<string, unknown> = {}) => ({
  type: `library.${entity}.create`,
  op_id: opId(`lib-${entity}`),
  id,
  fields,
  at: now(),
  ...extra,
})
const update = (entity: "show" | "item" | "note", id: string, fields: WireFields, base_seqs: Record<string, number | null>, at = now()) => ({
  type: `library.${entity}.update`,
  op_id: opId(`lib-${entity}-up`),
  id,
  fields,
  base_seqs,
  at,
})
const remove = (entity: "show" | "item" | "note", id: string, base_seq: number, extra: Record<string, unknown> = {}) => ({
  type: `library.${entity}.delete`,
  op_id: opId(`lib-${entity}-del`),
  id,
  base_seq,
  ...extra,
})
const restore = (entity: "show" | "item" | "note", id: string, fields: WireFields, extra: Record<string, unknown> = {}) => ({
  type: `library.${entity}.restore`,
  op_id: opId(`lib-${entity}-re`),
  id,
  fields,
  at: now(),
  ...extra,
})
const link = (a: EntityRef, b: EntityRef, linked: boolean) => ({
  type: "library.link.set",
  op_id: opId("lib-link"),
  a_type: a.type,
  a_id: a.id,
  b_type: b.type,
  b_id: b.id,
  linked,
})

/** The same library with uuid ids (the database requires them; the demo and synthetic ids are readable strings). */
function withUuids(s: KnowledgeState): KnowledgeState {
  const map = new Map<string, string>()
  const id = (x: string) => map.get(x) ?? (map.set(x, crypto.randomUUID()), map.get(x)!)
  const shows = Object.fromEntries(Object.values(s.shows).map((sh) => [id(sh.id), { ...sh, id: id(sh.id) }]))
  const items = Object.fromEntries(
    Object.values(s.items).map((i): [string, ContentItem] => [
      id(i.id),
      i.kind === "episode" ? { ...i, id: id(i.id), episode: { ...i.episode, showId: i.episode.showId ? id(i.episode.showId) : null } } : { ...i, id: id(i.id) },
    ])
  )
  const notes = Object.fromEntries(Object.values(s.notes).map((n) => [id(n.id), { ...n, id: id(n.id), itemId: n.itemId ? id(n.itemId) : null }]))
  const links = Object.fromEntries(
    Object.values(s.links).map((l) => {
      const a = { ...l.a, id: id(l.a.id) }
      const b = { ...l.b, id: id(l.b.id) }
      return [`${a.type}:${a.id}|${b.type}:${b.id}`, { ...l, a, b }]
    })
  )
  return { shows, items, notes, links }
}

/** Ops that write a whole library (shows, then content, then notes, then links). */
function libraryOps(s: KnowledgeState): unknown[] {
  return [
    ...Object.values(s.shows).map((sh) => create("show", sh.id, showFields(sh))),
    ...Object.values(s.items).map((i) => create("item", i.id, itemFields(i), { kind: i.kind })),
    ...Object.values(s.notes).map((n) => create("note", n.id, noteFields(n), { captured_at: n.createdAt })),
    ...Object.values(s.links).map((l) => link(l.a, l.b, true)),
  ]
}

let a: User
let b: User

beforeAll(async () => {
  a = await createUser("lib-a")
  b = await createUser("lib-b")
})
afterAll(async () => {
  await removeUser(a)
  await removeUser(b)
})

/** A small library of one user: a book (300 pages), a show with an episode (1 h) and a note. */
async function seed(u: User) {
  const ids = { book: crypto.randomUUID(), show: crypto.randomUUID(), ep: crypto.randomUUID(), note: crypto.randomUUID() }
  const r = await apply(u.d1, [
    create("item", ids.book, { title: "Libro", page_count: 300, topics: ["Sueño"] }, { kind: "book" }),
    create("show", ids.show, { title: "Programa" }),
    create("item", ids.ep, { title: "Episodio", show_id: ids.show, duration_seconds: 3600 }, { kind: "episode" }),
    create("note", ids.note, { item_id: ids.book, note_type: "idea", body: "Primera idea" }),
  ])
  expect(r.map((x) => x.status)).toEqual(["applied", "applied", "applied", "applied"])
  return { ...ids, seqs: Object.fromEntries(Object.keys(ids).map((k, i) => [k, r[i].seq!])) as Record<keyof typeof ids, number> }
}

describe("same rules as the TypeScript domain", () => {
  it("the demo library (valid in TypeScript) is accepted and comes back identical", async () => {
    const lib = withUuids(demoLibrary("2026-10-30"))
    const results = await apply(a.d1, libraryOps(lib))
    expect(results.filter((r) => r.status !== "applied")).toEqual([])
    const copy = applyChanges(new Map(), (await pullAll(a.d1)).changes)
    for (const i of Object.values(lib.items)) {
      const back = rowToItem(copy.get(`item:${i.id}`)!.row)
      expect({ ...back, createdAt: "", updatedAt: "" }).toEqual({ ...i, createdAt: "", updatedAt: "" })
      expect(itemSchema.safeParse(back).success).toBe(true)
    }
    for (const sh of Object.values(lib.shows)) {
      const back = rowToShow(copy.get(`show:${sh.id}`)!.row)
      expect({ ...back, createdAt: "", updatedAt: "" }).toEqual({ ...sh, createdAt: "", updatedAt: "" })
      expect(showSchema.safeParse(back).success).toBe(true)
    }
    for (const n of Object.values(lib.notes)) {
      const back = rowToNote(copy.get(`note:${n.id}`)!.row)
      expect({ ...back, updatedAt: "" }).toEqual({ ...n, createdAt: new Date(n.createdAt).toISOString(), updatedAt: "" })
    }
  })

  const book = (over: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(), kind: "book", title: "Libro", subtitle: null, creators: [], description: null, topics: [], language: null,
    status: "planned", favorite: false, rating: null, startedOn: null, finishedOn: null, cover: null, sourceUrl: null, external: null,
    createdAt: now(), updatedAt: now(),
    book: { isbn13: null, isbn10: null, pageCount: 300, currentPage: null, progressPercent: null, publisher: null, publishedYear: null },
    ...over,
  })

  // Each case: the same entity through Zod and through the database. Both must agree.
  const cases: [string, Record<string, unknown>, boolean][] = [
    ["rating 1", { rating: 1 }, true],
    ["rating 10", { rating: 10 }, true],
    ["rating 0", { rating: 0 }, false],
    ["rating 11", { rating: 11 }, false],
    ["rating 7.5", { rating: 7.5 }, false],
    ["unknown status", { status: "reading" }, false],
    ["each approved status", { status: "abandoned" }, true],
    ["title of 300", { title: "a".repeat(300) }, true],
    ["title of 301", { title: "a".repeat(301) }, false],
    ["empty title", { title: "" }, false],
    ["untrimmed title", { title: " Libro" }, false],
    ["double space", { title: "Libro  doble" }, false],
    ["control character", { description: "Texto\u0007raro" }, false],
    ["block with paragraphs", { description: "Uno\n\nDos" }, true],
    ["duplicate topics by accent", { topics: ["Sueño", "sueno"] }, false],
    ["11 topics", { topics: Array.from({ length: 11 }, (_, i) => `t${i}`) }, false],
    ["10 topics of 40", { topics: Array.from({ length: 10 }, (_, i) => `${i}`.padEnd(40, "x")) }, true],
    ["duplicate creators", { creators: ["Ana", "ana"] }, false],
    ["finished before started", { startedOn: "2026-10-10", finishedOn: "2026-10-01" }, false],
    ["unsafe link", { sourceUrl: "javascript:alert(1)" }, false],
    ["link with credentials", { sourceUrl: "https://u:p@x.org/" }, false],
    ["valid ISBN-13", { book: { ...book().book, isbn13: "9780306406157" } }, true],
    ["bad ISBN-13", { book: { ...book().book, isbn13: "9780306406156" } }, false],
    ["bad ISBN-10", { book: { ...book().book, isbn10: "0306406153" } }, false],
    ["page beyond the book", { book: { ...book().book, currentPage: 301 } }, false],
    ["progress 101 %", { book: { ...book().book, progressPercent: 101 } }, false],
    ["zero pages", { book: { ...book().book, pageCount: 0 } }, false],
  ]
  it.each(cases)("item: %s", async (_name, over, valid) => {
    const entity = book(over) as unknown as ContentItem
    expect(itemSchema.safeParse(entity).success).toBe(valid)
    const r = await applyOne(a.d1, create("item", entity.id, itemFields(entity), { kind: "book" }))
    expect(r.status).toBe(valid ? "applied" : "rejected")
  })

  it("format fields stay in their format, and the show must exist", async () => {
    expect((await applyOne(a.d1, create("item", crypto.randomUUID(), { title: "X", show_id: crypto.randomUUID() }, { kind: "book" }))).code).toBe("invalid_fields")
    expect((await applyOne(a.d1, create("item", crypto.randomUUID(), { title: "X", page_count: 3 }, { kind: "episode" }))).code).toBe("invalid_fields")
    expect((await applyOne(a.d1, create("item", crypto.randomUUID(), { title: "X", show_id: crypto.randomUUID() }, { kind: "episode" }))).code).toBe("show_not_found")
    expect((await applyOne(a.d1, create("item", crypto.randomUUID(), { title: "X" }, { kind: "article" }))).status).toBe("rejected")
  })

  it("notes: limits, locators by format, applications and free ideas — same verdict as Zod", async () => {
    const s = await seed(a)
    const note = (over: Partial<KnowledgeNote>): KnowledgeNote => ({
      id: crypto.randomUUID(), itemId: s.book, type: "idea", format: "plain", body: "Idea", locator: null, starred: false,
      applicationStatus: null, applicationLink: null, topics: [], createdAt: now(), updatedAt: now(), ...over,
    })
    const cases: [string, KnowledgeNote, boolean, string?][] = [
      ["note of 10.000", note({ body: "a".repeat(10_000) }), true],
      ["note of 10.001", note({ body: "a".repeat(10_001) }), false],
      ["quote of 2.000", note({ type: "quote", body: "a".repeat(2_000) }), true],
      ["quote of 2.001", note({ type: "quote", body: "a".repeat(2_001) }), false],
      ["empty", note({ body: "" }), false],
      ["application with status", note({ type: "application", applicationStatus: "open" }), true],
      ["application without status", note({ type: "application" }), false],
      ["status on an idea", note({ applicationStatus: "done" }), false],
      ["free idea", note({ itemId: null }), true],
      ["free idea with locator", note({ itemId: null, locator: { page: 3, positionSeconds: null, label: null } }), false],
      ["page on a book", note({ locator: { page: 300, positionSeconds: null, label: null } }), true],
    ]
    for (const [name, n, valid] of cases) {
      expect(noteSchema.safeParse(n).success, name).toBe(valid)
      const r = await applyOne(a.d1, create("note", n.id, noteFields(n)))
      expect(r.status, name).toBe(valid ? "applied" : "rejected")
    }
    // Cross-row rules (the domain checks them in ops.ts; the database in its guard).
    const crossRow: [string, KnowledgeNote, string][] = [
      ["page beyond the book", note({ locator: { page: 301, positionSeconds: null, label: null } }), "invalid_locator"],
      ["page on an episode", note({ itemId: s.ep, locator: { page: 3, positionSeconds: null, label: null } }), "invalid_locator"],
      ["timestamp on a book", note({ locator: { page: null, positionSeconds: 30, label: null } }), "invalid_locator"],
      ["timestamp beyond the episode", note({ itemId: s.ep, locator: { page: null, positionSeconds: 3601, label: null } }), "invalid_locator"],
      ["unknown content", note({ itemId: crypto.randomUUID() }), "item_deleted"],
    ]
    for (const [name, n, code] of crossRow) expect((await applyOne(a.d1, create("note", n.id, noteFields(n)))).code, name).toBe(code)
  })

  it("an application can point to the user's own habit only, never to another user's", async () => {
    const s = await seed(a)
    const habit = (u: User) => {
      const id = crypto.randomUUID()
      const start = new Date().toISOString().slice(0, 10)
      return applyOne(u.d1, {
        type: "habit.create",
        op_id: opId("habit"),
        habit: { id, title: "Leer", icon: "check", dimension: "mind", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: start },
        versions: [{ valid_from: start, rule: { kind: "daily" } }],
      }).then((r) => (expect(r.status).toBe("applied"), id))
    }
    const mine = await habit(a)
    const theirs = await habit(b)
    const app = (habitId: string) =>
      create("note", crypto.randomUUID(), { item_id: s.book, note_type: "application", body: "Leer cada noche", application_status: "open", application_habit_id: habitId, application_link_title: "Leer" })
    expect((await applyOne(a.d1, app(mine))).status).toBe("applied")
    expect((await applyOne(a.d1, app(theirs))).status).toBe("rejected")
    expect((await applyOne(a.d1, app(crypto.randomUUID()))).status).toBe("rejected")
  })
})

describe("security", () => {
  it("another user can neither read, pull, write, note on nor link to someone else's library", async () => {
    const s = await seed(a)
    for (const t of ["library_items", "podcast_shows", "knowledge_notes", "knowledge_links"]) {
      const { data } = await b.d1.from(t).select("id")
      expect((data ?? []).some((r: { id: string }) => [s.book, s.show, s.ep, s.note].includes(r.id)), t).toBe(false)
    }
    const page = await pullPage(b.d1)
    expect(page.changes.some((c) => [s.book, s.show, s.ep, s.note].includes(c.row.id))).toBe(false)
    expect((await applyOne(b.d1, update("item", s.book, { title: "Mío" }, {}))).code).toBe("not_found")
    expect((await applyOne(b.d1, remove("note", s.note, s.seqs.note))).code).toBe("not_found")
    // Another user's content answers exactly like one that does not exist.
    expect((await applyOne(b.d1, create("note", crypto.randomUUID(), { item_id: s.book, note_type: "idea", body: "Ajena" }))).code).toBe("item_deleted")
    expect((await applyOne(b.d1, create("item", crypto.randomUUID(), { title: "E", show_id: s.show }, { kind: "episode" }))).status).toBe("rejected")
    const mine = crypto.randomUUID()
    await applyOne(b.d1, create("item", mine, { title: "Mío" }, { kind: "book" }))
    expect((await applyOne(b.d1, link({ type: "item", id: mine }, { type: "item", id: s.book }, true))).code).toBe("link_target_not_found")
    // Reusing another user's id for a new row does not reveal or overwrite it.
    expect((await applyOne(b.d1, create("item", s.book, { title: "Robo" }, { kind: "book" }))).code).toBe("not_found")
  })

  it("anonymous visitors get nothing", async () => {
    const anon = anonClient()
    for (const t of ["library_items", "podcast_shows", "knowledge_notes", "knowledge_links"]) {
      const { data, error } = await anon.from(t).select("id")
      expect(error !== null || (data ?? []).length === 0, t).toBe(true)
    }
    expect((await anon.rpc("pull_library", { p_since: 0 })).error).not.toBeNull()
  })

  it("direct writes skip nothing: inserts and updates through the API are refused, deletes are not granted", async () => {
    const s = await seed(a)
    const ins = await a.d1.from("library_items").insert({ id: crypto.randomUUID(), kind: "book", title: "Directo" })
    expect(ins.error?.message).toMatch(/library_via_ops_only/)
    const upd = await a.d1.from("knowledge_notes").update({ body: "Cambiado" }).eq("id", s.note)
    expect(upd.error?.message).toMatch(/library_via_ops_only/)
    const del = await a.d1.from("knowledge_notes").delete().eq("id", s.note)
    expect(del.error).not.toBeNull()
    const { data } = await a.d1.from("knowledge_notes").select("body").eq("id", s.note)
    expect(data).toEqual([{ body: "Primera idea" }])
  })

  it("privileges: no anon grants, no delete grants, no security definer, every function with an empty search_path", async () => {
    await db(async (c) => {
      const grants = await c.query(`select table_name, grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and table_name in ('podcast_shows','library_items','knowledge_notes','knowledge_links')
          and (grantee = 'anon' or (grantee = 'authenticated' and privilege_type in ('DELETE','TRUNCATE')))`)
      expect(grants.rows).toEqual([])
      const fns = await c.query(`select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') anon
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname = 'private' and (p.proname like 'lib%' or p.proname in ('library_op','apply_library_op','guard_library')))
           or (n.nspname = 'public' and p.proname = 'pull_library')`)
      expect(fns.rows.length).toBeGreaterThan(20)
      for (const f of fns.rows) {
        expect(f.prosecdef, f.proname).toBe(false)
        expect(f.anon, f.proname).toBe(false)
        expect(f.proconfig, f.proname).toContain('search_path=""')
      }
      const rls = await c.query(`select relname, relrowsecurity from pg_class where relname in ('podcast_shows','library_items','knowledge_notes','knowledge_links')`)
      expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true)
    })
  })

  it("the audit log records actions, never text", async () => {
    const s = await seed(a)
    await applyOne(a.d1, update("item", s.book, { status: "active" }, { status: null }))
    await db(async (c) => {
      const rows = await c.query("select entity_type, action, metadata_json from public.audit_logs where user_id = $1 and entity_type like 'library_%'", [a.id])
      expect(rows.rows.length).toBeGreaterThan(0)
      expect(JSON.stringify(rows.rows)).not.toMatch(/Primera idea|Libro|Programa/)
    })
  })
})

describe("idempotency and conflicts (D68)", () => {
  it("a replayed op answers the same; the same id under another op id does not create twice", async () => {
    const id = crypto.randomUUID()
    const op = create("note", id, { note_type: "idea", body: "Una vez", item_id: null })
    const first = await applyOne(a.d1, op)
    const again = await applyOne(a.d2, op)
    expect(first).toMatchObject({ status: "applied" })
    expect(again).toMatchObject({ status: "duplicate", outcome: "applied", seq: first.seq })
    expect(await applyOne(a.d2, create("note", id, { note_type: "idea", body: "Otra vez", item_id: null }))).toMatchObject({ status: "superseded", code: "exists" })
  })

  it("different fields from two devices both apply; a sequential edit with the right base applies", async () => {
    const s = await seed(a)
    const r1 = await applyOne(a.d1, update("item", s.book, { rating: 8 }, { rating: null }))
    const r2 = await applyOne(a.d2, update("item", s.book, { favorite: true }, { favorite: s.seqs.book }))
    expect([r1.status, r2.status]).toEqual(["applied", "applied"])
    const r3 = await applyOne(a.d1, update("item", s.book, { rating: 9 }, { rating: r1.seq! }))
    expect(r3.status).toBe("applied")
    const row = (await db((c) => c.query("select rating, favorite from public.library_items where id = $1", [s.book]))).rows[0]
    expect(row).toEqual({ rating: 9, favorite: true })
  })

  it("the same simple field from two devices: the newest stamp wins, the older one is stale", async () => {
    const s = await seed(a)
    const t0 = Date.now()
    const newer = new Date(t0 + 1000).toISOString()
    const older = new Date(t0).toISOString()
    expect((await applyOne(a.d1, update("item", s.book, { status: "active" }, { status: s.seqs.book }, newer))).status).toBe("applied")
    expect(await applyOne(a.d2, update("item", s.book, { status: "paused" }, { status: s.seqs.book }, older))).toMatchObject({ status: "superseded", code: "stale_fields" })
    expect((await db((c) => c.query("select status from public.library_items where id = $1", [s.book]))).rows[0].status).toBe("active")
  })

  it("the same text from two devices keeps both: conflict with the field names, nothing written", async () => {
    const s = await seed(a)
    expect((await applyOne(a.d1, update("note", s.note, { body: "Versión del móvil" }, { body: s.seqs.note }))).status).toBe("applied")
    const r = await applyOne(a.d2, update("note", s.note, { body: "Versión del ordenador", starred: true }, { body: s.seqs.note, starred: s.seqs.note }))
    expect(r).toMatchObject({ status: "conflict", code: "field_conflict", fields: ["body"] })
    const row = (await db((c) => c.query("select body, starred from public.knowledge_notes where id = $1", [s.note]))).rows[0]
    expect(row).toEqual({ body: "Versión del móvil", starred: false })
    // Writing the same text again is not a conflict.
    expect((await applyOne(a.d2, update("note", s.note, { body: "Versión del móvil" }, { body: s.seqs.note }))).status).toBe("applied")
  })

  it("unknown or misplaced fields and missing stamps are refused", async () => {
    const s = await seed(a)
    expect((await applyOne(a.d1, update("item", s.book, { user_id: b.id }, {}))).code).toBe("invalid_fields")
    expect((await applyOne(a.d1, update("item", s.book, { show_id: s.show }, {}))).code).toBe("invalid_fields")
    expect((await applyOne(a.d1, { ...update("item", s.book, { rating: 3 }, {}), at: undefined })).code).toBe("invalid_stamp")
  })
})

describe("deletes, restores and no resurrection", () => {
  it("delete needs the version the user saw", async () => {
    const s = await seed(a)
    const up = await applyOne(a.d2, update("note", s.note, { starred: true }, { starred: s.seqs.note }))
    expect(await applyOne(a.d1, remove("note", s.note, s.seqs.note))).toMatchObject({ status: "conflict", code: "changed" })
    expect((await applyOne(a.d1, remove("note", s.note, up.seq!))).status).toBe("applied")
  })

  it("deleting a content takes its notes and links, refuses if a note changed unseen, and keeps no text", async () => {
    const s = await seed(a)
    await applyOne(a.d1, link({ type: "note", id: s.note }, { type: "item", id: s.ep }, true))
    const late = await applyOne(a.d2, create("note", crypto.randomUUID(), { item_id: s.book, note_type: "idea", body: "Añadida en otro dispositivo" }))
    expect(await applyOne(a.d1, remove("item", s.book, s.seqs.book, { notes_seq: s.seqs.note }))).toMatchObject({ status: "conflict", code: "notes_changed" })
    expect((await applyOne(a.d1, remove("item", s.book, s.seqs.book, { notes_seq: late.seq }))).status).toBe("applied")
    await db(async (c) => {
      const item = (await c.query("select title, topics, deleted_at is not null as gone from public.library_items where id = $1", [s.book])).rows[0]
      expect(item).toEqual({ title: "", topics: [], gone: true })
      const notes = (await c.query("select body, deleted_at is not null as gone from public.knowledge_notes where item_id = $1", [s.book])).rows
      expect(notes).toHaveLength(2)
      expect(notes.every((n) => n.gone && n.body === "")).toBe(true)
      const links = (await c.query("select deleted_at is not null as gone from public.knowledge_links where user_id = $1 and (a_id = $2 or b_id = $2)", [a.id, s.note])).rows
      expect(links.every((l) => l.gone)).toBe(true)
    })
  })

  it("deleting a show keeps its episodes and their notes, without a show", async () => {
    const s = await seed(a)
    const n = crypto.randomUUID()
    await applyOne(a.d1, create("note", n, { item_id: s.ep, note_type: "quote", body: "Momento", position_seconds: 90 }))
    expect((await applyOne(a.d1, remove("show", s.show, s.seqs.show))).status).toBe("applied")
    const rows = await db((c) => c.query("select i.show_id, i.title, n.body from public.library_items i join public.knowledge_notes n on n.item_id = i.id where i.id = $1", [s.ep]))
    expect(rows.rows).toEqual([{ show_id: null, title: "Episodio", body: "Momento" }])
  })

  it("late edits, creates and notes never revive a deleted row; only an explicit restore does", async () => {
    const s = await seed(a)
    expect((await applyOne(a.d1, remove("item", s.book, s.seqs.book, { notes_seq: s.seqs.note }))).status).toBe("applied")
    expect(await applyOne(a.d2, update("item", s.book, { rating: 7 }, { rating: null }))).toMatchObject({ status: "conflict", code: "deleted" })
    expect(await applyOne(a.d2, update("note", s.note, { body: "Tarde" }, { body: s.seqs.note }))).toMatchObject({ status: "conflict", code: "deleted" })
    expect(await applyOne(a.d2, create("item", s.book, { title: "Otra vez" }, { kind: "book" }))).toMatchObject({ status: "conflict", code: "deleted" })
    expect(await applyOne(a.d2, create("note", crypto.randomUUID(), { item_id: s.book, note_type: "idea", body: "Huérfana" }))).toMatchObject({ status: "conflict", code: "item_deleted" })
    expect(await applyOne(a.d2, link({ type: "item", id: s.book }, { type: "item", id: s.ep }, true))).toMatchObject({ status: "rejected", code: "link_target_not_found" })
    expect((await db((c) => c.query("select deleted_at is not null as gone from public.library_items where id = $1", [s.book])))).toMatchObject({ rows: [{ gone: true }] })
    // «Deshacer»: the client sends the content back explicitly.
    expect((await applyOne(a.d1, restore("item", s.book, { title: "Libro", page_count: 300 }, { kind: "book" }))).status).toBe("applied")
    expect((await applyOne(a.d1, restore("note", s.note, { item_id: s.book, note_type: "idea", body: "Primera idea" }))).status).toBe("applied")
    expect(await applyOne(a.d1, restore("note", s.note, { item_id: s.book, note_type: "idea", body: "Primera idea" }))).toMatchObject({ status: "superseded", code: "exists" })
    expect((await db((c) => c.query("select body from public.knowledge_notes where id = $1 and deleted_at is null", [s.note])))).toMatchObject({ rows: [{ body: "Primera idea" }] })
  })

  it("links are a desired state: linking twice or unlinking twice changes nothing", async () => {
    const s = await seed(a)
    const x = { type: "item" as const, id: s.ep }
    const y = { type: "note" as const, id: s.note }
    for (const op of [link(x, y, true), link(y, x, true), link(x, y, false), link(x, y, false), link(y, x, true)]) expect((await applyOne(a.d1, op)).status).toBe("applied")
    const rows = await db((c) => c.query("select deleted_at is null as live from public.knowledge_links where user_id = $1 and (a_id = $2 or b_id = $2)", [a.id, s.note]))
    expect(rows.rows).toEqual([{ live: true }])
    expect((await applyOne(a.d1, link(x, x, true))).code).toBe("invalid_link")
  })
})

describe("incremental pull (N2)", () => {
  let u: User
  beforeAll(async () => {
    u = await createUser("lib-pull")
  })
  afterAll(async () => removeUser(u))

  it("pages in a stable order, no duplicates, and the pages add up to the whole", async () => {
    const lib = withUuids(syntheticLibrary({ books: 40, shows: 5, episodes: 30, notes: 1_200, links: 150, seed: 3 }))
    const results = await apply(u.d1, libraryOps(lib))
    expect(results.filter((r) => r.status !== "applied")).toEqual([])
    const all = await pullAll(u.d1, 0, 250)
    const seqs = all.changes.map((c) => c.seq)
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y))
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(all.pages).toBe(Math.ceil(all.changes.length / 250) + (all.changes.length % 250 === 0 ? 1 : 0))
    const total = Object.keys(lib.shows).length + Object.keys(lib.items).length + Object.keys(lib.notes).length + Object.keys(lib.links).length
    expect(all.changes).toHaveLength(total)
    expect(all.cursor).toBe(all.head)
    // Nothing new: an incremental pull is empty.
    const none = await pullPage(u.d1, all.cursor)
    expect(none).toMatchObject({ changes: [], has_more: false, cursor: all.cursor })
  })

  it("brings creates, edits and tombstones; a full pull from 0 leaves tombstones out", async () => {
    const before = (await pullAll(u.d1)).cursor
    const s = await seed(u)
    await applyOne(u.d1, update("note", s.note, { starred: true }, { starred: s.seqs.note }))
    const del = await applyOne(u.d1, remove("item", s.ep, s.seqs.ep))
    expect(del.status).toBe("applied")
    const inc = await pullAll(u.d2, before)
    const ep = inc.changes.filter((c) => c.row.id === s.ep)
    expect(ep.at(-1)!.row.deleted).toBe(true)
    expect(inc.changes.find((c) => c.row.id === s.note)!.row.starred).toBe(true)
    const full = await pullAll(u.d2, 0)
    expect(full.changes.some((c) => c.row.id === s.ep)).toBe(false)
  })

  it("changes made while a device is paging are not lost: it converges on the server", async () => {
    const start = await pullPage(u.d2, 0, 300)
    const copy = applyChanges(new Map(), start.changes)
    // Another device edits rows the first page already brought, deletes one and adds a new one.
    const seen = start.changes.filter((c) => c.t === "note").slice(0, 3)
    for (const c of seen) await applyOne(u.d1, update("note", c.row.id, { starred: !c.row.starred }, { starred: c.row.field_seqs?.starred ?? null }))
    const victim = (await pullAll(u.d1, 0, 1000)).changes.find((c) => c.t === "link")!
    await applyOne(u.d1, link({ type: victim.row.a_type as EntityRef["type"], id: String(victim.row.a_id) }, { type: victim.row.b_type as EntityRef["type"], id: String(victim.row.b_id) }, false))
    await applyOne(u.d1, create("note", crypto.randomUUID(), { item_id: null, note_type: "idea", body: "Llega mientras se descarga" }))
    const rest = await pullAll(u.d2, start.cursor, 300)
    applyChanges(copy, rest.changes)
    const truth = applyChanges(new Map(), (await pullAll(u.d1, 0, 1000)).changes)
    expect(live(copy)).toEqual(live(truth))
  })

  it("a device that lost its copy rebuilds the same state from 0", async () => {
    const d1 = applyChanges(new Map(), (await pullAll(u.d1, 0, 400)).changes)
    const lost = applyChanges(new Map(), (await pullAll(u.d2, 0, 137)).changes)
    expect(live(lost)).toEqual(live(d1))
    const sample = [...d1.values()].find((c) => c.t === "note")!
    expect(lost.get(`note:${sample.row.id}`)!.row).toEqual(sample.row)
  })

  it("a pull waits for a library write in flight, so the cursor never skips it", async () => {
    const id = crypto.randomUUID()
    await db(async (c) => {
      await c.query("begin")
      await c.query("set local role authenticated")
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, role: "authenticated" })])
      const w = await c.query("select public.apply_ops('it-tx', $1::jsonb) r", [JSON.stringify([create("note", id, { item_id: null, note_type: "idea", body: "Escrita en una transacción lenta" })])])
      const seq = w.rows[0].r.results[0].seq as number
      // While the write is uncommitted, a pull from another device must wait instead of moving past it.
      let done = false
      const pending = pullAll(u.d2, seq - 1, 50).then((r) => ((done = true), r))
      await new Promise((r) => setTimeout(r, 700))
      expect(done).toBe(false)
      // A second write of the same user also waits: library writes commit in server_seq order.
      let second = 0
      const later = applyOne(u.d1, create("note", crypto.randomUUID(), { item_id: null, note_type: "idea", body: "Después" })).then((r) => (second = r.seq!))
      await new Promise((r) => setTimeout(r, 300))
      expect(second).toBe(0)
      await c.query("commit")
      const got = await pending
      expect(got.changes.some((ch) => ch.row.id === id)).toBe(true)
      await later
      expect(second).toBeGreaterThan(seq)
    })
  })

  it("pull_changes keeps its keys and cursor, and only announces the library head", async () => {
    const p1 = (await u.d1.rpc("pull_changes", { p_since: 0 })).data as Record<string, unknown> & { cursor: number; library: { head: number } }
    for (const k of ["habits", "entries", "rest_days", "goals", "measurements", "focus_sessions", "daily_checkins", "reviews", "profile", "dimensions", "cursor"]) expect(p1, k).toHaveProperty(k)
    expect(p1).not.toHaveProperty("library_items")
    await applyOne(u.d1, create("note", crypto.randomUUID(), { item_id: null, note_type: "idea", body: "Solo biblioteca" }))
    const p2 = (await u.d1.rpc("pull_changes", { p_since: 0 })).data as typeof p1
    expect(p2.cursor).toBe(p1.cursor)
    expect(p2.library.head).toBeGreaterThan(p1.library.head)
  })
})

describe("volume: 5.000 notes (measured, LOCAL PostgreSQL)", () => {
  let v: User
  beforeAll(async () => {
    v = await createUser("lib-volume")
  })
  afterAll(async () => removeUser(v))

  it("loads, pages and pulls incrementally", { timeout: 600_000 }, async () => {
    const lib = withUuids(syntheticLibrary(VOLUME_5K))
    const ops = libraryOps(lib)
    const tLoad = performance.now()
    const results = await apply(v.d1, ops)
    const loadMs = performance.now() - tLoad
    expect(results.filter((r) => r.status !== "applied")).toEqual([])

    const measure = async (since: number, limit: number) => {
      const t = performance.now()
      const pages: Page[] = []
      let cursor = since
      for (;;) {
        const p = await pullPage(v.d2, cursor, limit, since === 0)
        pages.push(p)
        cursor = p.cursor
        if (!p.has_more) break
      }
      const ms = performance.now() - t
      const json = pages.map((p) => JSON.stringify(p))
      return {
        ms,
        pages: pages.length,
        rows: pages.reduce((n, p) => n + p.changes.length, 0),
        bytes: json.reduce((n, j) => n + Buffer.byteLength(j), 0),
        gzipBytes: json.reduce((n, j) => n + gzipSync(j).byteLength, 0),
        cursor,
      }
    }
    const full500 = await measure(0, 500)
    const full1000 = await measure(0, 1000)
    expect(full500.rows).toBe(ops.length)

    // A few edits on another device, then the incremental pull of a device that is up to date.
    const notes = Object.values(lib.notes).slice(0, 5)
    const base = new Map((await pullAll(v.d1, 0, 1000)).changes.map((c) => [c.row.id, c]))
    for (const n of notes) await applyOne(v.d1, update("note", n.id, { starred: !n.starred }, { starred: base.get(n.id)!.row.field_seqs?.starred ?? null }))
    const incremental = await measure(full500.cursor, 500)
    expect(incremental.rows).toBe(5)

    const pc = await (async () => {
      const t = performance.now()
      const { data } = await v.d2.rpc("pull_changes", { p_since: 0 })
      return { ms: performance.now() - t, bytes: Buffer.byteLength(JSON.stringify(data)) }
    })()

    const out = {
      date: new Date().toISOString(),
      library: { shows: Object.keys(lib.shows).length, items: Object.keys(lib.items).length, notes: Object.keys(lib.notes).length, links: Object.keys(lib.links).length, ops: ops.length },
      load: { ms: loadMs, rpcs: Math.ceil(ops.length / 100) },
      fullPull500: full500,
      fullPull1000: full1000,
      incrementalAfter5Edits: incremental,
      pullChanges: pc,
    }
    console.log(JSON.stringify(out, null, 2))
    if (process.env.M4B_BENCH_OUT) writeFileSync(process.env.M4B_BENCH_OUT, JSON.stringify(out, null, 2) + "\n")
    expect(incremental.bytes).toBeLessThan(full500.bytes / 100)
  })
})
