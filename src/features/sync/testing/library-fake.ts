/**
 * In-memory stand-in for the library part of public.apply_ops and public.pull_library (M4b SQL),
 * for engine unit tests: per-field versions and stamps, protected texts, tombstones without
 * resurrection, cascades, ledger idempotency and paged pulls with skip_deleted_upto. Parity with
 * the real SQL is covered by tests/integration/library*.int.test.ts.
 */
import type { LibraryPage } from "../engine"
import type { WireChange, WireRow } from "../domain/library-wire"
import type { LibraryOp, LibraryWriteOp, OpResult } from "../domain/types"

type T = "show" | "item" | "note" | "link"
const PROTECTED: Record<string, string[]> = { note: ["body"], item: ["description"], show: ["description"] }

export class LibraryFake {
  seq = 1000
  rows = new Map<string, { t: T; row: WireRow }>()
  private ledger = new Map<string, OpResult>()
  /** Times each op_id was really applied (never > 1). */
  applied = new Map<string, number>()
  /** pull_library calls (since, limit, upto), for assertions. */
  pulls: { since: number; limit: number; upto: number | null }[] = []
  /** Throw a network-like error on the Nth next pull_library call (1 = next). */
  failPullAt: number | null = null
  /** Called between pulled pages (lets a test write «while a device pages»). */
  onPage: ((n: number) => void) | null = null

  head(): number {
    let h = 0
    for (const { row } of this.rows.values()) h = Math.max(h, Number(row.server_seq))
    return h
  }

  private key = (t: T, id: string) => `${t}:${id}`
  private get(t: T, id: string) {
    return this.rows.get(this.key(t, id))?.row
  }
  private write(t: T, row: WireRow, changed: string[]) {
    const seq = ++this.seq
    const seqs = row.deleted ? {} : { ...((row.field_seqs as Record<string, number>) ?? {}) }
    for (const f of changed) seqs[f] = seq
    const next: WireRow = { ...row, server_seq: seq, field_seqs: seqs, updated_at: new Date().toISOString() }
    this.rows.set(this.key(t, row.id), { t, row: next })
    return seq
  }
  private tombstone(t: T, id: string) {
    const r = this.get(t, id)!
    // A tombstone keeps no text (like the SQL guard).
    const seq = ++this.seq
    this.rows.set(this.key(t, id), { t, row: { id, kind: r.kind, item_id: r.item_id, a_type: r.a_type, a_id: r.a_id, b_type: r.b_type, b_id: r.b_id, deleted: true, server_seq: seq, field_seqs: {} } })
  }
  private live(t: T, id: string | null | undefined) {
    const r = id ? this.get(t, id) : undefined
    return !!r && !r.deleted
  }

  applyOps(ops: LibraryOp[]): OpResult[] {
    return ops.map((op) => {
      const prev = this.ledger.get(op.op_id)
      if (prev) return { ...prev, status: "duplicate", outcome: prev.status as Exclude<OpResult["status"], "duplicate"> }
      const r = { op_id: op.op_id, ...this.apply(op) } as OpResult
      this.ledger.set(op.op_id, r)
      if (r.status === "applied") this.applied.set(op.op_id, (this.applied.get(op.op_id) ?? 0) + 1)
      return r
    })
  }

