import type { Metadata } from "next"
import { LibraryView } from "@/features/library/components/library-view"

export const metadata: Metadata = { title: "Biblioteca" }

export default function LibraryPage() {
  return <LibraryView />
}
