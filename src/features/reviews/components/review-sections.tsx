"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Link2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { uuidv4 } from "@/lib/ids"
import type { HabitsState } from "@/features/habits/domain/types"
import type { ReviewSaveOutcome } from "@/features/habits/store/types"
import { decisionsToEvaluate, setEvaluation } from "../domain/content"
import { sameSection, type SectionValue } from "../domain/sync"
import {
  DECISION_KIND_LABEL,
  DECISION_KINDS,
  EVALUATION_LABEL,
  EVALUATION_OUTCOMES,
  LIMITS,
  QUESTION_KEYS,
  QUESTION_LABEL,
  type ContentKey,
  type Decision,
  type DecisionLink,
  type Evaluation,
  type EvaluationOutcome,
  type Review,
  type ReviewField,
  type ReviewKind,
} from "../domain/types"
import { ChoiceGroup } from "./review-ui"

/** Saves one section; returns the refusal reason, or null when it was saved. */
export type SaveSection = (field: ReviewField, value: SectionValue) => Exclude<ReviewSaveOutcome, { ok: true }>["reason"] | null

const SAVE_ERROR: Record<string, string> = {
  closed: "Esta revisión ya está cerrada. Tu texto sigue aquí: cópialo si quieres conservarlo.",
  closing: "La revisión se está cerrando. Cancela el cierre para seguir editando.",
  conflict: "Este apartado espera tu decisión: elige arriba qué versión se queda.",
  invalid: "No se pudo guardar: revisa la longitud del texto.",
  not_available: "Este periodo aún no se puede revisar.",
  invalid_period: "Este periodo no existe.",
}

export const DEBOUNCE_MS = 800

/**
 * Autosave of one section (plan §4.1): saved 800 ms after the last change, on leaving the field,
 * and on pagehide / tab hidden, so at most the last 800 ms are lost if the system kills the tab.
 * While the user edits, a newer value from another device does not replace the text; once
 * saved, the field follows the stored value again. A refused save keeps the text on screen.
 */
export function useAutosave<T extends SectionValue>(field: ReviewField, stored: T, save: SaveSection, onTyping?: (field: ReviewField, typing: boolean) => void) {
  const [value, setValue] = useState<T>(stored)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState<T>(stored)
  if (!sameSection(field, seen, stored)) {
    setSeen(stored)
    if (!dirty) setValue(stored)
  }
  const pending = useRef<{ value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)
  const typingRef = useRef(onTyping)
  useEffect(() => {
    saveRef.current = save
    typingRef.current = onTyping
  })

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const p = pending.current
    if (!p) return
    pending.current = null
    const reason = saveRef.current(field, p.value)
    setError(reason ? (SAVE_ERROR[reason] ?? "No se pudo guardar.") : null)
    // A refused value stays dirty: the user's text is never replaced by the stored one.
    if (!reason) setDirty(false)
    typingRef.current?.(field, false)
  }, [field])

  useEffect(() => {
    const onHide = () => flush()
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush()
    }
    window.addEventListener("pagehide", onHide)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("pagehide", onHide)
      document.removeEventListener("visibilitychange", onVisibility)
      flush()
    }
  }, [flush])

  const change = useCallback(
    (v: T, immediate = false) => {
      setValue(v)
      setDirty(true)
      pending.current = { value: v }
      if (timer.current) clearTimeout(timer.current)
      if (immediate) flush()
      else {
        typingRef.current?.(field, true)
        timer.current = setTimeout(flush, DEBOUNCE_MS)
      }
    },
    [field, flush]
  )

  return { value, change, flush, error }
}

function Counter({ length, max, id }: { length: number; max: number; id: string }) {
  // Visible from 80 % of the limit (plan §6.3); always available to screen readers.
  const visible = length >= max * 0.8
  return (
    <span id={id} className={cn("num text-[0.6875rem]", length > max ? "text-error" : "text-text-tertiary", !visible && "sr-only")}>
      {length}/{max}
    </span>
  )
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-1.5 text-xs leading-relaxed text-warning">
      {message}
    </p>
  )
}

