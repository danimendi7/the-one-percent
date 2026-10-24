import { cn } from "@/lib/utils"
import type { Book } from "../fixtures"

/**
 * Generated typographic cover: the designed fallback for missing/unauthorised
 * cover images (DESIGN_SYSTEM: "missing-cover designs"). Fixed 2:3 ratio so
 * real covers (object-cover) will never distort the grid.
 */
export function BookCover({ book, className, size = "md" }: { book: Book; className?: string; size?: "md" | "lg" }) {
  const h = book.hue
  return (
    <div
      className={cn("relative aspect-[2/3] w-full overflow-hidden rounded-lg", className)}
      style={{
        background: `linear-gradient(160deg, oklch(0.42 0.06 ${h}) 0%, oklch(0.26 0.045 ${h}) 70%, oklch(0.2 0.03 ${h}) 100%)`,
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.08), inset 3px 0 0 rgb(0 0 0 / 0.18), 0 6px 18px rgb(2 6 10 / 0.45)",
      }}
      aria-hidden
    >
      <div className="absolute inset-y-0 left-[6%] w-px bg-white/10" />
      <div className={cn("absolute inset-0 flex flex-col justify-between", size === "lg" ? "p-5" : "p-[10%]")}>
        <p
          className={cn(
            "leading-[1.15] font-semibold text-balance text-white/92",
            size === "lg" ? "text-xl" : "text-[clamp(0.6875rem,2.6vw,0.875rem)] lg:text-[0.8125rem]"
          )}
        >
          {book.title}
        </p>
        <p className={cn("truncate text-white/60", size === "lg" ? "text-sm" : "text-[0.625rem]")}>{book.author}</p>
      </div>
    </div>
  )
}
