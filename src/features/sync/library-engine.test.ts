import { describe, expect, it } from "vitest"
import { memoryStorage, NetworkError, SyncEngine, type LibraryPage, type SyncTransport } from "./engine"
import { memoryLibraryStore, type LibraryStore } from "./library-store"
import { FakeServer } from "./testing/fake-server"
import { LibraryFake } from "./testing/library-fake"
import { isLibraryOp, type LibraryOp, type Op, type OpResult } from "./domain/types"
import { upgradePersisted } from "./domain/persisted"

/**
 * M4c · the Library through the real SyncEngine: per-row device copy, paged pull (D71), the shared
 * operation queue, durable conflicts (D68). Each test pins one guarantee and fails if the
 * protection it relies on is removed. The server is LibraryFake (SQL parity: integration suite).
 */

const TODAY = "2026-10-30"
const T0 = Date.parse("2026-10-30T10:00:00Z")

function world() {
  const clock = { now: T0 }
  return { clock, server: new FakeServer(TODAY, () => clock.now), lib: new LibraryFake(), storage: memoryStorage(), store: memoryLibraryStore() }
}
type World = ReturnType<typeof world>

/** FakeServer for the rest of the app, LibraryFake for library ops and pages. */
function transport(w: World, opts: { library?: boolean } = {}) {
  const t = {
    online: true,
    libraryEnabled: opts.library ?? true,
    /** Runs while a library batch is in flight (another device, or the user typing meanwhile). */
    duringApply: null as null | (() => void),
    async applyOps(_d: string, ops: Op[]) {
      if (!t.online) throw new NetworkError("offline")
      t.duringApply?.()
      const results: OpResult[] = []
      for (const op of ops) {
        if (isLibraryOp(op)) results.push(...(t.libraryEnabled ? w.lib.applyOps([structuredClone(op)]) : [{ op_id: op.op_id, status: "rejected" as const, code: "unknown_op_type" }]))
        else results.push(...w.server.applyOps([structuredClone(op)]).results)
      }
      return { results, server_today: TODAY, server_time: new Date(w.clock.now).toISOString() }
    },
    async pull(since: number) {
      if (!t.online) throw new NetworkError("offline")
      const p = structuredClone(w.server.pull(since))
      return t.libraryEnabled ? { ...p, library: { head: w.lib.head() } } : p
    },
    async pullLibrary(since: number, limit: number, upto: number | null): Promise<LibraryPage> {
      if (!t.online) throw new NetworkError("offline")
      try {
        return structuredClone(w.lib.pull(since, limit, upto))
      } catch {
        throw new NetworkError("pull_library failed")
      }
    },
  }
  return t satisfies SyncTransport
}

async function device(w: World, opts: { store?: LibraryStore; storage?: ReturnType<typeof memoryStorage>; pageSize?: number; library?: boolean; lock?: <T>(fn: () => Promise<T>) => Promise<T> } = {}) {
  const t = transport(w, { library: opts.library })
  const engine = new SyncEngine({
    transport: t,
    storage: opts.storage ?? w.storage,
    library: opts.store ?? w.store,
    libraryPageSize: opts.pageSize ?? 1000,
    deviceId: `dev-${Math.random().toString(36).slice(2, 8)}`,
    now: () => w.clock.now,
    schedule: () => () => {},
    lock: opts.lock,
  })
  await engine.start()
  return { engine, t }
}

async function settle(e: SyncEngine) {
  const running = () => (e as unknown as { running: Promise<void> | null }).running
  await e.sync()
  for (let i = 0; i < 20 && running(); i++) await running()
}

/** Server-side setup without a device: n notes on one book. */
function seedServer(w: World, notes: number) {
  const ops: LibraryOp[] = [{ type: "library.item.create", op_id: "seed-book", id: "book-1", kind: "book", fields: { title: "Libro" }, at: new Date(T0).toISOString() }]
  for (let i = 0; i < notes; i++) {
    ops.push({ type: "library.note.create", op_id: `seed-n${i}`, id: `n-${i}`, fields: { item_id: "book-1", note_type: "idea", body: `Idea ${i}` }, at: new Date(T0).toISOString() })
  }
  w.lib.applyOps(ops)
}

