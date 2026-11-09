"use client"

import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { clearAssistantDraft, clearAssistantDrafts, draftStorage, readAssistantDraft, writeAssistantDraft, type AssistantKind } from "../metadata/assistant-draft"

/**
 * The draft of one assistant (M4g.5, D102). While something was left half-written, `offer` holds it
 * and the assistant asks before showing anything; afterwards `restored` is what it starts from.
 * Without a user (it should not happen with an account) drafts are simply off.
 */
export function useAssistantDraft<T>(kind: AssistantKind, userId: string | null, worthKeeping: (draft: T) => boolean) {
  const [offer, setOffer] = useState<T | null>(() => {
    if (!userId) return null
    const storage = draftStorage()
    clearAssistantDrafts(storage, userId)
    return readAssistantDraft<T>(storage, kind, userId, Date.now())
  })
  const [restored, setRestored] = useState<T | null>(null)
  const finished = useRef(false)
  const keep = useRef(worthKeeping)

  const clear = useCallback(() => {
    finished.current = true
    if (userId) clearAssistantDraft(draftStorage(), kind, userId)
  }, [kind, userId])

  const persist = useCallback(
    (draft: T) => {
      if (finished.current || !userId) return
      if (keep.current(draft)) writeAssistantDraft(draftStorage(), kind, userId, draft, Date.now())
      else clearAssistantDraft(draftStorage(), kind, userId)
    },
    [kind, userId]
  )

  const recover = () => (setRestored(offer), setOffer(null))
  const startOver = () => {
    if (userId) clearAssistantDraft(draftStorage(), kind, userId)
    setOffer(null)
  }

  return { offer, restored, recover, startOver, persist, clear }
}

export function RecoverDraft({ title, what, onRecover, onStartOver }: { title: string; what: string; onRecover: () => void; onStartOver: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="draft-offer">
      <SheetHeader className="px-5 pt-5 pb-4">
        <SheetTitle className="text-lg">{title}</SheetTitle>
        <SheetDescription>Dejaste esto a medias en esta pestaña: «{what}».</SheetDescription>
      </SheetHeader>
      <SheetFooter className="pb-safe flex-col gap-2 border-t border-border px-5 py-4">
        <Button onClick={onRecover} data-testid="draft-recover">
          Recuperar lo que escribías
        </Button>
        <Button variant="outline" onClick={onStartOver} data-testid="draft-start-over">
          Empezar de cero
        </Button>
      </SheetFooter>
    </div>
  )
}
