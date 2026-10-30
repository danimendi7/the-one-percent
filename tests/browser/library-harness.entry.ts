/**
 * Browser harness for the M4c Library tests (tests/browser/library.spec.ts). Bundled for Chromium:
 * the real SyncEngine, the real IndexedDB stores (main record + per-row library copy, Web Locks)
 * and the real Supabase transport against the LOCAL stack. No app UI is involved (that is M4d).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { SyncEngine, NetworkError, type SyncTransport } from "@/features/sync/engine"
import { idbStorage, tabLock } from "@/features/sync/idb-storage"
import { idbLibraryStore, type StoreFaults } from "@/features/sync/library-store"
import { supabaseTransport } from "@/features/sync/supabase-transport"
import { syntheticLibrary, VOLUME_5K } from "@/features/knowledge/domain/synthetic"
import type { WireChange, WireRow } from "@/features/sync/domain/library-wire"
import type { LibraryMeta } from "@/features/sync/domain/library-sync"

interface Setup {
  url: string
  key: string
  email: string
  password: string
  pageSize?: number
  /** ms to wait before answering each pull_library page (to reload mid-download). */
  pageDelay?: number
  faults?: StoreFaults
}

let engine: SyncEngine | null = null
let sb: SupabaseClient | null = null
let userId = ""
const net = { online: true }
const pulls: { since: number; upto: number | null }[] = []

async function settle() {
  const e = engine!
  const running = () => (e as unknown as { running: Promise<void> | null }).running
  await e.sync()
  for (let i = 0; i < 20 && running(); i++) await running()
}

