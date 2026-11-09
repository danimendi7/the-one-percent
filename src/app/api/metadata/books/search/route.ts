import type { NextRequest } from "next/server"
import { metadataRoutes } from "@/features/library/metadata/server/routes"

/** Books by title, author or ISBN (Open Library). Signed-in users only; see docs/m4g-plan.md §12. */
export function GET(request: NextRequest) {
  return metadataRoutes().booksSearch(request)
}
