import { describe, expect, it, vi } from "vitest"
import { addDays } from "@/features/habits/domain/dates"
import { entries, makeHabit, makeState } from "@/features/habits/domain/test-helpers"
import type { HabitsState } from "@/features/habits/domain/types"
import { setCheckin } from "@/features/mind/domain/ops"
import { aiContextFrom, createAiClient, readAiConfig, SUPPORTED_PROVIDERS, type AiProvider } from "./ai-provider"

const TODAY = "2026-11-10"

describe("the AI provider is off by default", () => {
  it("with nothing configured it is disabled, and there is no client to call", () => {
    const status = readAiConfig({})
    expect(status).toEqual({ enabled: false, reason: "not_configured" })
    expect(createAiClient(status, {})).toBeNull()
  })

  it("no provider is built in: naming one does not turn anything on", () => {
    expect(SUPPORTED_PROVIDERS).toEqual([])
    expect(readAiConfig({ AI_PROVIDER: "gemini", AI_API_KEY: "k", AI_MONTHLY_TOKEN_BUDGET: "1000" })).toEqual({ enabled: false, reason: "unknown_provider" })
  })

  it("a known provider still needs a key and a monthly budget", () => {
    const known = ["fake"]
    expect(readAiConfig({ AI_PROVIDER: "fake", AI_MONTHLY_TOKEN_BUDGET: "1000" }, known)).toEqual({ enabled: false, reason: "no_key" })
    expect(readAiConfig({ AI_PROVIDER: "fake", AI_API_KEY: "k" }, known)).toEqual({ enabled: false, reason: "no_budget" })
    expect(readAiConfig({ AI_PROVIDER: "fake", AI_API_KEY: "k", AI_MONTHLY_TOKEN_BUDGET: "0" }, known)).toEqual({ enabled: false, reason: "no_budget" })
  })

  it("the status never carries the key", () => {
    const status = readAiConfig({ AI_PROVIDER: "fake", AI_API_KEY: "secreto-123", AI_MONTHLY_TOKEN_BUDGET: "1000" }, ["fake"])
    expect(status).toEqual({ enabled: true, provider: "fake", monthlyTokenBudget: 1000 })
    expect(JSON.stringify(status)).not.toContain("secreto-123")
  })

  it("without a client nothing reaches the network", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const client = createAiClient(readAiConfig({}), {})
    expect(client).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe("when a provider is enabled", () => {
  const status = readAiConfig({ AI_PROVIDER: "fake", AI_API_KEY: "k", AI_MONTHLY_TOKEN_BUDGET: "1000" }, ["fake"])
  const fake = (): AiProvider & { calls: number } => {
    const p = { name: "fake", calls: 0, async complete() { p.calls++; return { text: "ok", tokens: 10 } } }
    return p
  }

  it("calls it within the monthly budget", async () => {
    const p = fake()
    const client = createAiClient(status, { fake: () => p })!
    expect(await client.complete({ purpose: "explain_insight", context: { insights: [] }, maxTokens: 100 }, 0)).toEqual({ ok: true, text: "ok", tokens: 10 })
    expect(p.calls).toBe(1)
  })

  it("refuses without calling once the request would go over the budget", async () => {
    const p = fake()
    const client = createAiClient(status, { fake: () => p })!
    expect(await client.complete({ purpose: "explain_insight", context: { insights: [] }, maxTokens: 100 }, 950)).toEqual({ ok: false, reason: "over_budget" })
    expect(p.calls).toBe(0)
  })

  it("a failing provider is reported, not thrown", async () => {
    const client = createAiClient(status, { fake: () => ({ name: "fake", complete: async () => Promise.reject(new Error("503")) }) })!
    expect(await client.complete({ purpose: "explain_insight", context: { insights: [] }, maxTokens: 10 }, 0)).toEqual({ ok: false, reason: "provider_error" })
  })
})

describe("what could ever be sent", () => {
  it("is only the rule results: no reflections, notes or raw records", () => {
    const h = makeHabit({ id: "h1", name: "Leer", startDate: "2026-08-01" })
    let s: HabitsState = makeState([h], entries("h1", Object.fromEntries(Array.from({ length: 101 }, (_, i) => [addDays("2026-08-01", i), true]))))
    s = setCheckin(s, { date: "2026-11-09", phase: "pm", values: { energy: 4, note: "NOTA-PRIVADA-123" }, at: "2026-11-09T20:00:00.000Z", today: TODAY }).state
    const ctx = aiContextFrom(s, TODAY)
    expect(ctx.insights.length).toBeGreaterThan(0)
    const json = JSON.stringify(ctx)
    expect(json).not.toContain("NOTA-PRIVADA-123")
    for (const i of ctx.insights) expect(Object.keys(i).sort()).toEqual(["n", "period", "statement", "title", "variables"])
  })
})
