"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { habitActions } from "@/features/habits/store/habit-store"
import { CATEGORIES, TOPIC_LIMITS, type OwnTopicInput } from "../domain/ops"

const EMPTY: OwnTopicInput = { title: "", category: CATEGORIES[0], body: "", sourceTitle: "", sourceUrl: "" }
const LABEL: Record<keyof OwnTopicInput, string> = { title: "el título", category: "la categoría", body: "el texto", sourceTitle: "la fuente", sourceUrl: "el enlace" }

/** A topic written by the user: what they want to learn or keep, with the source they say it comes from. */
export function TopicSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const desktop = useMediaQuery("(min-width: 768px)")
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-3xl border-x-0")}>
        {open && <TopicForm onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function TopicForm({ onDone }: { onDone: () => void }) {
  const ids = { title: useId(), category: useId(), body: useId(), sourceTitle: useId(), sourceUrl: useId() }
  const [v, setV] = useState(EMPTY)
  const [error, setError] = useState<{ field: keyof OwnTopicInput; text: string } | null>(null)
  const set = (field: keyof OwnTopicInput, value: string) => setV((p) => ({ ...p, [field]: value }))
  const fieldError = (field: keyof OwnTopicInput) =>
    error?.field === field ? (
      <p role="alert" className="mt-1.5 text-xs text-warning">
        {error.text}
      </p>
    ) : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = habitActions.addDiscoveryTopic(v)
    if (!r.ok) {
      const name = LABEL[r.field]
      setError({ field: r.field, text: r.reason === "empty" ? `Escribe ${name}.` : r.reason === "too_long" ? `Acorta ${name}.` : `Revisa ${name}: debe empezar por http o https.` })
      return
    }
    toast("Tema guardado", { description: "Entrará en tu selección de cada día." })
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader className="border-b border-border px-5 py-4">
        <SheetTitle className="text-lg">Nuevo tema</SheetTitle>
        <SheetDescription>Algo que quieras aprender o conservar, con tus palabras.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <label htmlFor={ids.title} className="mb-1.5 block text-sm font-medium">
            Título
          </label>
          <Input id={ids.title} value={v.title} maxLength={TOPIC_LIMITS.title + 50} onChange={(e) => set("title", e.target.value)} aria-invalid={error?.field === "title"} />
          {fieldError("title")}
        </div>
        <div>
          <label htmlFor={ids.category} className="mb-1.5 block text-sm font-medium">
            Categoría
          </label>
          <select id={ids.category} value={v.category} onChange={(e) => set("category", e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm">
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.body} className="mb-1.5 block text-sm font-medium">
            Texto
          </label>
          <Textarea id={ids.body} value={v.body} rows={6} onChange={(e) => set("body", e.target.value)} aria-invalid={error?.field === "body"} className="field-sizing-content resize-none text-[0.9375rem] leading-relaxed" />
          {fieldError("body")}
        </div>
        <div>
          <label htmlFor={ids.sourceTitle} className="mb-1.5 block text-sm font-medium">
            Fuente <span className="font-normal text-text-tertiary">· opcional</span>
          </label>
          <Input id={ids.sourceTitle} value={v.sourceTitle} onChange={(e) => set("sourceTitle", e.target.value)} aria-invalid={error?.field === "sourceTitle"} />
          {fieldError("sourceTitle")}
        </div>
        <div>
          <label htmlFor={ids.sourceUrl} className="mb-1.5 block text-sm font-medium">
            Enlace <span className="font-normal text-text-tertiary">· opcional</span>
          </label>
          <Input id={ids.sourceUrl} value={v.sourceUrl} inputMode="url" placeholder="https://" onChange={(e) => set("sourceUrl", e.target.value)} aria-invalid={error?.field === "sourceUrl"} />
          {fieldError("sourceUrl")}
          <p className="mt-1.5 text-xs text-text-tertiary">La app no comprueba la fuente: se mostrará como indicada por ti.</p>
        </div>
      </div>
      <SheetFooter className="pb-safe flex-row gap-2 border-t border-border px-5 py-4">
        <Button type="submit" className="ml-auto min-w-32">
          Guardar tema
        </Button>
      </SheetFooter>
    </form>
  )
}
