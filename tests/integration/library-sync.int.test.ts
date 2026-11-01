import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { memoryStorage, NetworkError, SyncEngine, type SyncTransport } from "@/features/sync/engine"
import { memoryLibraryStore, type LibraryStore } from "@/features/sync/library-store"
import { supabaseTransport } from "@/features/sync/supabase-transport"
import { syntheticLibrary, VOLUME_5K } from "@/features/knowledge/domain/synthetic"
import { itemFields, noteFields, showFields } from "@/features/sync/domain/library-wire"
import type { KnowledgeState } from "@/features/knowledge/domain/types"
import { adminClient, anonClient, db } from "./setup"

/**
 * M4c · the real SyncEngine with the real Supabase transport against LOCAL PostgreSQL: first sync,
 * incremental pulls, cuts between pages, reopening, two devices, conflicts kept across reopening,
 * remote deletes with offline edits, a lost device copy and two accounts.
 */

interface User {
  id: string
  email: string
  password: string
}

async function createUser(label: string): Promise<User> {
  const email = `it-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@theonepercent.local`
  const password = `pw-${Math.random().toString(36).slice(2)}-A1!`
  await db((c) => c.query("insert into private.allowed_emails (email, note) values ($1, 'integration test')", [email]))
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("createUser failed")
  return { id: data.user.id, email, password }
}
async function removeUser(u: User) {
  await adminClient().auth.admin.deleteUser(u.id)
  await db((c) => c.query("delete from private.allowed_emails where email = $1", [u.email]))
}
async function client(u: User): Promise<SupabaseClient> {
  const c = anonClient()
  const s = await c.auth.signInWithPassword({ email: u.email, password: u.password })
  if (s.error) throw s.error
  return c
}

/** A device: its own session, its own main record and library copy (unless shared, like two tabs). */
async function device(u: User, opts: { storage?: ReturnType<typeof memoryStorage>; store?: LibraryStore; pageSize?: number; cutAtPage?: number } = {}) {
  const sb = await client(u)
  const real = supabaseTransport(sb)
  let pages = 0
  const state = { online: true }
  const t: SyncTransport = {
    applyOps: (d, ops) => (state.online ? real.applyOps(d, ops) : Promise.reject(new NetworkError("offline"))),
    pull: (s) => (state.online ? real.pull(s) : Promise.reject(new NetworkError("offline"))),
    pullLibrary: async (s, l, u2) => {
      if (!state.online) throw new NetworkError("offline")
      if (opts.cutAtPage && ++pages === opts.cutAtPage) throw new NetworkError("connection cut between pages")
      return real.pullLibrary!(s, l, u2)
    },
  }
  const storage = opts.storage ?? memoryStorage()
  const store = opts.store ?? memoryLibraryStore()
  const engine = new SyncEngine({ transport: t, storage, library: store, libraryPageSize: opts.pageSize ?? 1000, deviceId: `it-${Math.random().toString(36).slice(2, 8)}`, schedule: () => () => {} })
  await engine.start()
  return { engine, storage, store, net: state }
}

async function settle(e: SyncEngine) {
  const running = () => (e as unknown as { running: Promise<void> | null }).running
  await e.sync()
  for (let i = 0; i < 20 && running(); i++) await running()
}

/** The ops that write a whole library (same wire format the engine sends). */
function writeOps(lib: KnowledgeState) {
  const at = new Date().toISOString()
  let n = 0
  const op = (type: string, id: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type, op_id: `seed-${Date.now()}-${++n}`, id, fields, at, ...extra })
  return [
    ...Object.values(lib.shows).map((s) => op("library.show.create", s.id, showFields(s))),
    ...Object.values(lib.items).map((i) => op("library.item.create", i.id, itemFields(i), { kind: i.kind })),
    ...Object.values(lib.notes).map((x) => op("library.note.create", x.id, noteFields(x), { captured_at: x.createdAt })),
  ]
}

/** The synthetic library with uuid ids (the database requires them). */
function withUuids(s: KnowledgeState): KnowledgeState {
  const map = new Map<string, string>()
  const id = (x: string) => map.get(x) ?? (map.set(x, crypto.randomUUID()), map.get(x)!)
  return {
    shows: Object.fromEntries(Object.values(s.shows).map((x) => [id(x.id), { ...x, id: id(x.id) }])),
    items: Object.fromEntries(
      Object.values(s.items).map((i) => [id(i.id), i.kind === "episode" ? { ...i, id: id(i.id), episode: { ...i.episode, showId: i.episode.showId ? id(i.episode.showId) : null } } : { ...i, id: id(i.id) }])
    ),
    notes: Object.fromEntries(Object.values(s.notes).map((n) => [id(n.id), { ...n, id: id(n.id), itemId: n.itemId ? id(n.itemId) : null }])),
    links: {},
  }
}

