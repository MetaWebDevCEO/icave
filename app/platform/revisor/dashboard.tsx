"use client";

import { useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Cell,
  Pie,
  PieChart,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// ----- Tipos -----
type Kpis = {
  total: number;
  completadas: number;
  enCurso: number;
  pendientes: number;
  vencidas: number;
  avance: number;
};

type SupervisorCumplimiento = {
  email: string;
  label: string;
  total: number;
  completadas: number;
  avance: number;
};

type DailyPoint = {
  dia: string;
  creadas: number;
  entregadas: number;
  completadas: number;
  total: number;
};

type ImpactoAlto = {
  total: number;
  urgente: number;
  medio: number;
  noUrgente: number;
};

type Props = {
  kpis: Kpis;
  cumplimientoSupervisores: SupervisorCumplimiento[];
  dailySeries: DailyPoint[];
  impactoAlto: ImpactoAlto;
  selectedMonth: string;
};

// Paleta de colores (editorial: negro, gris, ámbar, rojo, verde, azul)
const PALETTE = ["#0a0a0a", "#737373", "#d97706", "#dc2626", "#16a34a", "#2563eb"];

// ----- KPI Card -----
function KpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: "default" | "muted" | "danger" | "success";
  hint?: string;
}) {
  const valueColor =
    tone === "danger"
      ? "text-red-600"
      : tone === "success"
        ? "text-green-600"
        : "text-foreground";
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border/60 bg-background p-5">
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-3xl font-semibold tracking-tight ${valueColor}`}
      >
        {value}
      </span>
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

// ----- 1. Cumplimiento por supervisor (0-100%) -----
const CUMPLIMIENTO_PAGE_SIZE = 9;
const CUMPLIMIENTO_GRID_ROWS = 10;

function cumplimientoTone(avance: number) {
  if (avance >= 75) {
    return {
      block: "bg-green-600",
      text: "text-green-600",
      badge: "bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/40 dark:text-green-200 dark:ring-green-900",
    };
  }
  if (avance >= 50) {
    return {
      block: "bg-amber-500",
      text: "text-amber-600",
      badge: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900",
    };
  }
  return {
    block: "bg-red-500",
    text: "text-red-600",
    badge: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900",
  };
}

function CumplimientoSupervisores({ data }: { data: SupervisorCumplimiento[] }) {
  const [page, setPage] = useState(0);

  if (data.length === 0) {
    return <Empty />;
  }

  const totalPages = Math.max(1, Math.ceil(data.length / CUMPLIMIENTO_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * CUMPLIMIENTO_PAGE_SIZE;
  const visible = data.slice(start, start + CUMPLIMIENTO_PAGE_SIZE);
  const rangeStart = start + 1;
  const rangeEnd = Math.min(start + CUMPLIMIENTO_PAGE_SIZE, data.length);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Leyenda de umbrales */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-600" />
          ≥75% óptimo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" />
          50–74% en riesgo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          &lt;50% crítico
        </span>
      </div>

      {/* Vista por bloques, acomodada de lado */}
      <div className="flex-1 rounded-2xl border border-border/60 bg-zinc-50/60 p-3 dark:bg-zinc-950/30">
        <div className="flex h-full min-h-[208px] items-end gap-2">
        {visible.map((s) => {
          const tone = cumplimientoTone(s.avance);
          const filled = Math.max(
            0,
            Math.min(CUMPLIMIENTO_GRID_ROWS, Math.round(s.avance / 10))
          );
          return (
            <div
              key={s.email}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
              title={`${s.label} · ${s.completadas}/${s.total} · ${s.avance}%`}
            >
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ring-inset ${tone.badge}`}
              >
                {s.avance}%
              </span>

              <div className="flex h-[136px] flex-col-reverse gap-[3px]">
                {Array.from({ length: CUMPLIMIENTO_GRID_ROWS }).map((_, idx) => (
                  <div
                    key={`${s.email}-${idx}`}
                    className={`h-3 w-6 rounded-[3px] transition-colors ${
                      idx < filled
                        ? tone.block
                        : "bg-zinc-200/90 dark:bg-zinc-800"
                    }`}
                  />
                ))}
              </div>

              <div className="flex flex-col items-center gap-0.5 text-center">
                <span
                  className="max-w-[64px] truncate text-[10px] font-medium text-foreground"
                  title={s.email}
                >
                  {s.label}
                </span>
                <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
                  {s.completadas}/{s.total}
                </span>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* Controles de paginación */}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between border-t border-border/60 pt-3">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            Mostrando {rangeStart}–{rangeEnd} de {data.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              aria-label="Página anterior"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="min-w-12 text-center text-[11px] tabular-nums text-muted-foreground">
              {currentPage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              aria-label="Página siguiente"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ----- 2. Días de actividad del mes en curso (Area chart estilo Evil Charts) -----
function DailyActivityChart({ data }: { data: DailyPoint[] }) {
  const config = {
    creadas: { label: "Creadas", color: "#f59e0b" },
    entregadas: { label: "Entregadas", color: "#7c3aed" },
    completadas: { label: "Completadas", color: "#16a34a" },
  } satisfies ChartConfig;

  const hasAny = data.some((d) => d.total > 0);
  if (!hasAny) return <Empty />;

  const maxY = Math.max(...data.map((d) => Math.max(d.creadas, d.entregadas, d.completadas)), 1);

  return (
    <ChartContainer config={config} className="h-[240px] w-full xl:h-[260px]">
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="dailyCreatedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(245, 158, 11, 0.35)" />
            <stop offset="100%" stopColor="rgba(245, 158, 11, 0.03)" />
          </linearGradient>
          <linearGradient id="dailyDeliveredFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(124, 58, 237, 0.4)" />
            <stop offset="100%" stopColor="rgba(124, 58, 237, 0.04)" />
          </linearGradient>
          <linearGradient id="dailyCompletedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(22, 163, 74, 0.32)" />
            <stop offset="100%" stopColor="rgba(22, 163, 74, 0.03)" />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(161, 161, 170, 0.22)" />
        <XAxis
          dataKey="dia"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fontSize: 10 }}
          interval={data.length > 20 ? 2 : data.length > 10 ? 1 : 0}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={28}
          allowDecimals={false}
          domain={[0, maxY]}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="dashed" />} />
        <Area
          type="monotone"
          dataKey="creadas"
          stroke="rgba(245, 158, 11, 0.95)"
          fill="url(#dailyCreatedFill)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: "rgba(245, 158, 11, 0.95)" }}
        />
        <Area
          type="monotone"
          dataKey="entregadas"
          stroke="rgba(124, 58, 237, 0.95)"
          fill="url(#dailyDeliveredFill)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: "rgba(124, 58, 237, 0.95)" }}
        />
        <Area
          type="monotone"
          dataKey="completadas"
          stroke="rgba(22, 163, 74, 0.95)"
          fill="url(#dailyCompletedFill)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: "rgba(22, 163, 74, 0.95)" }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ----- 3. Clasificación de Impacto (tareas creadas por prioridad) -----