  private apply(op: LibraryOp): Omit<OpResult, "op_id"> {
    if (op.type === "library.link.set") {
      const [a, b] = [`${op.a_type}:${op.a_id}`, `${op.b_type}:${op.b_id}`].sort()
      const id = `${a}|${b}`
      if (a === b) return { status: "rejected", code: "invalid_link" }
      if (op.linked) {
        for (const end of [a, b]) {
          const [t, eid] = end.split(":") as [T, string]
          if (!this.live(t, eid)) return { status: "rejected", code: "link_target_not_found" }
        }
        if (!this.live("link", id)) {
          const [at, aid] = a.split(":")
          const [bt, bid] = b.split(":")
          this.write("link", { id, a_type: at, a_id: aid, b_type: bt, b_id: bid, deleted: false, server_seq: 0, created_at: new Date().toISOString() }, [])
        }
      } else if (this.live("link", id)) this.tombstone("link", id)
      return { status: "applied" }
    }
    const [, entity, action] = op.type.split(".") as [string, "show" | "item" | "note", string]
    const cur = this.get(entity, op.id)
    if (action === "create" || action === "restore") {
      const w = op as LibraryWriteOp
      if (cur && !cur.deleted) return { status: "superseded", code: "exists", seq: Number(cur.server_seq) }
      if (cur && action === "create") return { status: "conflict", code: "deleted" }
      if (!cur && action === "restore") return { status: "rejected", code: "not_found" }
      if (entity === "note" && w.fields.item_id && !this.live("item", w.fields.item_id as string)) return { status: "conflict", code: "item_deleted" }
      if (typeof w.fields.title === "string" && w.fields.title === "") return { status: "rejected", code: "invalid" }
      const row: WireRow = {
        id: op.id,
        ...(entity === "item" ? { kind: w.kind } : {}),
        ...w.fields,
        field_stamps: Object.fromEntries(Object.keys(w.fields).map((k) => [k, w.at])),
        deleted: false,
        server_seq: 0,
        created_at: w.at,
        captured_at: w.captured_at ?? w.at,
      }
      const seq = this.write(entity, row, Object.keys(w.fields))
      return { status: "applied", seq }
    }
    if (!cur) return { status: "rejected", code: "not_found" }
    if (action === "delete") {
      const d = op as Extract<LibraryOp, { base_seq: number }>
      if (cur.deleted) return { status: "applied" }
      if (d.base_seq !== Number(cur.server_seq)) return { status: "conflict", code: "changed" }
      if (entity === "item") {
        const notes = [...this.rows.values()].filter((x) => x.t === "note" && !x.row.deleted && x.row.item_id === op.id)
        if (notes.some((n) => Number(n.row.server_seq) > (d.notes_seq ?? 0))) return { status: "conflict", code: "notes_changed" }
        for (const n of notes) this.dropLinks("note", n.row.id)
        for (const n of notes) this.tombstone("note", n.row.id)
      }
      if (entity === "show") {
        for (const x of [...this.rows.values()]) {
          if (x.t === "item" && !x.row.deleted && x.row.show_id === op.id) this.write("item", { ...x.row, show_id: null }, ["show_id"])
        }
      }
      this.dropLinks(entity, op.id)
      this.tombstone(entity, op.id)
      return { status: "applied" }
    }
    // update
    const u = op as Extract<LibraryOp, { base_seqs: Record<string, number | null> }>
    if (cur.deleted) return { status: "conflict", code: "deleted" }
    const seqs = (cur.field_seqs ?? {}) as Record<string, number>
    const stamps = (cur.field_stamps ?? {}) as Record<string, string>
    const applied: Record<string, unknown> = {}
    const conflicts: string[] = []
    const stale: string[] = []
    for (const [k, v] of Object.entries(u.fields)) {
      const c = seqs[k]
      const base = u.base_seqs[k] ?? null
      if (c === undefined || base === c) applied[k] = v
      else if (JSON.stringify(cur[k] ?? null) === JSON.stringify(v ?? null)) continue
      else if (PROTECTED[entity].includes(k)) conflicts.push(k)
      else if (u.at > (stamps[k] ?? "")) applied[k] = v
      else stale.push(k)
    }
    if (conflicts.length) return { status: "conflict", code: "field_conflict", fields: conflicts }
    if (!Object.keys(applied).length) return { status: stale.length ? "superseded" : "applied", code: stale.length ? "stale_fields" : null, seq: Number(cur.server_seq) }
    if (entity === "note" && "item_id" in applied && applied.item_id && !this.live("item", applied.item_id as string)) return { status: "conflict", code: "item_deleted" }
    const seq = this.write(entity, { ...cur, ...applied, field_stamps: { ...stamps, ...Object.fromEntries(Object.keys(applied).map((k) => [k, u.at])) } }, Object.keys(applied))
    return { status: "applied", seq }
  }

  private dropLinks(t: string, id: string) {
    for (const x of [...this.rows.values()]) {
      if (x.t === "link" && !x.row.deleted && ((x.row.a_type === t && x.row.a_id === id) || (x.row.b_type === t && x.row.b_id === id))) this.tombstone("link", x.row.id)
    }
  }

  pull(since: number, limit: number, upto: number | null): LibraryPage {
    this.pulls.push({ since, limit, upto })
    if (this.failPullAt !== null && --this.failPullAt <= 0) {
      this.failPullAt = null
      throw new Error("network")
    }
    const head = this.head()
    const skip = upto ?? (since === 0 ? head : 0)
    const all = [...this.rows.values()]
      .filter(({ row }) => Number(row.server_seq) > since && (!row.deleted || Number(row.server_seq) > skip))
      .sort((a, b) => Number(a.row.server_seq) - Number(b.row.server_seq))
    const page = all.slice(0, limit)
    const changes: WireChange[] = page.map(({ t, row }) => ({ t, seq: Number(row.server_seq), row: structuredClone(row) }))
    this.onPage?.(this.pulls.length)
    return { changes, cursor: page.length ? Number(page.at(-1)!.row.server_seq) : since, has_more: all.length > limit, skip_deleted_upto: skip, head }
  }

  /** Live rows by table, for comparisons with a device's copy. */
  liveIds(t: T): string[] {
    return [...this.rows.values()].filter((x) => x.t === t && !x.row.deleted).map((x) => x.row.id).sort()
  }
}