// ── Reflection ─────────────────────────────────────────────────────────────

function ReflectionField({
  question,
  stored,
  save,
  onTyping,
  waiting,
  disabled,
}: {
  question: ContentKey
  stored: string
  save: SaveSection
  onTyping: (field: ReviewField, typing: boolean) => void
  waiting: boolean
  disabled: boolean
}) {
  const id = useId()
  const field = `content.${question}` as const
  const max = question === "note" ? LIMITS.note : LIMITS.answer
  const a = useAutosave<string | null>(field, stored || null, save, onTyping)
  const text = a.value ?? ""
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {QUESTION_LABEL[question]} <span className="font-normal text-text-tertiary">· opcional</span>
        </label>
        <Counter length={text.length} max={max} id={`${id}-count`} />
      </div>
      <Textarea
        id={id}
        value={text}
        maxLength={max}
        rows={question === "note" ? 4 : 3}
        disabled={disabled || waiting}
        aria-describedby={`${id}-count`}
        onChange={(e) => a.change(e.target.value)}
        onBlur={a.flush}
        className="field-sizing-content min-h-24 resize-none text-[0.9375rem] leading-relaxed"
        data-testid={`review-${question}`}
      />
      {waiting && <p className="mt-1.5 text-xs text-warning">Este apartado espera tu decisión (arriba).</p>}
      <FieldError message={a.error} />
    </div>
  )
}

export function ReflectionStep({
  review,
  kind,
  save,
  onTyping,
  waiting,
  disabled,
}: {
  review: Review | undefined
  kind: ReviewKind
  save: SaveSection
  onTyping: (field: ReviewField, typing: boolean) => void
  waiting: Set<ReviewField>
  disabled: boolean
}) {
  const hasNote = !!review?.content.note
  const [noteOpen, setNoteOpen] = useState(hasNote)
  return (
    <div className="space-y-5">
      {QUESTION_KEYS[kind].map((q) => (
        <ReflectionField key={q} question={q} stored={review?.content[q] ?? ""} save={save} onTyping={onTyping} waiting={waiting.has(`content.${q}`)} disabled={disabled} />
      ))}
      {noteOpen || hasNote ? (
        <ReflectionField question="note" stored={review?.content.note ?? ""} save={save} onTyping={onTyping} waiting={waiting.has("content.note")} disabled={disabled} />
      ) : (
        <Button variant="ghost" className="-ml-2" onClick={() => setNoteOpen(true)} disabled={disabled}>
          <Plus aria-hidden />
          Añadir una nota libre
        </Button>
      )}
    </div>
  )
}

// ── Evaluations of the previous period's decisions ─────────────────────────

const OUTCOME_OPTIONS = EVALUATION_OUTCOMES.map((o) => ({ value: o, label: EVALUATION_LABEL[o] }))

