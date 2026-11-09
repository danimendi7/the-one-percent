"use client"

import { useMemo } from "react"
import type { LocalDate } from "@/features/habits/domain/dates"
import type { HabitsState } from "@/features/habits/domain/types"
import { habitActions, reviewsEnabled, useHabits } from "@/features/habits/store/habit-store"
import type { HabitsSnapshot, ReviewActions } from "@/features/habits/store/types"
import type { CloseIntent, ReviewSyncState, SyncNotice } from "@/features/sync/domain/types"
import type { ReviewField, ReviewKind } from "./domain/types"

export interface ReviewsModel {
  snap: HabitsSnapshot
  state: HabitsState
  today: LocalDate
  source: HabitsSnapshot["source"]
  /** False: an account whose server lacks the reviews migration. Drafts stay on the device and cannot close. */
  serverSaves: boolean
  /** The same for daily reviews, which need their own migration (C5). */
  dailySaves: boolean
  api: ReviewActions
}

export function useReviewsModel(): ReviewsModel | null {
  const snap = useHabits()
  return useMemo(() => {
    if (!snap) return null
    return { snap, state: snap.state, today: snap.today, source: snap.source, serverSaves: snap.source === "demo" || reviewsEnabled(), dailySaves: snap.source === "demo" || reviewsEnabled("day"), api: habitActions }
  }, [snap])
}

export function savesKind(m: ReviewsModel, kind: ReviewKind): boolean {
  return kind === "day" ? m.dailySaves : m.serverSaves
}

/** Kept texts of one review (D47 generalized): sections that wait for «Aplicar la mía» / «Mantener la otra». */
export function reviewNotices(m: ReviewsModel, kind: ReviewKind, periodStart: LocalDate): SyncNotice[] {
  return (m.snap.sync?.notices ?? []).filter((n) => n.op?.type === "review.save" && n.op.kind === kind && n.op.period_start === periodStart)
}

export function waitingFields(notices: readonly SyncNotice[]): Set<ReviewField> {
  const out = new Set<ReviewField>()
  for (const n of notices) if (n.op?.type === "review.save") for (const f of Object.keys(n.op.fields)) out.add(f as ReviewField)
  return out
}

export function closeIntentOf(m: ReviewsModel, kind: ReviewKind, periodStart: LocalDate): CloseIntent | undefined {
  return m.snap.sync?.closeIntents?.find((c) => c.kind === kind && c.periodStart === periodStart)
}

export function syncStateOf(m: ReviewsModel, kind: ReviewKind, periodStart: LocalDate): ReviewSyncState {
  return m.api.reviewSyncState(kind, periodStart)
}

/**
 * The save line of a review (aria-live). Honest by construction: «Sincronizado» only when the
 * server has every write of this review; a write only in IndexedDB says so.
 */
export function saveLine(m: ReviewsModel, kind: ReviewKind, state: ReviewSyncState, typing: boolean): { text: string; tone: "ok" | "pending" | "warn" } {
  if (typing) return { text: "Guardando…", tone: "pending" }
  if (m.source === "demo") return { text: "Guardado en este navegador · demo", tone: "ok" }
  if (!m.snap.persisted) return { text: "No se pudo guardar en este dispositivo", tone: "warn" }
  switch (state) {
    case "synced":
      return { text: "Sincronizado", tone: "ok" }
    case "pending":
      return { text: "Guardado en este dispositivo · sincronizando…", tone: "pending" }
    case "local":
      return savesKind(m, kind)
        ? { text: "Guardado en este dispositivo · se enviará al recuperar la conexión", tone: "pending" }
        : { text: "Guardado solo en este dispositivo · tu cuenta aún no guarda revisiones", tone: "warn" }
    case "conflict":
      return { text: "Hay un cambio que espera tu decisión", tone: "warn" }
    case "error":
      return { text: "No se pudo guardar en la nube · tu texto sigue en este dispositivo", tone: "warn" }
  }
}
