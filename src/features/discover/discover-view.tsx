"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { Bookmark, BookmarkCheck, ChevronRight, CircleSlash, Clock, Compass, GraduationCap, PenLine, Plus, ShieldAlert, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { discoveryEnabled, habitActions, useHabits, type HabitsSnapshot } from "@/features/habits/store/habit-store"
import { TopicSheet } from "./components/topic-sheet"
import { historyTopics, savedTopics, todayTopic, topicByKey, upcomingTopics } from "./domain/feed"
import { VERIFICATION_LABEL, type Dismissal, type OwnTopic, type Topic } from "./domain/types"

export function DiscoverSkeleton() {
  return <div className="panel h-96 animate-pulse rounded-2xl motion-reduce:animate-none" role="status" aria-busy="true" aria-label="Cargando el tema de hoy" />
}

/** `/knowledge/discover`: today's topic, what you thought of it, and your own topics. No model involved. */
export function DiscoverView() {
  const snap = useHabits()
  const [adding, setAdding] = useState(false)
  return (
    <>
      <PageHeader
        title="Descubrir"
        meta={<SourceBadge source={snap?.source}>Demo · tus valoraciones se guardan en este navegador</SourceBadge>}
        description="Un tema cada día, escogido por reglas a partir de lo que valoras. Sin IA: lo que no está verificado se indica."
        actions={
          <Button variant="outline" onClick={() => setAdding(true)} data-testid="discover-add">
            <Plus aria-hidden />
            Añadir tema
          </Button>
        }
      />
      {snap ? <Discover snap={snap} /> : <DiscoverSkeleton />}
      <TopicSheet open={adding} onOpenChange={setAdding} />
    </>
  )
}

function Discover({ snap }: { snap: HabitsSnapshot }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const d = snap.state.discovery
  const requested = params.get("tema")
  const opened = requested ? topicByKey(d, requested) : null
  const today = useMemo(() => todayTopic(d, snap.today), [d, snap.today])
  const upcoming = useMemo(() => upcomingTopics(d, snap.today, 4), [d, snap.today])
  const saved = useMemo(() => savedTopics(d), [d])
  const history = useMemo(() => historyTopics(d), [d])
  const own = useMemo(() => Object.values(d.topics).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [d.topics])
  const topic = opened ?? today

  return (
    <>
      {!discoveryEnabled() && (
        <p role="note" className="mb-4 rounded-xl border border-dashed border-warning/40 px-4 py-3 text-sm text-text-secondary">
          Tu cuenta aún no guarda esto en la nube: lo que hagas queda en este dispositivo y se enviará cuando esté disponible.
        </p>
      )}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:gap-10">
        <div className="min-w-0">
          {opened && (
            <Link href={pathname} className="-ml-2 mb-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-text-secondary hover:text-foreground">
              Volver al tema de hoy
            </Link>
          )}
          {topic ? (
            <TopicArticle topic={topic} />
          ) : (
            <section className="panel rounded-2xl" data-testid="discover-empty">
              <EmptyState icon={Compass} title="Has visto todos los temas" description="Añade uno propio para seguir aprendiendo. Tus valoraciones y lo guardado siguen a un lado." />
            </section>
          )}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-8">
          {topic && <TopicActions key={topic.key} snap={snap} topic={topic} />}
          <TopicList testId="discover-upcoming" title="Siguientes" items={upcoming.map((t) => ({ topic: t, meta: `${t.category} · ${t.minutes} min` }))} open={!!upcoming.length} />
          <TopicList testId="discover-saved" title={`Guardados (${saved.length})`} items={saved.map((t) => ({ topic: t, meta: t.category }))} />
          <TopicList testId="discover-history" title={`Historial (${history.length})`} items={history.map((h) => ({ topic: h.topic, meta: h.feedback.rating !== null ? `${h.feedback.rating}/10 · ${h.topic.category}` : h.topic.category }))} />
          {own.length > 0 && <OwnTopics topics={own} />}
        </aside>
      </div>
    </>
  )
}

