import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { addDays, anonClient, createTestUser, db, deleteTestUser, opId, type TestUser } from "./setup"

/** M3.3 · check-ins over the existing sync engine (supabase/migrations/*_checkins.sql). LOCAL stack only. */

type Result = { op_id: string; status: string; outcome?: string; code?: string | null }
type WireCheckin = {
  local_date: string
  phase: "am" | "pm"
  sleep_hours: number | null
  energy: number | null
  mood: number | null
  stress: number | null
  note: string | null
  field_stamps: Record<string, string>
  note_seq: number | null
  deleted: boolean
  server_seq: number
}

async function apply(u: TestUser, ops: unknown[]) {
  const { data, error } = await u.client.rpc("apply_ops", { p_device_id: "it", p_ops: ops })
  if (error) throw error
  return (data as { results: Result[] }).results
}

async function pull(u: TestUser, since = 0) {
  const { data, error } = await u.client.rpc("pull_changes", { p_since: since })
  if (error) throw error
  return data as { server_today: string; cursor: number; daily_checkins: WireCheckin[]; profile: { checkin_fields: { am: string[]; pm: string[] } | null } }
}

const iso = (t: number) => new Date(t).toISOString()
const set = (date: string, phase: "am" | "pm", fields: Record<string, unknown>, at = Date.now(), base: number | null = null) => ({
  type: "checkin.set",
  op_id: opId("ci"),
  local_date: date,
  phase,
  fields,
  at: iso(at),
  base_note_seq: base,
})

let a: TestUser
let b: TestUser
let today: string

beforeAll(async () => {
  a = await createTestUser("checkins-a")
  b = await createTestUser("checkins-b")
  today = (await pull(a)).server_today
})
afterAll(async () => {
  await deleteTestUser(a)
  await deleteTestUser(b)
})

const one = async (u: TestUser, date: string, phase: "am" | "pm") => (await pull(u)).daily_checkins.find((c) => c.local_date === date && c.phase === phase) ?? null