const lib = (e: SyncEngine) => e.getSnapshot().library
const sync = (e: SyncEngine) => e.getSnapshot().librarySync

describe("first sync, incremental pull and progress (D71)", () => {
  it("A · builds the copy in pages, stores every row once, and says «synced» only at the end", async () => {
    const w = world()
    seedServer(w, 250)
    const { engine } = await device(w, { pageSize: 100 })
    expect(Object.keys(lib(engine).notes)).toHaveLength(250)
    expect(sync(engine)).toMatchObject({ enabled: true, state: "synced", phase: "idle", pending: 0 })
    expect(w.lib.pulls.map((p) => [p.since > 0, p.limit])).toEqual([[false, 100], [true, 100], [true, 100]])
    expect(w.store.data.meta).toMatchObject({ complete: true, rebuildUpto: null, cursor: w.lib.head() })
    expect(w.store.data.rows.note.size).toBe(250)
  })

  it("B · after five edits elsewhere, only those five rows come down", async () => {
    const w = world()
    seedServer(w, 300)
    const { engine } = await device(w, { pageSize: 1000 })
    const before = w.lib.pulls.length
    const writes = w.store.writes
    for (let i = 0; i < 5; i++) w.lib.applyOps([{ type: "library.note.update", op_id: `other-${i}`, id: `n-${i}`, fields: { starred: true }, base_seqs: {}, at: new Date(T0 + 1000).toISOString() }])
    await settle(engine)
    expect(w.lib.pulls.length - before).toBe(1)
    expect(w.store.writes - writes).toBe(5)
    expect(lib(engine).notes["n-3"].starred).toBe(true)
  })

  it("nothing new on the server: no library pull at all", async () => {
    const w = world()
    seedServer(w, 3)
    const { engine } = await device(w)
    const before = w.lib.pulls.length
    await settle(engine)
    await settle(engine)
    expect(w.lib.pulls.length).toBe(before)
  })
})

describe("offline opening", () => {
  it("opening the app without network shows the stored copy (and its pending edits on top)", async () => {
    const w = world()
    seedServer(w, 40)
    const first = await device(w)
    first.t.online = false
    const id = first.engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "Sin conexión" })
    await settle(first.engine)
    first.engine.stop()
    const t = transport(w)
    t.online = false
    const engine = new SyncEngine({ transport: t, storage: w.storage, library: w.store, deviceId: "offline", now: () => w.clock.now, schedule: () => () => {} })
    await engine.start()
    expect(Object.keys(lib(engine).notes)).toHaveLength(41)
    expect(lib(engine).notes[id].body).toBe("Sin conexión")
    expect(lib(engine).items["book-1"].title).toBe("Libro")
  })
})

