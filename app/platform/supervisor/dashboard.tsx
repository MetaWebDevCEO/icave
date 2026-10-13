"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

type Kpis = {
  total: number;
  completadas: number;
  enCurso: number;
  pendientes: number;
  vencidas: number;
  avance: number;
  urgentesPendientes: number;
};

type PriorityPoint = { name: string; value: number };
type DailyPoint = { dia: string; creadas: number; entregadas: number };
type MonthlyPoint = { mes: string; total: number; completadas: number };

type Props = {
  kpis: Kpis;
  priorityData: PriorityPoint[];
  dailySeries: DailyPoint[];
  monthlySeries: MonthlyPoint[];
  selectedMonth: string;
};

const COLORS = {
  completadas: "#16a34a",
  enCurso: "#7c3aed",
  pendientes: "#f59e0b",
  vencidas: "#dc2626",
  creadas: "#f59e0b",
  entregadas: "#7c3aed",
};

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const PRIORITY_COLORS = ["#dc2626", "#d97706", "#2563eb", "#737373", "#16a34a"];

// ----- Chart config (estilo EvilCharts / shadcn) -----
const chartConfig = {
  creadas: { label: "Creadas", color: COLORS.creadas },
  entregadas: { label: "Entregadas", color: COLORS.entregadas },
  avance: { label: "Avance", color: COLORS.enCurso },
  value: { label: "Tareas", color: COLORS.enCurso },
} satisfies ChartConfig;

// ----- KPI Stat Card -----
function KpiStatCard({
  label,
  value,
  change,
  tone,
}: {
  label: string;
  value: number;
  change?: number;
  tone: "default" | "success" | "warning" | "danger";
}) {
  const toneRing =
    tone === "success"
      ? "ring-emerald-200 dark:ring-emerald-900"
      : tone === "warning"
        ? "ring-amber-200 dark:ring-amber-900"
        : tone === "danger"
          ? "ring-red-200 dark:ring-red-900"
          : "ring-zinc-200 dark:ring-zinc-800";

  const changeColor =
    (change ?? 0) >= 0 ? "text-emerald-600" : "text-red-600";

  return (
    <div className={`rounded-xl bg-white p-4 ring-1 ring-inset ${toneRing} dark:bg-zinc-950`}>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      {typeof change === "number" ? (
        <div className="mt-1 flex items-center gap-1.5">
          <span className={`inline-flex items-center text-[11px] font-semibold ${changeColor}`}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change)}%
          </span>
          <span className="text-[11px] text-zinc-400">vs mes anterior</span>
        </div>
      ) : null}
    </div>
  );
}

// ----- Donut de Prioridades (Recharts + shadcn) -----
function PriorityDonutChart({ data }: { data: PriorityPoint[] }) {
  const total = data.reduce((acc, d) => acc + d.value, 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-[140px] w-full">
        <ChartContainer config={chartConfig} className="h-full w-full">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="white"
              strokeWidth={2}
              isAnimationActive={true}
              animationDuration={600}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PRIORITY_COLORS[i % PRIORITY_COLORS.length]} />
              ))}
            </Pie>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{total}</span>
          <span className="text-[10px] text-zinc-400">Total</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2 text-xs">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: PRIORITY_COLORS[i % PRIORITY_COLORS.length] }}
            />
            <span className="text-zinc-600 dark:text-zinc-400">{d.name}</span>
            <span className="ml-auto font-semibold">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----- Línea de Actividad Diaria (Recharts + shadcn) -----
function DailyActivityChart({ data }: { data: DailyPoint[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-[150px] w-full">
        <ChartContainer config={chartConfig} className="h-full w-full">
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
            <XAxis
              dataKey="dia"
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              interval={2}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => `Día ${v}`} />} />
            <Line
              type="monotone"
              dataKey="creadas"
              name="Creadas"
              stroke={COLORS.creadas}
              strokeWidth={2.5}
              dot={{ r: 3, fill: hexToRgba(COLORS.creadas, 0.7) }}
              activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2 }}
              isAnimationActive={true}
              animationDuration={600}
            />
            <Line
              type="monotone"
              dataKey="entregadas"
              name="Entregadas"
              stroke={COLORS.entregadas}
              strokeWidth={2.5}
              dot={{ r: 3, fill: hexToRgba(COLORS.entregadas, 0.7) }}
              activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2 }}
              isAnimationActive={true}
              animationDuration={600}
            />
          </LineChart>
        </ChartContainer>
      </div>
      <div className="flex items-center justify-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS.creadas }} />
          <span className="text-zinc-600 dark:text-zinc-400">Creadas</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS.entregadas }} />
          <span className="text-zinc-600 dark:text-zinc-400">Entregadas</span>
        </div>
      </div>
    </div>
  );
}