function TopicArticle({ topic: t }: { topic: Topic }) {
  return (
    <article className="panel rounded-2xl px-5 py-6 sm:px-8 sm:py-8" aria-labelledby="topic-title" data-testid="discover-topic">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-surface-raised px-2.5 py-1 text-text-secondary">{t.category}</span>
        <span className="flex items-center gap-1 text-text-tertiary">
          <Clock className="size-3.5" aria-hidden /> {t.minutes} min
        </span>
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5", t.verification === "unverified" ? "border-warning/30 text-warning" : "border-border text-text-secondary")} data-testid="discover-verification">
          {t.verification === "unverified" ? <ShieldAlert className="size-3" aria-hidden /> : <PenLine className="size-3" aria-hidden />}
          {VERIFICATION_LABEL[t.verification]}
        </span>
      </div>
      <div className="max-w-[65ch]">
        <h2 id="topic-title" className="text-2xl leading-tight font-semibold tracking-tight text-balance break-words sm:text-[1.75rem]">
          {t.title}
        </h2>
        {t.hook && <p className="mt-4 text-[1.0625rem] leading-relaxed text-text-secondary">{t.hook}</p>}
        {t.sections.map((s) => (
          <section key={s.heading} className="mt-7">
            <h3 className="text-base font-semibold">{s.heading}</h3>
            <p className="mt-2 text-[0.9375rem] leading-[1.7] break-words whitespace-pre-wrap text-foreground/88">{s.body}</p>
          </section>
        ))}
        {t.takeaway && (
          <div className="mt-8 rounded-xl border-l-2 border-signal bg-signal/[0.05] px-4 py-3.5">
            <p className="text-xs font-medium text-text-tertiary">Para quedarte</p>
            <p className="mt-1 text-[0.9375rem] leading-relaxed">{t.takeaway}</p>
          </div>
        )}
        {t.recallQuestion && (
          <p className="mt-5 text-sm text-text-secondary">
            <span className="font-medium text-foreground">Para repasar:</span> {t.recallQuestion}
          </p>
        )}
        {(t.references.length > 0 || t.origin === "curated") && (
          <section className="mt-8 border-t border-border pt-5" aria-labelledby="refs-title">
            <h3 id="refs-title" className="text-sm font-semibold">
              Referencias
            </h3>
            {t.references.length > 0 && (
              <ul className="mt-2 space-y-1.5 text-sm" data-testid="discover-references">
                {t.references.map((r) => (
                  <li key={r.title} className="break-words">
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">
                        {r.title}
                      </a>
                    ) : (
                      <span className="text-foreground">{r.title}.</span>
                    )}{" "}
                    <span className="text-text-tertiary">{r.note}</span>
                  </li>
                ))}
              </ul>
            )}
            {t.origin === "curated" && <p className="mt-3 text-xs leading-relaxed text-text-tertiary">Resumen propio sin fuentes comprobadas: no se muestran enlaces ni estudios con nombre.</p>}
          </section>
        )}
      </div>
    </article>
  )
}

function TopicActions({ snap, topic }: { snap: HabitsSnapshot; topic: Topic }) {
  const fb = snap.state.discovery.feedback[topic.key]
  const rating = fb?.rating ?? null
  const saved = fb?.saved ?? false
  const set = habitActions.setTopicFeedback
  function dismiss(dismissed: Dismissal, message: string) {
    set(topic.key, { dismissed })
    toast(message, { action: { label: "Deshacer", onClick: () => set(topic.key, { dismissed: null }) } })
  }
  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="rate-title">
      <div className="flex items-baseline justify-between">
        <h3 id="rate-title" className="text-sm font-semibold">
          ¿Cuánto te ha aportado?
        </h3>
        <span className="num text-sm text-text-secondary" data-testid="discover-rating">
          {rating ? `${rating}/10` : ""}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Valoración del 1 al 10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} de 10`}
            onClick={() => set(topic.key, { rating: rating === n ? null : n })}
            className={cn("num h-11 rounded-xl border text-sm font-semibold transition-colors motion-reduce:transition-none", rating !== null && n <= rating ? "border-transparent bg-signal text-signal-foreground" : "border-border text-text-secondary hover:bg-surface-raised")}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant={saved ? "secondary" : "outline"} onClick={() => set(topic.key, { saved: !saved })} aria-pressed={saved} data-testid="discover-save">
          {saved ? <BookmarkCheck aria-hidden /> : <Bookmark aria-hidden />}
          {saved ? "Guardado" : "Guardar"}
        </Button>
        <Button variant="outline" onClick={() => dismiss("already_known", "Anotado: ya lo conocías")} data-testid="discover-known">
          <GraduationCap aria-hidden />
          Ya lo sé
        </Button>
        <Button variant="ghost" className="col-span-2 text-text-secondary" onClick={() => dismiss("not_interested", "Tema descartado")} data-testid="discover-dismiss">
          <CircleSlash aria-hidden />
          No me interesa
        </Button>
      </div>
    </section>
  )
}

function TopicList({ testId, title, items, open }: { testId: string; title: string; items: { topic: Topic; meta: string }[]; open?: boolean }) {
  const pathname = usePathname()
  if (items.length === 0) return null
  return (
    <details className="panel group rounded-2xl" open={open} data-testid={testId}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronRight className="size-4 text-text-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
      </summary>
      <ul className="divide-y divide-border/70 border-t border-border/70">
        {items.map(({ topic, meta }) => (
          <li key={topic.key}>
            <Link href={`${pathname}?tema=${encodeURIComponent(topic.key)}`} className="block min-h-11 px-4 py-2.5 hover:bg-surface-raised/50">
              <span className="block text-sm font-medium break-words">{topic.title}</span>
              <span className="num mt-0.5 block text-xs text-text-tertiary">{meta}</span>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}

function OwnTopics({ topics }: { topics: OwnTopic[] }) {
  const [removing, setRemoving] = useState<OwnTopic | null>(null)
  return (
    <details className="panel group rounded-2xl" data-testid="discover-own">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        Tus temas ({topics.length})
        <ChevronRight className="size-4 text-text-tertiary transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
      </summary>
      <ul className="divide-y divide-border/70 border-t border-border/70">
        {topics.map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-1 pr-1 pl-4">
            <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
            <Button variant="ghost" size="icon" className="size-11 shrink-0 text-text-tertiary" aria-label={`Borrar: ${t.title}`} onClick={() => setRemoving(t)}>
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Borrar este tema?</DialogTitle>
            <DialogDescription>Desaparece de todos tus dispositivos, con su texto. No se puede deshacer.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (removing) habitActions.removeDiscoveryTopic(removing.id)
                setRemoving(null)
              }}
              data-testid="discover-remove-confirm"
            >
              Borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </details>
  )
}