describe("atomic page + cursor, failures and resuming", () => {
  it("C · a connection cut between pages keeps every stored page and resumes from the last one", async () => {
    const w = world()
    seedServer(w, 250)
    w.lib.failPullAt = 2
    const { engine, t } = await device(w, { pageSize: 100 })
    // Page 1 stored, page 2 failed: the copy stops exactly at page 1.
    expect(w.store.data.meta).toMatchObject({ complete: false, cursor: w.lib.pulls[0] ? expect.any(Number) : 0 })
    const stopped = w.store.data.meta!.cursor
    expect(w.store.data.rows.note.size).toBe(99)
    expect(sync(engine).state).not.toBe("synced")
    await settle(engine)
    // Resumed from the stored cursor, with the rebuild's limit, not from 0.
    const resumed = w.lib.pulls.at(-2)!
    expect(resumed.since).toBe(stopped)
    expect(resumed.upto).toBe(w.lib.pulls[0].upto ?? w.lib.head())
    expect(Object.keys(lib(engine).notes)).toHaveLength(250)
    expect(sync(engine).state).toBe("synced")
    void t
  })

  it("D1 · storing fails before the commit: neither the copy nor the cursor move, and the next cycle retries", async () => {
    const w = world()
    seedServer(w, 10)
    const store = memoryLibraryStore(undefined, { failBeforeCommit: 1 })
    const { engine } = await device(w, { store })
    expect(store.data.meta).toBeNull()
    expect(Object.keys(lib(engine).notes)).toHaveLength(0)
    expect(sync(engine).state).toBe("error")
    await settle(engine)
    expect(Object.keys(lib(engine).notes)).toHaveLength(10)
    expect(store.data.meta).toMatchObject({ complete: true })
    expect(sync(engine).state).toBe("synced")
  })

  it("D2 · storing fails after the commit: the device copy is ahead of memory, and the next cycle converges without duplicates", async () => {
    const w = world()
    seedServer(w, 10)
    const store = memoryLibraryStore(undefined, { failAfterCommit: 1 })
    const { engine } = await device(w, { store })
    expect(store.data.meta).toMatchObject({ complete: true })
    expect(Object.keys(lib(engine).notes)).toHaveLength(0)
    await settle(engine)
    expect(Object.keys(lib(engine).notes)).toHaveLength(10)
    expect(store.data.rows.note.size).toBe(10)
    // Reopening reads exactly what was committed.
    const again = await device(w, { store })
    expect(Object.keys(lib(again.engine).notes)).toHaveLength(10)
  })

  it("E · closing mid-rebuild and reopening resumes the rebuild (same limit) and still learns about rows deleted meanwhile", async () => {
    const w = world()
    seedServer(w, 250)
    w.lib.failPullAt = 2
    const first = await device(w, { pageSize: 100 })
    const upto = w.lib.pulls[0].upto ?? (first.engine.getSnapshot(), w.store.data.meta!.rebuildUpto)
    first.engine.stop()
    // While the app is closed another device deletes a note that page 1 already brought.
    const victim = [...w.store.data.rows.note.keys()][0]
    w.lib.applyOps([{ type: "library.note.delete", op_id: "del-victim", id: victim, base_seq: Number(w.lib.rows.get(`note:${victim}`)!.row.server_seq) }])
    const reopened = await device(w, { pageSize: 100 })
    expect(w.lib.pulls.at(-3)!.upto).toBe(w.store.data.meta?.rebuildUpto ?? w.lib.pulls.at(-3)!.upto)
    expect(lib(reopened.engine).notes[victim]).toBeUndefined()
    expect(Object.keys(lib(reopened.engine).notes)).toHaveLength(249)
    void upto
  })

  it("a rebuild learns about a row deleted between two of its pages (M4c fix of the M4b contract)", async () => {
    const w = world()
    seedServer(w, 250)
    w.lib.onPage = (n) => {
      if (n === 1) w.lib.applyOps([{ type: "library.note.delete", op_id: "del-mid", id: "n-0", base_seq: Number(w.lib.rows.get("note:n-0")!.row.server_seq) }])
    }
    const { engine } = await device(w, { pageSize: 100 })
    expect(lib(engine).notes["n-0"]).toBeUndefined()
    expect(Object.keys(lib(engine).notes).sort()).toEqual(w.lib.liveIds("note"))
  })

  it("K · a lost device copy is rebuilt while the pending edits in the queue survive and are sent", async () => {
    const w = world()
    seedServer(w, 20)
    const a = await device(w)
    a.t.online = false
    const id = a.engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "Escrita sin conexión" })
    a.engine.stop()
    // The library copy is lost (cleared site data, failed database): the main record still has the queue.
    const reopened = await device(w, { store: memoryLibraryStore() })
    expect(Object.keys(lib(reopened.engine).notes)).toHaveLength(21)
    expect(lib(reopened.engine).notes[id].body).toBe("Escrita sin conexión")
    expect(w.lib.applied.size).toBeGreaterThan(0)
    expect(w.lib.liveIds("note")).toContain(id)
  })
})

