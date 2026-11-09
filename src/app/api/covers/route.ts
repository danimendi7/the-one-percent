import type { NextRequest } from "next/server"
import { coverRouteHandler } from "@/features/library/metadata/server/routes"

/** Cover images by provider identifier, for signed-in users only; see docs/m4g-plan.md §15. */
export function GET(request: NextRequest) {
  return coverRouteHandler()(request)
}