const notesOf = (e: SyncEngine) => e.getSnapshot().library.notes
const serverNote = async (id: string) => (await db((c) => c.query("select body, starred, deleted_at is not null as gone, item_id from public.knowledge_notes where id = $1", [id]))).rows[0]

let small: User
let big: User
let other: User
let bookId: string

beforeAll(async () => {
  small = await createUser("libsync")
  big = await createUser("libsync-5k")
  other = await createUser("libsync-other")
  const d = await device(small)
  bookId = d.engine.libraryCreate("item", { title: "Libro compartido", page_count: 300 }, { kind: "book" })
  for (let i = 0; i < 30; i++) d.engine.libraryCreate("note", { item_id: bookId, note_type: "idea", body: `Idea ${i}` })
  await settle(d.engine)
  expect(d.engine.getSnapshot().librarySync).toMatchObject({ state: "synced", pending: 0 })
})
afterAll(async () => {
  for (const u of [small, big, other]) await removeUser(u)
})

describe("A/B · first sync of 5.000 notes and incremental pulls (real server)", () => {
  it("5.000 notes on the server: a new device builds its copy, then pulls only five edits", { timeout: 600_000 }, async () => {
    const lib = withUuids(syntheticLibrary(VOLUME_5K))
    // Seeded straight through apply_ops (bulk writes through the engine's queue are not the use
    // case: see the M4c report). The engine is measured where it matters: a device's first sync.
    const sb = await client(big)
    const ops = writeOps(lib)
    for (let i = 0; i < ops.length; i += 100) {
      const { error } = await sb.rpc("apply_ops", { p_device_id: "it-seed", p_ops: ops.slice(i, i + 100) })
      if (error) throw error
    }
    const writer = await device(big)
    expect(writer.engine.getSnapshot().librarySync).toMatchObject({ state: "synced", pending: 0 })

    const t1 = performance.now()
    const reader = await device(big)
    const firstSyncMs = performance.now() - t1
    expect(Object.keys(notesOf(reader.engine))).toHaveLength(5_000)
    expect(reader.engine.getSnapshot().librarySync).toMatchObject({ state: "synced", phase: "idle" })

    const ids = Object.keys(lib.notes).slice(0, 5)
    for (const id of ids) writer.engine.libraryUpdate("note", id, { starred: true })
    await settle(writer.engine)
    const writes = (reader.store as ReturnType<typeof memoryLibraryStore>).writes
    const t2 = performance.now()
    await settle(reader.engine)
    const incrementalMs = performance.now() - t2
    expect((reader.store as ReturnType<typeof memoryLibraryStore>).writes - writes).toBe(5)
    for (const id of ids) expect(notesOf(reader.engine)[id].starred).toBe(true)
    console.log(JSON.stringify({ engineFirstSync5kMs: Math.round(firstSyncMs), engineIncremental5Ms: Math.round(incrementalMs), pages: Math.ceil(5_600 / 1000) }))
  })
})

describe("C/E · cuts between pages and reopening mid-download", () => {
  it("a cut keeps the stored pages; reopening resumes from them (with the rebuild's limit) and converges", async () => {
    const store = memoryLibraryStore()
    const storage = memoryStorage()
    const cut = await device(small, { store, storage, pageSize: 10, cutAtPage: 2 })
    expect(store.data.meta).toMatchObject({ complete: false })
    const stored = store.data.meta!.cursor
    expect(store.data.rows.note.size + store.data.rows.item.size).toBe(10)
    cut.engine.stop()
    // Deleted elsewhere while this device was closed: a row its first page already brought.
    const victim = [...store.data.rows.note.keys()][0]
    const killer = await device(small)
    expect(killer.engine.libraryDelete("note", victim)).toEqual({ ok: true })
    await settle(killer.engine)
    const reopened = await device(small, { store, storage, pageSize: 10 })
    expect(store.data.meta!.cursor).toBeGreaterThan(stored)
    expect(notesOf(reopened.engine)[victim]).toBeUndefined()
    expect(Object.keys(notesOf(reopened.engine)).sort()).toEqual(Object.keys(notesOf(killer.engine)).sort())
    expect(reopened.engine.getSnapshot().librarySync.state).toBe("synced")
  })
})