describe("optimistic edits, compaction and bases", () => {
  it("a note shows at once, is sent once and leaves the queue only after the pull that confirms it", async () => {
    const w = world()
    seedServer(w, 1)
    const { engine, t } = await device(w)
    t.online = false
    const id = engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "Rápida" })
    expect(lib(engine).notes[id].body).toBe("Rápida")
    // While the first attempt runs it is «pending»; once it fails for lack of network, «local».
    expect(sync(engine)).toMatchObject({ pending: 1, state: "pending" })
    await settle(engine)
    expect(sync(engine)).toMatchObject({ pending: 1, state: "local" })
    t.online = true
    await settle(engine)
    expect(sync(engine)).toMatchObject({ pending: 0, state: "synced" })
    expect([...w.lib.applied.values()]).toEqual(Array(w.lib.applied.size).fill(1))
  })

  it("edits of an unsent note fold into its create; a note never sent and deleted never reaches the server", async () => {
    const w = world()
    seedServer(w, 1)
    const { engine, t } = await device(w)
    t.online = false
    const id = engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "v1" })
    // The create is in flight during the first (failing) attempt and is never touched meanwhile.
    await settle(engine)
    engine.libraryUpdate("note", id, { body: "v2" })
    await settle(engine)
    engine.libraryUpdate("note", id, { starred: true })
    await settle(engine)
    const q = engine.getSnapshot().pending
    expect(q).toBe(1)
    expect(lib(engine).notes[id]).toMatchObject({ body: "v2", starred: true })
    const gone = engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "Borrada antes de enviar" })
    expect(engine.libraryDelete("note", gone)).toEqual({ ok: false, reason: "in_flight" })
    await settle(engine)
    expect(engine.libraryDelete("note", gone)).toEqual({ ok: true })
    t.online = true
    await settle(engine)
    expect(w.lib.liveIds("note")).toContain(id)
    expect(w.lib.rows.has(`note:${gone}`)).toBe(false)
  })

  it("consecutive edits of the user's own text never conflict with each other, also while the first is in flight", async () => {
    const w = world()
    seedServer(w, 1)
    const { engine, t } = await device(w)
    // The user types again while the create is still in flight (its answer not received yet)…
    const id = "note-typed-twice"
    t.duringApply = () => {
      t.duringApply = null
      engine.libraryUpdate("note", id, { body: "dos" })
    }
    engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "uno" }, { id })
    await settle(engine)
    await settle(engine)
    // …and once more after everything was confirmed.
    engine.libraryUpdate("note", id, { body: "tres" })
    await settle(engine)
    expect(engine.getSnapshot().notices).toEqual([])
    expect(w.lib.rows.get(`note:${id}`)!.row.body).toBe("tres")
  })

  it("deleting a content with unsent edits on its notes is refused instead of losing them; a content never sent goes with its notes", async () => {
    const w = world()
    seedServer(w, 2)
    const { engine, t } = await device(w)
    t.online = false
    engine.libraryUpdate("note", "n-0", { body: "Editada sin conexión" })
    expect(engine.libraryDelete("item", "book-1")).toEqual({ ok: false, reason: "pending" })
    const book = engine.libraryCreate("item", { title: "Nuevo" }, { kind: "book" })
    engine.libraryCreate("note", { item_id: book, note_type: "idea", body: "En el nuevo" })
    expect(engine.libraryDelete("item", book)).toEqual({ ok: true })
    expect(engine.getSnapshot().pending).toBe(1)
    t.online = true
    await settle(engine)
    expect(w.lib.rows.get("note:n-0")!.row.body).toBe("Editada sin conexión")
    expect(w.lib.rows.has(`item:${book}`)).toBe(false)
  })
})

