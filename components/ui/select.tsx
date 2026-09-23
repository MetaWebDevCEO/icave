"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { ChevronDown } from "@/components/ui/icons"

interface SelectContextValue {
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  registerTriggerRef: (el: HTMLElement | null) => void
  triggerRef: React.MutableRefObject<HTMLElement | null>
  triggerWidth: number
  setTriggerWidth: (w: number) => void
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelectContext() {
  const ctx = React.useContext(SelectContext)
  if (!ctx) throw new Error("Select components must be used within <Select>")
  return ctx
}

interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
}

function Select({ value, defaultValue, onValueChange, children }: SelectProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? "")
  const [open, setOpen] = React.useState(false)
  const [triggerWidth, setTriggerWidth] = React.useState<number>(0)
  const currentValue = value !== undefined ? value : uncontrolled
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const registerTriggerRef = React.useCallback(
    (el: HTMLElement | null) => (triggerRef.current = el),
    []
  )

  const handleChange = (v: string) => {
    if (value === undefined) setUncontrolled(v)
    onValueChange?.(v)
    setOpen(false)
  }

  return (
    <SelectContext.Provider
      value={{
        value: currentValue,
        onValueChange: handleChange,
        open,
        setOpen,
        registerTriggerRef,
        triggerRef,
        triggerWidth,
        setTriggerWidth,
      }}
    >
      <div className="relative inline-flex w-full min-w-0">{children}</div>
    </SelectContext.Provider>
  )
}

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { children?: React.ReactNode }
>(function SelectTrigger({ className, children, ...props }, fwdRef) {
  const { open, setOpen, registerTriggerRef } = useSelectContext()
  const localRef = React.useRef<HTMLButtonElement | null>(null)

  React.useImperativeHandle(fwdRef, () => localRef.current as HTMLButtonElement)

  React.useLayoutEffect(() => {
    const el = localRef.current
    registerTriggerRef(el as unknown as HTMLElement | null)
    return () => {
      /* Unmount: no borramos inmediatamente por si el close-animation necesita ref */
    }
  }, [registerTriggerRef])

  return (
    <button
      ref={localRef}
      type="button"
      aria-expanded={open}
      data-slot="select-trigger"
      data-state={open ? "open" : "closed"}
      onClick={() => setOpen(!open)}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
    </button>
  )
})

export { SelectTrigger as _SelectTriggerRaw }

function SelectValue({
  placeholder,
  className,
  children,
}: {
  placeholder?: string
  className?: string
  children?: React.ReactNode
}) {
  const { value } = useSelectContext()
  return (
    <span
      data-slot="select-value"
      className={cn(
        !value && placeholder ? "text-muted-foreground" : "",
        className
      )}
    >
      {children || value || placeholder}
    </span>
  )
}

function SelectContent({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const { open, setOpen, triggerRef } = useSelectContext()
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)
  const [portalMounted, setPortalMounted] = React.useState(false)
  React.useEffect(() => setPortalMounted(true), [])

  // Click outside + Escape
  React.useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      const t = e.target as Node
      if (contentRef.current && contentRef.current.contains(t)) return
      const trigger = triggerRef.current
      if (trigger && trigger.contains(t)) return
      setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    let raf1 = 0
    let raf2 = 0
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        document.addEventListener("mousedown", handle)
        document.addEventListener("keydown", esc)
      })
    })
    return () => {
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      document.removeEventListener("mousedown", handle)
      document.removeEventListener("keydown", esc)
    }
  }, [open, setOpen, triggerRef])

  const resolveAnchor = (): HTMLElement | null => {
    // 1) Direct register via context (preferred, 100% deterministic)
    if (triggerRef.current) return triggerRef.current
    // 2) Fallback: DOM-search from here for the nearest trigger in *this* subtree.
    //    Si hay varios selects en el DOM, usamos el más cercano a este SelectContent.
    let node: Element | null = contentRef.current?.previousElementSibling ?? null
    // Si no previous sibling, el SelectContent está como child del provider wrapper.
    // Subimos y buscamos [data-slot="select-trigger"] dentro del wrapper (1 nivel).
    let cursor: Element | null = contentRef.current
    let safety = 12
    while (cursor && safety > 0) {
      if (cursor.querySelector) {
        const found = cursor.querySelector<HTMLElement>('[data-slot="select-trigger"]')
        if (found) return found
      }
      cursor = cursor.parentElement
      safety--
    }
    void node
    return null
  }

  // Posicionamiento fixed-viewport + detección colisiones + fallback centrado
  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const compute = () => {
      const anchor = resolveAnchor()
      const content = contentRef.current
      if (!content) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const c = content.getBoundingClientRect()
      const PAD = 12
      const GAP = 6

      let top: number
      let left: number

      if (anchor) {
        const a = anchor.getBoundingClientRect()
        // min-width del popover = ancho del trigger (estilo visual shadcn: dropdown align con trigger)
        if (c.width < a.width) {
          content.style.minWidth = `${Math.round(a.width)}px`
        }
        left = a.left
        // Right-collision: ajustar alineamiento a la derecha del trigger
        const maxLeft = vw - c.width - PAD
        if (left + c.width > vw - PAD) left = Math.min(maxLeft, a.right - c.width)
        if (left < PAD) left = PAD
        // Por defecto abrir abajo
        top = a.bottom + GAP
        const roomBelow = vh - a.bottom - GAP - PAD
        const roomAbove = a.top - GAP - PAD
        if (c.height > roomBelow && roomAbove > roomBelow) top = a.top - GAP - c.height
        if (top + c.height > vh - PAD) top = vh - c.height - PAD
        if (top < PAD) top = PAD
      } else {
        // FALLBACK FINAL: centrar en viewport (no hay anchor)
        left = Math.max(PAD, Math.round(vw / 2 - c.width / 2))
        top = Math.max(PAD, Math.round(vh / 2 - c.height / 2))
      }
      setPos({ top: Math.round(top), left: Math.round(left) })
    }
    compute()
    let frame = 0
    let i = 0
    const loop = () => {
      compute()
      if (i < 6) {
        i++
        frame = window.requestAnimationFrame(loop)
      }
    }
    frame = window.requestAnimationFrame(loop)
    const onResize = () => compute()
    const onScroll = () => compute()
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [open])

  if (!open || !portalMounted || typeof document === "undefined") return null

  return createPortal(
    <div
      ref={contentRef}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
      data-slot="select-content"
      className={cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-[9999] max-h-80 w-auto min-w-[8rem] max-w-[min(92vw,560px)] overflow-x-hidden overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-zinc-900 shadow-[0_10px_38px_-10px_rgba(15,23,42,0.2)] dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)]",
        className
      )}
    >
      {children}
    </div>,
    document.body
  )
}

function SelectItem({
  value,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const { value: selected, onValueChange } = useSelectContext()
  const isSelected = selected === value
  return (
    <div
      data-slot="select-item"
      role="option"
      aria-selected={isSelected}
      data-selected={isSelected}
      onClick={() => onValueChange(value)}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        isSelected ? "bg-accent/50" : "",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        {isSelected && (
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <path
              d="M5 12l5 5L20 7"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      {children}
    </div>
  )
}

function SelectGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("", className)}>{children}</div>
}

function SelectLabel({ className, children }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs font-semibold", className)}
    >
      {children}
    </div>
  )
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
}
