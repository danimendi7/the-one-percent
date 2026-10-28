"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Moon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import { compact } from "@/components/common/format"
import { cn } from "@/lib/utils"
import type { LocalDate } from "../domain/dates"
import type { EvalContext } from "../domain/metrics"
import type { Habit } from "../domain/types"
import { isFocusFed } from "../domain/ops"
import { cellAriaLabel, cellInfo, type CellState } from "./cell-state"
import { recordEntry } from "./entry-actions"
import { QuickEntry } from "./quick-entry"

const STATE_CLASS: Record<CellState, string> = {
  done: "bg-signal text-signal-foreground border-transparent",
  partial: "border-warning/45 bg-warning/8 text-warning",
  todo: "border-text-tertiary/70 bg-surface-raised text-text-secondary hover:border-signal/70",
  missed: "border-border bg-transparent text-text-tertiary hover:border-text-tertiary",
  open: "border-dashed border-border bg-transparent text-text-tertiary hover:border-text-tertiary",
  future: "border-dashed border-border/60 bg-transparent",
  rest: "hatch border-border/60",
  inactive: "border-transparent",
}

/**
 * HabitDayCell: one tap for binary habits; numeric opens quick entry
 * (bottom sheet on touch-size screens, popover on desktop).
 */
export function HabitDayCell({
  habit,
  date,
  ctx,
  className,
}: {
  habit: Habit
  date: LocalDate
  ctx: EvalContext
  className?: string
}) {
  const info = cellInfo(habit, date, ctx)
  const label = cellAriaLabel(habit, date, info)
  const [open, setOpen] = useState(false)
  const mobile = useMediaQuery("(max-width: 767px)")

  const base = cn(
    "relative grid aspect-square w-full max-w-11 place-items-center rounded-[10px] border text-[0.6875rem] font-semibold transition-[background-color,border-color,transform] duration-150 select-none",
    STATE_CLASS[info.state],
    info.interactive && "cursor-pointer active:scale-[0.94]",
    className
  )

  if (info.interactive && isFocusFed(habit, date)) {
    // Derived from focus sessions (M3.2): no manual control, the cell leads to Enfoque.
    const v = info.entry && typeof info.entry.value === "number" ? info.entry.value : null
    return (
      <Link href="/focus" className={cn(base, "cursor-pointer")}>
        <span className="sr-only">{`${label}. Se alimenta de Enfoque: ir a Enfoque`}</span>
        <span aria-hidden className="contents">
          {v !== null ? <span className="num">{compact(v)}</span> : <span className="text-[0.625rem] font-medium text-text-tertiary">foco</span>}
        </span>
      </Link>
    )
  }

  if (!info.interactive) {
    return (
      <span role="img" aria-label={label} className={base}>
        {info.state === "inactive" && <span className="h-px w-2.5 bg-border" />}
        {info.state === "rest" && <Moon className="size-3.5 text-text-tertiary" aria-hidden />}
      </span>
    )
  }

  const numericValue = info.entry && typeof info.entry.value === "number" ? info.entry.value : null
  const content =
    habit.type === "binary" ? (
      info.state === "done" ? (
        <Check key="done" className="animate-pop size-[18px]" strokeWidth={3} aria-hidden />
      ) : info.state === "todo" ? (
        // Affordance: today's pending cell hints at the tap-to-complete action.
        <Check className="size-[18px] opacity-25" strokeWidth={2.5} aria-hidden />
      ) : null
    ) : numericValue !== null ? (
      <span key={`${info.state}`} className={cn("num", info.state === "done" && "animate-pop")}>
        {compact(numericValue)}
      </span>
    ) : (
      <span className="text-base leading-none font-normal text-text-tertiary" aria-hidden>
        +
      </span>
    )

  if (habit.type === "binary") {
    const done = info.state === "done"
    return (
      <button
        type="button"
        aria-pressed={done}
        className={base}
        onClick={() => recordEntry(habit, date, !done, ctx.today)}
      >
        <span className="sr-only">{label}</span>
        <span aria-hidden className="contents">{content}</span>
      </button>
    )
  }

  const entry = (
    <QuickEntry
      habit={habit}
      date={date}
      initial={numericValue}
      onSave={(v) => {
        recordEntry(habit, date, v, ctx.today)
        setOpen(false)
      }}
      onClear={() => {
        recordEntry(habit, date, null, ctx.today)
        setOpen(false)
      }}
    />
  )
  const trigger = (
    <button type="button" aria-haspopup="dialog" className={base} onClick={mobile ? () => setOpen(true) : undefined}>
      {/* Name via hidden text, not aria-label, so it always contains the visible value (WCAG 2.5.3). */}
      <span className="sr-only">{`${label}. Editar cantidad`}</span>
      <span aria-hidden className="contents">{content}</span>
    </button>
  )

  if (mobile) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="gap-0 rounded-t-3xl p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{habit.name}</SheetTitle>
              <SheetDescription>Registrar cantidad</SheetDescription>
            </SheetHeader>
            <div className="pb-safe px-5 pt-6 pb-5">{entry}</div>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[min(18rem,calc(100vw-2rem))]" align="center" collisionPadding={16}>
        {entry}
      </PopoverContent>
    </Popover>
  )
}
