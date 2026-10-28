"use client"

import Link from "next/link"
import { useEffect, useId, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { BarChart3, CloudOff, Timer } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { EmptyState } from "@/components/common/empty-state"
import { SourceBadge } from "@/components/common/demo-note"
import { pct } from "@/components/common/format"
import { PageHeader } from "@/components/shell/page-header"
import { startOfWeek } from "@/features/habits/domain/dates"
import { focusDataLevel, focusStreak, focusToday, sessionsIn } from "./domain/metrics"
import { sessionById } from "./domain/ops"
import type { FocusSession } from "./domain/types"
import { CloseSheet } from "./components/close-sheet"
import { EditSheet } from "./components/edit-sheet"
import { minutesLabel } from "./components/focus-ui"
import { PreparePanel } from "./components/prepare-panel"
import { SessionList } from "./components/session-list"
import { TimerPanel } from "./components/timer-panel"
import { useFocusModel, type FocusModel } from "./use-focus"

/**
 * Deep Work (docs/m3.2-deep-work-plan.md §2). Four states: Preparar, En foco, En pausa, Cierre.
 * Time is always derived from timestamps (PRD §3.5), so it survives backgrounding, closing the
 * app, losing the connection and switching device.
 */
export function FocusView() {
  const fm = useFocusModel()
  return (
    <>
      <PageHeader title="Enfoque" meta={<SourceBadge source={fm?.snap.source}>Demo · sesiones de ejemplo</SourceBadge>} />
      {!fm ? <FocusSkeleton /> : <Content fm={fm} />}
    </>
  )
}

function FocusSkeleton() {
  return (
    <div className="grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]" aria-busy="true" aria-label="Cargando enfoque">
      <div className="panel h-[520px] animate-pulse rounded-2xl" />
      <div className="panel h-64 animate-pulse rounded-2xl" />
    </div>
  )
}

function Content({ fm }: { fm: FocusModel }) {
  const [closing, setClosing] = useState<string | null>(null)
  const params = useSearchParams()
  const pathname = usePathname()
  const [editing, setEditing] = useState<string | null>(() => params.get("sesion"))
  const session = fm.active
  const closingSession = closing ? sessionById(fm.state, closing) : null
  const editingSession = editing ? sessionById(fm.state, editing) : null

  function openEdit(s: FocusSession | null) {
    setEditing(s?.id ?? null)
    // ?sesion= only opens a session once (link from the recovery toast).
    if (!s && params.get("sesion")) window.history.replaceState(null, "", pathname)
  }

  function finish() {
    if (!session) return
    // Freeze the time on every device while the close sheet is open.
    if (session.state === "running") fm.api.pauseFocus(session.id)
    setClosing(session.id)
  }

  return (
    <div className="max-w-6xl space-y-8">
      {!fm.saved && (
        <div role="note" className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/8 px-4 py-3 text-sm leading-relaxed text-warning">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Tu cuenta aún no guarda sesiones de enfoque. El temporizador funciona, pero esta sesión no se guardará ni contará en tus datos.</p>
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
        <section className="panel flex flex-col items-center rounded-2xl px-5 py-7 sm:py-9" aria-label={session ? "Bloque en curso" : "Preparar bloque"}>
          {session ? <TimerPanel fm={fm} session={session} onFinish={finish} /> : <PreparePanel fm={fm} />}
        </section>
        <aside className="space-y-4">
          <TodaySummary fm={fm} />
          <WakeLockToggle running={session?.state === "running"} />
        </aside>
      </div>
      <History fm={fm} onOpen={openEdit} />
      <CloseSheet fm={fm} session={closingSession && closingSession.state !== "finished" ? closingSession : null} onOpenChange={(o) => !o && setClosing(null)} />
      <EditSheet fm={fm} session={editingSession && editingSession.state === "finished" ? editingSession : null} onOpenChange={(o) => !o && openEdit(null)} />
    </div>
  )
}

function TodaySummary({ fm }: { fm: FocusModel }) {
  const { day, week } = focusToday(fm.state, fm.today)
  const level = focusDataLevel(fm.state, { range: { from: startOfWeek(fm.today), to: fm.today }, project: "all" }, fm.today)
  const streak = focusStreak(fm.state, fm.today)
  return (
    <section className="panel rounded-2xl p-5" aria-label="Enfoque de hoy">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Hoy
        </h2>
        {level === "few" && <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] text-text-tertiary">Pocos datos</span>}
      </div>
      <p className="num mt-3 text-[2rem] leading-none font-semibold" data-testid="focus-today-minutes">
        {minutesLabel(day.minutes)}
      </p>
      <p className="mt-1.5 text-xs text-text-tertiary">
        {day.sessions === 0 ? "Ningún bloque terminado hoy" : `${day.sessions} ${day.sessions === 1 ? "bloque terminado" : "bloques terminados"}`}
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border/70 pt-4 text-sm">
        <div>
          <dt className="text-xs text-text-tertiary">Semana</dt>
          <dd className="num mt-0.5 font-medium">{minutesLabel(week.minutes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-tertiary">Completos</dt>
          <dd className="num mt-0.5 font-medium">{pct(week.completeRate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-tertiary">Racha</dt>
          <dd className="num mt-0.5 font-medium">{streak} d</dd>
        </div>
      </dl>
      <Link href="/analytics#enfoque" className="mt-4 -mb-1 inline-flex min-h-11 items-center gap-1.5 text-sm text-text-secondary hover:text-foreground">
        <BarChart3 className="size-4" aria-hidden /> Ver en Análisis
      </Link>
    </section>
  )
}

/** Optional Wake Lock (off by default; only where the browser supports it). */
function WakeLockToggle({ running }: { running: boolean }) {
  const id = useId()
  const [supported] = useState(() => typeof navigator !== "undefined" && "wakeLock" in navigator)
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem("the-one-percent:focus:wake-lock") === "1"
    } catch {
      return false
    }
  })
  useEffect(() => {
    if (!supported || !on || !running) return
    let sentinel: { release(): Promise<void> } | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== "visible") return
      ;(navigator as Navigator & { wakeLock: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock
        .request("screen")
        .then((s) => {
          if (cancelled) void s.release()
          else sentinel = s
        })
        .catch(() => {})
    }
    acquire()
    document.addEventListener("visibilitychange", acquire)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", acquire)
      void sentinel?.release()
    }
  }, [supported, on, running])
  if (!supported) return null
  return (
    <div className="panel flex items-center justify-between gap-4 rounded-2xl px-5 py-3">
      <label htmlFor={id} className="text-sm">
        Mantener la pantalla encendida
        <span className="block text-xs text-text-tertiary">Solo mientras el bloque está en marcha</span>
      </label>
      <Switch
        id={id}
        checked={on}
        onCheckedChange={(v) => {
          setOn(v)
          try {
            window.localStorage.setItem("the-one-percent:focus:wake-lock", v ? "1" : "0")
          } catch {
            // per-device convenience only
          }
        }}
      />
    </div>
  )
}

function History({ fm, onOpen }: { fm: FocusModel; onOpen: (s: FocusSession) => void }) {
  const week = sessionsIn(fm.state, { range: { from: startOfWeek(fm.today), to: fm.today }, project: "all" })
  const any = fm.state.focusSessions.some((s) => s.state === "finished")
  return (
    <section aria-labelledby="focus-history-title">
      <div className="mb-3 flex items-end justify-between">
        <h2 id="focus-history-title" className="text-base font-semibold">
          Esta semana
        </h2>
        {any && (
          <Link href="/analytics#enfoque" className="-mr-2 inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-text-secondary hover:text-foreground">
            Todo el historial
          </Link>
        )}
      </div>
      {week.length === 0 ? (
        <div className="panel rounded-2xl">
          <EmptyState
            icon={Timer}
            title={any ? "Sin bloques esta semana" : "Aún no hay sesiones"}
            description={
              any
                ? "Los bloques que termines aparecerán aquí con sus minutos, proyecto y valoración."
                : "Elige una duración y empieza. Al terminar anotarás el resultado y, si quieres, una valoración; aquí verás tu historial."
            }
            className="py-8"
          />
        </div>
      ) : (
        <SessionList sessions={week} habits={fm.state.habits} timezone={fm.timezone} today={fm.today} onOpen={fm.saved ? onOpen : undefined} />
      )}
    </section>
  )
}