describe("F/G/H/J · two devices of one account", () => {
  it("F · different notes from two devices: both kept everywhere", async () => {
    const [a, b] = [await device(small), await device(small)]
    const x = a.engine.libraryCreate("note", { item_id: bookId, note_type: "idea", body: "Desde A" })
    const y = b.engine.libraryCreate("note", { item_id: bookId, note_type: "learning", body: "Desde B" })
    await settle(a.engine)
    await settle(b.engine)
    await settle(a.engine)
    for (const d of [a, b]) expect(Object.keys(notesOf(d.engine))).toEqual(expect.arrayContaining([x, y]))
  })

  it("G/H · the same note on two devices: both versions kept across reopening, «Guardar las dos» keeps both", async () => {
    const a = await device(small)
    const b = await device(small)
    const id = Object.keys(notesOf(a.engine))[0]
    a.engine.libraryUpdate("note", id, { body: "Versión del móvil" })
    await settle(a.engine)
    b.engine.libraryUpdate("note", id, { body: "Versión del ordenador" })
    await settle(b.engine)
    expect(b.engine.getSnapshot().notices).toMatchObject([{ code: "field_conflict", op: { fields: { body: "Versión del ordenador" } } }])
    expect((await serverNote(id)).body).toBe("Versión del móvil")
    // Closed and reopened: the kept text comes back from the device's main record.
    b.engine.stop()
    const reopened = await device(small, { storage: b.storage, store: b.store })
    const [n] = reopened.engine.getSnapshot().notices
    expect(n).toMatchObject({ code: "field_conflict" })
    expect(reopened.engine.resolveLibraryText(n.id, "both")).toBe(true)
    await settle(reopened.engine)
    const bodies = Object.values(notesOf(reopened.engine)).map((x) => x.body)
    expect(bodies).toEqual(expect.arrayContaining(["Versión del móvil", "Versión del ordenador"]))
    await settle(reopened.engine)
    expect(reopened.engine.getSnapshot().notices).toEqual([])
  })

  it("J · a note deleted on one device while another edits it offline: kept, then restored explicitly", async () => {
    const a = await device(small)
    const b = await device(small)
    const id = Object.keys(notesOf(a.engine)).at(-1)!
    b.net.online = false
    b.engine.libraryUpdate("note", id, { body: "Edición sin conexión" })
    expect(a.engine.libraryDelete("note", id)).toEqual({ ok: true })
    await settle(a.engine)
    expect((await serverNote(id)).gone).toBe(true)
    b.net.online = true
    await settle(b.engine)
    const [n] = b.engine.getSnapshot().notices
    expect(n).toMatchObject({ code: "deleted", op: { fields: { body: "Edición sin conexión" } } })
    expect((await serverNote(id)).gone).toBe(true)
    expect(b.engine.resolveLibraryText(n.id, "restore")).toBe(true)
    await settle(b.engine)
    expect(await serverNote(id)).toMatchObject({ gone: false, body: "Edición sin conexión", item_id: bookId })
  })
})

/** The text a kept library notice holds. */
const bodyOf = (n: { op?: unknown }) => (n.op as { fields: { body: string } }).fields.body

