import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { EpisodeDiagnostics } from "@/features/library/bench/episode-diagnostics"

export const metadata: Metadata = { title: "Diagnóstico de episodios" }

// M4g.4: development only (`next dev`); a production build answers 404. Synthetic data, no
// request and no account data.
export default function EpisodeDiagnosticsPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <EpisodeDiagnostics />
}
