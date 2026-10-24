import { cn } from "@/lib/utils"

/**
 * Brand mark: a full ring with a short signal segment at the top (the "1%").
 * One simple geometric mark (see docs/design-decisions.md).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <circle cx="16" cy="16" r="11" fill="none" stroke="var(--border)" strokeWidth="3.5" />
      <circle
        cx="16"
        cy="16"
        r="11"
        fill="none"
        stroke="var(--signal)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="6 63.1"
        transform="rotate(-90 16 16)"
      />
    </svg>
  )
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="text-[0.8125rem] font-semibold tracking-[0.14em] text-foreground uppercase">
        The One <span className="text-signal">Percent</span>
      </span>
    </span>
  )
}