// ----- Área de Avance (Recharts + shadcn) -----
function AvanceAreaChart({ data }: { data: MonthlyPoint[] }) {
  const points = data.map((d) => ({
    mes: d.mes,
    avance: d.total > 0 ? Math.round((d.completadas / d.total) * 100) : 0,
  }));

  const gradId = "avanceGradient";

  return (
    <div className="relative h-[120px] w-full">
      <ChartContainer config={chartConfig} className="h-full w-full">
        <AreaChart data={points} margin={{ top: 5, right: 10, bottom: 0, left: -25 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.enCurso} stopOpacity={0.35} />
              <stop offset="100%" stopColor={COLORS.enCurso} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="mes"
            tick={{ fontSize: 11, fill: "#71717a" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis hide domain={[0, 100]} />
          <ChartTooltip
            content={<ChartTooltipContent labelFormatter={(v) => `${v}`} />}
          />
          <Area
            type="monotone"
            dataKey="avance"
            name="Avance"
            stroke={COLORS.enCurso}
            strokeWidth={2.5}
            fill={`url(#${gradId})`}
            dot={{ r: 3.5, fill: "#fff", stroke: COLORS.enCurso, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: "#fff", stroke: COLORS.enCurso, strokeWidth: 2 }}
            isAnimationActive={true}
            animationDuration={600}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

// ----- Barra apilada horizontal de estado (CSS) -----
function StatusStackedBar({ data }: { data: { label: string; value: number; color: string }[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const total = data.reduce((acc, d) => acc + d.value, 0);
  if (total === 0) {
    return <div className="text-sm text-zinc-400">Sin datos</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {data.map((d) => {
          const pct = (d.value / total) * 100;
          if (pct === 0) return null;
          const isHovered = hovered === d.label;
          return (
            <div
              key={d.label}
              className="h-full cursor-pointer transition-all duration-200"
              style={{
                width: `${pct}%`,
                backgroundColor: hexToRgba(d.color, isHovered ? 0.7 : 0.35),
                borderLeft: `2px solid ${d.color}`,
                transform: isHovered ? "scaleY(1.6)" : "scaleY(1)",
              }}
              onMouseEnter={() => setHovered(d.label)}
              onMouseLeave={() => setHovered(null)}
              title={`${d.label}: ${d.value} (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {data.map((d) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          const isHovered = hovered === d.label;
          return (
            <div
              key={d.label}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg p-1.5 transition-colors ${
                isHovered ? "bg-zinc-50 dark:bg-zinc-900" : ""
              }`}
              onMouseEnter={() => setHovered(d.label)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: d.color }}
                />
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{d.label}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{d.value}</span>
                <span className="text-[11px] text-zinc-400">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----- Página principal -----
export function SupervisorDashboard({
  kpis,
  priorityData,
  dailySeries,
  monthlySeries,
  selectedMonth,
}: Props) {
  const monthName = (() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    return d.toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  })();

  const lastMonth = monthlySeries[monthlySeries.length - 2];
  const thisMonth = monthlySeries[monthlySeries.length - 1];
  const pctChange = (curr: number, prev: number) =>
    prev > 0 ? Math.round(((curr - prev) / prev) * 100) : curr > 0 ? 100 : 0;

  const changeCompletadas = thisMonth && lastMonth
    ? pctChange(thisMonth.completadas, lastMonth.completadas)
    : undefined;
  const changePendientes = thisMonth && lastMonth
    ? pctChange(thisMonth.total - thisMonth.completadas, lastMonth.total - lastMonth.completadas)
    : undefined;

  const statusData = [
    { label: "Completadas", value: kpis.completadas, color: COLORS.completadas },
    { label: "En curso", value: kpis.enCurso, color: COLORS.enCurso },
    { label: "Pendientes", value: kpis.pendientes, color: COLORS.pendientes },
  ];

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-col gap-0.5">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Mi Rendimiento</h1>
        <p className="text-xs text-zinc-500">Estadísticas de tus tareas · {monthName}</p>
      </div>

      {/* Fila 1: 3 KPI cards pequeñas */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiStatCard label="Total Tareas" value={kpis.total} tone="default" />
        <KpiStatCard label="Completadas" value={kpis.completadas} change={changeCompletadas} tone="success" />
        <KpiStatCard label="Pendientes" value={kpis.pendientes} change={changePendientes} tone="warning" />
      </div>

      {/* Fila 2: Rendimiento (área) + Estado (barra apilada) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-xl bg-white p-4 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Rendimiento</h2>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800">
              Últimos {monthlySeries.length} meses
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {kpis.avance}%
            </span>
            {changeCompletadas !== undefined ? (
              <span className={`inline-flex items-center text-xs font-semibold ${changeCompletadas >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {changeCompletadas >= 0 ? "▲" : "▼"} {Math.abs(changeCompletadas)}%
              </span>
            ) : null}
            <span className="text-xs text-zinc-400">vs mes anterior</span>
          </div>
          <AvanceAreaChart data={monthlySeries} />
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Estado de Tareas</h2>
          <StatusStackedBar data={statusData} />
        </div>
      </div>

      {/* Fila 3: Actividad diaria + Prioridades */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-xl bg-white p-4 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actividad Diaria</h2>
            <span className="text-[11px] text-zinc-500">Día 1 al último día del mes</span>
          </div>
          <DailyActivityChart data={dailySeries} />
        </div>

        <div className="flex flex-col gap-2 rounded-xl bg-white p-4 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Prioridades</h2>
            <span className="text-[11px] text-zinc-500">Mes seleccionado</span>
          </div>
          <PriorityDonutChart data={priorityData} />
        </div>
      </div>
    </div>
  );
}
