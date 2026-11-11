"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Bell, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { cn } from "@/lib/utils"
import { useHabits, type HabitsSnapshot } from "@/features/habits/store/habit-store"
import { evaluate } from "../domain/motivation"
import { deliver, dismiss, localMinutesInZone, markAllRead, toSent, unread, visible } from "../domain/inbox"
import { readInbox, useInbox, writeInbox } from "./inbox-store"

const scopeOf = (snap: HabitsSnapshot | null) => (!snap ? null : snap.source === "account" ? `account:${snap.account?.userId ?? "?"}` : "demo")
const TICK_MS = 60_000

/** Runs the Motivation Engine now and puts what is due in this device's inbox. */
function deliverNow(snap: HabitsSnapshot, scope: string) {
  const now = new Date()
  const items = readInbox(scope)
  const minutes = localMinutesInZone(now, snap.state.timezone)
  const { nudges } = evaluate({ state: snap.state, today: snap.today, minutes, settings: snap.state.motivation, sent: toSent(items) })
  const next = deliver(items, nudges, { localDate: snap.today, minutes, at: now.toISOString() })
  if (next !== items) writeInbox(scope, next)
}

/** The bell of the header: unread count and the inbox (E7). */
export function InboxButton({ className }: { className?: string }) {
  const snap = useHabits()
  const scope = scopeOf(snap)
  const items = useInbox(scope)
  const [open, setOpen] = useState(false)
  const desktop = useMediaQuery("(min-width: 768px)")

  useEffect(() => {
    if (!snap || !scope) return
    deliverNow(snap, scope)
    const t = setInterval(() => deliverNow(snap, scope), TICK_MS)
    return () => clearInterval(t)
  }, [snap, scope])

  const n = unread(items)
  const list = visible(items)
  const time = (at: string) => new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: snap?.state.timezone }).format(new Date(at))

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn("relative size-11 rounded-full", className)}
        onClick={() => {
          setOpen(true)
          if (scope && n > 0) writeInbox(scope, markAllRead(items))
        }}
        aria-label={n > 0 ? `Avisos, ${n} sin leer` : "Avisos"}
        data-testid="inbox-button"
      >
        <Bell className="size-5" aria-hidden />
        {n > 0 && (
          <span className="num absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-signal px-1 text-[0.625rem] leading-4 font-semibold text-signal-foreground" aria-hidden data-testid="inbox-count">
            {n}
          </span>
        )}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={desktop ? "right" : "bottom"} className={cn("gap-0 p-0", desktop ? "w-full sm:max-w-md" : "max-h-[85dvh] rounded-t-3xl border-x-0")}>
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle className="text-lg">Avisos</SheetTitle>
            <SheetDescription>Recordatorios de este dispositivo, según tus ajustes. Se vuelven a comprobar antes de mostrarse.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-text-tertiary" data-testid="inbox-empty">
                Sin avisos por ahora.
              </p>
            ) : (
              <ul className="divide-y divide-border/70" data-testid="inbox-list">
                {list.map((i) => (
                  <li key={i.key} className="flex items-start gap-2 py-3 pr-2 pl-5" data-testid="inbox-item">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{i.title}</p>
                      <p className="mt-0.5 text-sm leading-snug text-text-secondary">{i.body}</p>
                      <p className="num mt-1 text-[0.6875rem] text-text-tertiary">{time(i.at)}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="size-11 shrink-0 text-text-tertiary" aria-label={`Descartar: ${i.title}`} onClick={() => scope && writeInbox(scope, dismiss(readInbox(scope), i.key))}>
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="pb-safe border-t border-border px-5 py-3">
            <Link href="/settings/notifications" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center text-sm text-text-secondary underline-offset-2 hover:underline">
              Ajustes de avisos
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