describe("daily_checkins (M3.3)", () => {
  it("one check-in per day and phase; fields accumulate; a replayed op applies once", async () => {
    const op = set(today, "am", { sleep_hours: 7.25 })
    expect((await apply(a, [op]))[0].status).toBe("applied")
    expect((await apply(a, [op]))[0]).toMatchObject({ status: "duplicate", outcome: "applied" })
    await apply(a, [set(today, "am", { energy: 4, mood: 3 })])
    const rows = await db(async (c) => (await c.query("select * from public.daily_checkins where user_id = $1", [a.id])).rows)
    expect(rows).toHaveLength(1)
    expect(await one(a, today, "am")).toMatchObject({ sleep_hours: 7.25, energy: 4, mood: 3, stress: null, deleted: false })
    // The table itself refuses a second row for the same day and phase.
    await expect(db((c) => c.query("insert into public.daily_checkins (user_id, local_date, phase, energy) values ($1, $2, 'am', 2)", [a.id, today]))).rejects.toThrow(/unique|duplicate/)
  })

  it("per-field last-writer-wins: an older write never overwrites a newer value; other fields are taken (decision 3)", async () => {
    const t = Date.now()
    await apply(a, [set(today, "pm", { mood: 4 }, t)])
    await apply(a, [set(today, "pm", { mood: 2, stress: 3 }, t - 60_000)])
    expect(await one(a, today, "pm")).toMatchObject({ mood: 4, stress: 3 })
    // A device clock far ahead is capped at server now + 1 min, so it cannot freeze a field forever.
    await apply(a, [set(today, "pm", { energy: 5 }, t + 3600_000)])
    const stamp = Date.parse((await one(a, today, "pm"))!.field_stamps.energy)
    expect(stamp).toBeLessThanOrEqual(Date.now() + 61_000)
  })

  it("a concurrent reflection is a conflict (never a silent overwrite); a sequential one is not", async () => {
    const d = addDays(today, -1)
    await apply(a, [set(d, "pm", { note: "Escrito en el móvil" })])
    const seen = (await one(a, d, "pm"))!.note_seq
    // Another device that never saw it.
    expect((await apply(a, [set(d, "pm", { note: "Escrito en el ordenador" }, Date.now(), null)]))[0]).toMatchObject({ status: "conflict", code: "note_conflict" })
    expect((await one(a, d, "pm"))!.note).toBe("Escrito en el móvil")
    // Against the version it saw: applied («Aplicar el mío» re-sends with the new base).
    expect((await apply(a, [set(d, "pm", { note: "  Escrito en el ordenador \r\n" }, Date.now(), seen)]))[0].status).toBe("applied")
    expect((await one(a, d, "pm"))!.note).toBe("Escrito en el ordenador")
    // Writing the same text again, or clearing a reflection nobody else changed, is fine.
    const now = (await one(a, d, "pm"))!.note_seq
    expect((await apply(a, [set(d, "pm", { note: null }, Date.now(), now)]))[0].status).toBe("applied")
  })

  it("clearing every field leaves a tombstone: incremental pulls carry it, full pulls omit it", async () => {
    const d = addDays(today, -2)
    await apply(a, [set(d, "am", { energy: 2 })])
    const cursor = (await pull(a)).cursor
    await apply(a, [set(d, "am", { energy: null })])
    const inc = (await pull(a, cursor)).daily_checkins.find((c) => c.local_date === d)
    expect(inc).toMatchObject({ deleted: true, energy: null })
    expect((await pull(a)).daily_checkins.find((c) => c.local_date === d)).toBeUndefined()
    // It can be filled again.
    await apply(a, [set(d, "am", { mood: 5 })])
    expect(await one(a, d, "am")).toMatchObject({ mood: 5, deleted: false })
  })

  it("rejects future days, out-of-range values and unknown fields, deterministically", async () => {
    const bad = [
      set(addDays(today, 2), "am", { energy: 3 }),
      set(today, "am", { energy: 6 }),
      set(today, "am", { energy: 2.5 }),
      set(today, "am", { sleep_hours: 7.1 }),
      set(today, "am", { sleep_hours: 17 }),
      set(today, "am", { steps: 1000 }),
      set(today, "am", { note: "x".repeat(1001) }),
      { ...set(today, "am", { energy: 3 }), phase: "noon" },
    ]
    const res = await apply(a, bad)
    expect(res.map((r) => r.status)).toEqual(Array(bad.length).fill("rejected"))
    expect(res[0].code).toBe("future_date")
    // Tomorrow is allowed (one day of slack for the 04:00 rollover and clocks around midnight).
    expect((await apply(a, [set(addDays(today, 1), "am", { energy: 3 })]))[0].status).toBe("applied")
  })

  it("RLS: another user never reads or writes my check-ins; anon has no access at all", async () => {
    await apply(a, [set(addDays(today, -3), "pm", { stress: 4, note: "privado" })])
    expect((await pull(b)).daily_checkins).toEqual([])
    const { data } = await b.client.from("daily_checkins").select("*")
    expect(data).toEqual([])
    const upd = await b.client.from("daily_checkins").update({ stress: 1 }).eq("user_id", a.id).select()
    expect(upd.data ?? []).toEqual([])
    const ins = await b.client.from("daily_checkins").insert({ user_id: a.id, local_date: today, phase: "am", energy: 1 })
    expect(ins.error).not.toBeNull()
    const del = await a.client.from("daily_checkins").delete().eq("user_id", a.id)
    expect(del.error).not.toBeNull()
    const anon = await anonClient().from("daily_checkins").select("*")
    expect(anon.error ?? (anon.data?.length === 0 ? null : "leak")).not.toBe("leak")
    expect(anon.data ?? []).toEqual([])
  })

  it("the audit log records which fields changed, never their values or the reflection", async () => {
    const logs = await db(async (c) => (await c.query("select action, metadata_json::text m from public.audit_logs where user_id = $1 and entity_type = 'daily_checkin'", [a.id])).rows)
    expect(logs.length).toBeGreaterThan(0)
    for (const l of logs) {
      expect(l.action).toBe("set")
      expect(l.m).not.toMatch(/privado|Escrito|móvil|ordenador/)
      expect(JSON.parse(l.m).fields.every((f: string) => ["sleep_hours", "energy", "mood", "stress", "note"].includes(f))).toBe(true)
    }
  })

  it("indicators per phase sync as a whole, in canonical order, and are validated however they are written", async () => {
    expect((await pull(b)).profile.checkin_fields).toBeNull()
    expect((await apply(b, [{ type: "profile.checkin_fields", op_id: opId("cfg"), am: ["mood", "sleep"], pm: ["note", "stress"] }]))[0].status).toBe("applied")
    expect((await pull(b)).profile.checkin_fields).toEqual({ am: ["sleep", "mood"], pm: ["stress", "note"] })
    const bad = await apply(b, [
      { type: "profile.checkin_fields", op_id: opId("cfg"), am: ["note"], pm: ["mood"] },
      { type: "profile.checkin_fields", op_id: opId("cfg"), am: [], pm: ["mood"] },
      { type: "profile.checkin_fields", op_id: opId("cfg"), am: ["steps"], pm: ["mood"] },
    ])
    expect(bad.map((r) => r.code)).toEqual(["invalid_config", "invalid_config", "invalid_config"])
    // A direct write to the profile is validated by the trigger too.
    const direct = await b.client.from("profiles").update({ settings_json: { checkin: { am: [], pm: "x" } } }).eq("id", b.id)
    expect(direct.error?.message).toMatch(/invalid_config/)
    expect((await pull(b)).profile.checkin_fields).toEqual({ am: ["sleep", "mood"], pm: ["stress", "note"] })
  })

  it("the incremental cursor covers check-ins (a later change is seen after the cursor)", async () => {
    const c0 = (await pull(a)).cursor
    await apply(a, [set(addDays(today, -4), "am", { sleep_hours: 6 })])
    const inc = await pull(a, c0)
    expect(inc.cursor).toBeGreaterThan(c0)
    expect(inc.daily_checkins.map((c) => c.local_date)).toContain(addDays(today, -4))
  })
})
