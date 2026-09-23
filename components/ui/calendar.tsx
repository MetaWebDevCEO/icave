"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "@/components/ui/icons"

/* -------------------------------------------------------------------------- */
/* Helpers & constants                                                         */
/* -------------------------------------------------------------------------- */

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

/* Monday-first (ES standard): Lu = 0, Ma = 1, Mi = 2, Ju = 3, Vi = 4, Sá = 5, Do = 6 */
const WEEK_DAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"]

const YEARS = (() => {
  const current = new Date().getFullYear()
  const arr: number[] = []
  for (let y = current - 5; y <= current + 10; y++) arr.push(y)
  return arr
})()

function createCalendarMonthMonFirst(year: number, month: number) {
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  /* JS getDay(): 0=Do, 1=Lu, 2=Ma, ..., 6=Sá — queremos Lu primero => shift */
  const nativeDow = first.getDay()
  const startPadding = nativeDow === 0 ? 6 : nativeDow - 1
  const cells: Array<{ date: Date | null; outside: boolean }> = []

  /* previous month trailing days (greyed, outside) */
  const prevMonthLast = new Date(year, month, 0).getDate()
  for (let i = startPadding - 1; i >= 0; i--) {
    cells.push({
      date: new Date(year, month - 1, prevMonthLast - i),
      outside: true,
    })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), outside: false })
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]
    const nxt = new Date(last.date || new Date())
    nxt.setDate(nxt.getDate() + 1)
    cells.push({ date: nxt, outside: true })
  }
  /* siempre 6 filas x 7 cols = 42 celdas para altura consistente */
  while (cells.length < 42) {
    const last = cells[cells.length - 1]
    const nxt = new Date(last.date || new Date())
    nxt.setDate(nxt.getDate() + 1)
    cells.push({ date: nxt, outside: true })
  }
  return cells
}

function sameDay(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a || !b) return false
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/* is Monday-first weekend: sábado 5, domingo 6 */
function isWeekend(date: Date) {
  const d = date.getDay()
  return d === 0 || d === 6
}

/* -------------------------------------------------------------------------- */
/* Props & component                                                           */
/* -------------------------------------------------------------------------- */

interface CalendarProps {
  mode?: "single" | "range"
  selected?: Date | { from: Date; to?: Date } | null
  onSelect?: (value: Date | { from: Date; to?: Date } | null) => void
  className?: string
  defaultMonth?: Date
  fixedWeeks?: boolean
}

