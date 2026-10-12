"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
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

type MonthlyPoint = { mes: string; creadas: number; entregadas: number };
type StatusPoint = { mes: string; pendientes: number; encurso: number; completadas: number };
type Slice = { name: string; value: number; key: string };
type SupervisorRow = {
  email: string;
  label: string;
  total: number;
  completadas: number;
  avance: number;
};

type Props = {
  kpis: Kpis;
  monthlySeries: MonthlyPoint[];
  statusSeries: StatusPoint[];
  priorityData: Slice[];
  topSupervisores: SupervisorRow[];
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

// ----- Gráfico de barras: Creadas vs Entregadas por mes -----
function MonthlyChart({ data }: { data: MonthlyPoint[] }) {
  const config = {
    creadas: { label: "Creadas", color: "#0a0a0a" },
    entregadas: { label: "Entregadas", color: "#16a34a" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <BarChart data={data}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="mes"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
        />
        <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="dashed" />} />
        <Bar dataKey="creadas" fill="var(--color-creadas)" radius={[6, 6, 0, 0]} barSize={22} />
        <Bar dataKey="entregadas" fill="var(--color-entregadas)" radius={[6, 6, 0, 0]} barSize={22} />
      </BarChart>
    </ChartContainer>
  );
}

// ----- Area Chart apilado: evolución de estados por mes -----
function StatusAreaChart({ data }: { data: StatusPoint[] }) {
  const config = {
    pendientes: { label: "Pendientes", color: "#d97706" },
    encurso: { label: "En curso", color: "#2563eb" },
    completadas: { label: "Completadas", color: "#16a34a" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gradPendientes" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#d97706" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#d97706" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gradEnCurso" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gradCompletadas" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#16a34a" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#16a34a" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={10} />
        <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
        <Area
          type="monotone"
          dataKey="pendientes"
          stackId="st"
          stroke="#d97706"
          fill="url(#gradPendientes)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="encurso"
          stackId="st"
          stroke="#2563eb"
          fill="url(#gradEnCurso)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="completadas"
          stackId="st"
          stroke="#16a34a"
          fill="url(#gradCompletadas)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ----- Donut -----
function DonutChart({ data }: { data: Slice[] }) {
  const config = data.reduce<ChartConfig>((acc, s, i) => {
    acc[s.key] = { label: s.name, color: PALETTE[i % PALETTE.length] };
    return acc;
  }, {});

  return (
    <ChartContainer config={config} className="h-[260px] w-full">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={95}
          paddingAngle={2}
          stroke="none"
        >
          {data.map((s, i) => (
            <Cell
              key={s.key}
              fill={PALETTE[i % PALETTE.length]}
            />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

// ----- Barras horizontales: Top supervisores -----
function TopSupervisoresChart({ data }: { data: SupervisorRow[] }) {
  const config = {
    completadas: { label: "Completadas", color: "#0a0a0a" },
  } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="h-[340px] w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={110}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Bar dataKey="completadas" fill="var(--color-completadas)" radius={[0, 6, 6, 0]} barSize={16} />
      </BarChart>
    </ChartContainer>
  );
}

// ----- Página principal -----
export function RevisorDashboard({
  kpis,
  monthlySeries,
  statusSeries,
  priorityData,
  topSupervisores,
}: Props) {
  return (
    <div className="flex flex-col gap-8 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Panorama general de asignaciones y desempeño del equipo.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total" value={kpis.total} />
        <KpiCard label="Completadas" value={kpis.completadas} tone="success" />
        <KpiCard label="En curso" value={kpis.enCurso} />
        <KpiCard label="Pendientes" value={kpis.pendientes} />
        <KpiCard label="Vencidas" value={kpis.vencidas} tone="danger" />
        <KpiCard label="% Avance" value={`${kpis.avance}%`} tone="success" />
      </div>

      {/* Gráfico mensual + Area chart por estado */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Actividad mensual
            </h2>
            <span className="text-xs text-muted-foreground">Últimos 6 meses</span>
          </div>
          <MonthlyChart data={monthlySeries} />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-5">
          <h2 className="text-lg font-semibold tracking-tight">Por estado</h2>
          {statusSeries.length > 0 ? (
            <StatusAreaChart data={statusSeries} />
          ) : (
            <Empty />
          )}
        </div>
      </div>

      {/* Top supervisores + Prioridad */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Top supervisores por entregas
          </h2>
          {topSupervisores.length > 0 ? (
            <TopSupervisoresChart data={topSupervisores} />
          ) : (
            <Empty />
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-5">
          <h2 className="text-lg font-semibold tracking-tight">Por prioridad</h2>
          {priorityData.length > 0 ? (
            <DonutChart data={priorityData} />
          ) : (
            <Empty />
          )}
          <LegendList data={priorityData} />
        </div>
      </div>
    </div>
  );
}

function LegendList({ data }: { data: Slice[] }) {
  const total = data.reduce((acc, d) => acc + d.value, 0) || 1;
  return (
    <ul className="flex flex-col gap-2">
      {data.map((d, i) => (
        <li key={d.key} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            <span className="text-foreground">{d.name}</span>
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {d.value} · {Math.round((d.value / total) * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

function Empty() {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
      Sin datos para mostrar
    </div>
  );
}
