"use client"

import Link from "next/link"
import { useState } from "react"
import { BookOpen, Compass, CircleCheck, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DemoBadge } from "@/components/common/demo-note"
import { EmptyState } from "@/components/common/empty-state"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { RECALL_CARDS } from "./fixtures"

const GRADES = [
  { id: "again", label: "Otra vez", hint: "< 1 día" },
  { id: "hard", label: "Difícil", hint: "1 día" },
  { id: "good", label: "Bien", hint: "3 días" },
  { id: "easy", label: "Fácil", hint: "7 días" },
] as const

/** RecallCard: single question, reveal, then difficulty. Intervals shown are illustrative (algorithm in M4). */
export function BrainView() {
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const card = RECALL_CARDS[index]
  const remaining = RECALL_CARDS.length - index

  const next = () => {
    setRevealed(false)
    setIndex(index + 1)
  }

  return (
    <>
      <PageHeader title="Cerebro" meta={<DemoBadge />} description="Repaso espaciado de lo que lees y descubres." />

      <div className="mx-auto max-w-2xl">
        <div className="mb-3 flex items-center justify-between px-1 text-sm">
          <span className="text-text-secondary">Repaso de hoy</span>
          <span className="num text-text-tertiary" aria-live="polite">
            {Math.max(0, remaining)} {remaining === 1 ? "tarjeta" : "tarjetas"} en cola
          </span>
        </div>

        {card ? (
          <div className="panel rounded-2xl">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-xs text-text-tertiary">
              {card.source.type === "book" ? <BookOpen className="size-3.5" aria-hidden /> : <Compass className="size-3.5" aria-hidden />}
              <Link href={card.source.href} className="hover:text-text-secondary hover:underline">
                {card.source.label}
              </Link>
            </div>
            <div className="px-5 py-8 sm:px-8 sm:py-10">
              <p className="text-xl leading-snug font-semibold text-balance">{card.question}</p>
              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-200",
                  revealed ? "mt-6 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
                aria-hidden={!revealed}
              >
                <div className="overflow-hidden">
                  <p className="border-t border-border pt-6 text-[0.9375rem] leading-relaxed text-text-secondary">{card.answer}</p>
                </div>
              </div>
            </div>
            <div className="border-t border-border p-3 sm:p-4">
              {!revealed ? (
                <Button size="lg" className="w-full" onClick={() => setRevealed(true)}>
                  Mostrar respuesta
                </Button>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="¿Cómo te ha ido?">
                  {GRADES.map((g) => (
                    <Button key={g.id} variant={g.id === "good" ? "default" : "outline"} className="h-14 flex-col gap-0.5" onClick={next}>
                      <span>{g.label}</span>
                      <span className={cn("num text-[0.6875rem] font-normal", g.id === "good" ? "text-signal-foreground/70" : "text-text-tertiary")}>
                        {g.hint}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="panel rounded-2xl">
            <EmptyState
              icon={CircleCheck}
              title="Repaso completado"
              description="No quedan tarjetas pendientes hoy. Volverán cuando toque según su intervalo."
              action={
                <Button variant="outline" onClick={() => setIndex(0)}>
                  <RotateCcw />
                  Repetir demo
                </Button>
              }
            />
          </div>
        )}
        <p className="mt-3 px-1 text-xs text-text-tertiary">
          Los intervalos son ilustrativos. El algoritmo versionado de repetición espaciada llega en M4.
        </p>
      </div>
    </>
  )
}
