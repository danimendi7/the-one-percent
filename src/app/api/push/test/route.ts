import type { NextRequest } from "next/server"
import { pushRoutes } from "@/features/notifications/push/server"

/** Test notification to the device that asks (E8). Signed-in users with a registered device only. */
export function POST(request: NextRequest) {
  return pushRoutes().test(request)
}
