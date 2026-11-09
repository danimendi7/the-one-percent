import type { NextRequest } from "next/server"
import { metadataRoutes } from "@/features/library/metadata/server/routes"

/** Episodes of a show, recent or by search (Apple Podcasts). Signed-in users only; see docs/m4g-plan.md §12. */
export function GET(request: NextRequest) {
  return metadataRoutes().showEpisodes(request)
}
