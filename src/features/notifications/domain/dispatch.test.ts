import { describe, expect, it } from "vitest"
import { entries, makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import { deliveryOutcome, deviceResult, parseDispatchUsers, planFor, pushPayload, reachable, type DispatchUser } from "./dispatch"
import { DEFAULT_SETTINGS, type MotivationSettings } from "./motivation"

const TODAY = "2026-11-10" // Tuesday
const KEY = "BMvEjgb5ntOXJI244QmBG0AWhMPPFnUp2np-PoRDO4sTSNboeeBNXgNGNutTdjUvx6Yjh17qINcUgm_Xe9T-26I"
const OTHER = "B" + "x".repeat(86)
const UID = "11111111-1111-4111-8111-111111111111"
const DEV = "22222222-2222-4222-8222-222222222222"
// 19:30 in Madrid (UTC+1 in November).
const AT_1930 = new Date("2026-11-10T18:30:00Z")
const habits = [makeHabit({ id: "h1", name: "Leer", startDate: "2026-10-01" }), makeHabit({ id: "h2", name: "Correr", startDate: "2026-10-01" })]
const only = (rule: keyof MotivationSettings["rules"], over: Partial<MotivationSettings> = {}): MotivationSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
  rules: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.rules).map((k) => [k, k === rule])) as MotivationSettings["rules"],
})
const user = (over: Partial<DispatchUser> = {}): DispatchUser => ({ userId: UID, timezone: "Europe/Madrid", sent: [], devices: [], ...over })
const withSettings = (s: MotivationSettings, e = {}) => ({ ...makeState(habits, e), timezone: "Europe/Madrid", motivation: s })

describe("planFor", () => {
  it("evaluates the Motivation Engine in the person's timezone, at send time", () => {
    const p = planFor(user(), withSettings(only("late")), AT_1930)
    expect(p).toMatchObject({ today: TODAY, minutes: 19 * 60 + 30 })
    expect(p.nudges.map((n) => n.key)).toEqual([`late:${TODAY}`])
  })

  it("a habit done meanwhile is not mentioned; all done means nothing to send", () => {
    expect(planFor(user(), withSettings(only("late"), entries("h1", { [TODAY]: true })), AT_1930).nudges[0].habitIds).toEqual(["h2"])
    const done = { ...entries("h1", { [TODAY]: true }), ...entries("h2", { [TODAY]: true }) }
    expect(planFor(user(), withSettings(only("late"), done), AT_1930).nudges).toEqual([])
  })

  it("respects silence, the daily cap, the gap and what was already delivered", () => {
    expect(planFor(user(), withSettings(only("late", { quietStart: "19:00", quietEnd: "07:00" })), AT_1930).nudges).toEqual([])
    const sentLate = { key: `late:${TODAY}`, rule: "late" as const, at: "x", localDate: TODAY, minutes: 19 * 60 }
    expect(planFor(user({ sent: [sentLate] }), withSettings(only("late")), AT_1930).nudges).toEqual([])
    const sentOther = { ...sentLate, key: `review:2026-11-09`, rule: "review" as const, minutes: 19 * 60 + 10 }
    expect(planFor(user({ sent: [sentOther] }), withSettings(only("late", { minGapMinutes: 60 })), AT_1930).nudges).toEqual([])
    expect(planFor(user({ sent: [sentOther] }), withSettings(only("late", { dailyCap: 1, minGapMinutes: 0 })), AT_1930).nudges).toEqual([])
  })
})

describe("pushPayload", () => {
  it("never puts habit names on the lock screen", () => {
    const [n] = planFor(user(), withSettings(only("late")), AT_1930).nudges
    expect(n.body).toContain("Leer")
    const p = pushPayload(n)
    expect(p).toEqual({ title: n.title, body: "Aún quedan 2 hábitos por hoy.", url: "/", tag: "top-late" })
    expect(JSON.stringify(p)).not.toMatch(/Leer|Correr/)
  })

  it("opens the screen of the reminder", () => {
    expect(pushPayload({ key: "review:2026-11-09", rule: "review", title: "Revisión semanal", body: "b" }).url).toBe("/reviews")
    expect(pushPayload({ key: "recall:2026-11-10", rule: "recall", title: "Repaso", body: "b" }).url).toBe("/knowledge/brain/repaso")
    expect(pushPayload({ key: "due:2026-11-10", rule: "due", title: "t", body: "b", habitIds: ["h1"] }).body).toBe("Queda 1 hábito por hoy.")
  })
})

describe("parseDispatchUsers and reachable", () => {
  it("keeps well-formed people and devices and drops the rest", () => {
    const users = parseDispatchUsers([
      {
        user_id: UID,
        timezone: "Atlantic/Canary",
        sent: [{ key: `late:${TODAY}`, rule: "late", at: "2026-11-10T19:00:00Z", localDate: TODAY, minutes: 1140 }, { key: 1 }],
        devices: [
          { id: DEV, endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: KEY, auth: "a", vapid_key: KEY },
          { id: DEV, endpoint: "https://evil.example/x", p256dh: KEY, auth: "a", vapid_key: KEY },
        ],
      },
      { user_id: "not-a-uuid" },
      "x",
    ])
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ userId: UID, timezone: "Atlantic/Canary" })
    expect(users[0].sent).toHaveLength(1)
    expect(users[0].devices.map((d) => d.endpoint)).toEqual(["https://fcm.googleapis.com/fcm/send/x"])
    expect(parseDispatchUsers(null)).toEqual([])
  })

  it("only devices subscribed with the current server key can receive", () => {
    const d = { id: DEV, endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: KEY, auth: "a", vapidKey: KEY }
    expect(reachable([d, { ...d, vapidKey: OTHER }], KEY)).toEqual([d])
  })
})

describe("outcomes", () => {
  it("a delivery is sent if any device accepted it", () => {
    expect(deliveryOutcome(["ok", "gone", "failed"])).toEqual({ status: "sent", ok: 1, failed: 1, gone: 1 })
    expect(deliveryOutcome(["failed", "gone"])).toEqual({ status: "failed", ok: 0, failed: 1, gone: 1 })
    expect(deliveryOutcome(["gone"])).toEqual({ status: "none", ok: 0, failed: 0, gone: 1 })
    expect(deliveryOutcome([])).toEqual({ status: "none", ok: 0, failed: 0, gone: 0 })
  })

  it("404 and 410 mean the device is gone", () => {
    expect([201, 404, 410, 429, 500, undefined].map(deviceResult)).toEqual(["ok", "gone", "gone", "failed", "failed", "failed"])
  })
})
