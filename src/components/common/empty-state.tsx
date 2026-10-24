import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-border bg-surface-raised">
        <Icon className="size-5 text-text-secondary" strokeWidth={1.75} aria-hidden />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-text-secondary">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
