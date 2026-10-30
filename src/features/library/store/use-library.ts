"use client"

import { useSyncExternalStore } from "react"
import { getActiveBackend, subscribeData } from "@/features/habits/store/habit-store"
import type { LibraryActions, LibrarySnapshot } from "./types"

/** The Library of the active data source; null while it resolves (SSR, first paint): render skeletons. */
export function useLibrary(): LibrarySnapshot | null {
  return useSyncExternalStore(
    subscribeData,
    () => getActiveBackend()?.library?.getSnapshot() ?? null,
    () => null
  )
}

function active(): LibraryActions {
  const lib = getActiveBackend()?.library
  if (!lib) throw new Error("No data source with a library is active yet")
  return lib.actions
}

/** Actions on the active data source's Library (demo or account), validated by the M4a domain. */
export const libraryActions: LibraryActions = {
  createItem: ((kind: "book", input: Parameters<LibraryActions["createItem"]>[1]) => active().createItem(kind, input)) as LibraryActions["createItem"],
  updateItem: (...a) => active().updateItem(...a),
  deleteItem: (...a) => active().deleteItem(...a),
  createShow: (...a) => active().createShow(...a),
  updateShow: (...a) => active().updateShow(...a),
  deleteShow: (...a) => active().deleteShow(...a),
  createNote: (...a) => active().createNote(...a),
  updateNote: (...a) => active().updateNote(...a),
  moveNote: (...a) => active().moveNote(...a),
  deleteNote: (...a) => active().deleteNote(...a),
  setLink: (...a) => active().setLink(...a),
  undo: (...a) => active().undo(...a),
  syncStateOf: (...a) => active().syncStateOf(...a),
  resolveText: (...a) => active().resolveText(...a),
}
