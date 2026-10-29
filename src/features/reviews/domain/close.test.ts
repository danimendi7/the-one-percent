import { describe, expect, it } from "vitest"
import { makeState } from "@/features/habits/domain/test-helpers"
import { applyClose, applyEdit, closeGate, closeReview, emptyDraft, FRESH_PULL_MS, type SyncView } from "./close"
import { buildReviewSnapshot } from "./snapshot"
import type { Review } from "./types"

const WEEK = "2026-10-19"
const NOW = 1_800_000_000_000
const synced: SyncView = { online: true, pending: 0, lastPullAt: NOW - 1_000, now: NOW, conflicts: 0, serverSupports: true }

const draft = (p: Partial<Review> = {}): Review => ({ ...emptyDraft("week", WEEK, "2026-10-25T18:00:00.000Z"), ...p })
const snap = (today = "2026-10-26") => buildReviewSnapshot({ state: makeState([]), kind: "week", periodStart: WEEK, today, computedAt: "2026-10-26T09:00:00.000Z" })

describe("when a review can close (decision 2)", () => {
  it("closes from the period's last day when synced with a recent pull", () => {
    expect(closeGate(draft(), "2026-10-25", synced)).toEqual({ action: "close" })
    expect(closeGate(draft(), "2026-12-01", synced)).toEqual({ action: "close" })
  })

  it("is not available before the last day", () => {
    expect(closeGate(draft(), "2026-10-24", synced)).toEqual({ action: "blocked", reason: "not_available" })
  })

  it("offline the draft stays and the close is deferred, never forced", () => {
    expect(closeGate(draft(), "2026-10-26", { ...synced, online: false })).toEqual({ action: "defer", reason: "offline" })
  })

  it("with pending operations or a stale pull it syncs first", () => {
    expect(closeGate(draft(), "2026-10-26", { ...synced, pending: 2 })).toEqual({ action: "sync_first", reason: "pending" })
    expect(closeGate(draft(), "2026-10-26", { ...synced, lastPullAt: NOW - FRESH_PULL_MS - 1 })).toEqual({ action: "sync_first", reason: "stale_pull" })
    expect(closeGate(draft(), "2026-10-26", { ...synced, lastPullAt: null })).toEqual({ action: "sync_first", reason: "stale_pull" })
  })

  it("a section conflict waiting for a decision blocks the close, even offline (decision 5)", () => {
    expect(closeGate(draft(), "2026-10-26", { ...synced, conflicts: 1, online: false })).toEqual({ action: "blocked", reason: "conflicts" })
  })

  it("refuses invalid content, a closed review, an invalid period and a server without the migration", () => {
    expect(closeGate(draft({ content: { wins: "a".repeat(601) } }), "2026-10-26", synced)).toEqual({ action: "blocked", reason: "invalid_content" })
    expect(closeGate(draft({ status: "closed" }), "2026-10-26", synced)).toEqual({ action: "blocked", reason: "already_closed" })
    expect(closeGate(draft({ periodStart: "2026-10-20" }), "2026-10-26", synced)).toEqual({ action: "blocked", reason: "invalid_period" })
    expect(closeGate(draft(), "2026-10-26", { ...synced, serverSupports: false })).toEqual({ action: "blocked", reason: "no_server_support" })
  })
})

describe("closing freezes once; the first close wins (decisions 1 and 4)", () => {
  it("a close stores the snapshot and normalized content", () => {
    const closed = closeReview(draft({ content: { wins: "  Bien  ", lessons: " " } }), snap(), "2026-10-26T09:00:01.000Z")
    expect(closed).toMatchObject({ status: "closed", content: { wins: "Bien" }, closedAt: "2026-10-26T09:00:01.000Z" })
    expect(closed.snapshot?.period.from).toBe(WEEK)
  })

  it("refuses a snapshot of another period and a second close", () => {
    const other = buildReviewSnapshot({ state: makeState([]), kind: "week", periodStart: "2026-10-12", today: "2026-10-26", computedAt: "x" })
    expect(() => closeReview(draft(), other, "t")).toThrow("snapshot_mismatch")
    const closed = closeReview(draft(), snap(), "t1")
    expect(() => closeReview(closed, snap("2026-11-30"), "t2")).toThrow("already_closed")
  })

  it("a repeated or concurrent close changes nothing: the original snapshot stays", () => {
    const first = closeReview(draft(), snap(), "t1")
    const second = closeReview(draft({ content: { wins: "otro dispositivo" } }), snap("2026-11-30"), "t2")
    const r = applyClose(first, second)
    expect(r.outcome).toBe("already_closed")
    expect(r.review).toBe(first)
    expect(applyClose(draft(), first)).toEqual({ review: first, outcome: "applied" })
  })
})

describe("a closed review is immutable", () => {
  it("edits are refused and the review is returned unchanged (the caller keeps the text, never drops it)", () => {
    const closed = closeReview(draft({ content: { wins: "Bien" } }), snap(), "t1")
    const r = applyEdit(closed, "content.wins", "Cambiado", "t2")
    expect(r).toEqual({ ok: false, reason: "closed", review: closed })
  })

  it("a draft takes each section edit; a blank answer clears it", () => {
    let r = applyEdit(draft(), "content.wins", "Terminé el informe", "t1")
    expect(r.ok && r.review.content).toEqual({ wins: "Terminé el informe" })
    r = applyEdit(r.review, "content.wins", "   ", "t2")
    expect(r.ok && r.review.content).toEqual({})
  })

  it("a new draft knows its period end; an invalid start is refused", () => {
    expect(emptyDraft("month", "2028-02-01", "t").periodEnd).toBe("2028-02-29")
    expect(() => emptyDraft("week", "2026-10-20", "t")).toThrow("invalid_period")
  })
})
