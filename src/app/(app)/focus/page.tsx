import type { Metadata } from "next"
import { FocusView } from "@/features/focus/focus-view"

export const metadata: Metadata = { title: "Enfoque" }

export default function FocusPage() {
  return <FocusView />
}