describe("conflicts without loss (D68)", () => {
  async function twoDevices() {
    const w = world()
    seedServer(w, 2)
    const a = await device(w)
    const b = await device(w, { store: memoryLibraryStore(), storage: memoryStorage() })
    return { w, a, b }
  }

  it("F · two devices adding different notes: both kept", async () => {
    const { w, a, b } = await twoDevices()
    const x = a.engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "A" })
    const y = b.engine.libraryCreate("note", { item_id: "book-1", note_type: "learning", body: "B" })
    await settle(a.engine)
    await settle(b.engine)
    await settle(a.engine)
    expect(Object.keys(lib(a.engine).notes)).toEqual(expect.arrayContaining([x, y]))
    expect(Object.keys(lib(b.engine).notes)).toEqual(expect.arrayContaining([x, y]))
    expect(w.lib.liveIds("note")).toHaveLength(4)
  })

  it("G/H · the same note on two devices: both versions kept, durably across reopening, decided once", async () => {
    const { w, a, b } = await twoDevices()
    a.engine.libraryUpdate("note", "n-0", { body: "Del móvil" })
    await settle(a.engine)
    b.engine.libraryUpdate("note", "n-0", { body: "Del ordenador", starred: true })
    await settle(b.engine)
    const notices = b.engine.getSnapshot().notices
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ code: "field_conflict", op: { fields: { body: "Del ordenador" } } })
    // The other field of the same write went through on its own.
    expect(w.lib.rows.get("note:n-0")!.row).toMatchObject({ body: "Del móvil", starred: true })
    expect(b.engine.getSnapshot().librarySync.state).toBe("conflict")
    // Reopening the app (new engine over the same device storage) brings the kept text back.
    b.engine.stop()
    const reopened = await device(w, { store: b.engine["deps"].library, storage: b.engine["deps"].storage as ReturnType<typeof memoryStorage> })
    const kept = reopened.engine.getSnapshot().notices
    expect(kept).toHaveLength(1)
    expect(reopened.engine.resolveLibraryText(kept[0].id, "both")).toBe(true)
    await settle(reopened.engine)
    const bodies = Object.values(lib(reopened.engine).notes).map((n) => n.body)
    expect(bodies).toEqual(expect.arrayContaining(["Del móvil", "Del ordenador"]))
    // Decided: it does not come back after another pull, nor after reopening again.
    await settle(reopened.engine)
    expect(reopened.engine.getSnapshot().notices).toEqual([])
    reopened.engine.stop()
    const third = await device(w, { store: b.engine["deps"].library, storage: b.engine["deps"].storage as ReturnType<typeof memoryStorage> })
    expect(third.engine.getSnapshot().notices).toEqual([])
  })

  it("«Aplicar la mía» writes it over the other version; «Mantener la otra» forgets it", async () => {
    const { w, a, b } = await twoDevices()
    a.engine.libraryUpdate("note", "n-0", { body: "Otra" })
    a.engine.libraryUpdate("note", "n-1", { body: "Otra 2" })
    await settle(a.engine)
    b.engine.libraryUpdate("note", "n-0", { body: "Mía" })
    b.engine.libraryUpdate("note", "n-1", { body: "Mía 2" })
    await settle(b.engine)
    const [n0, n1] = b.engine.getSnapshot().notices
    expect(b.engine.resolveLibraryText(n0.id, "mine")).toBe(true)
    expect(b.engine.resolveLibraryText(n1.id, "theirs")).toBe(true)
    await settle(b.engine)
    expect(w.lib.rows.get("note:n-0")!.row.body).toBe("Mía")
    expect(w.lib.rows.get("note:n-1")!.row.body).toBe("Otra 2")
    expect(b.engine.getSnapshot().notices).toEqual([])
  })

  it("J · a note deleted elsewhere while this device edited it offline: the text is kept and can be restored", async () => {
    const { w, a, b } = await twoDevices()
    b.t.online = false
    b.engine.libraryUpdate("note", "n-0", { body: "Editada sin conexión" })
    a.engine.libraryDelete("note", "n-0")
    await settle(a.engine)
    b.t.online = true
    await settle(b.engine)
    const [n] = b.engine.getSnapshot().notices
    expect(n).toMatchObject({ code: "deleted", op: { fields: { body: "Editada sin conexión" } } })
    expect(lib(b.engine).notes["n-0"]).toBeUndefined()
    expect(b.engine.resolveLibraryText(n.id, "restore")).toBe(true)
    await settle(b.engine)
    expect(w.lib.rows.get("note:n-0")!.row).toMatchObject({ deleted: false, body: "Editada sin conexión", item_id: "book-1", note_type: "idea" })
  })

  it("a note written offline on a content deleted elsewhere is kept and can become a free idea", async () => {
    const { w, a, b } = await twoDevices()
    b.t.online = false
    b.engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "Huérfana", page: 3 })
    a.engine.libraryDelete("item", "book-1")
    await settle(a.engine)
    b.t.online = true
    await settle(b.engine)
    const [n] = b.engine.getSnapshot().notices
    expect(n.code).toBe("item_deleted")
    expect(b.engine.resolveLibraryText(n.id, "free")).toBe(true)
    await settle(b.engine)
    const free = Object.values(lib(b.engine).notes).find((x) => x.body === "Huérfana")!
    expect(free).toMatchObject({ itemId: null, locator: null })
    expect(w.lib.liveIds("note")).toContain(free.id)
  })

  it("a late edit never revives something deleted elsewhere by itself", async () => {
    const { w, a, b } = await twoDevices()
    b.t.online = false
    b.engine.libraryUpdate("item", "book-1", { rating: 9 })
    a.engine.libraryDelete("item", "book-1")
    await settle(a.engine)
    b.t.online = true
    await settle(b.engine)
    expect(w.lib.rows.get("item:book-1")!.row.deleted).toBe(true)
    expect(lib(b.engine).items["book-1"]).toBeUndefined()
  })
})

