import type { Metadata } from "next"
import { MindView } from "@/features/mind/mind-view"

export const metadata: Metadata = { title: "Mente y energía" }

export default function MindPage() {
  return <MindView />
}
