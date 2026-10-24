import type { Metadata } from "next"
import { DiscoverView } from "@/features/discover/discover-view"

export const metadata: Metadata = { title: "Descubrir" }

export default function DiscoverPage() {
  return <DiscoverView />
}
