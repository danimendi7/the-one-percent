import { detectIsbn, QUERY_MIN, queryKey } from "./query"
import type { MetadataErrorCode, MetadataResponse } from "./types"

/**
 * Search-as-you-type without React (docs/m4g-plan.md §5.6), reusable by the book and podcast
 * searches of M4g.3/M4g.4:
 * - waits `debounceMs` after the last keystroke (an ISBN goes at once);
 * - aborts the request it supersedes and ignores any late answer;
 * - remembers answers of this session (bounded), so going back is instant;
 * - offline, it does not ask: the interface offers manual entry (D8).
 * Errors are not remembered, so «Reintentar» asks again.
 */
export type SearchState<T> =
  | { status: "idle" }
  | { status: "waiting"; query: string }
  | { status: "loading"; query: string }
  | { status: "done"; query: string; data: T }
  | { status: "error"; query: string; code: MetadataErrorCode; retryAfter?: number }
  | { status: "offline"; query: string }

export interface SearchControllerOptions<T> {
  run: (query: string, signal: AbortSignal) => Promise<MetadataResponse<T>>
  onChange: (state: SearchState<T>) => void
  debounceMs?: number
  minLength?: number
  cacheSize?: number
  online?: () => boolean
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export function createSearchController<T>(o: SearchControllerOptions<T>) {
  const debounceMs = o.debounceMs ?? 350
  const minLength = o.minLength ?? QUERY_MIN
  const cacheSize = o.cacheSize ?? 30
  const online = o.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false)
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const cache = new Map<string, T>()
  let timer: unknown = null
  let controller: AbortController | null = null
  let seq = 0
  let last = ""
  let disposed = false

  const emit = (s: SearchState<T>) => {
    if (!disposed) o.onChange(s)
  }

  function stop() {
    if (timer !== null) clearTimer(timer)
    timer = null
    controller?.abort()
    controller = null
  }

  async function run(query: string, id: number) {
    const key = queryKey(query)
    const hit = cache.get(key)
    if (hit !== undefined) return emit({ status: "done", query, data: hit })
    if (!online()) return emit({ status: "offline", query })
    controller = new AbortController()
    const signal = controller.signal
    emit({ status: "loading", query })
    try {
      const res = await o.run(query, signal)
      if (id !== seq) return
      if (res.ok) {
        cache.delete(key)
        cache.set(key, res.data)
        if (cache.size > cacheSize) cache.delete(cache.keys().next().value!)
        emit({ status: "done", query, data: res.data })
      } else if (res.error.code === "network" && !online()) emit({ status: "offline", query })
      else emit({ status: "error", query, code: res.error.code, ...(res.error.retryAfter !== undefined && { retryAfter: res.error.retryAfter }) })
    } catch {
      // Aborted: a newer search (or dispose) took over.
      if (id === seq && !signal.aborted) emit({ status: "error", query, code: "network" })
    }
  }

  return {
    /** Call on every change of the text. */
    search(text: string) {
      stop()
      const id = ++seq
      last = text.trim()
      if (last.length < minLength && !detectIsbn(last)) return emit({ status: "idle" })
      if (detectIsbn(last) || cache.has(queryKey(last))) return void run(last, id)
      emit({ status: "waiting", query: last })
      timer = setTimer(() => {
        timer = null
        void run(last, id)
      }, debounceMs)
    },
    /** Same query again, now (after an error or when the connection comes back). */
    retry() {
      stop()
      const id = ++seq
      if (last.length >= minLength || detectIsbn(last)) void run(last, id)
    },
    dispose() {
      disposed = true
      seq++
      stop()
    },
  }
}
