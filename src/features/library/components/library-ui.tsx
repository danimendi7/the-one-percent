"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { AlertTriangle, BookOpen, Check, CloudOff, Headphones, Loader2, Mic, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { STATUS_LABEL, type ContentItem, type ContentKind, type ContentStatus, type CoverRef } from "@/features/knowledge/domain/types"
import { formatTimestamp } from "@/features/knowledge/domain/text"
import { progressOf } from "@/features/knowledge/domain/library"
import { coverKeyOf, coverSrc } from "../metadata/covers"
import type { EntitySyncState, LibrarySnapshot } from "../store/types"

export const LIBRARY_HREF = "/knowledge/library"
export const BOOKS_HREF = "/knowledge/library/books"
export const PODCASTS_HREF = "/knowledge/library/podcasts"
export const BRAIN_HREF = "/knowledge/brain"
// Static pages with the id in the query (not dynamic segments): prefetched once, they open offline.
export const itemHref = (id: string) => `/knowledge/library/item?id=${encodeURIComponent(id)}`
export const showHref = (id: string) => `/knowledge/library/show?id=${encodeURIComponent(id)}`
/** One note on its own in Cerebro, with its connections (M4e). */
export const brainNoteHref = (id: string) => `/knowledge/brain?nota=${encodeURIComponent(id)}`
export const APPLICATIONS_HREF = "/knowledge/brain?vista=aplicaciones"

export const KIND_ICON: Record<ContentKind | "show", typeof BookOpen> = { book: BookOpen, episode: Headphones, show: Mic }

/** Hue derived from an id: the same item always gets the same generated cover. */
function hueOf(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h % 360
}

/**
 * A content's cover. The generated typographic cover (D11) is always drawn; a real provider image
 * (M4g.2), when the item has one the proxy can serve, is laid over it in the same box once it has
 * loaded. While loading, on any error, offline, signed out or in the demo, the typographic cover
 * is what shows: never a broken image, never a jump in the layout. Books are 2:3 with a spine;
 * episodes and shows are square; images are cropped (`object-cover`), never distorted.
 *
 * Decorative by default (the title is next to it as text). With `label` it is announced as an
 * image («Portada de …»), whichever of the two covers is showing.
 */
export function CoverArt({
  seed,
  title,
  byline,
  kind,
  size = "md",
  cover,
  label,
  className,
}: {
  seed: string
  title: string
  byline?: string | null
  kind: ContentKind | "show"
  size?: "sm" | "md" | "lg"
  /** Only external covers the proxy accepts become images; anything else keeps the typographic one. */
  cover?: CoverRef | null
  label?: string
  className?: string
}) {
  const h = hueOf(seed)
  const square = kind !== "book"
  const Icon = KIND_ICON[kind]
  const key = cover?.source === "external" ? coverKeyOf(cover.url) : null
  const src = key ? coverSrc(key, size) : null
  // Outcome for the current address only: a new address starts over without an effect.
  const [outcome, setOutcome] = useState<{ src: string; ok: boolean } | null>(null)
  const state = !src ? "none" : outcome?.src === src ? (outcome.ok ? "loaded" : "failed") : "loading"
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-lg", square ? "aspect-square" : "aspect-[2/3]", className)}
      style={{
        background: square
          ? `radial-gradient(120% 90% at 85% 10%, oklch(0.46 0.07 ${h}) 0%, oklch(0.27 0.045 ${h}) 55%, oklch(0.19 0.03 ${h}) 100%)`
          : `linear-gradient(160deg, oklch(0.42 0.06 ${h}) 0%, oklch(0.26 0.045 ${h}) 70%, oklch(0.2 0.03 ${h}) 100%)`,
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.08), 0 6px 18px rgb(2 6 10 / 0.45)",
      }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      data-cover={state === "loaded" ? "image" : "typographic"}
    >
      {!square && <div className="absolute inset-y-0 left-[6%] w-px bg-white/10" />}
      {square && size !== "sm" && <Icon className="absolute top-[10%] right-[10%] size-[18%] text-white/35" strokeWidth={1.5} />}
      {size !== "sm" && (
        <div className={cn("absolute inset-0 flex flex-col justify-end gap-1", size === "lg" ? "p-3 sm:p-4" : "p-[10%]")}>
          <p
            className={cn(
              "leading-[1.15] font-semibold text-balance text-white/92",
              size === "lg" ? "line-clamp-3 text-[0.9375rem] sm:text-lg" : "line-clamp-3 text-[clamp(0.6875rem,2.6vw,0.8125rem)]"
            )}
          >
            {title}
          </p>
          {byline && <p className={cn("truncate text-white/60", size === "lg" ? "text-sm" : "text-[0.625rem]")}>{byline}</p>}
        </div>
      )}
      {src && state !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin proxy with its own checks; next/image would add an optimiser and another image origin.
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={(e) => setOutcome({ src, ok: e.currentTarget.naturalWidth >= 16 && e.currentTarget.naturalHeight >= 16 })}
          onError={() => setOutcome({ src, ok: false })}
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300 motion-reduce:transition-none", state === "loaded" ? "opacity-100" : "opacity-0")}
          data-testid="cover-image"
        />
      )}
    </div>
  )
}

