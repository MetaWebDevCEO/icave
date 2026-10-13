import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  getRoleFromUserRolesTable,
  buildSections,
  type UserRole,
} from "@/lib/platform-roles";
import { RevisorDashboard } from "@/app/platform/revisor/dashboard";

// Tipo mínimo de asignación para el dashboard
type AssignmentStat = {
  id: string;
  status: string | null;
  created_at: string | null;
  due_at: string | null;
  submitted_at: string | null;
  priority: string | null;
  assigned_to_email: string | null;
};

// Matchers de status (alineados con task/page.tsx)
// "Entregada" cuenta como en_curso (entregado, pendiente de revisión), NO como completada
const isCompletedStatus = (s: string) =>
  /comp|done|termin|final|cerrad/.test(s);
const isProgressStatus = (s: string) =>
  /prog|curso|inici|ejecu|desarr|entreg/.test(s);
const isPendingStatus = (s: string) =>
  /pend|asign|abiert|nueva/.test(s) || s === "";

// Parsear fecha a Date (UTC) de forma robusta
const parseDate = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Obtener clave "YYYY-MM" en UTC
const ymKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

// Obtener clave "YYYY-MM-DD" en UTC
const ymdKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

// Label corto "Sep 26"
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
};

// Label de día "12"
const dayLabel = (ymd: string) => {
  const parts = ymd.split("-").map(Number);
  return String(parts[2]);
};

// Detectar si es prioridad urgente (impacto alto)
const isHighImpact = (p: string | null) => {
  const pl = (p ?? "").trim().toLowerCase();
  if (!pl) return false;
  if (pl === "urgente") return true;
  if (pl.includes("no urg")) return false;
  if (pl.includes("urg")) return true;
  return false;
};

