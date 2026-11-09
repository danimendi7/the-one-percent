import type { NextRequest } from "next/server"
import { metadataRoutes } from "@/features/library/metadata/server/routes"

/** One work with one of its editions (Open Library). Signed-in users only; see docs/m4g-plan.md §12. */
export function GET(request: NextRequest) {
  return metadataRoutes().bookDetail(request)
}
