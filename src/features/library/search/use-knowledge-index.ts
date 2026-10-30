"use client"

import { useEffect, useSyncExternalStore } from "react"
import { buildIndex, indexBuilder, type KnowledgeIndex } from "@/features/knowledge/domain/search"
import type { KnowledgeState } from "@/features/knowledge/domain/types"
import { SLICE_MS } from "../bench/search-bench"
import type { LibrarySnapshot } from "../store/types"

/**
 * The search index of the device copy (M4e, D81). Built only when a screen needs it (Cerebro, the
 * link picker), in slices of a few milliseconds so the page stays responsive (1,3 s in total on a
 * 4× slower CPU with 5.000 notes, no slice above ~20 ms), then kept up to date incrementally: an
 * edit re-indexes only what changed. One index per data source; it lives in memory only.
 */

interface Entry {
  source: string
  index: KnowledgeIndex | null
  /** The state the index reflects. */
  indexed: KnowledgeState | null
  progress: number
  building: boolean
}

let entry: Entry | null = null
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version++
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))

function start(source: string, state: () => KnowledgeState) {
  if (entry?.source === source && (entry.index || entry.building)) return
  entry = { source, index: null, indexed: null, progress: 0, building: true }
  const mine = entry
  const target = state()
  const b = indexBuilder(target)
  const slice = () => {
    if (entry !== mine) return
    const t0 = performance.now()
    const done = b.step(() => performance.now() - t0 >= SLICE_MS)
    mine.progress = b.progress
    if (done) {
      mine.index = b.index
      mine.indexed = target
      mine.building = false
    } else setTimeout(slice, 0)
    emit()
  }
  setTimeout(slice, 0)
  emit()
}

/** The index brought up to date with `state` (incremental), or null while the first build runs. */
function current(source: string, state: KnowledgeState): KnowledgeIndex | null {
  if (!entry || entry.source !== source || !entry.index) return null
  if (entry.indexed !== state) {
    buildIndex(state, entry.index)
    entry.indexed = state
  }
  return entry.index
}

export function useKnowledgeIndex(snap: LibrarySnapshot | null, enabled = true): { index: KnowledgeIndex | null; progress: number } {
  useSyncExternalStore(subscribe, () => version, () => 0)
  const source = snap?.source ?? null
  useEffect(() => {
    if (enabled && snap && source) start(source, () => snap.state)
  }, [enabled, snap, source])
  if (!snap || !source || !enabled) return { index: null, progress: 0 }
  const index = current(source, snap.state)
  return { index, progress: index ? 1 : entry?.source === source ? entry.progress : 0 }
}

/** Tests only: forget the index. */
export function resetKnowledgeIndex() {
  entry = null
  emit()
}
