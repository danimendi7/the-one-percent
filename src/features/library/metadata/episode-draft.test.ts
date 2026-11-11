import { describe, expect, it } from "vitest"
import { createItem, createShow, type Ctx } from "@/features/knowledge/domain/ops"
import { emptyKnowledge } from "@/features/knowledge/domain/types"
import { itemSchema } from "@/features/knowledge/domain/validation"
import { itemFields, rowToItem, type WireRow } from "@/features/sync/domain/library-wire"
import { createEpisodeDraft, durationLabel, editEpisodeField, episodeDraftErrors, episodeDraftInput, localDayOf, parseDuration } from "./episode-draft"
import { parseLookup } from "./itunes"
import { toShowInput } from "./to-input"
import type { EpisodeResult } from "./types"
import itLookup from "./__fixtures__/itunes-lookup-laruina.json"

const ctx: Ctx = { now: "2026-11-01T10:00:00.000Z", today: "2026-11-01" }
const { show, episodes } = parseLookup(itLookup, "1455818214")!
const ep = episodes[0]
const bare: EpisodeResult = { ...ep, description: null, durationSeconds: null, publishedAt: null, cover: null, sourceUrl: null }

describe("episode draft (M4g.4)", () => {
  it("the day of the instant in the profile's zone: no day shift, the instant untouched", () => {
    expect(localDayOf("2026-10-28T23:30:00.000Z", "Europe/Madrid")).toBe("2026-10-29")
    expect(localDayOf("2026-10-28T23:30:00.000Z", "America/New_York")).toBe("2026-10-28")
    expect(localDayOf("2026-10-28T17:00:00.000Z", "Europe/Madrid")).toBe("2026-10-28")
    // The last Sunday of October (DST ends in Spain): still the right day.
    expect(localDayOf("2026-10-25T00:30:00.000Z", "Europe/Madrid")).toBe("2026-10-25")
    expect(localDayOf(null, "Europe/Madrid")).toBeNull()
    expect(localDayOf("ayer", "Europe/Madrid")).toBeNull()
    const d = createEpisodeDraft({ ...ep, publishedAt: "2026-10-28T23:30:00.000Z" }, "Europe/Madrid")
    expect(d.values.publishedOn).toBe("2026-10-29")
    expect(d.source.publishedAt).toBe("2026-10-28T23:30:00.000Z")
  })

  it("what Apple does not give stays empty; the show's cover stands in for an episode without one", () => {
    const d = createEpisodeDraft(bare, "Europe/Madrid", show!.cover)
    expect(d.values).toMatchObject({ publishedOn: "", duration: "", description: "", sourceUrl: "", creators: "", episodeNumber: "" })
    expect(d.cover).toBe(show!.cover)
    expect(createEpisodeDraft(bare, "Europe/Madrid").useCover).toBe(false)
  })

  it("durations: minutes alone, h:mm:ss, labels; nonsense is refused", () => {
    expect(parseDuration("45")).toBe(2700)
    expect(parseDuration("1:16:36")).toBe(4596)
    expect(parseDuration("")).toBeNull()
    expect(parseDuration("mucho")).toBe("bad")
    expect(parseDuration("99999")).toBe("bad")
    expect(durationLabel(4596)).toBe("1 h 17 min")
    expect(durationLabel(2280)).toBe("38 min")
    expect(durationLabel(null)).toBe("")
    expect(createEpisodeDraft(ep, "Europe/Madrid").values.duration).toBe("1:16:36")
  })

  it("checks each field; the user's edits are recorded as touched", () => {
    let d = createEpisodeDraft(ep, "Europe/Madrid")
    expect(episodeDraftErrors(d)).toEqual({})
    d = editEpisodeField(d, "duration", "mucho")
    d = editEpisodeField(d, "sourceUrl", "javascript:alert(1)")
    d = editEpisodeField(d, "episodeNumber", "tres")
    d = editEpisodeField(d, "title", " ")
    expect(Object.keys(episodeDraftErrors(d)).sort()).toEqual(["duration", "episodeNumber", "sourceUrl", "title"])
    expect(d.touched.sort()).toEqual(["duration", "episodeNumber", "sourceUrl", "title"])
  })

  it("saves through createShow/createItem: on its show, with every field, valid for the sync wire", () => {
    const st = createShow(emptyKnowledge(), "s1", toShowInput(show!), ctx)
    if (!st.ok) throw new Error("show")
    let d = createEpisodeDraft({ ...ep, publishedAt: "2026-10-28T23:30:00.000Z" }, "Europe/Madrid")
    d = editEpisodeField(d, "duration", "80")
    d = editEpisodeField(d, "creators", "Petite Lorena")
    d = editEpisodeField(d, "episodeNumber", "331")
    const r = createItem(st.state, "episode", "e1", episodeDraftInput(d, "s1", { status: "done", rating: 7, favorite: true }), ctx)
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    const item = r.state.items.e1
    expect(itemSchema.safeParse(item).success).toBe(true)
    expect(item).toMatchObject({
      title: ep.title,
      creators: ["Petite Lorena"],
      status: "done",
      rating: 7,
      favorite: true,
      external: { provider: "itunes", id: ep.id, attribution: "Datos: Apple Podcasts" },
      episode: { showId: "s1", platform: "apple", durationSeconds: 4800, publishedOn: "2026-10-29", episodeNumber: 331 },
    })
    const row: WireRow = { id: "e1", server_seq: 1, deleted: false, ...itemFields(item), kind: "episode", created_at: item.createdAt, updated_at: item.updatedAt }
    expect(rowToItem(row)).toEqual(item)
  })

  it("a bare episode saves with empty fields, nothing invented; the description can be left out", () => {
    const d = createEpisodeDraft(bare, "Europe/Madrid")
    const input = episodeDraftInput(d, null)
    expect(input).toMatchObject({ description: null, cover: null, sourceUrl: null, episode: { showId: null, durationSeconds: null, publishedOn: null, episodeNumber: null } })
    const withText = { ...createEpisodeDraft(ep, "Europe/Madrid"), keepDescription: false }
    expect(episodeDraftInput(withText, null).description).toBeNull()
    expect(createItem(emptyKnowledge(), "episode", "e2", input, ctx).ok).toBe(true)
  })
})
