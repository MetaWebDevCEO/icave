"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { formatCalendarDateLong, parseAsCalendarDate } from "@/lib/calendar-date";

export type PlannerAssignment = {
  id: string;
  title: string | null;
  status: string | null;
  priority: string | null;
  created_at: string | null;
  due_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  assigned_to_email: string | null;
};

type PlannerViewProps = {
  role: "revisor" | "usuario";
  assignments: PlannerAssignment[];
};

type PlannerEventKind = "creada" | "vence" | "entregada" | "completada";

type PlannerEvent = {
  id: string;
  assignmentId: string;
  kind: PlannerEventKind;
  at: string;
  dayKey: string;
  title: string;
  status: string | null;
  priority: string | null;
  assignedToEmail: string | null;
};

type MonthCell = {
  date: Date;
  outside: boolean;
};

const WEEK_DAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

function createCalendarMonthMonFirst(year: number, month: number): MonthCell[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const nativeDow = first.getDay();
  const startPadding = nativeDow === 0 ? 6 : nativeDow - 1;
  const cells: MonthCell[] = [];

  const prevMonthLast = new Date(year, month, 0).getDate();
  for (let i = startPadding - 1; i >= 0; i -= 1) {
    cells.push({
      date: new Date(year, month - 1, prevMonthLast - i),
      outside: true,
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      date: new Date(year, month, day),
      outside: false,
    });
  }

  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]?.date ?? new Date(year, month, daysInMonth);
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, outside: true });
  }

  while (cells.length < 42) {
    const last = cells[cells.length - 1]?.date ?? new Date(year, month, daysInMonth);
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    cells.push({ date: next, outside: true });
  }

  return cells;
}

function utcDateKey(value: string | null | undefined) {
  const parsed = parseAsCalendarDate(value);
  if (!parsed) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function keyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthLabelFromKey(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  return new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12, 0, 0, 0)));
}

function isCompleted(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  return (
    normalized.includes("comp") ||
    normalized.includes("done") ||
    normalized.includes("termin") ||
    normalized.includes("final") ||
    normalized.includes("cerrad")
  );
}

function getPriorityLabel(priority: string | null | undefined) {
  const normalized = (priority ?? "").trim().toLowerCase();
  if (!normalized) return "Sin prioridad";
  if (normalized.includes("no urg")) return "No urgente";
  if (normalized.includes("urg")) return "Urgente";
  if (normalized.includes("med")) return "Medio";
  return priority ?? "Sin prioridad";
}

function getPriorityBadge(priority: string | null | undefined) {
  const normalized = (priority ?? "").trim().toLowerCase();
  if (normalized.includes("no urg")) return "secondary" as const;
  if (normalized.includes("urg")) return "destructive" as const;
  if (normalized.includes("med")) return "warning" as const;
  return "outline" as const;
}

function getStatusMeta(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();

  if (isCompleted(normalized)) {
    return {
      label: "Completada",
      description: "Ya fue revisada y cerrada por el revisor.",
      badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
      panelClass: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20",
      dotClass: "bg-emerald-500",
    };
  }

  if (normalized.includes("entreg")) {
    return {
      label: "Entregada",
      description: "Ya fue enviada por el supervisor, pero aun espera revision final.",
      badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
      panelClass: "border-violet-200 bg-violet-50/70 dark:border-violet-900/40 dark:bg-violet-950/20",
      dotClass: "bg-violet-500",
    };
  }

  return {
    label: "Pendiente",
    description: "Sigue abierta y todavia requiere atencion o entrega.",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    panelClass: "border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20",
    dotClass: "bg-amber-500",
  };
}

function formatOwner(email: string | null | undefined) {
  if (!email) return "Sin supervisor";
  return email;
}

function getEventDotClass(kind: PlannerEventKind) {
  if (kind === "creada") return "bg-zinc-500";
  if (kind === "vence") return "bg-amber-500";
  if (kind === "entregada") return "bg-violet-500";
  return "bg-emerald-500";
}