const IMPACTO_STYLE: Record<string, { fill: string; stroke: string }> = {
  urgente: { fill: "rgba(220, 38, 38, 0.35)", stroke: "rgba(220, 38, 38, 0.6)" },
  medio: { fill: "rgba(245, 158, 11, 0.35)", stroke: "rgba(245, 158, 11, 0.6)" },
  noUrgente: { fill: "rgba(22, 163, 74, 0.35)", stroke: "rgba(22, 163, 74, 0.6)" },
};

function ImpactoAltoChart({ data }: { data: ImpactoAlto }) {
  const pieData = [
    { name: "Urgente", value: data.urgente, key: "urgente" },
    { name: "Medio", value: data.medio, key: "medio" },
    { name: "No Urgente", value: data.noUrgente, key: "noUrgente" },
  ].filter((d) => d.value > 0);

  const config = {
    urgente: { label: "Urgente", color: "#dc2626" },
    medio: { label: "Medio", color: "#f59e0b" },
    noUrgente: { label: "No Urgente", color: "#16a34a" },
  } satisfies ChartConfig;

  const percent = (value: number) =>
    data.total > 0 ? Math.round((value / data.total) * 100) : 0;

  if (data.total === 0) {
    return <Empty />;
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartContainer config={config} className="h-[160px] w-full xl:h-[170px]">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            innerRadius={38}
            outerRadius={68}
            paddingAngle={2}
            stroke="none"
          >
            {pieData.map((s) => (
              <Cell
                key={s.key}
                fill={IMPACTO_STYLE[s.key].fill}
                stroke={IMPACTO_STYLE[s.key].stroke}
                strokeWidth={1}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-red-50 p-2.5 ring-1 ring-inset ring-red-200 dark:bg-red-950/30 dark:ring-red-900">
          <div className="text-xl font-semibold text-red-700 dark:text-red-200">{data.urgente}</div>
          <div className="text-[11px] uppercase tracking-wide text-red-700/70 dark:text-red-200/70">
            Urgente
          </div>
          <div className="mt-1 text-[11px] text-red-700/80 dark:text-red-200/80">
            {percent(data.urgente)}%
          </div>
        </div>
        <div className="rounded-lg bg-amber-50 p-2.5 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900">
          <div className="text-xl font-semibold text-amber-700 dark:text-amber-200">{data.medio}</div>
          <div className="text-[11px] uppercase tracking-wide text-amber-700/70 dark:text-amber-200/70">
            Medio
          </div>
          <div className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-200/80">
            {percent(data.medio)}%
          </div>
        </div>
        <div className="rounded-lg bg-emerald-50 p-2.5 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900">
          <div className="text-xl font-semibold text-emerald-700 dark:text-emerald-200">{data.noUrgente}</div>
          <div className="text-[11px] uppercase tracking-wide text-emerald-700/70 dark:text-emerald-200/70">
            No Urgente
          </div>
          <div className="mt-1 text-[11px] text-emerald-700/80 dark:text-emerald-200/80">
            {percent(data.noUrgente)}%
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressRing({
  value,
  size,
  dotSize,
  dotCount,
  color,
  trackColor = "rgba(161, 161, 170, 0.22)",
  children,
}: {
  value: number;
  size: number;
  dotSize: number;
  dotCount: number;
  color: string;
  trackColor?: string;
  children?: ReactNode;
}) {
  const toStablePx = (n: number) => `${Math.round(n * 10000) / 10000}px`;
  const normalized = Math.max(0, Math.min(100, value));
  const activeDots = Math.round((normalized / 100) * dotCount);
  const radius = size / 2 - dotSize * 1.4;
  const center = size / 2;
  const startAngle = 225;
  const innerSize = size - dotSize * 5.5;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {Array.from({ length: dotCount }).map((_, idx) => {
        const angle = ((startAngle + (idx * 360) / dotCount) * Math.PI) / 180;
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        return (
          <span
            key={idx}
            className="absolute rounded-full"
            style={{
              left: toStablePx(x),
              top: toStablePx(y),
              width: toStablePx(dotSize),
              height: toStablePx(dotSize),
              transform: "translate(-50%, -50%)",
              backgroundColor: idx < activeDots ? color : trackColor,
            }}
          />
        );
      })}
      <div
        className="absolute rounded-full bg-background"
        style={{ width: toStablePx(innerSize), height: toStablePx(innerSize) }}
      />
      {children ? <div className="absolute inset-0 flex items-center justify-center">{children}</div> : null}
    </div>
  );
}

// ----- 4. Promedio de cumplimiento -----
function PromedioCumplimientoChart({
  data,
}: {
  data: SupervisorCumplimiento[];
}) {
  if (data.length === 0) {
    return <Empty />;
  }

  const totalAsignadas = data.reduce((acc, s) => acc + s.total, 0);
  const totalCompletadas = data.reduce((acc, s) => acc + s.completadas, 0);
  const promedio = totalAsignadas > 0 ? Math.round((totalCompletadas / totalAsignadas) * 100) : 0;
  const optimos = data.filter((s) => s.avance >= 85).length;
  const enRiesgo = data.filter((s) => s.avance >= 50 && s.avance < 85).length;
  const criticos = data.filter((s) => s.avance < 50).length;
  const tone =
    promedio >= 85
      ? {
          stroke: "#16a34a",
          soft: "bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/40 dark:text-green-200 dark:ring-green-900",
        }
      : promedio >= 50
        ? {
            stroke: "#f59e0b",
            soft: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900",
          }
        : {
            stroke: "#dc2626",
            soft: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900",
          };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Promedio de cumplimiento
        </h2>
      </div>
      <div className="rounded-2xl border border-border/60 bg-zinc-50/70 p-3 dark:bg-zinc-950/30">
        <div className="flex flex-col items-center justify-center gap-4">
          <ProgressRing value={promedio} size={190} dotSize={9} dotCount={36} color={tone.stroke}>
            <div className="flex max-w-[112px] flex-col items-center gap-1 text-center">
              <span className="text-4xl font-semibold tracking-tight text-foreground">
                {promedio}%
              </span>
              <span className="text-xs text-muted-foreground">
                {totalCompletadas} de {totalAsignadas}
              </span>
              <span className="text-[11px] leading-4 text-muted-foreground">
                actividades completadas
              </span>
            </div>
          </ProgressRing>

          <div className="grid w-full grid-cols-3 gap-2">
            <div className="rounded-xl bg-background/90 px-2.5 py-2.5 text-center ring-1 ring-inset ring-border/60">
              <div className="text-base font-semibold text-green-600">{optimos}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Optimos
              </div>
            </div>

            <div className="rounded-xl bg-background/90 px-2.5 py-2.5 text-center ring-1 ring-inset ring-border/60">
              <div className="text-base font-semibold text-amber-600">{enRiesgo}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  En riesgo
              </div>
            </div>

            <div className="rounded-xl bg-background/90 px-2.5 py-2.5 text-center ring-1 ring-inset ring-border/60">
              <div className="text-base font-semibold text-red-600">{criticos}</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Criticos
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- Página principal -----
export function RevisorDashboard({
  kpis,
  cumplimientoSupervisores,
  dailySeries,
  impactoAlto,
  selectedMonth,
}: Props) {
  const monthName = (() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    return d.toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  })();

  return (
    <div className="flex flex-col gap-4 p-4 xl:max-h-[calc(100dvh-7.5rem)] xl:overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Cumplimiento, actividad e impacto de las asignaciones · {monthName}
          </p>
        </div>
      </div>

      {/* Fila 1: Cumplimiento por supervisor + promedio general */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Cumplimiento de Actividades
            </h2>
            <span className="text-xs text-muted-foreground">
              Por supervisor · 0–100%
            </span>
          </div>
          <CumplimientoSupervisores data={cumplimientoSupervisores} />
        </div>

        <PromedioCumplimientoChart data={cumplimientoSupervisores} />
      </div>

      {/* Fila 2: Días de actividad + Clasificación de impacto */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Días de Actividad
            </h2>
            <span className="text-xs text-muted-foreground">Mes en curso</span>
          </div>
          <DailyActivityChart data={dailySeries} />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Clasificación de Impacto
            </h2>
            <span className="text-xs text-muted-foreground">
              Creadas · {impactoAlto.total}
            </span>
          </div>
          <ImpactoAltoChart data={impactoAlto} />
        </div>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
      Sin datos para mostrar
    </div>
  );
}
