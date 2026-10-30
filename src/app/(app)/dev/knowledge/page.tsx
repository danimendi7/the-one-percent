import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SearchDiagnostics } from "@/features/library/bench/search-diagnostics"

export const metadata: Metadata = { title: "Diagnóstico de búsqueda" }

// M4e: development only (`next dev`); a production build answers 404. Synthetic data, its own
// IndexedDB database, nothing sent anywhere.
export default function SearchDiagnosticsPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <SearchDiagnostics />
}
