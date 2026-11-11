"use client"

import { useId, useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/features/habits/domain/dates"
import { Segmented } from "@/features/habits/components/habit-form-sheet"
import { habitActions } from "@/features/habits/store/habit-store"
import { cleanLogText, GOAL_LOG_LIMITS, goalLogNewestFirst } from "../domain/ops"
import type { Goal, GoalLogEntry, GoalLogKind } from "../domain/types"

const KIND_LABEL: Record<GoalLogKind, string> = { obstacle: "Obstáculo", adjustment: "Ajuste" }
const PLACEHOLDER: Record<GoalLogKind, string> = {
  obstacle: "¿Qué se ha interpuesto?",
  adjustment: "¿Qué vas a cambiar en el proceso?",
}

/** What got in the way and what was changed: the process under review, not only the target (Plan Maestro 5.4). */
export function GoalLog({ goal, editable }: { goal: Goal; editable: boolean }) {
  const textId = useId()
  const [kind, setKind] = useState<GoalLogKind>("obstacle")
  const [text, setText] = useState("")
  const [confirming, setConfirming] = useState<string | null>(null)
  const entries = goalLogNewestFirst(goal.processLog)
  const full = (goal.processLog?.length ?? 0) >= GOAL_LOG_LIMITS.entries

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!cleanLogText(text) || full) return
    habitActions.addGoalLog(goal.id, kind, text)
    setText("")
  }

  return (
    <section className="panel rounded-2xl p-4 sm:p-5" aria-labelledby="goal-log-title">
      <h2 id="goal-log-title" className="text-sm font-medium text-text-secondary">
        Obstáculos y ajustes
      </h2>

      {editable && (
        <form onSubmit={add} className="mt-3 space-y-2">
          <Segmented label="Tipo de anotación" value={kind} onChange={(v) => setKind(v as GoalLogKind)} options={[{ value: "obstacle", label: "Obstáculo" }, { value: "adjustment", label: "Ajuste" }]} />
          <Label htmlFor={textId} className="sr-only">
            Anotación
          </Label>
          <Textarea id={textId} value={text} onChange={(e) => setText(e.target.value)} maxLength={GOAL_LOG_LIMITS.text} rows={2} placeholder={PLACEHOLDER[kind]} />
          {full ? (
            <p className="text-xs text-text-tertiary">Has llegado a las {GOAL_LOG_LIMITS.entries} anotaciones de este objetivo. Borra alguna para añadir otra.</p>
          ) : (
            <Button type="submit" variant="outline" className="h-11" disabled={!cleanLogText(text)}>
              Añadir
            </Button>
          )}
        </form>
      )}

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary">Sin anotaciones todavía.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border" aria-label="Anotaciones">
          {entries.map((entry) => (
            <Row key={entry.id} goalId={goal.id} entry={entry} editable={editable} confirming={confirming === entry.id} setConfirming={setConfirming} />
          ))}
        </ul>
      )}
    </section>
  )
}

function Row({ goalId, entry, editable, confirming, setConfirming }: { goalId: string; entry: GoalLogEntry; editable: boolean; confirming: boolean; setConfirming: (id: string | null) => void }) {
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-text-tertiary">
            {KIND_LABEL[entry.kind]} · {formatDate(entry.on, { day: "numeric", month: "short", year: "numeric" })}
          </p>
          <p className="mt-0.5 text-sm leading-relaxed break-words">{entry.text}</p>
        </div>
        {editable && !confirming && (
          <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`Borrar anotación: ${entry.text}`} onClick={() => setConfirming(entry.id)}>
            <Trash2 />
          </Button>
        )}
      </div>
      {confirming && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <p className="mr-auto text-xs text-text-secondary">¿Borrar esta anotación?</p>
          <Button variant="ghost" className="h-11" onClick={() => setConfirming(null)}>
            Cancelar
          </Button>
          <Button variant="outline" className="h-11" onClick={() => (habitActions.removeGoalLog(goalId, entry.id), setConfirming(null))}>
            Borrar
          </Button>
        </div>
      )}
    </li>
  )
}