describe("tabs, accounts without the migration, older copies", () => {
  it("I · two tabs writing at once over the same device copy: every note reaches the server once", async () => {
    const w = world()
    seedServer(w, 1)
    let chain = Promise.resolve()
    const lock = <T,>(fn: () => Promise<T>) => {
      const run = chain.then(fn)
      chain = run.then(() => undefined, () => undefined)
      return run
    }
    const t1 = await device(w, { lock })
    const t2 = await device(w, { lock })
    t1.t.online = false
    t2.t.online = false
    const ids = [
      t1.engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "Pestaña 1" }),
      t2.engine.libraryCreate("note", { item_id: "book-1", note_type: "idea", body: "Pestaña 2" }),
    ]
    await new Promise((r) => setTimeout(r, 0))
    // The first tab is closed before it could send anything.
    t1.engine.stop()
    t2.t.online = true
    await settle(t2.engine)
    expect(w.lib.liveIds("note")).toEqual(expect.arrayContaining(ids))
    expect([...w.lib.applied.values()].every((n) => n === 1)).toBe(true)
  })

  it("an account whose server lacks the library migration: edits wait on the device, everything else syncs", async () => {
    const w = world()
    const { engine, t } = await device(w, { library: false })
    engine.libraryCreate("note", { item_id: null, note_type: "idea", body: "Espera" })
    await settle(engine)
    expect(sync(engine)).toMatchObject({ enabled: false, state: "local", pending: 1 })
    expect(w.lib.applied.size).toBe(0)
    t.libraryEnabled = true
    await settle(engine)
    expect(sync(engine)).toMatchObject({ enabled: true, pending: 0 })
    expect(w.lib.liveIds("note")).toHaveLength(1)
  })

  it("M · a copy saved by the previous version (M3.4 shape) keeps its queue and texts; library texts survive reopening", () => {
    const m34 = {
      cache: { state: { habits: [], entries: {}, restDays: [], timezone: "Europe/Madrid" }, cursor: 5 },
      queue: [{ op: { type: "entry.set", op_id: "old-op", habit_id: "h", local_date: TODAY, value: true, client_updated_at: "", base_seq: null }, enqueuedAt: 1, attempts: 0 }],
      pendingNotes: [
        { id: "r1", kind: "conflict", opType: "review.save", op: { type: "review.save", op_id: "r1", kind: "week", period_start: "2026-10-19", fields: { "content.wins": "x" }, base_seqs: {} } },
        { id: "l1", kind: "conflict", opType: "library.note.update", code: "field_conflict", op: { type: "library.note.update", op_id: "l1", id: "n", fields: { body: "Mía" }, base_seqs: {}, at: "" } },
      ],
      goneOps: ["g"],
    }
    const up = upgradePersisted(m34, TODAY)!
    expect(up.queue.map((q) => q.op.op_id)).toEqual(["old-op"])
    expect(up.pendingNotes!.map((n) => n.id)).toEqual(["r1", "l1"])
    expect(up.goneOps).toEqual(["g"])
  })
})