export function EvaluationsStep({
  review,
  previous,
  save,
  onTyping,
  waiting,
  disabled,
}: {
  review: Review | undefined
  previous: Review
  save: SaveSection
  onTyping: (field: ReviewField, typing: boolean) => void
  waiting: boolean
  disabled: boolean
}) {
  const a = useAutosave<Evaluation[]>("evaluations", review?.evaluations ?? [], save, onTyping)
  const list = a.value
  const left = decisionsToEvaluate(previous, list).length
  const off = disabled || waiting
  return (
    <div className="space-y-4">
      <p className="num text-xs text-text-tertiary" aria-live="polite">
        {left === 0 ? "Todas evaluadas." : `${left} de ${previous.decisions.length} por evaluar.`} Evaluar es opcional: puedes cerrar sin hacerlo.
      </p>
      <ul className="space-y-3">
        {previous.decisions.map((d) => {
          const e = list.find((x) => x.decisionId === d.id) ?? null
          const set = (outcome: EvaluationOutcome | null, note: string | null, immediate: boolean) =>
            a.change(outcome ? setEvaluation(list, { decisionId: d.id, from: previous.periodStart, outcome, note }) : list.filter((x) => x.decisionId !== d.id), immediate)
          return (
            <li key={d.id} className="panel-raised rounded-xl p-3.5" data-testid="review-evaluation">
              <p className="text-sm font-medium">{d.text}</p>
              <p className="mt-0.5 text-xs text-text-tertiary">
                {DECISION_KIND_LABEL[d.kind]}
                {d.expected && ` · esperado: ${d.expected}`}
                {d.link && ` · ${d.link.title}`}
              </p>
              <ChoiceGroup label={`Resultado de «${d.text}»`} value={e?.outcome ?? null} options={OUTCOME_OPTIONS} onChange={(o) => set(o, e?.note ?? null, true)} disabled={off} clearable className="mt-3 grid-cols-2! sm:grid-cols-4!" />
              {e && (
                <Input
                  aria-label={`Nota sobre «${d.text}» (opcional)`}
                  placeholder="Nota corta (opcional)"
                  value={e.note ?? ""}
                  maxLength={LIMITS.evaluationNote}
                  disabled={off}
                  onChange={(ev) => set(e.outcome, ev.target.value || null, false)}
                  onBlur={a.flush}
                  className="mt-2 h-11 md:h-10"
                />
              )}
            </li>
          )
        })}
      </ul>
      {waiting && <p className="text-xs text-warning">Las evaluaciones esperan tu decisión (arriba).</p>}
      <FieldError message={a.error} />
    </div>
  )
}

// ── Decisions for the next period ──────────────────────────────────────────

const KIND_OPTIONS = DECISION_KINDS.map((k) => ({ value: k, label: DECISION_KIND_LABEL[k] }))

/** Only complete decisions are stored; a row without text stays on screen until it has one. */
function storable(ds: readonly Decision[]): Decision[] {
  return ds.filter((d) => d.text.trim())
}

export function DecisionsStep({
  review,
  state,
  nextLabel,
  save,
  onTyping,
  waiting,
  disabled,
}: {
  review: Review | undefined
  state: HabitsState
  nextLabel: string
  save: SaveSection
  onTyping: (field: ReviewField, typing: boolean) => void
  waiting: boolean
  disabled: boolean
}) {
  const stored = review?.decisions ?? []
  const [rows, setRows] = useState<Decision[]>(stored)
  const a = useAutosave<Decision[]>("decisions", stored, save, onTyping)
  // Follow the stored list (another device, a decision taken) unless a new row is being written.
  const [seen, setSeen] = useState(a.value)
  if (seen !== a.value) {
    setSeen(a.value)
    if (!rows.some((r) => !r.text.trim())) setRows(a.value)
  }
  const off = disabled || waiting
  function update(next: Decision[], immediate = false) {
    setRows(next)
    a.change(storable(next), immediate)
  }
  const habits = state.habits.filter((h) => !h.archivedOn)
  const goals = state.goals.filter((g) => g.state === "active" && !g.archivedOn)
  return (
    <div className="space-y-4">
      <p className="text-xs text-text-tertiary">Hasta {LIMITS.decisions} decisiones concretas para {nextLabel}. Se evaluarán en la próxima revisión.</p>
      <ol className="space-y-3">
        {rows.map((d, i) => (
          <DecisionRow
            key={d.id}
            n={i + 1}
            d={d}
            habits={habits.map((h) => ({ type: "habit", id: h.id, title: h.name }))}
            goals={goals.map((g) => ({ type: "goal", id: g.id, title: g.title }))}
            exists={!d.link || (d.link.type === "habit" ? state.habits.some((h) => h.id === d.link!.id) : state.goals.some((g) => g.id === d.link!.id))}
            disabled={off}
            onChange={(next, immediate) => update(rows.map((x) => (x.id === d.id ? next : x)), immediate)}
            onRemove={() => update(rows.filter((x) => x.id !== d.id), true)}
            onBlur={a.flush}
          />
        ))}
      </ol>
      {rows.length < LIMITS.decisions && (
        <Button
          variant="outline"
          className="w-full"
          disabled={off}
          onClick={() => setRows([...rows, { id: uuidv4(), text: "", kind: "start", expected: null, link: null }])}
          data-testid="review-add-decision"
        >
          <Plus aria-hidden />
          Añadir decisión
        </Button>
      )}
      {waiting && <p className="text-xs text-warning">Las decisiones esperan tu decisión (arriba).</p>}
      <FieldError message={a.error} />
    </div>
  )
}

