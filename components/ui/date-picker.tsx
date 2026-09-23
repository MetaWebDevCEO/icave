"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Popover } from "@/components/ui/popover"
import { Calendar as CalendarIcon, X } from "@/components/ui/icons"
import { formatCalendarDateShort } from "@/lib/calendar-date"

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function formatNice(value: Date) {
  return formatCalendarDateShort(value.toISOString())
}

function dateToOrdinalEs(value: Date) {
  const weekdays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
  const months = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ]
  return `${weekdays[value.getDay()]} ${value.getDate()} ${months[value.getMonth()]}`
}

/* -------------------------------------------------------------------------- */
/* DatePicker (single)                                                         */
/* -------------------------------------------------------------------------- */

interface DatePickerProps {
  value?: Date | null
  onChange?: (date: Date | null) => void
  placeholder?: string
  className?: string
  label?: string
  hint?: string
  disabled?: boolean
  min?: Date
  max?: Date
}

export function DatePicker({
  value,
  onChange,
  placeholder = "dd/mm/aaaa",
  className,
  label,
  hint,
  disabled,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  const handleSelect = (date: Date | { from: Date; to?: Date } | null) => {
    if (date instanceof Date) {
      onChange?.(date)
      setOpen(false)
    }
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange?.(null)
  }

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11.5px] font-medium text-zinc-600 dark:text-zinc-400">
            {label}
          </span>
        </div>
      )}
      <Popover
        open={disabled ? false : open}
        onOpenChange={(o) => !disabled && setOpen(o)}
        trigger={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "group relative h-10 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3.5 text-left text-[13px] shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all outline-none",
              "hover:border-zinc-300 hover:bg-zinc-50/70",
              "focus-visible:border-[#023674] focus-visible:ring-[3px] focus-visible:ring-[#023674]/15",
              "dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/40 dark:focus-visible:border-[#02A9E5] dark:focus-visible:ring-[#02A9E5]/20",
              value && !disabled && "border-[#023674]/20 dark:border-[#02A9E5]/25",
              open && [
                "border-[#023674] ring-[3px] ring-[#023674]/15",
                "dark:border-[#02A9E5] dark:ring-[#02A9E5]/20",
              ],
              disabled && "cursor-not-allowed opacity-60",
              "flex items-center gap-3"
            )}
          >
            {/* Icono */}
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                value
                  ? "bg-[#023674]/10 text-[#023674] dark:bg-[#02A9E5]/10 dark:text-[#02A9E5]"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400",
                "transition-colors"
              )}
              aria-hidden
            >
              <CalendarIcon className="h-4 w-4" />
            </span>

            {/* Texto */}
            <span className="min-w-0 flex-1">
              {value ? (
                <span className="flex flex-col items-start leading-tight">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {formatNice(value)}
                  </span>
                  <span className="text-[10.5px] text-zinc-500 dark:text-zinc-400">
                    {dateToOrdinalEs(value)}
                  </span>
                </span>
              ) : (
                <span className="truncate text-zinc-400 dark:text-zinc-500">
                  {placeholder}
                </span>
              )}
            </span>

            {/* Clear */}
            {value && !disabled ? (
              <span
                role="button"
                tabIndex={0}
                onClick={clear}
                onKeyDown={(e) =>
                  (e.key === "Enter" || e.key === " ") && clear(e as unknown as React.MouseEvent)
                }
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Limpiar fecha"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </button>
        }
      >
        <Calendar
          mode="single"
          selected={value || null}
          onSelect={handleSelect}
        />
      </Popover>
      {hint && (
        <p className="mt-1 px-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* DateRangePicker                                                             */
/* -------------------------------------------------------------------------- */

interface DateRangePickerProps {
  value?: { from: Date; to?: Date } | null
  onChange?: (range: { from: Date; to?: Date } | null) => void
  placeholderFrom?: string
  placeholderTo?: string
  className?: string
  label?: string
  hint?: string
  disabled?: boolean
}

export function DateRangePicker({
  value,
  onChange,
  placeholderFrom = "Fecha inicio",
  placeholderTo = "Fecha fin",
  className,
  label,
  hint,
  disabled,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false)

  const handleSelect = (date: Date | { from: Date; to?: Date } | null) => {
    if (date && !(date instanceof Date)) {
      onChange?.(date)
    } else if (date instanceof Date) {
      onChange?.({ from: date })
    } else if (!date) {
      onChange?.(null)
    }
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange?.(null)
  }

  const hasRange = !!value
  const hasFullRange = !!(value && value.to)

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11.5px] font-medium text-zinc-600 dark:text-zinc-400">
            {label}
          </span>
        </div>
      )}
      <Popover
        open={disabled ? false : open}
        onOpenChange={(o) => !disabled && setOpen(o)}
        trigger={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "group relative h-10 w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-3.5 text-left text-[13px] shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all outline-none",
              "hover:border-zinc-300 hover:bg-zinc-50/70",
              "focus-visible:border-[#023674] focus-visible:ring-[3px] focus-visible:ring-[#023674]/15",
              "dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/40 dark:focus-visible:border-[#02A9E5] dark:focus-visible:ring-[#02A9E5]/20",
              hasRange && !disabled && "border-[#023674]/20 dark:border-[#02A9E5]/25",
              open && [
                "border-[#023674] ring-[3px] ring-[#023674]/15",
                "dark:border-[#02A9E5] dark:ring-[#02A9E5]/20",
              ],
              disabled && "cursor-not-allowed opacity-60",
              "flex items-center gap-3"
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                hasRange
                  ? "bg-[#023674]/10 text-[#023674] dark:bg-[#02A9E5]/10 dark:text-[#02A9E5]"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400",
                "transition-colors"
              )}
              aria-hidden
            >
              <CalendarIcon className="h-4 w-4" />
            </span>

            <span className="min-w-0 flex-1">
              {hasRange ? (
                <span className="flex flex-col items-start leading-tight">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {formatNice(value.from)}
                    <span className="mx-1.5 font-normal text-zinc-400 dark:text-zinc-500">→</span>
                    {value.to ? formatNice(value.to) : "…"}
                  </span>
                  <span className="text-[10.5px] text-zinc-500 dark:text-zinc-400">
                    {value.to
                      ? `${daysBetween(value.from, value.to)} días`
                      : "Selecciona fecha de fin"}
                  </span>
                </span>
              ) : (
                <span className="truncate text-zinc-400 dark:text-zinc-500">
                  {placeholderFrom} – {placeholderTo}
                </span>
              )}
            </span>

            {hasFullRange && (
              <span className="shrink-0 rounded-full bg-[#023674]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#023674] dark:bg-[#02A9E5]/10 dark:text-[#02A9E5]">
                {daysBetween(value.from, value.to as Date)} d
              </span>
            )}

            {hasRange && !disabled ? (
              <span
                role="button"
                tabIndex={0}
                onClick={clear}
                onKeyDown={(e) =>
                  (e.key === "Enter" || e.key === " ") && clear(e as unknown as React.MouseEvent)
                }
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Limpiar rango"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </button>
        }
      >
        <Calendar
          mode="range"
          selected={value || null}
          onSelect={handleSelect}
        />
      </Popover>
      {hint && (
        <p className="mt-1 px-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
    </div>
  )
}

function daysBetween(a: Date, b: Date) {
  const MS = 1000 * 60 * 60 * 24
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.max(1, Math.round((b0 - a0) / MS) + 1)
}

export default DatePicker
