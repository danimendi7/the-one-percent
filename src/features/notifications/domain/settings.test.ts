import { describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS } from "./motivation"
import { normalizeMotivation, sampleNudge } from "./settings"

describe("notification settings read from anywhere are made valid", () => {
  it("nothing gives the defaults", () => {
    expect(normalizeMotivation(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeMotivation("x")).toEqual(DEFAULT_SETTINGS)
  })

  it("keeps every valid field", () => {
    const s = { ...DEFAULT_SETTINGS, tone: "calm", dailyCap: 2, quietStart: "23:15", quietEnd: "07:00", minGapMinutes: 90, daysOff: [6, 7], rules: { ...DEFAULT_SETTINGS.rules, recall: true }, times: { ...DEFAULT_SETTINGS.times, late: "20:30" } }
    expect(normalizeMotivation(s)).toEqual(s)
  })

  it("replaces each invalid field with its default, field by field", () => {
    const s = normalizeMotivation({ enabled: "yes", tone: "angry", dailyCap: 99, quietStart: "25:00", quietEnd: "7:00", minGapMinutes: -5, daysOff: [0, 3, 3, 8], rules: { late: "no", recall: true, extra: true }, times: { morning: "06:30", late: "nope" }, extra: 1 })
    expect(s).toEqual({
      ...DEFAULT_SETTINGS,
      daysOff: [3],
      rules: { ...DEFAULT_SETTINGS.rules, recall: true },
      times: { ...DEFAULT_SETTINGS.times, morning: "06:30" },
    })
  })

  it("strong language only stays on with the Hardcore tone", () => {
    expect(normalizeMotivation({ ...DEFAULT_SETTINGS, tone: "calm", profanity: true }).profanity).toBe(false)
    expect(normalizeMotivation({ ...DEFAULT_SETTINGS, tone: "hardcore", profanity: true }).profanity).toBe(true)
  })

  it("the preview follows the tone", () => {
    expect(sampleNudge({ ...DEFAULT_SETTINGS, tone: "calm" }).body).not.toBe(sampleNudge({ ...DEFAULT_SETTINGS, tone: "hardcore" }).body)
  })
})
