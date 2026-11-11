import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { metadataClient, type Fetcher } from "./client"
import { createSearchController, type SearchState } from "./search-controller"
import type { MetadataResponse } from "./types"

describe("search controller: debounce, cancellation, session cache, offline", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(online = () => true) {
    const states: SearchState<string>[] = []
    const calls: { q: string; signal: AbortSignal; resolve: (r: MetadataResponse<string>) => void }[] = []
    const c = createSearchController<string>({
      run: (q, signal) => new Promise((resolve) => calls.push({ q, signal, resolve })),
      onChange: (s) => states.push(s),
      online,
    })
    return { c, states, calls, last: () => states.at(-1) }
  }

  it("waits 350 ms after the last keystroke and asks once", async () => {
    const { c, calls, last } = setup()
    c.search("s")
    expect(last()).toEqual({ status: "idle" })
    c.search("sa")
    c.search("sap")
    c.search("sapiens")
    expect(last()).toEqual({ status: "waiting", query: "sapiens" })
    await vi.advanceTimersByTimeAsync(349)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls.map((x) => x.q)).toEqual(["sapiens"])
    expect(last()).toEqual({ status: "loading", query: "sapiens" })
    calls[0].resolve({ ok: true, data: "R" })
    await vi.runAllTimersAsync()
    expect(last()).toEqual({ status: "done", query: "sapiens", data: "R" })
  })

  it("a new search aborts the previous request and its late answer is ignored", async () => {
    const { c, calls, states } = setup()
    c.search("dune")
    await vi.advanceTimersByTimeAsync(350)
    c.search("dune messiah")
    expect(calls[0].signal.aborted).toBe(true)
    calls[0].resolve({ ok: true, data: "OLD" })
    await vi.advanceTimersByTimeAsync(350)
    calls[1].resolve({ ok: true, data: "NEW" })
    await vi.runAllTimersAsync()
    expect(states.filter((s) => s.status === "done")).toEqual([{ status: "done", query: "dune messiah", data: "NEW" }])
  })

  it("an ISBN goes at once; a repeated query comes from the session cache", async () => {
    const { c, calls, last } = setup()
    c.search("978-84-17860-79-0")
    expect(calls).toHaveLength(1)
    calls[0].resolve({ ok: true, data: "ISBN" })
    await vi.runAllTimersAsync()
    c.search("otra")
    await vi.advanceTimersByTimeAsync(350)
    c.search("978-84-17860-79-0")
    expect(last()).toEqual({ status: "done", query: "978-84-17860-79-0", data: "ISBN" })
    expect(calls).toHaveLength(2)
  })

  it("errors are reported (with Retry-After) and not cached; retry asks again", async () => {
    const { c, calls, last } = setup()
    c.search("huberman")
    await vi.advanceTimersByTimeAsync(350)
    calls[0].resolve({ ok: false, error: { code: "provider_busy", retryAfter: 5 } })
    await vi.runAllTimersAsync()
    expect(last()).toEqual({ status: "error", query: "huberman", code: "provider_busy", retryAfter: 5 })
    c.retry()
    expect(calls).toHaveLength(2)
  })

  it("offline: nothing is requested and manual entry can be offered", async () => {
    let online = false
    const { c, calls, last } = setup(() => online)
    c.search("sapiens")
    await vi.advanceTimersByTimeAsync(350)
    expect(calls).toHaveLength(0)
    expect(last()).toEqual({ status: "offline", query: "sapiens" })
    online = true
    c.retry()
    expect(calls).toHaveLength(1)
  })

  it("dispose cancels everything and stays silent", async () => {
    const { c, calls, states } = setup()
    c.search("sapiens")
    await vi.advanceTimersByTimeAsync(350)
    const before = states.length
    c.dispose()
    expect(calls[0].signal.aborted).toBe(true)
    calls[0].resolve({ ok: true, data: "x" })
    await vi.runAllTimersAsync()
    expect(states.length).toBe(before)
  })
})

describe("metadata client: answers are validated again in the browser", () => {
  const signal = new AbortController().signal
  const answer = (status: number, body: string): Fetcher => async () => new Response(body, { status, headers: { "Content-Type": "application/json" } })

  it("same-origin request with the parameters, and a valid answer passes", async () => {
    let seen = ""
    let init: RequestInit = {}
    const f: Fetcher = async (u, i) => ((seen = u), (init = i), new Response(JSON.stringify({ ok: true, data: [] })))
    expect(await metadataClient(f).searchShows("la ruina", signal)).toEqual({ ok: true, data: [] })
    expect(seen).toBe("/api/metadata/podcasts/search?q=la+ruina")
    expect(init).toMatchObject({ credentials: "same-origin", cache: "no-store" })
  })

  it("a malformed or foreign answer is never data", async () => {
    const bad = JSON.stringify({ ok: true, data: [{ provider: "itunes", id: "x", title: "<b>" }] })
    expect(await metadataClient(answer(200, bad)).searchShows("xx", signal)).toEqual({ ok: false, error: { code: "network" } })
    expect(await metadataClient(answer(200, "<html>login</html>")).searchShows("xx", signal)).toEqual({ ok: false, error: { code: "network" } })
    expect(await metadataClient(answer(401, "<html>")).searchShows("xx", signal)).toEqual({ ok: false, error: { code: "unauthorized" } })
    const err = JSON.stringify({ ok: false, error: { code: "rate_limited", retryAfter: 3 } })
    expect(await metadataClient(answer(429, err)).searchShows("xx", signal)).toEqual({ ok: false, error: { code: "rate_limited", retryAfter: 3 } })
  })

  it("no connection is a network error; an abort is rethrown", async () => {
    const down: Fetcher = async () => {
      throw new TypeError("Failed to fetch")
    }
    expect(await metadataClient(down).searchShows("xx", signal)).toEqual({ ok: false, error: { code: "network" } })
    const ac = new AbortController()
    ac.abort()
    const aborting: Fetcher = async () => {
      throw new DOMException("aborted", "AbortError")
    }
    await expect(metadataClient(aborting).searchShows("xx", ac.signal)).rejects.toThrow()
  })
})
