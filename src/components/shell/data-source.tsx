"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { demoBackend } from "@/features/habits/store/demo-store"
import { activateBackend, habitActions, useHabits } from "@/features/habits/store/habit-store"
import type { Backend } from "@/features/habits/store/types"
import { createAccountBackend } from "@/features/sync/account-backend"
import type { SyncNotice } from "@/features/sync/domain/types"
import { getSupabaseBrowser } from "@/lib/supabase/browser"
import { isSupabaseConfigured } from "@/lib/supabase/env"

/**
 * Chooses the data source: the signed-in account (sync engine) or the local
 * demo. The proxy guarantees that, when Supabase is configured, an anonymous
 * visitor only reaches the app after explicitly choosing the demo.
 */
export function DataSourceProvider() {
  useEffect(() => {
    if (!isSupabaseConfigured) {
      activateBackend(demoBackend)
      return
    }
    const sb = getSupabaseBrowser()!
    let current: (Backend & { userId?: string }) | null = null
    let cancelled = false

    const choose = (user: { id: string; email?: string | null } | null) => {
      if (cancelled) return
      if (user) {
        if (current?.userId === user.id) return
        current?.dispose?.()
        current = createAccountBackend(sb, { id: user.id, email: user.email ?? null })
      } else {
        if (current === demoBackend) return
        current?.dispose?.()
        current = demoBackend
      }
      activateBackend(current)
    }

    void sb.auth.getSession().then(({ data }) => choose(data.session?.user ?? null))
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => choose(session?.user ?? null))
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
      current?.dispose?.()
      activateBackend(null)
    }
  }, [])

  return <SyncNotices />
}

const REJECTION: Record<string, string> = {
  not_eligible: "ese día no está programado",
  future_date: "no se pueden registrar días futuros",
  rest_day: "es un día de descanso",
  invalid_value: "el valor no es válido",
  habit_not_found: "el hábito ya no existe",
  invalid_effective_date: "los cambios de frecuencia solo se aplican desde hoy",
  history_immutable: "el historial no se puede reescribir",
}

/** Turns sync conflicts and server rejections into actionable, non-alarming toasts. */
function SyncNotices() {
  const snap = useHabits()
  const shown = useRef(new Set<string>())
  const notices = snap?.sync?.notices

  useEffect(() => {
    for (const n of notices ?? []) {
      if (shown.current.has(n.id)) continue
      shown.current.add(n.id)
      showNotice(n)
    }
  }, [notices])

  return null
}

function showNotice(n: SyncNotice) {
  const subject = n.subject ? `«${n.subject}»` : "Un cambio"
  if (n.kind === "conflict") {
    toast(`${subject} se editó en otro dispositivo`, {
      id: n.id,
      description: "Se ha mantenido la versión más reciente. Puedes volver a aplicar tu cambio.",
      duration: 12_000,
      action: { label: "Aplicar el mío", onClick: () => habitActions.reapplyNotice?.(n.id) },
      onDismiss: () => habitActions.dismissNotice?.(n.id),
      onAutoClose: () => habitActions.dismissNotice?.(n.id),
    })
  } else {
    toast.error(`${subject} no se pudo guardar`, {
      id: n.id,
      description: `El servidor lo rechazó: ${REJECTION[n.code ?? ""] ?? "datos no válidos"}. Se muestra el estado real.`,
      duration: 8_000,
      onDismiss: () => habitActions.dismissNotice?.(n.id),
      onAutoClose: () => habitActions.dismissNotice?.(n.id),
    })
  }
}
