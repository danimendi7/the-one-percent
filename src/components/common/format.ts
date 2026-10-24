/** Display helpers. N/A is shown explicitly, never as 0% (DATABASE_ARCHITECTURE §Computation contracts). */

export function pct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "N/D"
  return `${Math.round(rate * 100)}%`
}

const numFmt = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 })
export function num(n: number): string {
  return numFmt.format(n)
}

/** Compact amounts for tight cells: 12.430 → 12,4k */
export function compact(n: number): string {
  if (n >= 10000) return `${numFmt.format(Math.round(n / 100) / 10)}k`
  return numFmt.format(n)
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
