import { COVER_HOSTS, coverRedirectAllowed, coverUpstreamUrl, type CoverKey, type CoverSize } from "../covers"
import { CircuitBreaker, InFlight, TokenBucket } from "./limits"
import { safeFetchImage, UpstreamError, type ImageType } from "./safe-fetch"
import { defaultServiceDeps, ServiceError, type ServiceDeps } from "./service"

/**
 * Cover images (M4g.2). Public provider images only, fetched without anything of the user, never
 * stored on the server (they weigh 6–100 KB and the browser keeps them). Limits per §15:
 * 5 s, 2 MB, at most the 2 redirects of Open Library's measured chain, at least 1 KB.
 * No retries: a missing cover shows the typographic one, so a second attempt is never worth it.
 *
 * A timeout does not count against the provider: archive.org, which stores older Open Library
 * covers, answered in 3–12 s on 31/10/2026, and pausing Open Library for it would also hide the
 * covers covers.openlibrary.org serves at once. The per-instance buckets still bound the rate.
 */
export const COVER_LIMITS = { timeoutMs: 5_000, maxBytes: 2 * 1024 * 1024, minBytes: 1_024, maxRedirects: 2 }

type Provider = CoverKey["provider"]

export function createCoverService(deps: ServiceDeps = defaultServiceDeps) {
  const breakers: Record<Provider, CircuitBreaker> = { openlibrary: new CircuitBreaker(deps.now), apple: new CircuitBreaker(deps.now) }
  // Per instance. Covers by id have no published limit; these keep a grid from becoming a burst.
  const buckets: Record<Provider, TokenBucket> = { openlibrary: new TokenBucket(20, 120, deps.now), apple: new TokenBucket(30, 240, deps.now) }
  const inFlight = new InFlight<{ bytes: Uint8Array; type: ImageType }>()

  return {
    get(key: CoverKey, size: CoverSize): Promise<{ bytes: Uint8Array; type: ImageType }> {
      const url = coverUpstreamUrl(key, size)
      return inFlight.run(url, async () => {
        const p = key.provider
        const blocked = breakers[p].blockedFor()
        if (blocked > 0) throw new ServiceError("provider_unavailable", Math.ceil(blocked / 1000))
        const slot = buckets[p].take()
        if (!slot.ok) throw new ServiceError("provider_busy", Math.max(1, Math.ceil(slot.retryAfterMs / 1000)))
        try {
          const image = await safeFetchImage(
            url,
            { hosts: COVER_HOSTS, redirect: (from, to) => coverRedirectAllowed(key, size, from, to), ...COVER_LIMITS },
            deps.fetch
          )
          breakers[p].success()
          return image
        } catch (e) {
          if (!(e instanceof UpstreamError)) throw e
          // No cover there (404, or Open Library's placeholder GIF): an answer, not a failure.
          if ((e.kind === "status" && e.status === 404) || e.kind === "bad_image") throw new ServiceError("not_found")
          if (e.kind === "status" && (e.status === 429 || e.status === 403)) {
            breakers[p].refused(e.retryAfter)
            throw new ServiceError("provider_busy", Math.ceil(breakers[p].blockedFor() / 1000))
          }
          if (e.kind !== "timeout") breakers[p].failure()
          throw new ServiceError("provider_unavailable")
        }
      })
    },
  }
}

export type CoverService = ReturnType<typeof createCoverService>