function getEventMeta(kind: PlannerEventKind) {
  switch (kind) {
    case "creada":
      return {
        label: "Creada",
        badge: "outline" as const,
        className: "border-zinc-200 text-zinc-700 bg-zinc-50",
      };
    case "vence":
      return {
        label: "Fecha límite",
        badge: "warning" as const,
        className: "",
      };
    case "entregada":
      return {
        label: "Entregada",
        badge: "secondary" as const,
        className: "bg-violet-50 text-violet-700 border-violet-200",
      };
    case "completada":
      return {
        label: "Completada",
        badge: "success" as const,
        className: "",
      };
  }
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function PlannerView({ role, assignments }: PlannerViewProps) {
  const today = React.useMemo(() => new Date(), []);
  const [selectedDate, setSelectedDate] = React.useState<Date>(today);
  const [isDayModalOpen, setIsDayModalOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );

  const todayKey = React.useMemo(() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(
      now.getUTCDate()
    ).padStart(2, "0")}`;
  }, []);

  const selectedMonthKey = React.useMemo(() => monthKeyFromDate(viewMonth), [viewMonth]);
  const monthCells = React.useMemo(
    () => createCalendarMonthMonFirst(viewMonth.getFullYear(), viewMonth.getMonth()),
    [viewMonth]
  );

  const events = React.useMemo<PlannerEvent[]>(() => {
    const list: PlannerEvent[] = [];

    for (const row of assignments) {
      const title = (row.title ?? "").trim() || `Asignación ${row.id}`;

      const pushEvent = (kind: PlannerEventKind, at: string | null) => {
        const dayKey = utcDateKey(at);
        if (!at || !dayKey) return;
        list.push({
          id: `${row.id}-${kind}-${at}`,
          assignmentId: row.id,
          kind,
          at,
          dayKey,
          title,
          status: row.status,
          priority: row.priority,
          assignedToEmail: row.assigned_to_email,
        });
      };

      pushEvent("creada", row.created_at);
      pushEvent("vence", row.due_at);
      pushEvent("entregada", row.submitted_at);
      pushEvent("completada", row.completed_at);
    }

    return list.sort((a, b) => {
      const ta = parseAsCalendarDate(a.at)?.getTime() ?? 0;
      const tb = parseAsCalendarDate(b.at)?.getTime() ?? 0;
      return ta - tb;
    });
  }, [assignments]);

  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, PlannerEvent[]>();
    for (const event of events) {
      const current = map.get(event.dayKey) ?? [];
      current.push(event);
      map.set(event.dayKey, current);
    }
    return map;
  }, [events]);

  const selectedDayKey = React.useMemo(() => keyFromDate(selectedDate), [selectedDate]);
  const selectedDayEvents = React.useMemo(
    () => eventsByDay.get(selectedDayKey) ?? [],
    [eventsByDay, selectedDayKey]
  );

  React.useEffect(() => {
    if (!isDayModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDayModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDayModalOpen]);

  function moveMonth(offset: number) {
    const next = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + offset, 1);
    setViewMonth(next);
    if (
      selectedDate.getFullYear() !== next.getFullYear() ||
      selectedDate.getMonth() !== next.getMonth()
    ) {
      setSelectedDate(new Date(next.getFullYear(), next.getMonth(), 1));
    }
  }

  function selectToday() {
    const nextToday = new Date();
    setViewMonth(new Date(nextToday.getFullYear(), nextToday.getMonth(), 1));
    setSelectedDate(nextToday);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
            Calendario
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Fechas de creación, entrega, vencimiento y completado de las asignaciones.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-700">
            {role === "revisor" ? "Vista global" : "Mis asignaciones"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(new Date())}>
            Hoy
          </Button>
        </div>
      </div>

      <Card className="border-zinc-200 bg-white shadow-none dark:border-zinc-800 dark:bg-zinc-950">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base font-medium">Calendario de asignaciones</CardTitle>
              <CardDescription className="text-zinc-500">
                Vista mensual de creadas, vencimientos, entregas y completados.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="icon-sm" onClick={() => moveMonth(-1)}>
                <ChevronLeft />
              </Button>
              <div className="min-w-[180px] text-center text-sm font-medium capitalize text-zinc-900 dark:text-zinc-100">
                {monthLabelFromKey(selectedMonthKey)}
              </div>
              <Button variant="outline" size="icon-sm" onClick={() => moveMonth(1)}>
                <ChevronRight />
              </Button>
              <Button variant="outline" size="sm" onClick={selectToday}>
                Hoy
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/40 p-2 dark:border-zinc-800 dark:bg-zinc-900/20">
            <div className="mb-2 grid grid-cols-7 gap-2">
              {WEEK_DAYS.map((day) => (
                <div
                  key={day}
                  className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400"
                >
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
              {monthCells.map((cell) => {
                const dayKey = keyFromDate(cell.date);
                const dayEvents = eventsByDay.get(dayKey) ?? [];
                const overdueCount = assignments.filter((row) => {
                  const dueKey = utcDateKey(row.due_at);
                  return dueKey === dayKey && dayKey < todayKey && !isCompleted(row.status);
                }).length;
                const visibleEvents = dayEvents.slice(0, 3);
                const remaining = dayEvents.length - visibleEvents.length;
                const isSelected = sameDay(cell.date, selectedDate);
                const isToday = sameDay(cell.date, today);

                return (
                  <button
                    key={`${dayKey}-${cell.outside ? "outside" : "inside"}`}
                    type="button"
                    onClick={() => {
                      setSelectedDate(cell.date);
                      setIsDayModalOpen(true);
                    }}
                    className={[
                      "group min-h-[184px] rounded-xl border p-3 text-left transition-colors duration-150",
                      cell.outside
                        ? "border-zinc-200/80 bg-zinc-50/70 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-600"
                        : "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900/70",
                      isSelected ? "border-zinc-950 dark:border-zinc-100" : "",
                      isToday ? "bg-zinc-100 dark:bg-zinc-900" : "",
                      overdueCount > 0 ? "border-red-300 dark:border-red-900/50" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-lg font-medium tracking-tight">
                        {cell.date.getDate()}
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        {isToday ? (
                          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                            Hoy
                          </span>
                        ) : null}
                        {overdueCount > 0 ? (
                          <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
                            {overdueCount} atrasada{overdueCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                      {visibleEvents.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-zinc-200 px-3 py-4 text-center text-[11px] font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                          Sin movimientos
                        </div>
                      ) : null}

                      {visibleEvents.map((event) => {
                        const meta = getEventMeta(event.kind);
                        return (
                          <div
                            key={event.id}
                            className="border-l-2 border-zinc-200 pl-3 transition-colors dark:border-zinc-700"
                            style={{ borderLeftColor: "currentColor" }}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${getEventDotClass(event.kind)}`} />
                              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                                {meta.label}
                              </span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-[12px] leading-4 text-zinc-800 dark:text-zinc-200">
                              {event.title}
                            </div>
                          </div>
                        );
                      })}

                      {remaining > 0 ? (
                        <div className="pt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                          + {remaining} mas
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {isDayModalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          onClick={() => setIsDayModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                  {formatCalendarDateLong(selectedDayKey)}
                </h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {selectedDayEvents.length} movimiento{selectedDayEvents.length === 1 ? "" : "s"} registrado{selectedDayEvents.length === 1 ? "" : "s"} en esta fecha.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDayModalOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                aria-label="Cerrar detalles del día"
              >
                ×
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-700">
                  Creadas: {selectedDayEvents.filter((event) => event.kind === "creada").length}
                </Badge>
                <Badge variant="warning">
                  Vencen: {selectedDayEvents.filter((event) => event.kind === "vence").length}
                </Badge>
                <Badge className="border-violet-200 bg-violet-50 text-violet-700">
                  Entregadas: {selectedDayEvents.filter((event) => event.kind === "entregada").length}
                </Badge>
                <Badge variant="success">
                  Completadas: {selectedDayEvents.filter((event) => event.kind === "completada").length}
                </Badge>
              </div>

              {selectedDayEvents.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                  No hay movimientos de asignaciones en esta fecha.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDayEvents.map((event) => {
                    const meta = getEventMeta(event.kind);
                    const statusMeta = getStatusMeta(event.status);
                    return (
                      <div
                        key={event.id}
                        className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                      >
                        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={meta.badge} className={meta.className || undefined}>
                              Evento del dia: {meta.label}
                            </Badge>
                            <Badge variant={getPriorityBadge(event.priority)}>
                              Prioridad: {getPriorityLabel(event.priority)}
                            </Badge>
                          </div>
                          <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {event.title}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            {formatOwner(event.assignedToEmail)}
                          </div>
                        </div>

                        <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_240px]">
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                              Movimiento registrado
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${getEventDotClass(event.kind)}`} />
                              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                {meta.label}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                              Este es el cambio que quedo registrado exactamente en esta fecha.
                            </p>
                          </div>

                          <div className={`rounded-xl border p-3 ${statusMeta.panelClass}`}>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                              Estado actual de la tarea
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${statusMeta.dotClass}`} />
                              <span
                                className={`inline-flex rounded-md border px-2.5 py-1 text-sm font-semibold ${statusMeta.badgeClass}`}
                              >
                                {statusMeta.label}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                              {statusMeta.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
