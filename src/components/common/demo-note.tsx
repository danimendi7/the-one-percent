import { FlaskConical } from "lucide-react"
import { cn } from "@/lib/utils"

/** Visible label for anything backed by fixtures (IMPLEMENTATION_PLAN M1: "clearly label demos"). */
export function DemoBadge({ className, children = "Demo" }: { className?: string; children?: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border border-warning/30 bg-warning/8 px-2 text-[0.6875rem] font-medium text-warning",
        className
      )}
    >
      <FlaskConical className="size-3" aria-hidden />
      {children}
    </span>
  )
}

export function DemoNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm leading-relaxed text-text-secondary",
        className
      )}
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div>{children}</div>
    </div>
  )
}

/**
 * Label for screens computed from habit data: "Demo" only when the data comes
 * from the local demo. Real account data carries no demo label.
 */
export function SourceBadge({ source, children }: { source: "demo" | "account" | null | undefined; children?: React.ReactNode }) {
  if (source !== "demo") return null
  return <DemoBadge>{children}</DemoBadge>
}