function DecisionRow({
  n,
  d,
  habits,
  goals,
  exists,
  disabled,
  onChange,
  onRemove,
  onBlur,
}: {
  n: number
  d: Decision
  habits: DecisionLink[]
  goals: DecisionLink[]
  exists: boolean
  disabled: boolean
  onChange: (d: Decision, immediate: boolean) => void
  onRemove: () => void
  onBlur: () => void
}) {
  const id = useId()
  const [more, setMore] = useState(!!(d.expected || d.link))
  const linkValue = d.link ? `${d.link.type}:${d.link.id}` : ""
  return (
    <li className="panel-raised rounded-xl p-3.5" data-testid="review-decision">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          Decisión {n}
        </label>
        <Counter length={d.text.length} max={LIMITS.decisionText} id={`${id}-count`} />
      </div>
      <Input
        id={id}
        value={d.text}
        maxLength={LIMITS.decisionText}
        placeholder="Ej.: 4 bloques de foco de 90 min"
        disabled={disabled}
        aria-describedby={`${id}-count`}
        onChange={(e) => onChange({ ...d, text: e.target.value }, false)}
        onBlur={onBlur}
        className="h-11 text-[0.9375rem] md:h-10"
      />
      <ChoiceGroup label={`Tipo de la decisión ${n}`} value={d.kind} options={KIND_OPTIONS} onChange={(k) => k && onChange({ ...d, kind: k }, true)} disabled={disabled} className="mt-2.5 grid-cols-2! sm:grid-cols-4!" />
      {more ? (
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          <Input
            aria-label={`Resultado esperado de la decisión ${n} (opcional)`}
            placeholder="Resultado esperado (opcional)"
            value={d.expected ?? ""}
            maxLength={LIMITS.expected}
            disabled={disabled}
            onChange={(e) => onChange({ ...d, expected: e.target.value || null }, false)}
            onBlur={onBlur}
            className="h-11 md:h-10"
          />
          <div className="relative">
            <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <select
              aria-label={`Vínculo de la decisión ${n} (opcional)`}
              value={linkValue}
              disabled={disabled}
              onChange={(e) => {
                const [type, ...rest] = e.target.value.split(":")
                const target = [...habits, ...goals].find((l) => l.type === type && l.id === rest.join(":"))
                onChange({ ...d, link: target ?? null }, true)
              }}
              className="h-11 w-full appearance-none rounded-lg border border-input bg-input/30 pr-8 pl-9 text-sm text-foreground md:h-10"
            >
              <option value="">Sin vínculo</option>
              {d.link && !exists && <option value={linkValue}>{d.link.title} (ya no existe)</option>}
              {habits.length > 0 && (
                <optgroup label="Hábitos">
                  {habits.map((h) => (
                    <option key={h.id} value={`habit:${h.id}`}>
                      {h.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {goals.length > 0 && (
                <optgroup label="Objetivos">
                  {goals.map((g) => (
                    <option key={g.id} value={`goal:${g.id}`}>
                      {g.title}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)} disabled={disabled} className="mt-1 inline-flex min-h-11 items-center text-xs font-medium text-text-secondary hover:text-foreground">
          + Resultado esperado o vínculo
        </button>
      )}
      <div className="mt-1 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onRemove} disabled={disabled} aria-label={`Quitar la decisión ${n}`} className="h-11 md:h-9">
          <Trash2 aria-hidden />
          Quitar
        </Button>
      </div>
    </li>
  )
}
