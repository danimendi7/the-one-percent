import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Op, SyncNotice } from "@/features/sync/domain/types"

/**
 * Library texts kept after a refusal or a conflict (D68) are decided only by the user (D108).
 * Their toast only informs: closing it — when its time runs out or by hand — must never resolve the
 * notice, because resolving it forgets the kept text for good (engine.dismissNotice → forget).
 * Informative notices keep their behaviour: closing their toast is acknowledging them.
 */

type ToastOptions = { id?: string; duration?: number; onAutoClose?: () => void; onDismiss?: () => void; action?: { onClick: () => void }; cancel?: { onClick: () => void } }
const calls: { title: string; opts: ToastOptions }[] = []
const record = (title: string, opts: ToastOptions) => void calls.push({ title, opts })
const dismissNotice = vi.fn()
const reapplyNotice = vi.fn()

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(record), { error: vi.fn(record), dismiss: vi.fn() }) }))
vi.mock("@/features/habits/store/habit-store", () => ({ activateBackend: vi.fn(), useHabits: vi.fn(), habitActions: { dismissNotice: (id: string) => dismissNotice(id), reapplyNotice: (id: string) => reapplyNotice(id) } }))
vi.mock("@/features/habits/store/demo-store", () => ({ demoBackend: {} }))
vi.mock("@/features/sync/account-backend", () => ({ createAccountBackend: vi.fn() }))
vi.mock("@/lib/supabase/browser", () => ({ getSupabaseBrowser: vi.fn() }))

const { showNotice } = await import("./data-source")

const notice = (kind: SyncNotice["kind"], code: string | null, op: Op): SyncNotice => ({ id: `n-${calls.length}-${Math.random()}`, kind, opType: op.type, subject: "Algo", code, op })
const noteUpdate = { op_id: "o1", type: "library.note.update", id: "note-1", fields: { body: "Mi texto" }, base_seqs: { body: 3 }, client_time: "2026-11-03T10:00:00.000Z" } as unknown as Op
const itemCreate = { op_id: "o2", type: "library.item.create", id: "item-1", kind: "book", fields: { title: "Libro", external_provider: "openlibrary", external_id: "OL1W" }, client_time: "2026-11-03T10:00:00.000Z" } as unknown as Op
const noteCreate = { op_id: "o3", type: "library.note.create", id: "note-2", fields: { body: "Nota sin red", item_id: "item-1" }, client_time: "2026-11-03T10:00:00.000Z" } as unknown as Op
const noteDelete = { op_id: "o4", type: "library.note.delete", id: "note-3", client_time: "2026-11-03T10:00:00.000Z" } as unknown as Op
const habitLog = { op_id: "o5", type: "habit.log", habit_id: "h1", local_date: "2026-11-03", value: 1 } as unknown as Op

/** Every way a toast can close without a decision: its time runs out, or the user closes it. */
function closeWithoutDeciding() {
  for (const { opts } of calls) {
    opts.onAutoClose?.()
    opts.onDismiss?.()
  }
}

beforeEach(() => {
  calls.length = 0
  dismissNotice.mockClear()
  reapplyNotice.mockClear()
})

describe("library texts kept on the device: a toast closing decides nothing", () => {
  const kept: [string, SyncNotice][] = [
    ["field conflict on a note (12 s toast before)", notice("conflict", "field_conflict", noteUpdate)],
    ["note edited while deleted elsewhere", notice("conflict", "deleted", noteUpdate)],
    ["note whose content was deleted or refused", notice("conflict", "item_deleted", noteCreate)],
    ["duplicate refused (8 s toast before)", notice("rejected", "duplicate_external", itemCreate)],
    ["episode whose show was refused", notice("rejected", "show_not_found", { ...(itemCreate as object), kind: "episode" } as unknown as Op)],
    ["any other refusal", notice("rejected", "invalid_value", noteUpdate)],
  ]
  it.each(kept)("%s", (_label, n) => {
    showNotice(n)
    expect(calls).toHaveLength(1)
    closeWithoutDeciding()
    expect(dismissNotice).not.toHaveBeenCalled()
    expect(reapplyNotice).not.toHaveBeenCalled()
  })

  it("the toast offers no button that would decide in its place (the panel decides)", () => {
    showNotice(notice("conflict", "field_conflict", noteUpdate))
    expect(calls[0].opts.action).toBeUndefined()
    expect(calls[0].opts.cancel).toBeUndefined()
  })
})

describe("informative notices keep their behaviour", () => {
  it("a refused habit log: closing its toast acknowledges it", () => {
    const n = notice("rejected", "future_date", habitLog)
    showNotice(n)
    calls[0].opts.onAutoClose?.()
    expect(dismissNotice).toHaveBeenCalledWith(n.id)
  })

  it("a refused library delete (nothing kept, nothing lost): closing its toast acknowledges it", () => {
    const n = notice("rejected", "not_found", noteDelete)
    showNotice(n)
    calls[0].opts.onDismiss?.()
    expect(dismissNotice).toHaveBeenCalledWith(n.id)
  })
})