export function byline(item: ContentItem, showTitle?: string | null): string | null {
  if (item.kind === "episode") return showTitle ?? (item.creators.length ? item.creators.join(", ") : null)
  return item.creators.length ? item.creators.join(", ") : null
}

const STATUS_TONE: Record<ContentStatus, string> = {
  planned: "border-border text-text-secondary",
  active: "border-signal/50 bg-signal/10 text-foreground",
  paused: "border-border text-text-secondary",
  done: "border-border bg-surface-raised text-foreground",
  abandoned: "border-border text-text-tertiary",
}

export function StatusPill({ kind, status, className }: { kind: ContentKind; status: ContentStatus; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium", STATUS_TONE[status], className)}>{STATUS_LABEL[kind][status]}</span>
}

/** Thin progress bar with its number in words (never colour alone). */
export function ProgressLine({ item, className }: { item: ContentItem; className?: string }) {
  const p = progressOf(item)
  if (p === null || item.status === "planned") return null
  const label =
    item.kind === "book"
      ? item.book.pageCount && item.book.currentPage !== null
        ? `p. ${item.book.currentPage} de ${item.book.pageCount}`
        : `${Math.round(p * 100)} %`
      : item.episode.positionSeconds !== null && item.episode.durationSeconds
        ? `${formatTimestamp(item.episode.positionSeconds)} de ${formatTimestamp(item.episode.durationSeconds)}`
        : `${Math.round(p * 100)} %`
  return (
    <div className={cn("space-y-1", className)}>
      <div className="h-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label="Progreso">
        <div className="h-full rounded-full bg-signal" style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
      <p className="num text-[0.6875rem] text-text-tertiary">{label}</p>
    </div>
  )
}

/** Personal rating 1–10 (D61): a radiogroup of ten, arrows move, the chosen one again clears it. */
export function RatingInput({ value, onChange, className }: { value: number | null; onChange: (v: number | null) => void; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = value === null ? 0 : value - 1
  return (
    <div role="radiogroup" aria-label="Valoración de 1 a 10" className={cn("grid grid-cols-10 gap-1", className)}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n, i) => (
        <button
          key={n}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} de 10`}
          tabIndex={i === current ? 0 : -1}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0
            if (!step) return
            e.preventDefault()
            const next = Math.min(10, Math.max(1, (value ?? 0) + step))
            refs.current[next - 1]?.focus()
            onChange(next)
          }}
          onClick={() => onChange(value === n ? null : n)}
          className={cn(
            "num h-11 min-w-0 rounded-lg border text-[0.8125rem] font-medium transition-colors motion-reduce:transition-none",
            value !== null && n <= value ? "border-signal/50 bg-signal/15 text-foreground" : "border-border text-text-tertiary hover:bg-surface-raised hover:text-foreground"
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

export function RatingBadge({ rating, className }: { rating: number | null; className?: string }) {
  if (rating === null) return null
  return (
    <span className={cn("num inline-flex items-center gap-1 text-[0.6875rem] text-text-secondary", className)}>
      <Star className="size-3 fill-current text-signal" aria-hidden />
      {rating}/10
    </span>
  )
}

/** The honest save line of one item or note (D57 precedent): «Sincronizado» only with the server. */
export function syncLine(state: EntitySyncState, snap: LibrarySnapshot | null): { text: string; tone: "ok" | "pending" | "warn"; offline: boolean } {
  switch (state) {
    case "demo":
      return { text: "Guardado en este navegador · demo", tone: "ok", offline: false }
    case "synced":
      return { text: "Sincronizado", tone: "ok", offline: false }
    case "pending":
      return { text: "Guardado en este dispositivo · sincronizando…", tone: "pending", offline: false }
    case "local":
      return snap?.sync && !snap.sync.enabled
        ? { text: "Guardado solo en este dispositivo · tu cuenta aún no guarda la biblioteca", tone: "warn", offline: false }
        : { text: "Guardado en este dispositivo · se enviará al recuperar la conexión", tone: "pending", offline: true }
    case "conflict":
      return { text: "Hay otra versión: decide cuál se queda", tone: "warn", offline: false }
    case "error":
      return { text: "No se pudo guardar en la nube · tu texto sigue en este dispositivo", tone: "warn", offline: false }
  }
}

export function SyncLine({ state, snap, className, testId }: { state: EntitySyncState; snap: LibrarySnapshot | null; className?: string; testId?: string }) {
  const { text, tone, offline } = syncLine(state, snap)
  const Icon = tone === "warn" ? AlertTriangle : offline ? CloudOff : tone === "pending" ? Loader2 : Check
  return (
    <p role="status" aria-live="polite" data-testid={testId} data-state={state} className={cn("flex min-w-0 items-center gap-1.5 text-xs", tone === "warn" ? "text-warning" : "text-text-tertiary", className)}>
      <Icon className={cn("size-3.5 shrink-0", tone === "pending" && !offline && "animate-spin motion-reduce:animate-none")} aria-hidden />
      <span className="truncate">{text}</span>
    </p>
  )
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-text-secondary hover:text-foreground">
      ← {children}
    </Link>
  )
}
