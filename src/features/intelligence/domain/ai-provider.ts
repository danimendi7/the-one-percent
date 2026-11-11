import type { LocalDate } from "@/features/habits/domain/dates"
import type { DateRange } from "@/features/habits/domain/metrics"
import type { HabitsState } from "@/features/habits/domain/types"
import { insights } from "./insights"

/**
 * The optional generative AI provider (PRD §4.2, Plan Maestro 5.9), off by default. Architecture
 * only: no provider is built in, because every one would mean pay-per-use, which the order rules
 * out. To add one with authorization: implement `AiProvider`, add its name to SUPPORTED_PROVIDERS
 * and set AI_PROVIDER, AI_API_KEY and AI_MONTHLY_TOKEN_BUDGET on the server. Without all three
 * there is no client, and so no call.
 */
export const SUPPORTED_PROVIDERS: readonly string[] = []

export type AiStatus =
  | { enabled: false; reason: "not_configured" | "unknown_provider" | "no_key" | "no_budget" }
  /** Never carries the key: it can be shown or logged. */
  | { enabled: true; provider: string; monthlyTokenBudget: number }

export function readAiConfig(env: Record<string, string | undefined>, supported: readonly string[] = SUPPORTED_PROVIDERS): AiStatus {
  const provider = env.AI_PROVIDER?.trim()
  if (!provider) return { enabled: false, reason: "not_configured" }
  if (!supported.includes(provider)) return { enabled: false, reason: "unknown_provider" }
  if (!env.AI_API_KEY?.trim()) return { enabled: false, reason: "no_key" }
  const budget = Number(env.AI_MONTHLY_TOKEN_BUDGET)
  if (!Number.isFinite(budget) || budget <= 0) return { enabled: false, reason: "no_budget" }
  return { enabled: true, provider, monthlyTokenBudget: Math.floor(budget) }
}

/** Only what the rules already concluded, never a raw record, a reflection or a note. */
export interface AiContext {
  insights: { title: string; statement: string; n: number; period: DateRange; variables: string[] }[]
}

export function aiContextFrom(state: HabitsState, today: LocalDate): AiContext {
  return { insights: insights(state, today).map((i) => ({ title: i.title, statement: i.statement, n: i.n, period: i.period, variables: i.variables })) }
}

export interface AiRequest {
  purpose: "explain_insight" | "topic_suggestion"
  context: AiContext
  maxTokens: number
}

export interface AiProvider {
  name: string
  complete(request: AiRequest): Promise<{ text: string; tokens: number }>
}

export type AiResult = { ok: true; text: string; tokens: number } | { ok: false; reason: "over_budget" | "provider_error" }

export interface AiClient {
  /** `usedThisMonth`: tokens already spent; a request that could go over the budget is refused unsent. */
  complete(request: AiRequest, usedThisMonth: number): Promise<AiResult>
}

export function createAiClient(status: AiStatus, factories: Record<string, () => AiProvider>): AiClient | null {
  if (!status.enabled) return null
  const make = factories[status.provider]
  if (!make) return null
  const provider = make()
  return {
    async complete(request, usedThisMonth) {
      if (usedThisMonth + request.maxTokens > status.monthlyTokenBudget) return { ok: false, reason: "over_budget" }
      try {
        const r = await provider.complete(request)
        return { ok: true, text: r.text, tokens: r.tokens }
      } catch {
        return { ok: false, reason: "provider_error" }
      }
    },
  }
}
