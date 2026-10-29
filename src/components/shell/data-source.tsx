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
  goal_not_found: "el objetivo ya no existe",
  not_manual: "ese objetivo se alimenta de un hábito",
  before_start: "la fecha es anterior al inicio del objetivo",
  goal_cycle: "un objetivo no puede depender de sus subobjetivos",
  source_habit_not_numeric: "el hábito elegido no tiene valores numéricos",
  checkpoint_not_found: "el hito ya no existe",
  unknown_op_type: "el servidor aún no admite este cambio",
  derived_entry: "ese hábito se alimenta de Enfoque",
  not_duration_habit: "solo los hábitos de duración pueden alimentarse de Enfoque",
  session_not_found: "la sesión ya no existe",
  not_finished: "la sesión aún no ha terminado",
  too_short: "dura menos de 1 minuto efectivo",
  invalid_habit: "solo se pueden vincular hábitos de duración",
  segments_future: "las horas no pueden estar en el futuro",
  segments_overlap: "los tramos de la sesión se solapan",
  segments_too_long: "una sesión dura como máximo 12 horas",
  segments_order: "la hora de fin es anterior a la de inicio",
  invalid_config: "debe quedar al menos un indicador por momento del día",
  review_closed: "la revisión ya está cerrada",
  invalid_link: "el hábito u objetivo vinculado ya no existe",
  not_available: "ese periodo aún no ha terminado",
  invalid_period: "el periodo no es válido",
  confirmation_required: "falta la confirmación",
}

/** A review section the server did not take (M3.4c): never closed on its own, the text is kept until the user decides. */
function showReviewText(n: SyncNotice & { op: Extract<SyncNotice["op"], { type: "review.save" }> }) {
  const subject = n.subject ? `«${n.subject}»` : "La revisión"
  const sections = Object.keys(n.op.fields).length
  const what = sections === 1 ? "Tu texto" : `Tus ${sections} apartados`
  if (n.kind === "conflict" && n.code === "review_field_conflict") {
    toast(`${subject} cambió en otro dispositivo`, {
      id: n.id,
      description: `Se muestra la otra versión. ${what} se conserva en este dispositivo hasta que decidas.`,
      duration: Infinity,
      action: { label: "Aplicar la mía", onClick: () => habitActions.reapplyNotice?.(n.id) },
      cancel: { label: "Mantener la otra", onClick: () => habitActions.dismissNotice?.(n.id) },
    })
  } else if (n.kind === "conflict" && n.code === "review_deleted") {
    toast(`${subject} se borró en otro dispositivo`, {
      id: n.id,
      description: `${what} se conserva en este dispositivo. Puedes recuperarla con tu texto o dejarla borrada.`,
      duration: Infinity,
      action: { label: "Recuperar con mi texto", onClick: () => habitActions.reapplyNotice?.(n.id) },
      cancel: { label: "Dejarla borrada", onClick: () => habitActions.dismissNotice?.(n.id) },
    })
  } else {
    // Closed elsewhere first, or refused: it cannot be written there, but the text is not lost.
    toast(n.code === "review_closed" ? `${subject} ya se cerró en otro dispositivo` : `${subject} no se pudo guardar`, {
      id: n.id,
      description:
        n.code === "review_closed"
          ? `${what} se ha conservado aquí, sin cambiar la revisión cerrada.`
          : `El servidor lo rechazó: ${REJECTION[n.code ?? ""] ?? "datos no válidos"}. ${what} se conserva aquí.`,
      duration: Infinity,
      cancel: { label: "Descartar mi texto", onClick: () => habitActions.dismissNotice?.(n.id) },
    })
  }
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
    // Decided elsewhere (Mind & Energy's panel or another tab): its toast goes too.
    for (const id of shown.current) {
      if (notices?.some((n) => n.id === id)) continue
      shown.current.delete(id)
      toast.dismiss(id)
    }
  }, [notices])

  return null
}

function showNotice(n: SyncNotice) {
  if (n.op?.type === "review.save") return showReviewText({ ...n, op: n.op })
  const subject = n.subject ? `«${n.subject}»` : "Un cambio"
  if (n.op?.type === "review.delete") {
    // Never retried on its own: a delete only applies to the exact version the user confirmed.
    toast(`${subject} no se ha borrado`, {
      id: n.id,
      description: n.code === "review_changed" ? "Cambió en otro dispositivo después de que confirmaras. Revísala antes de volver a borrarla." : `El servidor lo rechazó: ${REJECTION[n.code ?? ""] ?? "datos no válidos"}.`,
      duration: 12_000,
      onDismiss: () => habitActions.dismissNotice?.(n.id),
      onAutoClose: () => habitActions.dismissNotice?.(n.id),
    })
    return
  }
  if (n.kind === "conflict" && n.opType === "focus.start") {
    // Decision 5: the first device to reach the server wins; this one joins its session.
    toast("Ya había un bloque en curso en otro dispositivo", {
      id: n.id,
      description: "Se muestra ese bloque aquí: puedes pausarlo o terminarlo desde cualquier dispositivo.",
      duration: 10_000,
      onDismiss: () => habitActions.dismissNotice?.(n.id),
      onAutoClose: () => habitActions.dismissNotice?.(n.id),
    })
    return
  }
  if (n.kind === "conflict" && n.op?.type === "checkin.set") {
    // Reflections are never overwritten silently: the notice stays until the user decides and shows their text.
    // Theirs is kept on this device (D47): closing the toast or the app does not decide, and it comes back on reopening.
    const mine = n.op.fields.note ?? ""
    toast(`La reflexión del ${subject} cambió en otro dispositivo`, {
      id: n.id,
      description: `Se muestra la otra versión. La tuya se conserva en este dispositivo hasta que decidas: «${mine.length > 140 ? `${mine.slice(0, 140)}…` : mine}».`,
      duration: Infinity,
      action: { label: "Aplicar la mía", onClick: () => habitActions.reapplyNotice?.(n.id) },
      cancel: { label: "Mantener la otra", onClick: () => habitActions.dismissNotice?.(n.id) },
    })
    return
  }
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
