"use client"

import { useState } from "react"
import { Bookmark, BookmarkCheck, CircleSlash, Clock, GraduationCap, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DemoBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { FEATURED_TOPIC, TOPIC_FEED, VERIFICATION_LABEL } from "./fixtures"

export function DiscoverView() {
  const t = FEATURED_TOPIC
  const [rating, setRating] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)

  return (
    <>
      <PageHeader title="Descubrir" meta={<DemoBadge>Demo · contenido curado</DemoBadge>} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:gap-10">
        <article className="panel rounded-2xl px-5 py-6 sm:px-8 sm:py-8" aria-labelledby="topic-title">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-surface-raised px-2.5 py-1 text-text-secondary">{t.category}</span>
            <span className="flex items-center gap-1 text-text-tertiary">
              <Clock className="size-3.5" aria-hidden /> {t.minutes} min
            </span>
            <span className="text-text-tertiary">· Curado</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 px-2 py-0.5 text-warning">
              <ShieldAlert className="size-3" aria-hidden />
              {VERIFICATION_LABEL[t.verification]}
            </span>
          </div>

          <div className="max-w-[65ch]">
            <h2 id="topic-title" className="text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-[1.75rem]">
              {t.title}
            </h2>
            <p className="mt-4 text-[1.0625rem] leading-relaxed text-text-secondary">{t.hook}</p>

            {t.sections.map((s) => (
              <section key={s.heading} className="mt-7">
                <h3 className="text-base font-semibold">{s.heading}</h3>
                <p className="mt-2 text-[0.9375rem] leading-[1.7] text-foreground/88">{s.body}</p>
              </section>
            ))}

            <div className="mt-8 rounded-xl border-l-2 border-signal bg-signal/[0.05] px-4 py-3.5">
              <p className="text-xs font-medium text-text-tertiary">Para quedarte</p>
              <p className="mt-1 text-[0.9375rem] leading-relaxed">{t.takeaway}</p>
            </div>

            <section className="mt-8 border-t border-border pt-5" aria-labelledby="refs-title">
              <h3 id="refs-title" className="text-sm font-semibold">
                Referencias
              </h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {t.references.map((r) => (
                  <li key={r.title}>
                    <span className="text-foreground">{r.title}.</span> <span className="text-text-tertiary">{r.note}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-text-tertiary">
                Sin recuperación de fuentes no se muestran enlaces ni estudios con nombre como verificados.
              </p>
            </section>
          </div>
        </article>

        <aside className="space-y-4 lg:sticky lg:top-8">
          <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="rate-title">
            <div className="flex items-baseline justify-between">
              <h3 id="rate-title" className="text-sm font-semibold">
                ¿Cuánto te ha aportado?
              </h3>
              <span className="num text-sm text-text-secondary">{rating ? `${rating}/10` : ""}</span>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Valoración del 1 al 10">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} de 10`}
                  onClick={() => setRating(n)}
                  className={cn(
                    "num h-11 rounded-xl border text-sm font-semibold transition-colors",
                    rating !== null && n <= rating
                      ? "border-transparent bg-signal text-signal-foreground"
                      : "border-border text-text-secondary hover:bg-surface-raised"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant={saved ? "secondary" : "outline"} onClick={() => setSaved(!saved)} aria-pressed={saved}>
                {saved ? <BookmarkCheck /> : <Bookmark />}
                {saved ? "Guardado" : "Guardar"}
              </Button>
              <Button variant="outline" onClick={() => toast("Anotado: ya lo conocías", { description: "Se evitarán temas muy similares." })}>
                <GraduationCap />
                Ya lo sé
              </Button>
              <Button
                variant="ghost"
                className="col-span-2 text-text-secondary"
                onClick={() => toast("Tema descartado", { description: "No se generarán variantes de este tema." })}
              >
                <CircleSlash />
                No me interesa
              </Button>
            </div>
            <p className="mt-3 text-xs text-text-tertiary">Demo: la valoración y las acciones no se guardan todavía (M4).</p>
          </section>

          <section aria-labelledby="next-title">
            <h3 id="next-title" className="mb-2 px-1 text-xs font-medium text-text-tertiary">
              Siguientes en tu cola
            </h3>
            <ul className="panel divide-y divide-border/70 rounded-2xl">
              {TOPIC_FEED.map((f) => (
                <li key={f.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    {f.category} · {f.minutes} min
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </>
  )
}
