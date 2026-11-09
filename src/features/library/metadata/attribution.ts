import type { ExternalRef } from "@/features/knowledge/domain/types"
import { ATTRIBUTION } from "./types"

function isOpenLibrary(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === "openlibrary.org" || host.endsWith(".openlibrary.org")
  } catch {
    return false
  }
}

/**
 * Where an item's data came from, for its page. A separate edition has no external reference (D101:
 * `external_id` is always the work), so its Open Library link says it. Derived on display, never stored.
 */
export function dataAttribution(item: { external: ExternalRef | null; sourceUrl: string | null }): string | null {
  if (item.external?.attribution) return item.external.attribution
  return item.sourceUrl && isOpenLibrary(item.sourceUrl) ? ATTRIBUTION.openlibrary : null
}