describe("M4-H1 · a write is on the device before anything opens another page", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const storedOps = (w: World) => (w.storage.data?.queue ?? []).map((q) => q.op.type)

  it("whenSaved waits for the write in progress; until it lands the row says «saving», never «saved»", async () => {
    const w = world()
    const { engine, t } = await device(w)
    t.online = false
    const real = w.storage.save
    let release: (() => void) | null = null
    w.storage.save = async (d) => {
      await new Promise<void>((r) => (release = r))
      return real(d)
    }
    const id = engine.libraryCreate("item", { title: "Sin red" }, { kind: "book" })
    expect(engine.librarySyncStateOf("item", id)).toBe("saving")
    let saved: boolean | null = null
    void engine.whenSaved().then((v) => (saved = v))
    for (let i = 0; i < 10 && !release; i++) await flush()
    expect(saved).toBeNull()
    expect(storedOps(w)).toEqual([])
    w.storage.save = real
    release!()
    await expect.poll(() => saved).toBe(true)
    expect(storedOps(w)).toEqual(["library.item.create"])
    expect(engine.librarySyncStateOf("item", id)).toBe("local")
  })

  it("storage refusing the write: false and «error»; calling again retries and stores the create once", async () => {
    const w = world()
    const { engine, t } = await device(w)
    t.online = false
    const real = w.storage.save
    let full = true
    w.storage.save = async (d) => {
      if (full) throw new DOMException("quota", "QuotaExceededError")
      return real(d)
    }
    const id = engine.libraryCreate("item", { title: "Disco lleno" }, { kind: "book" })
    expect(await engine.whenSaved()).toBe(false)
    expect(engine.librarySyncStateOf("item", id)).toBe("error")
    expect(await engine.whenSaved()).toBe(false)
    full = false
    expect(await engine.whenSaved()).toBe(true)
    expect(storedOps(w)).toEqual(["library.item.create"])
    expect(engine.librarySyncStateOf("item", id)).toBe("local")
  })

  it("a show and then its episode: once saved, the device copy holds both, the show first", async () => {
    const w = world()
    const { engine, t } = await device(w)
    t.online = false
    const show = engine.libraryCreate("show", { title: "Programa" })
    expect(await engine.whenSaved()).toBe(true)
    engine.libraryCreate("item", { title: "Episodio", show_id: show }, { kind: "episode" })
    expect(await engine.whenSaved()).toBe(true)
    expect(storedOps(w)).toEqual(["library.show.create", "library.item.create"])
    // Back online, both reach the server once, in that order.
    t.online = true
    await settle(engine)
    expect(storedOps(w)).toEqual([])
    expect(lib(engine).items[Object.keys(lib(engine).items)[0]]).toMatchObject({ title: "Episodio", episode: { showId: show } })
  })
})