const api = {
  /** Signs in and starts the engine with the real IndexedDB stores of this user. */
  async start(s: Setup) {
    sb = createClient(s.url, s.key, { auth: { persistSession: false, autoRefreshToken: false } })
    const r = await sb.auth.signInWithPassword({ email: s.email, password: s.password })
    if (r.error) throw r.error
    userId = r.data.user!.id
    const real = supabaseTransport(sb)
    const t: SyncTransport = {
      applyOps: (d, ops) => (net.online ? real.applyOps(d, ops) : Promise.reject(new NetworkError("offline"))),
      pull: (since) => (net.online ? real.pull(since) : Promise.reject(new NetworkError("offline"))),
      pullLibrary: async (since, limit, upto) => {
        if (!net.online) throw new NetworkError("offline")
        pulls.push({ since, upto })
        if (s.pageDelay) await new Promise((res) => setTimeout(res, s.pageDelay))
        return real.pullLibrary!(since, limit, upto)
      },
    }
    engine = new SyncEngine({
      transport: t,
      storage: idbStorage(userId),
      library: idbLibraryStore(userId, s.faults),
      libraryPageSize: s.pageSize ?? 1000,
      deviceId: `browser-${Math.random().toString(36).slice(2, 8)}`,
      lock: tabLock(`the-one-percent:sync:${userId}`),
    })
    const t0 = performance.now()
    await engine.start()
    return { userId, startMs: performance.now() - t0 }
  },
  /** Starts without waiting (to reload the page while it pages). */
  startNoWait(s: Setup) {
    void api.start(s)
  },
  settle,
  setOnline(v: boolean) {
    net.online = v
  },
  pulls: () => pulls,
  snapshot() {
    const s = engine!.getSnapshot()
    return { notes: Object.values(s.library.notes).map((n) => ({ id: n.id, body: n.body, itemId: n.itemId })), sync: s.librarySync, notices: s.notices.map((n) => ({ id: n.id, code: n.code })), pending: s.pending }
  },
  createNote(fields: Record<string, unknown>, id?: string) {
    return engine!.libraryCreate("note", fields, { id })
  },
  updateNote(id: string, fields: Record<string, unknown>) {
    engine!.libraryUpdate("note", id, fields)
  },
  stop() {
    engine?.stop()
  },

  /** Reads this user's library copy straight from IndexedDB (what survives a reload). */
  async stored(uid = userId) {
    const s = await idbLibraryStore(uid).load()
    return { notes: s.rows.note.size, items: s.rows.item.size, meta: s.meta }
  },

  /** The store contract on the REAL IndexedDB store (same as library-store.test.ts on the memory one). */
  async storeContract() {
    const uid = `contract-${Math.random().toString(36).slice(2, 8)}`
    const other = `${uid}-other`
    const s = idbLibraryStore(uid)
    const note = (id: string, seq: number, body = `v${seq}`, deleted = false): WireChange => ({ t: "note", seq, row: { id, server_seq: seq, deleted, body } })
    const meta = (cursor: number): LibraryMeta => ({ cursor, rebuildUpto: null, complete: true })
    const out: Record<string, unknown> = {}
    await s.applyPage([note("a", 20, "nueva")], meta(20))
    await s.applyPage([note("a", 10, "vieja"), note("b", 11)], meta(11))
    let got = await s.load()
    out.newestKept = got.rows.note.get("a")!.body === "nueva" && got.rows.note.get("b")!.body === "v11"
    out.cursorForward = got.meta!.cursor === 20
    await s.applyPage([note("b", 30, "", true)], meta(30))
    await s.applyPage([note("a", 15, "", true)], meta(15))
    got = await s.load()
    out.tombstones = !got.rows.note.has("b") && got.rows.note.get("a")!.body === "nueva"
    // Two users in the same database never see or clear each other's rows.
    const o = idbLibraryStore(other)
    await o.applyPage([note("x", 5)], meta(5))
    await s.clear()
    out.isolation = (await s.load()).rows.note.size === 0 && (await o.load()).rows.note.get("x")?.body === "v5"
    await o.clear()
    // A failure before the commit aborts the real transaction: neither rows nor cursor stored.
    const f1 = idbLibraryStore(`${uid}-f1`, { failBeforeCommit: 1 })
    let threw = false
    try {
      await f1.applyPage([note("a", 5)], meta(5))
    } catch {
      threw = true
    }
    const after1 = await f1.load()
    out.abortBeforeCommit = threw && after1.rows.note.size === 0 && after1.meta === null
    // A failure after the commit: both are stored.
    const f2 = idbLibraryStore(`${uid}-f2`, { failAfterCommit: 1 })
    threw = false
    try {
      await f2.applyPage([note("a", 5)], meta(5))
    } catch {
      threw = true
    }
    const after2 = await f2.load()
    out.afterCommitStored = threw && after2.rows.note.size === 1 && after2.meta?.cursor === 5
    await f1.clear()
    await f2.clear()
    return out
  },

  /**
   * Volume (Phase 5): a synthetic library of 5.000 notes stored in the per-row copy of a fake user,
   * then the engine costs that matter with it in place. No network: pages are applied locally.
   */
  /** Fills the per-row copy of `uid` with the synthetic 5.000-note library (two-tab benchmark). */
  async fill(uid: string) {
    const lib = syntheticLibrary(VOLUME_5K)
    let seq = 0
    const rows = Object.values(lib.notes).map((n): WireChange => ({ t: "note", seq: ++seq, row: { id: n.id, server_seq: seq, deleted: false, item_id: null, note_type: n.type, body: n.body, captured_at: n.createdAt, updated_at: n.updatedAt } }))
    const store = idbLibraryStore(uid)
    for (let i = 0; i < rows.length; i += 1000) await store.applyPage(rows.slice(i, i + 1000), { cursor: rows[Math.min(i + 999, rows.length - 1)].seq, rebuildUpto: null, complete: true })
  },

  /** n note saves in an offline engine over `uid`'s stores; returns each save's persist time (main record, Web Lock). */
  async saves(uid: string, n: number) {
    const offline: SyncTransport = {
      applyOps: () => Promise.reject(new NetworkError("offline")),
      pull: () => Promise.reject(new NetworkError("offline")),
      pullLibrary: () => Promise.reject(new NetworkError("offline")),
    }
    const e = new SyncEngine({ transport: offline, storage: idbStorage(uid), library: idbLibraryStore(uid), deviceId: `tab-${Math.random()}`, lock: tabLock(`bench:${uid}`), schedule: () => () => {} })
    await e.start()
    const persist = () => (e as unknown as { persist(): Promise<void> }).persist()
    const times: number[] = []
    for (let k = 0; k < n; k++) {
      e.libraryCreate("note", { item_id: null, note_type: "idea", body: `Pestaña ${k}` })
      const t0 = performance.now()
      await persist()
      times.push(performance.now() - t0)
    }
    e.stop()
    times.sort((a, b) => a - b)
    return { median: times[Math.floor(n / 2)], max: times[n - 1], notes: Object.keys(e.getSnapshot().library.notes).length }
  },

  async bench() {
    const uid = `bench-${Math.random().toString(36).slice(2, 8)}`
    const lib = syntheticLibrary(VOLUME_5K)
    let seq = 0
    const changes: WireChange[] = []
    const add = (t: WireChange["t"], row: Record<string, unknown>) => changes.push({ t, seq: ++seq, row: { ...row, server_seq: seq, deleted: false } as WireRow })
    for (const s of Object.values(lib.shows)) add("show", { id: s.id, title: s.title, topics: s.topics, description: s.description, created_at: s.createdAt, updated_at: s.updatedAt, field_seqs: { title: seq + 1 } })
    for (const i of Object.values(lib.items)) add("item", { id: i.id, kind: i.kind, title: i.title, creators: i.creators, topics: i.topics, description: i.description, status: i.status, favorite: i.favorite, rating: i.rating, created_at: i.createdAt, updated_at: i.updatedAt, field_seqs: { title: seq + 1 } })
    for (const n of Object.values(lib.notes)) add("note", { id: n.id, item_id: n.itemId, note_type: n.type, body: n.body, starred: n.starred, topics: n.topics, application_status: n.applicationStatus, captured_at: n.createdAt, updated_at: n.updatedAt, field_seqs: { body: seq + 1 } })
    const store = idbLibraryStore(uid)
    const out: Record<string, number> = { rows: changes.length }
    // Rebuild from scratch, in pages of 1.000 (what a first sync stores).
    let t = performance.now()
    for (let i = 0; i < changes.length; i += 1000) {
      const page = changes.slice(i, i + 1000)
      await store.applyPage(page, { cursor: page.at(-1)!.seq, rebuildUpto: i + 1000 < changes.length ? seq : null, complete: i + 1000 >= changes.length })
    }
    out.rebuildStoreMs = performance.now() - t
    // Incremental: five changed notes.
    const five = changes.filter((c) => c.t === "note").slice(0, 5).map((c, k) => ({ ...c, seq: seq + 1 + k, row: { ...c.row, server_seq: seq + 1 + k, starred: true } }))
    t = performance.now()
    await store.applyPage(five, { cursor: seq + 5, rebuildUpto: null, complete: true })
    out.incremental5StoreMs = performance.now() - t
    // Reading the whole copy back (what the app does on opening).
    t = performance.now()
    const loaded = await store.load()
    out.loadMs = performance.now() - t
    out.loadedNotes = loaded.rows.note.size
    // An engine over that copy: opening, saving a note, saving a habit (both only touch the main record).
    const mem = performance as unknown as { memory?: { usedJSHeapSize: number } }
    const heap0 = mem.memory?.usedJSHeapSize ?? 0
    const offline: SyncTransport = {
      applyOps: () => Promise.reject(new NetworkError("offline")),
      pull: () => Promise.reject(new NetworkError("offline")),
      pullLibrary: () => Promise.reject(new NetworkError("offline")),
    }
    const e = new SyncEngine({ transport: offline, storage: idbStorage(uid), library: store, deviceId: "bench", lock: tabLock(`bench:${uid}`), schedule: () => () => {} })
    t = performance.now()
    await e.start()
    out.engineStartMs = performance.now() - t
    out.engineNotes = Object.keys(e.getSnapshot().library.notes).length
    out.heapAfterStartMB = ((mem.memory?.usedJSHeapSize ?? 0) - heap0) / 2 ** 20
    const persist = () => (e as unknown as { persist(): Promise<void> }).persist()
    const time = async (fn: () => void) => {
      const r: number[] = []
      for (let k = 0; k < 7; k++) {
        fn()
        const t0 = performance.now()
        await persist()
        r.push(performance.now() - t0)
      }
      r.sort((a, b) => a - b)
      return { median: r[3], max: r[6] }
    }
    let k = 0
    const note = await time(() => e.libraryCreate("note", { item_id: null, note_type: "idea", body: `Idea rápida ${++k}` }))
    out.saveNotePersistMedianMs = note.median
    out.saveNotePersistMaxMs = note.max
    const habit = await time(() => e.submit({ type: "rest_day.set", op_id: `rd-${++k}`, local_date: "2026-10-30", rest: k % 2 === 0, client_updated_at: new Date().toISOString(), base_seq: null }))
    out.saveHabitPersistMedianMs = habit.median
    out.saveHabitPersistMaxMs = habit.max
    // Optimistic view with pending library edits on top of 5.000 notes.
    t = performance.now()
    for (let r = 0; r < 10; r++) {
      ;(e as unknown as { invalidate(): void }).invalidate()
      e.getSnapshot()
    }
    out.snapshotWith5kMs = (performance.now() - t) / 10
    // Size of the main record (what every save writes): it holds no library rows.
    const raw = await (await import("idb-keyval")).get(`v1:${uid}`, (await import("idb-keyval")).createStore("the-one-percent", "sync"))
    out.mainRecordKB = new TextEncoder().encode(JSON.stringify(raw)).byteLength / 1024
    out.libraryCopyMB = new TextEncoder().encode(JSON.stringify(changes.map((c) => c.row))).byteLength / 2 ** 20
    e.stop()
    await store.clear()
    return out
  },
}

;(globalThis as unknown as { h: typeof api }).h = api
