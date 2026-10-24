import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  description,
  actions,
  meta,
  inlineActions = false,
  className,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  /** Small line above the title (date, context). */
  meta?: React.ReactNode
  /** Keep actions on the title row on mobile (for one compact primary action). */
  inlineActions?: boolean
  className?: string
}) {
  return (
    <header className={cn("mb-5 md:mb-8", className)}>
      {/* Meta sits on its own row so it never competes with inline actions for width. */}
      {meta && <div className="mb-1.5 text-sm text-text-secondary">{meta}</div>}
      <div
        className={cn(
          "flex gap-4 md:flex-row md:items-end md:justify-between",
          inlineActions ? "flex-row items-end justify-between" : "flex-col"
        )}
      >
        <div className="min-w-0">
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight text-balance md:text-[2rem]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-[60ch] text-[0.9375rem] leading-relaxed text-text-secondary">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
