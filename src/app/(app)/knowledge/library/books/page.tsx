import type { Metadata } from "next"
import { BooksView } from "@/features/library/library-views"

export const metadata: Metadata = { title: "Libros" }

export default function BooksPage() {
  return <BooksView />
}
