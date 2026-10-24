import {
  Activity,
  Bike,
  BookOpen,
  Brain,
  Check,
  Coffee,
  Droplets,
  Dumbbell,
  Footprints,
  Languages,
  Leaf,
  Moon,
  Music,
  NotebookPen,
  PenLine,
  Sun,
  Target,
  Wind,
  type LucideIcon,
} from "lucide-react"
import type { DimensionId } from "../domain/types"
import { cn } from "@/lib/utils"

export const HABIT_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  check: { icon: Check, label: "Genérico" },
  dumbbell: { icon: Dumbbell, label: "Fuerza" },
  footprints: { icon: Footprints, label: "Caminar" },
  activity: { icon: Activity, label: "Movilidad" },
  bike: { icon: Bike, label: "Cardio" },
  droplets: { icon: Droplets, label: "Hidratación" },
  coffee: { icon: Coffee, label: "Café" },
  leaf: { icon: Leaf, label: "Nutrición" },
  moon: { icon: Moon, label: "Sueño" },
  sun: { icon: Sun, label: "Mañana" },
  wind: { icon: Wind, label: "Respiración" },
  brain: { icon: Brain, label: "Mente" },
  "book-open": { icon: BookOpen, label: "Lectura" },
  languages: { icon: Languages, label: "Idiomas" },
  "pen-line": { icon: PenLine, label: "Escritura" },
  "notebook-pen": { icon: NotebookPen, label: "Diario" },
  target: { icon: Target, label: "Enfoque" },
  music: { icon: Music, label: "Música" },
}

export const DIMENSION_COLOR: Record<DimensionId, string> = {
  body: "var(--dim-body)",
  mind: "var(--dim-mind)",
  learn: "var(--dim-learn)",
  work: "var(--dim-work)",
}

export function HabitIcon({
  icon,
  dimensionId,
  className,
  size = "md",
}: {
  icon: string
  dimensionId: DimensionId
  className?: string
  size?: "sm" | "md"
}) {
  const Icon = HABIT_ICONS[icon]?.icon ?? Check
  const color = DIMENSION_COLOR[dimensionId]
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-[10px] border",
        size === "md" ? "size-9" : "size-7 rounded-lg",
        className
      )}
      style={{
        color,
        borderColor: `color-mix(in oklab, ${color} 22%, transparent)`,
        background: `color-mix(in oklab, ${color} 9%, transparent)`,
      }}
    >
      <Icon className={size === "md" ? "size-[18px]" : "size-3.5"} strokeWidth={1.85} />
    </span>
  )
}
