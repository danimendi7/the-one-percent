import type { Metadata } from "next"
import { HabitsView } from "@/features/habits/components/habits-view"

export const metadata: Metadata = { title: "Hábitos" }

export default function HabitsPage() {
  return <HabitsView />
}