export default async function RevisorDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  let role: UserRole;
  try {
    role = await getRoleFromUserRolesTable(supabase, user.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    redirect("/?error=" + encodeURIComponent("Rol: " + message));
  }

  if (role !== "revisor") {
    redirect("/platform");
  }

  const sections = buildSections(role);

  // -------------------------------------------------------------------
  // Determinar mes seleccionado (default: mes actual)
  // -------------------------------------------------------------------
  const sp = await searchParams;
  const today = new Date();
  const currentYm = ymKey(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const selectedYm = sp?.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : currentYm;
  const [selYear, selMonth] = selectedYm.split("-").map(Number);

  // Generar lista de meses para el selector (Enero 2026 a Diciembre 2026)
  const monthOptions: { value: string; label: string }[] = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `2026-${String(m).padStart(2, "0")}`;
    monthOptions.push({ value: ym, label: monthLabel(ym) });
  }

  // -------------------------------------------------------------------
  // INTENTO 1: Leer desde la tabla agregada monthly_dashboard_stats
  // (se actualiza automáticamente vía trigger sobre asignaciones).
  // Si la tabla no existe o no hay fila para el mes, cae al cálculo en JS.
  // -------------------------------------------------------------------
  type MonthlyStatRow = {
    month_key: string;
    total: number;
    completadas: number;
    en_curso: number;
    pendientes: number;
    vencidas: number;
    avance: number;
    supervisor_compliance: unknown;
    daily_series: unknown;
    alto_impacto_total: number;
    alto_impacto_completadas: number;
    alto_impacto_pendientes: number;
    alto_impacto_avance: number;
    dia_max_actividad: string | null;
    dia_max_entregas: number;
  };

  const { data: statRow, error: statErr } = await supabase
    .from("monthly_dashboard_stats")
    .select("*")
    .eq("month_key", selectedYm)
    .maybeSingle();

  if (!statErr && statRow) {
    const r = statRow as MonthlyStatRow;
    const supArr = Array.isArray(r.supervisor_compliance) ? r.supervisor_compliance : [];
    const dailyArr = Array.isArray(r.daily_series) ? r.daily_series : [];
    return (
      <PlatformShell
        sections={sections}
        currentUserId={user.id}
        currentUserEmail={user.email ?? undefined}
      >
        <RevisorDashboard
          kpis={{
            total: r.total,
            completadas: r.completadas,
            enCurso: r.en_curso,
            pendientes: r.pendientes,
            vencidas: r.vencidas,
            avance: r.avance,
          }}
          cumplimientoSupervisores={supArr as any}
          dailySeries={dailyArr as any}
          impactoAlto={{
            total: r.alto_impacto_total,
            completadas: r.alto_impacto_completadas,
            pendientes: r.alto_impacto_pendientes,
            avance: r.alto_impacto_avance,
          }}
          diaMaxActividad={r.dia_max_actividad || "—"}
          diaMaxEntregas={r.dia_max_entregas}
          monthOptions={monthOptions}
          selectedMonth={selectedYm}
        />
      </PlatformShell>
    );
  }

  // -------------------------------------------------------------------
  // Carga de asignaciones (misma consulta que /platform/task para el revisor)
  // -------------------------------------------------------------------
  const selectFieldsBase =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email";
  const selectFieldsMid =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email, submission_path, submission_files, submitted_at, submitted_by_email";
  const selectFieldsExtended =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email, submission_name, submission_path, submission_files, submitted_at, submitted_by_email";

  // Fallback de esquema igual que en task/page.tsx
  const isSchemaMismatch = (err: unknown) => {
    if (!err) return false;
    const msg = (err as { message?: string }).message ?? "";
    return msg.includes("column") && msg.includes("does not exist");
  };

  let assignmentsData: AssignmentStat[] = [];

  const fetchAssignments = async (fields: string): Promise<AssignmentStat[]> => {
    const { data, error } = await supabase
      .from("asignaciones")
      .select(fields)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) {
      if (isSchemaMismatch(error)) throw new Error("schema_mismatch");
      return [];
    }
    return (data as unknown) as AssignmentStat[];
  };

  try {
    assignmentsData = await fetchAssignments(selectFieldsExtended);
  } catch {
    try {
      assignmentsData = await fetchAssignments(selectFieldsMid);
    } catch {
      assignmentsData = await fetchAssignments(selectFieldsBase);
    }
  }

  const rows: AssignmentStat[] = assignmentsData;

  // -------------------------------------------------------------------
  // Filtrar por mes seleccionado (igual que supervisores: cualquier fecha
  // [created_at, due_at, submitted_at] que caiga en el mes cuenta)
  // -------------------------------------------------------------------
  const monthStart = Date.UTC(selYear, selMonth - 1, 1);
  const monthEnd = Date.UTC(selYear, selMonth, 1); // primer día del sig. mes (exclusivo)

  const fallsInMonth = (r: AssignmentStat): boolean => {
    const dates = [parseDate(r.created_at), parseDate(r.due_at), parseDate(r.submitted_at)];
    return dates.some((d) => {
      if (!d) return false;
      const t = d.getTime();
      return t >= monthStart && t < monthEnd;
    });
  };

  const monthRows = rows.filter(fallsInMonth);

  // -------------------------------------------------------------------
  // KPIs
  // -------------------------------------------------------------------
  const total = monthRows.length;
  const completadas = monthRows.filter((r) =>
    isCompletedStatus((r.status ?? "").trim().toLowerCase())
  ).length;
  const enCurso = monthRows.filter((r) => {
    const s = (r.status ?? "").trim().toLowerCase();
    return isProgressStatus(s) && !isCompletedStatus(s);
  }).length;
  const pendientes = monthRows.filter((r) => {
    const s = (r.status ?? "").trim().toLowerCase();
    return isPendingStatus(s) && !isCompletedStatus(s);
  }).length;

  // Vencidas: asignaciones del mes con due_at anterior al fin del mes y no completadas
  const vencidas = monthRows.filter((r) => {
    const s = (r.status ?? "").trim().toLowerCase();
    if (isCompletedStatus(s)) return false;
    const due = parseDate(r.due_at);
    return due ? due.getTime() < monthEnd : false;
  }).length;

  const avance = total > 0 ? Math.round((completadas / total) * 100) : 0;

  // -------------------------------------------------------------------
  // 1. Cumplimiento de Actividades por supervisor (0-100%)
  //    Usa las asignaciones CREADAS en el mes seleccionado (1 al último día)
  // -------------------------------------------------------------------
  const supervisorCounts = new Map<string, { total: number; completadas: number }>();
  monthRows.forEach((r) => {
    const email = (r.assigned_to_email ?? "").trim().toLowerCase();
    if (!email) return;
    const existing = supervisorCounts.get(email) ?? { total: 0, completadas: 0 };
    existing.total++;
    const s = (r.status ?? "").trim().toLowerCase();
    if (isCompletedStatus(s)) existing.completadas++;
    supervisorCounts.set(email, existing);
  });

  const cumplimientoSupervisores = Array.from(supervisorCounts.entries())
    .map(([email, c]) => ({
      email,
      total: c.total,
      completadas: c.completadas,
      avance: c.total > 0 ? Math.round((c.completadas / c.total) * 100) : 0,
      label: email.split("@")[0].slice(0, 22),
    }))
    .sort((a, b) => b.avance - a.avance || b.total - a.total);

  // -------------------------------------------------------------------
  // 2. Días de Actividad (mes SELECCIONADO) - creadas vs entregadas por día
  // -------------------------------------------------------------------
  const yearNow = selYear;
  const monthNow = selMonth - 1; // meses en JS son 0-indexed
  const daysInMonth = new Date(Date.UTC(yearNow, monthNow + 1, 0)).getUTCDate();

  const inDay = (iso: string | null, dayStart: number, dayEnd: number) => {
    const d = parseDate(iso);
    return d ? d.getTime() >= dayStart && d.getTime() < dayEnd : false;
  };

  const dailySeries = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dayStart = Date.UTC(yearNow, monthNow, day);
    const dayEnd = Date.UTC(yearNow, monthNow, day + 1);

    const creadas = rows.filter((r) => inDay(r.created_at, dayStart, dayEnd)).length;
    const entregadas = rows.filter((r) => inDay(r.submitted_at, dayStart, dayEnd)).length;

    dailySeries.push({
      dia: String(day),
      creadas,
      entregadas,
      total: creadas + entregadas,
    });
  }

  // -------------------------------------------------------------------
  // 3. Clasificación de Impacto (tareas urgentes: completadas vs pendientes)
  // -------------------------------------------------------------------
  const altoImpacto = monthRows.filter((r) => isHighImpact(r.priority));
  const altoImpactoTotal = altoImpacto.length;
  const altoImpactoCompletadas = altoImpacto.filter((r) =>
    isCompletedStatus((r.status ?? "").trim().toLowerCase())
  ).length;
  const altoImpactoPendientes = altoImpactoTotal - altoImpactoCompletadas;
  const altoImpactoAvance =
    altoImpactoTotal > 0 ? Math.round((altoImpactoCompletadas / altoImpactoTotal) * 100) : 0;

  // -------------------------------------------------------------------
  // 4. Día con Mayor Actividad (día del mes con más entregas/subidas)
  // -------------------------------------------------------------------
  let diaMaxActividad = "";
  let maxEntregas = 0;
  dailySeries.forEach((d) => {
    if (d.entregadas > maxEntregas) {
      maxEntregas = d.entregadas;
      diaMaxActividad = d.dia;
    }
  });

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <RevisorDashboard
        kpis={{ total, completadas, enCurso, pendientes, vencidas, avance }}
        cumplimientoSupervisores={cumplimientoSupervisores}
        dailySeries={dailySeries}
        impactoAlto={{
          total: altoImpactoTotal,
          completadas: altoImpactoCompletadas,
          pendientes: altoImpactoPendientes,
          avance: altoImpactoAvance,
        }}
        diaMaxActividad={diaMaxActividad || "—"}
        diaMaxEntregas={maxEntregas}
        monthOptions={monthOptions}
        selectedMonth={selectedYm}
      />
    </PlatformShell>
  );
}
