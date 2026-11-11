import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "@/features/notifications/domain/motivation"
import { anonClient, createTestUser, db, deleteTestUser, opId, type TestUser } from "./setup"

/** E6 · Notification settings in the profile, against real PostgreSQL. LOCAL stack only. */
type Result = { status: string; code?: string | null }
let a: TestUser
let b: TestUser

async function applyOne(u: TestUser, op: unknown): Promise<Result> {
  const { data, error } = await u.client.rpc("apply_ops", { p_device_id: "it-motivation", p_ops: [op] })
  if (error) throw error
  return (data as { results: Result[] }).results[0]
}
async function profile(u: TestUser) {
  const { data, error } = await u.client.rpc("pull_changes", { p_since: 0 })
  if (error) throw error
  return (data as { profile: { motivation: unknown; checkin_fields: unknown } }).profile
}
const set = (settings: unknown) => ({ type: "profile.motivation", op_id: opId("pm"), settings })

beforeAll(async () => {
  a = await createTestUser("ma")
  b = await createTestUser("mb")
})
afterAll(async () => {
  await deleteTestUser(a)
  await deleteTestUser(b)
})

describe("notification settings", () => {
  it("are absent until set: the key exists, with nothing in it", async () => {
    const p = await profile(a)
    expect("motivation" in p).toBe(true)
    expect(p.motivation).toBeNull()
  })

  it("are stored whole and pulled back; a replay applies once", async () => {
    const s = { ...DEFAULT_SETTINGS, tone: "calm", dailyCap: 2, daysOff: [6, 7] }
    const op = set(s)
    expect(await applyOne(a, op)).toMatchObject({ status: "applied" })
    expect(await applyOne(a, op)).toMatchObject({ status: "duplicate" })
    expect((await profile(a)).motivation).toEqual(s)
  })

  it("refuse anything that is not a complete, valid object", async () => {
    const bad = [
      null,
      "x",
      { ...DEFAULT_SETTINGS, tone: "angry" },
      { ...DEFAULT_SETTINGS, dailyCap: 11 },
      { ...DEFAULT_SETTINGS, dailyCap: 2.5 },
      { ...DEFAULT_SETTINGS, quietStart: "25:00" },
      { ...DEFAULT_SETTINGS, minGapMinutes: 721 },
      { ...DEFAULT_SETTINGS, daysOff: [8] },
      { ...DEFAULT_SETTINGS, tone: "calm", profanity: true },
      { ...DEFAULT_SETTINGS, extra: 1 },
      { ...DEFAULT_SETTINGS, rules: { ...DEFAULT_SETTINGS.rules, late: "yes" } },
      { ...DEFAULT_SETTINGS, rules: { morning: true } },
      { ...DEFAULT_SETTINGS, times: { ...DEFAULT_SETTINGS.times, late: "7pm" } },
    ]
    for (const s of bad) expect(await applyOne(a, set(s)), JSON.stringify(s).slice(0, 60)).toMatchObject({ status: "rejected", code: "invalid_value" })
    expect((await profile(a)).motivation).toMatchObject({ tone: "calm", dailyCap: 2 })
  })

  it("live next to the check-in fields: writing one never erases the other", async () => {
    expect(await applyOne(a, { type: "profile.checkin_fields", op_id: opId("pc"), am: ["sleep", "energy"], pm: ["mood"] })).toMatchObject({ status: "applied" })
    const p = await profile(a)
    expect(p.motivation).toMatchObject({ tone: "calm", dailyCap: 2 })
    expect(p.checkin_fields).toMatchObject({ am: ["sleep", "energy"], pm: ["mood"] })
    await applyOne(a, set({ ...DEFAULT_SETTINGS, dailyCap: 3 }))
    expect((await profile(a)).checkin_fields).toMatchObject({ am: ["sleep", "energy"], pm: ["mood"] })
  })

  it("are private to their owner", async () => {
    expect((await profile(b)).motivation).toBeNull()
    const row = await db(async (c) => (await c.query("select settings_json -> 'motivation' m from public.profiles where id = $1", [b.id])).rows[0])
    expect(row.m).toBeNull()
    expect((await anonClient().rpc("apply_ops", { p_device_id: "x", p_ops: [set(DEFAULT_SETTINGS)] })).error).not.toBeNull()
  })
})