describe("M · the same work added offline on two devices (M4g.3)", () => {
  it("the second copy is refused as a duplicate; nothing is lost and its notes can be saved on the existing book", async () => {
    const a = await device(small)
    const b = await device(small)
    a.net.online = false
    b.net.online = false
    const work = { external_provider: "openlibrary", external_id: "OL20770492W", external_attribution: "Datos: Open Library" }
    const bookA = a.engine.libraryCreate("item", { title: "El infinito en un junco", ...work }, { kind: "book" })
    const bookB = b.engine.libraryCreate("item", { title: "El infinito en un junco", isbn13: "9788417860790", ...work }, { kind: "book" })
    const noteA = a.engine.libraryCreate("note", { item_id: bookA, note_type: "idea", body: "Idea escrita en A" })
    const noteB = b.engine.libraryCreate("note", { item_id: bookB, note_type: "quote", body: "Cita escrita en B", page: 12 })
    b.engine.libraryCreate("note", { item_id: bookB, note_type: "idea", body: "Otra idea de B" })
    a.net.online = true
    await settle(a.engine)
    b.net.online = true
    await settle(b.engine)

    // The server keeps one record of the work (A's) and nothing of B's copy.
    const live = await db((c) => c.query("select id from public.library_items where user_id = $1 and external_id = 'OL20770492W' and deleted_at is null", [small.id]))
    expect(live.rows.map((r) => r.id)).toEqual([bookA])
    expect(await serverNote(noteB)).toBeUndefined()
    expect(await serverNote(noteA)).toMatchObject({ body: "Idea escrita en A", item_id: bookA })

    // B is told why, and both of its notes are kept whole, waiting for a decision.
    const notices = b.engine.getSnapshot().notices
    expect(notices.find((n) => n.op && "id" in n.op && n.op.id === bookB)).toMatchObject({ code: "duplicate_external", kind: "rejected" })
    const kept = notices.filter((n) => n.code === "item_deleted")
    expect(kept.map((n) => bodyOf(n)).sort()).toEqual(["Cita escrita en B", "Otra idea de B"])
    expect(b.engine.getSnapshot().library.items[bookA]).toBeDefined()
    expect(b.engine.getSnapshot().library.items[bookB]).toBeUndefined()

    // Durable until decided: closing and reopening the device keeps the duplicate's notice and both notes.
    b.engine.stop()
    const again = await device(small, { storage: b.storage, store: b.store })
    const reopened = again.engine
    expect(reopened.getSnapshot().notices.map((n) => n.code).sort()).toEqual(["duplicate_external", "item_deleted", "item_deleted"])
    expect(reopened.getSnapshot().notices.filter((n) => n.code === "item_deleted").map(bodyOf).sort()).toEqual(["Cita escrita en B", "Otra idea de B"])

    // «Guardar en el libro existente»: the quote, with its page, now belongs to A's book.
    const keptAgain = reopened.getSnapshot().notices.filter((n) => n.code === "item_deleted")
    const quote = keptAgain.find((n) => bodyOf(n) === "Cita escrita en B")!
    expect(reopened.resolveLibraryText(quote.id, "existing", bookB)).toBe(false)
    expect(reopened.resolveLibraryText(quote.id, "existing", bookA)).toBe(true)
    // A second tap finds nothing left to decide: the note cannot be written twice.
    expect(reopened.resolveLibraryText(quote.id, "existing", bookA)).toBe(false)
    // The other one as a free idea: also nothing lost.
    const idea = keptAgain.find((n) => n !== quote)!
    expect(reopened.resolveLibraryText(idea.id, "free")).toBe(true)
    await settle(reopened)
    const onA = await db((c) => c.query("select body, page, item_id from public.knowledge_notes where user_id = $1 and body = 'Cita escrita en B' and deleted_at is null", [small.id]))
    expect(onA.rows).toEqual([{ body: "Cita escrita en B", page: 12, item_id: bookA }])
    const free = await db((c) => c.query("select item_id from public.knowledge_notes where user_id = $1 and body = 'Otra idea de B' and deleted_at is null", [small.id]))
    expect(free.rows).toEqual([{ item_id: null }])

    // The duplicate's own notice only informs; dismissing it leaves no pending texts.
    const dup = reopened.getSnapshot().notices.find((n) => n.code === "duplicate_external")!
    expect(reopened.resolveLibraryText(dup.id, "theirs")).toBe(true)
    await settle(reopened)
    expect(reopened.getSnapshot().notices).toEqual([])
    await settle(a.engine)
    expect(Object.values(notesOf(a.engine)).filter((n) => n.itemId === bookA).map((n) => n.body).sort()).toEqual(["Cita escrita en B", "Idea escrita en A"])
  })
})

describe("K/L · lost copy and two accounts", () => {
  it("K · the library copy is lost while edits wait offline: it is rebuilt and the edits still reach the server once", async () => {
    const d = await device(small)
    d.net.online = false
    const id = d.engine.libraryCreate("note", { item_id: bookId, note_type: "question", body: "Pendiente sin copia" })
    await settle(d.engine)
    d.engine.stop()
    const rebuilt = await device(small, { storage: d.storage, store: memoryLibraryStore() })
    expect(notesOf(rebuilt.engine)[id]?.body).toBe("Pendiente sin copia")
    expect(rebuilt.engine.getSnapshot().librarySync).toMatchObject({ state: "synced", pending: 0 })
    expect((await serverNote(id)).body).toBe("Pendiente sin copia")
  })

  it("L · another account's device sees nothing of this library and cannot touch it", async () => {
    const o = await device(other)
    await settle(o.engine)
    expect(o.engine.getSnapshot().library.notes).toEqual({})
    o.engine.libraryUpdate("item", bookId, { title: "Ajeno" })
    await settle(o.engine)
    expect(o.engine.getSnapshot().notices).toMatchObject([{ kind: "rejected" }])
    expect((await db((c) => c.query("select title from public.library_items where id = $1", [bookId]))).rows[0].title).toBe("Libro compartido")
  })
})
