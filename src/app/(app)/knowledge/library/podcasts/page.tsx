import type { Metadata } from "next"
import { PodcastsView } from "@/features/library/library-views"

export const metadata: Metadata = { title: "Podcasts" }

export default function PodcastsPage() {
  return <PodcastsView />
}