export function Calendar({
  mode = "single",
  selected,
  onSelect,
  className,
  defaultMonth,
}: CalendarProps) {
  const today = new Date()
  const initialMonth = defaultMonth
    ? new Date(defaultMonth.getFullYear(), defaultMonth.getMonth(), 1)
    : selected
      ? selected instanceof Date
        ? new Date(selected.getFullYear(), selected.getMonth(), 1)
        : new Date(selected.from.getFullYear(), selected.from.getMonth(), 1)
      : new Date(today.getFullYear(), today.getMonth(), 1)

  const [viewYear, setViewYear] = React.useState(initialMonth.getFullYear())
  const [viewMonth, setViewMonth] = React.useState(initialMonth.getMonth())
  const [rangeStart, setRangeStart] = React.useState<Date | null>(
    mode === "range" && selected && !(selected instanceof Date) ? selected.from : null
  )
  const [rangeEnd, setRangeEnd] = React.useState<Date | null>(
    mode === "range" && selected && !(selected instanceof Date) ? selected.to ?? null : null
  )
  const [hoverDate, setHoverDate] = React.useState<Date | null>(null)

  const cells = createCalendarMonthMonFirst(viewYear, viewMonth)

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }
  const goNext = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  const handleDayClick = (date: Date | null) => {
    if (!date) return
    if (mode === "single") {
      onSelect?.(date)
    } else {
      if (!rangeStart || (rangeStart && rangeEnd)) {
        setRangeStart(date)
        setRangeEnd(null)
        setHoverDate(null)
        onSelect?.({ from: date })
      } else {
        const from = date < rangeStart ? date : rangeStart
        const to = date < rangeStart ? rangeStart : date
        setRangeStart(from)
        setRangeEnd(to)
        setHoverDate(null)
        onSelect?.({ from, to })
      }
    }
  }

  const computedRangeEnd = mode === "range" && rangeStart && !rangeEnd && hoverDate
    ? hoverDate > rangeStart
      ? hoverDate
      : rangeStart
    : rangeEnd
  const effectiveTo = computedRangeEnd ?? rangeEnd

  const isInRange = (date: Date) => {
    if (mode !== "range") return false
    const from = rangeStart
    const to = effectiveTo
    if (!from) return false
    if (!to) return sameDay(date, from)
    const d0 = new Date(from.getFullYear(), from.getMonth(), from.getDate())
    const d1 = new Date(to.getFullYear(), to.getMonth(), to.getDate())
    const x = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    return x >= d0 && x <= d1
  }
  const isRangeStart = (date: Date) => sameDay(date, rangeStart)
  const isRangeEnd = (date: Date) => sameDay(date, effectiveTo)
  const isSelectedSingle = (date: Date) =>
    mode === "single" && sameDay(date, selected instanceof Date ? selected : null)

  const pickToday = () => {
    const t = new Date()
    setViewYear(t.getFullYear())
    setViewMonth(t.getMonth())
    if (mode === "single") {
      onSelect?.(t)
    } else {
      setRangeStart(t)
      setRangeEnd(null)
      onSelect?.({ from: t })
    }
  }

  return (
    <div
      data-slot="calendar"
      className={cn(
        "w-[320px] select-none rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_8px_30px_rgb(0,0,0,0.04)]",
        "dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-[0_8px_30px_rgb(0,0,0,0.35)]",
        className
      )}
    >
      {/* HEADER navigación */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={goPrev}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-label="Mes anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-1.5">
          <MonthSelect
            value={viewMonth}
            onChange={(m) => setViewMonth(m)}
          />
          <YearSelect
            value={viewYear}
            onChange={(y) => setViewYear(y)}
          />
        </div>

        <button
          type="button"
          onClick={goNext}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-label="Mes siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* WEEKDAY HEADER */}
      <div className="mb-1 grid grid-cols-7 gap-0">
        {WEEK_DAYS.map((d, i) => (
          <div
            key={d}
            className={cn(
              "flex h-7 items-center justify-center text-[11px] font-medium",
              i >= 5 ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-500 dark:text-zinc-400"
            )}
          >
            {d}
          </div>
        ))}
      </div>

      {/* GRID */}
      <div className="relative grid grid-cols-7 gap-0 rounded-lg bg-zinc-50/50 p-1 dark:bg-zinc-900/40">
        {cells.map((cell, idx) => {
          const date = cell.date
          if (!date) {
            return <div key={`empty-${idx}`} className="h-9 w-[38.86px]" />
          }
          const sel = isSelectedSingle(date) || isRangeStart(date) || isRangeEnd(date)
          const inRange = !sel && isInRange(date)
          const tdy = sameDay(date, today)
          const wknd = isWeekend(date)
          const col = idx % 7
          return (
            <button
              key={`${viewYear}-${viewMonth}-${idx}-${date.toISOString()}`}
              type="button"
              onClick={() => handleDayClick(date)}
              onMouseEnter={() => mode === "range" && rangeStart && !rangeEnd && setHoverDate(date)}
              onMouseLeave={() => mode === "range" && setHoverDate(null)}
              className={cn(
                "group relative h-9 w-full text-[13px] font-normal transition-colors",
                /* range background fill */
                inRange && "bg-[#E8F2FF] dark:bg-[#0A2540]/70",
                /* range start / end rounding (left edge) */
                (isRangeStart(date) || (mode === "single" && isSelectedSingle(date))) && [
                  "rounded-l-md",
                  "bg-gradient-to-r",
                  "from-[#023674] via-[#034e9c] to-[#034e9c] text-white",
                  "dark:from-[#02A9E5] dark:via-[#28b9ee] dark:to-[#28b9ee] dark:text-zinc-950",
                ],
                isRangeEnd(date) && [
                  "rounded-r-md",
                  "bg-gradient-to-r",
                  "from-[#034e9c] to-[#023674] text-white",
                  "dark:from-[#28b9ee] to-[#02A9E5] dark:text-zinc-950",
                ],
                /* today not selected */
                tdy && !sel && [
                  "font-semibold text-[#023674] dark:text-[#02A9E5]",
                ],
                /* empty / outside */
                cell.outside && !sel && !inRange && "text-zinc-300 dark:text-zinc-700",
                !cell.outside && !sel && !inRange && [
                  wknd
                    ? "text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                    : "text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100",
                ],
                /* Hover */
                !sel && "hover:bg-zinc-100 dark:hover:bg-zinc-800/70",
                /* focus */
                "outline-none focus-visible:ring-2 focus-visible:ring-[#023674]/40 focus-visible:ring-offset-1 dark:focus-visible:ring-[#02A9E5]/50",
                /* middle of range selection must not round */
                inRange && "rounded-none"
              )}
            >
              <span className="relative z-10">{date.getDate()}</span>
              {/* today dot marker when selected overridden */}
              {tdy && sel && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-white/80 dark:bg-zinc-950/70" />
              )}
              {tdy && !sel && (
                <span
                  className={cn(
                    "absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-[#023674] dark:bg-[#02A9E5]"
                  )}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* HOY & estado para rango */}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={pickToday}
          className="rounded-md px-2 py-1 text-[12px] font-medium text-[#023674] transition-colors hover:bg-[#023674]/10 dark:text-[#02A9E5] dark:hover:bg-[#02A9E5]/10"
        >
          Hoy
        </button>
        {mode === "range" ? (
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {rangeStart
              ? effectiveTo && !sameDay(rangeStart, effectiveTo)
                ? `${formatShort(rangeStart)} → ${formatShort(effectiveTo)}`
                : `Desde ${formatShort(rangeStart)}`
              : "Selecciona el inicio"}
          </div>
        ) : (
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {formatShort(today)}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Sub-componentes: Month / Year select (estilo inline, sin popover extra)     */
/* -------------------------------------------------------------------------- */

function MonthSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md px-2 py-1 text-[13px] font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {MONTH_NAMES[value]}
      </button>
      {open && (
        <div
          className="absolute left-1/2 top-full z-20 mt-1 w-40 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
          style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "2px" }}
        >
          {MONTH_NAMES.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onChange(i)
                setOpen(false)
              }}
              className={cn(
                "rounded-md px-1.5 py-1.5 text-[11.5px] transition-colors",
                i === value
                  ? "bg-[#023674] text-white dark:bg-[#02A9E5] dark:text-zinc-950"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              )}
            >
              {m.slice(0, 3)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function YearSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md px-2 py-1 text-[13px] font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {value}
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 max-h-52 w-20 -translate-x-1/2 overflow-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          {YEARS.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => {
                onChange(y)
                setOpen(false)
              }}
              className={cn(
                "block w-full rounded-md px-2 py-1 text-left text-[12px] transition-colors",
                y === value
                  ? "bg-[#023674] text-white dark:bg-[#02A9E5] dark:text-zinc-950"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              )}
            >
              {y}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function useClickOutside<T extends HTMLElement>(ref: React.RefObject<T | null>, onOutside: () => void) {
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onOutside()
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onOutside()
    document.addEventListener("mousedown", handler)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("mousedown", handler)
      document.removeEventListener("keydown", esc)
    }
  }, [ref, onOutside])
}

function formatShort(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  return `${dd}/${mm}/${d.getFullYear()}`
}

export { Calendar as default }
