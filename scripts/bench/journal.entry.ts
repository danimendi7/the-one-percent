import { NetworkError, SyncEngine, type SyncTransport } from "@/features/sync/engine"
import { idbStorage, tabLock } from "@/features/sync/idb-storage"
import { browserKeyValue, keyValueJournal } from "@/features/sync/journal"

// G1 (Orden 2 §1): the real engine with the real device copy (IndexedDB), the real journal
// (localStorage) and the real Web Lock, always offline. Exposed to scripts/bench-journal.mjs.

const USER = "00000000-0000-4000-8000-00000000a001"
const HABIT = "00000000-0000-4000-8000-00000000b001"
const offline: SyncTransport = {
  applyOps: () => Promise.reject(new NetworkError("offline")),
  pull: () => Promise.reject(new NetworkError("offline")),
}

let engine: SyncEngine | null = null
const queue = () => (engine as unknown as { queue: { op: { type: string; op_id: string } }[] }).queue

const api = {
  /**
   * Starts the engine over whatever this origin has stored. Returns how many marks the device copy
   * held before the journal was read, and how many are queued once started.
   */
  async start(withJournal: boolean) {
    const copy = await idbStorage(USER).load()
    const inCopy = (copy?.queue ?? []).filter((q) => q.op.type === "entry.set").length
    engine = new SyncEngine({
      transport: offline,
      storage: idbStorage(USER),
      journal: withJournal ? keyValueJournal(USER, browserKeyValue()) : undefined,
      deviceId: "bench-journal",
      lock: tabLock(`the-one-percent:sync:${USER}`),
    })
    // Offline, the first sync only schedules a retry: loading the copy is what matters here.
    await Promise.race([engine.start(), new Promise((r) => setTimeout(r, 3000))])
    return { inCopy, queued: queue().filter((q) => q.op.type === "entry.set").length }
  },
  /** The mark a tap on a habit queues (account-backend `setEntry`), shown at once. */
  mark(day: string) {
    engine!.submit({
      type: "entry.set",
      op_id: crypto.randomUUID(),
      habit_id: HABIT,
      local_date: day,
      value: true,
      client_updated_at: new Date().toISOString(),
      base_seq: null,
    })
    return queue().filter((q) => q.op.type === "entry.set").length
  },
  whenSaved: () => engine!.whenSaved(),
  journalKeys: () => Object.keys(localStorage).filter((k) => k.startsWith(`the-one-percent:queue:v1:${USER}:`)).length,
}

;(globalThis as unknown as { bench: typeof api }).bench = api
