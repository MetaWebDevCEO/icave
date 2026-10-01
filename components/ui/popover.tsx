"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { createPortal } from "react-dom"

interface PopoverProps {
  trigger: React.ReactNode
  children: React.ReactNode
  className?: string
  align?: "start" | "center" | "end"
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const GAP = 8
const EDGE_PAD = 12

export function Popover({
  trigger,
  children,
  className,
  align = "start",
  open: controlledOpen,
  onOpenChange,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (!isControlled) setUncontrolledOpen(v)
      onOpenChange?.(v)
    },
    [isControlled, onOpenChange]
  )
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  /* Coordenadas calculadas */
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)
  const [portalMounted, setPortalMounted] = React.useState(false)
  React.useEffect(() => setPortalMounted(true), [])

  const setOpenRef = React.useRef(setOpen)
  React.useEffect(() => {
    setOpenRef.current = setOpen
  }, [setOpen])

  /* Click outside + Escape */
  React.useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current && containerRef.current.contains(target)) return
      if (contentRef.current && contentRef.current.contains(target)) return
      setOpenRef.current(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenRef.current(false)
    }
    /* Delay para no atrapar el click del propio trigger (evita close inmediato) */
    let raf1 = 0
    let raf2 = 0
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        document.addEventListener("mousedown", handle)
        document.addEventListener("keydown", handleKey)
      })
    })
    return () => {
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      document.removeEventListener("mousedown", handle)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  /* Cálculo de posición (fixed, viewport-relative) con colisión automática */
  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const compute = () => {
      const anchor = anchorRef.current
      const content = contentRef.current
      if (!anchor || !content) return
      const a = anchor.getBoundingClientRect()
      const c = content.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      /* Left por alineamiento pedido */
      let left = a.left
      if (align === "center") left = a.left + a.width / 2 - c.width / 2
      if (align === "end") left = a.right - c.width

      /* Colisión RIGHT → alinear extremo derecho con extremo derecho del anchor */
      const maxLeft = vw - c.width - EDGE_PAD
      if (left + c.width > vw - EDGE_PAD) {
        left = Math.min(maxLeft, a.right - c.width)
      }
      if (left < EDGE_PAD) left = EDGE_PAD

      /* Top: debajo del anchor por defecto */
      let top = a.bottom + GAP
      const roomBelow = vh - a.bottom - GAP - EDGE_PAD
      const roomAbove = a.top - GAP - EDGE_PAD
      if (c.height > roomBelow && roomAbove > roomBelow) {
        /* abrir hacia arriba */
        top = a.top - GAP - c.height
      }
      if (top + c.height > vh - EDGE_PAD) top = vh - c.height - EDGE_PAD
      if (top < EDGE_PAD) top = EDGE_PAD

      setPos({ top: Math.round(top), left: Math.round(left) })
    }

    compute()
    // recalcular en próximos frames (medida inicial puede ser 0), scroll y resize
    let frame = 0
    let i = 0
    const loop = () => {
      compute()
      if (i < 4) {
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
  }, [open, align])

  const contentEl = (
    <div
      ref={contentRef}
      style={{
        position: "fixed",
        top: pos ? pos.top : 0,
        left: pos ? pos.left : 0,
        visibility: "visible",
      }}
      className={cn(
        "z-[99999]",
        "rounded-md border border-zinc-200 bg-white p-0 text-zinc-900 shadow-[0_10px_38px_-10px_rgba(15,23,42,0.2)]",
        "dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)]",
        !pos ? "opacity-0 pointer-events-none" : "",
        className
      )}
    >
      {children}
    </div>
  )

  return (
    <div ref={containerRef} className="relative block w-full">
      <div ref={anchorRef} onClick={() => setOpen(!open)}>
        {trigger}
      </div>
      {open && portalMounted && typeof document !== "undefined"
        ? createPortal(contentEl, document.body)
        : null}
    </div>
  )
}

export default Popover
