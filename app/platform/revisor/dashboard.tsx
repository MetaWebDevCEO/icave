"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
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

type DailyPoint = { dia: string; creadas: number; entregadas: number; total: number };

type ImpactoAlto = {
  total: number;
  completadas: number;
  pendientes: number;
  avance: number;
};

type Props = {
  kpis: Kpis;
  cumplimientoSupervisores: SupervisorCumplimiento[];
  dailySeries: DailyPoint[];
  impactoAlto: ImpactoAlto;
  diaMaxActividad: string;
  diaMaxEntregas: number;
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
function CumplimientoSupervisores({ data }: { data: SupervisorCumplimiento[] }) {
  if (data.length === 0) {
    return <Empty />;
  }
  return (
    <div className="flex flex-col gap-2">
      {data.slice(0, 12).map((s) => (
        <div key={s.email} className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="truncate font-medium text-foreground" title={s.email}>
              {s.label}
            </span>
            <span className="ml-3 shrink-0 font-mono tabular-nums text-muted-foreground">
              {s.completadas}/{s.total} · {s.avance}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all ${
                s.avance >= 75
                  ? "bg-green-600"
                  : s.avance >= 50
                    ? "bg-amber-500"
                    : "bg-red-500"
              }`}
              style={{ width: `${s.avance}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ----- 2. Días de actividad del mes en curso (Combo: barras + línea) -----
function DailyActivityChart({ data }: { data: DailyPoint[] }) {
  const config = {
    creadas: { label: "Creadas", color: "#f59e0b" },
    entregadas: { label: "Entregadas", color: "#7c3aed" },
  } satisfies ChartConfig;

  const hasAny = data.some((d) => d.total > 0);
  if (!hasAny) return <Empty />;

  // Calcular eje Y máximo para que la línea no quede abajo
  const maxY = Math.max(...data.map((d) => Math.max(d.creadas, d.entregadas)), 1);

  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <ComposedChart data={data}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
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
        <Bar
          dataKey="creadas"
          fill="rgba(245, 158, 11, 0.35)"
          radius={[6, 6, 0, 0]}
          barSize={14}
        />
        <Line
          type="monotone"
          dataKey="entregadas"
          stroke="rgba(124, 58, 237, 0.85)"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "rgba(124, 58, 237, 0.85)" }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

// ----- 3. Clasificación de Impacto (Alto: completadas vs pendientes) -----
function ImpactoAltoChart({ data }: { data: ImpactoAlto }) {
  const pieData = [
    { name: "Completadas", value: data.completadas, key: "completadas" },
    { name: "Pendientes", value: data.pendientes, key: "pendientes" },
  ].filter((d) => d.value > 0);

  const config = {
    completadas: { label: "Completadas", color: "#16a34a" },
    pendientes: { label: "Pendientes", color: "#f59e0b" },
  } satisfies ChartConfig;

  if (data.total === 0) {
    return <Empty />;
  }

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer config={config} className="h-[200px] w-full">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={85}
            paddingAngle={2}
            stroke="none"
          >
            {pieData.map((s, i) => (
              <Cell
                key={s.key}
                fill={s.key === "completadas" ? "rgba(22, 163, 74, 0.35)" : "rgba(245, 158, 11, 0.35)"}
                stroke={s.key === "completadas" ? "rgba(22, 163, 74, 0.6)" : "rgba(245, 158, 11, 0.6)"}
                strokeWidth={1}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-lg bg-emerald-50 p-3 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900">
          <div className="text-2xl font-semibold text-emerald-700 dark:text-emerald-200">{data.completadas}</div>
          <div className="text-[11px] uppercase tracking-wide text-emerald-700/70 dark:text-emerald-200/70">
            Completadas
          </div>
        </div>
        <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900">
          <div className="text-2xl font-semibold text-amber-700 dark:text-amber-200">{data.pendientes}</div>
          <div className="text-[11px] uppercase tracking-wide text-amber-700/70 dark:text-amber-200/70">
            Pendientes
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- 4. Día con Mayor Actividad (Grid Bar Chart) -----
function DiaMaximoGridChart({
  data,
  diaMax,
  entregasMax,
}: {
  data: DailyPoint[];
  diaMax: string;
  entregasMax: number;
}) {
  const totalEntregas = data.reduce((acc, d) => acc + d.entregadas, 0);
  const maxValue = Math.max(...data.map((d) => d.entregadas), 1);
  const GRID_ROWS = 10;

  // Mostrar etiquetas cada N días para no saturar el eje X
  const step = data.length > 20 ? 3 : data.length > 10 ? 2 : 1;

  return (
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-border/60 bg-background p-5">
      {/* Header con Total y Peak */}
      <div className="flex items-start justify-between">
        <div className="flex gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              [Σ] Total entregas
            </span>
            <span className="text-3xl font-semibold tracking-tight text-foreground">
              {totalEntregas.toLocaleString("es-MX")}
            </span>
          </div>
          <div className="h-12 w-px bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              [↑] Peak
            </span>
            <span className="text-3xl font-semibold tracking-tight text-foreground">
              {diaMax}
            </span>
            <span className="text-xs text-muted-foreground">
              {entregasMax} {entregasMax === 1 ? "entrega" : "entregas"}
            </span>
          </div>
        </div>
      </div>

      {/* Grid de bloques */}
      <div className="flex min-h-0 flex-1 items-end gap-[3px]">
        {data.map((d) => {
          const filled = Math.round((d.entregadas / maxValue) * GRID_ROWS);
          return (
            <div
              key={d.dia}
              className="flex flex-1 flex-col-reverse gap-[2px]"
              title={`Día ${d.dia}: ${d.entregadas} entrega(s)`}
            >
              {Array.from({ length: GRID_ROWS }).map((_, i) => (
                <div
                  key={i}
                  className={`aspect-square w-full rounded-[2px] ${
                    i < filled
                      ? "bg-zinc-900 dark:bg-zinc-100"
                      : "bg-zinc-200/70 dark:bg-zinc-800"
                  }`}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Eje X: días */}
      <div className="flex gap-[3px]">
        {data.map((d, idx) => (
          <div
            key={d.dia}
            className="flex-1 text-center text-[9px] text-muted-foreground"
          >
            {(idx % step === 0 || idx === data.length - 1) ? d.dia : ""}
          </div>
        ))}
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
  diaMaxActividad,
  diaMaxEntregas,
  selectedMonth,
}: Props) {
  const monthName = (() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1, 1));
    return d.toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  })();

  return (
    <div className="flex flex-col gap-8 p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Cumplimiento, actividad e impacto de las asignaciones · {monthName}
          </p>
        </div>
      </div>

      {/* Fila 1: Cumplimiento por supervisor + Día con mayor actividad */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-5 lg:col-span-2">
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

        <DiaMaximoGridChart
          data={dailySeries}
          diaMax={diaMaxActividad}
          entregasMax={diaMaxEntregas}
        />
      </div>

      {/* Fila 2: Días de actividad + Clasificación de impacto */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Días de Actividad
            </h2>
            <span className="text-xs text-muted-foreground">Mes en curso</span>
          </div>
          <DailyActivityChart data={dailySeries} />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Clasificación de Impacto
            </h2>
            <span className="text-xs text-muted-foreground">
              Alto · {impactoAlto.avance}%
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
