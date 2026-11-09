"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { habitActions } from "@/features/habits/store/habit-store"
import { LIMITS } from "../domain/ops"

export interface CardDraft {
  answer: string
  sourceNoteId: string | null
}

/** A card written by the user. From an idea, its text starts as the answer and nothing is cut. */
export function RecallCardSheet({ open, onOpenChange, draft }: { open: boolean; onOpenChange: (open: boolean) => void; draft?: CardDraft }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl border-x-0")}>
        {open && <CardForm draft={draft} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function CardForm({ draft, onDone }: { draft?: CardDraft; onDone: () => void }) {
  const ids = { question: useId(), answer: useId() }
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState(draft?.answer ?? "")
  const [error, setError] = useState<{ field: "question" | "answer"; text: string } | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = habitActions.addRecallCard({ question, answer, sourceNoteId: draft?.sourceNoteId ?? null })
    if (!r.ok) {
      const label = r.field === "question" ? "la pregunta" : "la respuesta"
      setError({ field: r.field, text: r.reason === "empty" ? `Escribe ${label}.` : `Acorta ${label}: admite hasta ${LIMITS[r.field]} caracteres.` })
      return
    }
    toast("Tarjeta creada", { description: "Aparecerá en tu repaso." })
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader className="border-b border-border px-5 py-4">
        <SheetTitle className="text-lg">Nueva tarjeta</SheetTitle>
        <SheetDescription>Una pregunta que te obligue a recordar y su respuesta.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <Field id={ids.question} label="Pregunta" value={question} onChange={setQuestion} max={LIMITS.question} rows={2} error={error?.field === "question" ? error.text : null} />
        <Field id={ids.answer} label="Respuesta" value={answer} onChange={setAnswer} max={LIMITS.answer} rows={5} error={error?.field === "answer" ? error.text : null} />
      </div>
      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        <Button type="submit" className="ml-auto min-w-32">
          Crear tarjeta
        </Button>
      </SheetFooter>
    </form>
  )
}

function Field({ id, label, value, onChange, max, rows, error }: { id: string; label: string; value: string; onChange: (v: string) => void; max: number; rows: number; error: string | null }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {value.length >= max * 0.8 && (
          <span className={cn("num text-[0.6875rem]", value.length > max ? "text-error" : "text-text-tertiary")}>
            {value.length}/{max}
          </span>
        )}
      </div>
      <Textarea id={id} value={value} rows={rows} onChange={(e) => onChange(e.target.value)} aria-invalid={error !== null} className="field-sizing-content resize-none text-[0.9375rem] leading-relaxed" />
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-warning">
          {error}
        </p>
      )}
    </div>
  )
}
