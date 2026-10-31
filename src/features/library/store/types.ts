import type { LocalDate } from "@/features/habits/domain/dates"
import type { BookInput, EpisodeInput, ItemPatch, KnowledgeError, NoteInput, NotePatch, Removed, ShowInput } from "@/features/knowledge/domain/ops"
import type { ContentKind, EntityRef, KnowledgeState } from "@/features/knowledge/domain/types"
import type { SyncNotice } from "@/features/sync/domain/types"
import type { LibrarySyncInfo } from "@/features/sync/engine"
import type { DataSource } from "@/features/habits/store/types"

/**
 * The Library as the screens see it (M4d): one contract for the demo (browser-only) and for an
 * account (the M4c engine). Actions take domain inputs (M4a) and are validated by the domain
 * reducers first, so both sources refuse exactly the same things.
 */
export interface LibrarySnapshot {
  source: DataSource
  state: KnowledgeState
  today: LocalDate
  /** null in the demo (nothing is synced there). */
  sync: LibrarySyncInfo | null
  /** Library texts waiting for the user's decision (D68/D75). */
  notices: SyncNotice[]
  /** The device copy accepted the last write. */
  persisted: boolean
}

/** What one row shows (D57 precedent): never «synced» for something only on this device. */
export type EntitySyncState = "demo" | "local" | "pending" | "synced" | "conflict" | "error"

export type LibraryRefusal = KnowledgeError | { code: "pending" | "in_flight" | "not_found"; detail: string }
export type LibraryResult<T = object> = ({ ok: true } & T) | { ok: false; error: LibraryRefusal }

export type ConflictChoice = "mine" | "theirs" | "both" | "restore" | "free" | "existing"

export interface LibraryActions {
  createItem(kind: "book", input: BookInput): LibraryResult<{ id: string }>
  createItem(kind: "episode", input: EpisodeInput): LibraryResult<{ id: string }>
  createItem(kind: ContentKind, input: BookInput & EpisodeInput): LibraryResult<{ id: string }>
  updateItem(id: string, patch: ItemPatch): LibraryResult
  /** P14: the caller confirms when it matters; `undo` puts back exactly what was removed. */
  deleteItem(id: string): LibraryResult<{ undo: Removed }>
  createShow(input: ShowInput): LibraryResult<{ id: string }>
  updateShow(id: string, patch: Partial<ShowInput>): LibraryResult
  deleteShow(id: string): LibraryResult<{ undo: Removed }>
  createNote(input: NoteInput): LibraryResult<{ id: string }>
  updateNote(id: string, patch: NotePatch): LibraryResult
  moveNote(id: string, itemId: string | null): LibraryResult
  deleteNote(id: string): LibraryResult<{ undo: Removed }>
  setLink(a: EntityRef, b: EntityRef, linked: boolean): LibraryResult
  /** «Deshacer» after a delete. */
  undo(removed: Removed): void
  syncStateOf(entity: "item" | "show" | "note", id: string): EntitySyncState
  /** `target`: the existing content for «existing» (a note whose content was refused as a duplicate). */
  resolveText(noticeId: string, choice: ConflictChoice, target?: string): boolean
}

export interface LibraryBackend {
  getSnapshot(): LibrarySnapshot | null
  actions: LibraryActions
}
