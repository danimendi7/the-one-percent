"use client"

import { useState } from "react"
import { ArchiveRestore, ListChecks, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DemoBadge } from "@/components/common/demo-note"
import { EmptyState } from "@/components/common/empty-state"
import { PageHeader } from "@/components/shell/page-header"
import { cn } from "@/lib/utils"
import { capitalize, formatDate, startOfWeek, type LocalDate } from "../domain/dates"
import type { Habit } from "../domain/types"
import { habitActions } from "../store/habit-store"
import { HabitFormSheet, Segmented } from "./habit-form-sheet"
import { HabitIcon } from "./habit-icon"
import { HabitMetrics, MetricsSkeleton } from "./habit-metrics"
import { TodayChecklist } from "./today-checklist"
import { useHabitsModel } from "./use-habits-model"
import { WeeklyHabitGrid } from "./weekly-habit-grid"

export function HabitsView() {
  const model = useHabitsModel()
  const [view, setView] = useState<"today" | "week">("today")
  const [weekStart, setWeekStart] = useState<LocalDate | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Habit | null>(null)

  const openNew = () => {
    setEditing(null)
    setFormOpen(true)
  }
  const openEdit = (h: Habit) => {
    setEditing(h)
    setFormOpen(true)
  }

  const archived = model ? model.all.filter((h) => h.archivedOn && h.archivedOn <= model.today) : []

  return (
    <>
      <PageHeader
        title="Hábitos"
        meta={
          <span className="flex items-center gap-2">
            {model ? <span>{capitalize(formatDate(model.today, { weekday: "long", day: "numeric", month: "long" }))}</span> : <span>&nbsp;</span>}
            <DemoBadge />
          </span>
        }
        inlineActions
        actions={
          <Button onClick={openNew} disabled={!model}>
            <Plus />
            Nuevo hábito
          </Button>
        }
      />

      {!model ? (
        <LoadingState />
      ) : model.active.length === 0 ? (
        <div className="panel rounded-2xl">
          <EmptyState
            icon={ListChecks}
            title="Aún no tienes hábitos activos"
            description="Crea el primero. Empezará a contar desde hoy y solo en los días que programes."
            action={
              <Button onClick={openNew}>
                <Plus />
                Crear hábito
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-6">
          <HabitMetrics model={model} />

          {/* Mobile: Hoy / Semana toggle. Desktop: both side by side. */}
          <Segmented
            label="Vista"
            value={view}
            onChange={(v) => setView(v as "today" | "week")}
            options={[
              { value: "today", label: "Hoy" },
              { value: "week", label: "Semana" },
            ]}
            className="lg:hidden"
          />

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className={cn(view === "today" && "hidden lg:block")}>
              <WeeklyHabitGrid
                model={model}
                weekStart={weekStart ?? startOfWeek(model.today)}
                onWeekChange={setWeekStart}
                onEdit={openEdit}
              />
            </div>
            <div className={cn("lg:sticky lg:top-8", view === "week" && "hidden lg:block")}>
              <h2 className="sr-only">Checklist de hoy</h2>
              <TodayChecklist model={model} />
            </div>
          </div>

          {archived.length > 0 && (
            <section aria-labelledby="archived-title" className="pt-2">
              <h2 id="archived-title" className="mb-2 px-1 text-xs font-medium text-text-tertiary">
                Archivados ({archived.length})
              </h2>
              <ul className="panel divide-y divide-border/70 rounded-2xl">
                {archived.map((h) => (
                  <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                    <HabitIcon icon={h.icon} dimensionId={h.dimensionId} size="sm" className="opacity-60" />
                    <span className="flex-1 truncate text-sm text-text-secondary">{h.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => habitActions.restoreHabit(h.id)}>
                      <ArchiveRestore />
                      Restaurar
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <HabitFormSheet open={formOpen} onOpenChange={setFormOpen} habit={editing} />
    </>
  )
}

function LoadingState() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando hábitos">
      <MetricsSkeleton />
      <div className="panel h-[420px] animate-pulse rounded-2xl" />
    </div>
  )
}
