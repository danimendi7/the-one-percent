import { cn } from "@/lib/utils"

/** Circular progress. `value` in [0,1] or null for N/A (renders an empty track). */
export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  className,
  children,
  label,
}: {
  value: number | null
  size?: number
  stroke?: number
  className?: string
  children?: React.ReactNode
  label: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = value === null ? 0 : Math.max(0, Math.min(1, value))
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-raised)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--signal)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${v * c} ${c}`}
          className="transition-[stroke-dasharray] duration-300 ease-(--ease-out-quint)"
          opacity={v === 0 ? 0 : 1}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}
