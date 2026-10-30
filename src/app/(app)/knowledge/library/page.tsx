import type { Metadata } from "next"
import { LibraryHome } from "@/features/library/library-views"

export const metadata: Metadata = { title: "Biblioteca" }

export default function LibraryPage() {
  return <LibraryHome />
}
