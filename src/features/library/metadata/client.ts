import { z } from "zod"
import { bookResultSchema, episodeListSchema, responseSchema, showResultSchema, type BookResult, type EpisodeList, type MetadataResponse, type ShowResult } from "./types"

/**
 * Browser side of the metadata endpoints: same-origin requests only (the CSP is unchanged) and
 * every answer validated again, so a server bug or a proxy page can never reach the interface as
 * data. Aborts propagate (the search controller cancels superseded requests).
 */
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>

async function call<T>(path: string, params: Record<string, string | undefined>, schema: z.ZodType<T>, signal: AbortSignal, fetcher: Fetcher): Promise<MetadataResponse<T>> {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ""))
  let res: Response
  try {
    res = await fetcher(`/api/metadata/${path}?${qs}`, { credentials: "same-origin", cache: "no-store", signal, headers: { Accept: "application/json" } })
  } catch (e) {
    if (signal.aborted) throw e
    return { ok: false, error: { code: "network" } }
  }
  let json: unknown
  try {
    json = await res.json()
  } catch (e) {
    if (signal.aborted) throw e
    // A non-JSON page (login redirect, offline page, gateway error) is not an answer.
    return { ok: false, error: { code: res.status === 401 ? "unauthorized" : "network" } }
  }
  const parsed = responseSchema(schema).safeParse(json)
  return parsed.success ? (parsed.data as MetadataResponse<T>) : { ok: false, error: { code: "network" } }
}

const browserFetch: Fetcher = (input, init) => fetch(input, init)

export const metadataClient = (fetcher: Fetcher = browserFetch) => ({
  searchBooks: (q: string, signal: AbortSignal, opts: { by?: "any" | "title" | "author" | "isbn"; lang?: "es" | "en" } = {}) =>
    call<BookResult[]>("books/search", { q, by: opts.by, lang: opts.lang }, z.array(bookResultSchema), signal, fetcher),
  bookDetail: (work: string, edition: string | null, signal: AbortSignal) =>
    call<BookResult>("books/detail", { work, edition: edition ?? undefined }, bookResultSchema, signal, fetcher),
  bookEditions: (work: string, signal: AbortSignal, lang?: "es" | "en") => call<BookResult[]>("books/editions", { work, lang }, z.array(bookResultSchema), signal, fetcher),
  searchShows: (q: string, signal: AbortSignal) => call<ShowResult[]>("podcasts/search", { q }, z.array(showResultSchema), signal, fetcher),
  showEpisodes: (show: string, signal: AbortSignal, q?: string) => call<EpisodeList>("podcasts/episodes", { show, q }, episodeListSchema, signal, fetcher),
})
