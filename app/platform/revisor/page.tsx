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
const isCompletedStatus = (s: string) =>
  /comp|done|termin|final|cerrad|entreg/.test(s);
const isProgressStatus = (s: string) =>
  /prog|curso|inici|ejecu|desarr/.test(s);
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

// Label corto "Sep 26"
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
};

export default async function RevisorDashboardPage() {
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
  // Carga de asignaciones (todas, para panorama completo)
  // -------------------------------------------------------------------
  const { data: assignments } = await supabase
    .from("asignaciones")
    .select(
      "id, status, created_at, due_at, submitted_at, priority, assigned_to_email"
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows: AssignmentStat[] = (assignments ?? []) as AssignmentStat[];

  // -------------------------------------------------------------------
  // KPIs
  // -------------------------------------------------------------------
  const total = rows.length;
  const completadas = rows.filter((r) =>
    isCompletedStatus((r.status ?? "").trim().toLowerCase())
  ).length;
  const enCurso = rows.filter((r) => {
    const s = (r.status ?? "").trim().toLowerCase();
    return isProgressStatus(s) && !isCompletedStatus(s);
  }).length;
  const pendientes = rows.filter((r) => {
    const s = (r.status ?? "").trim().toLowerCase();
    return isPendingStatus(s) && !isCompletedStatus(s);
  }).length;

  const now = Date.now();
  const vencidas = rows.filter((r) => {
    const s = (r.status ?? "").trim().toLowerCase();
    if (isCompletedStatus(s)) return false;
    const due = parseDate(r.due_at);
    return due ? due.getTime() < now : false;
  }).length;

  const avance = total > 0 ? Math.round((completadas / total) * 100) : 0;

  // -------------------------------------------------------------------
  // Serie mensual (últimos 6 meses incluyendo el actual)
  // -------------------------------------------------------------------
  const today = new Date();
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    months.push(ymKey(d));
  }

  const inMonth = (iso: string | null, monthStart: number, monthEnd: number) => {
    const d = parseDate(iso);
    return d ? d.getTime() >= monthStart && d.getTime() < monthEnd : false;
  };

  const monthlySeries = months.map((ym) => {
    const [y, m] = ym.split("-").map(Number);
    const monthStart = Date.UTC(y, m - 1, 1);
    const monthEnd = Date.UTC(y, m, 1); // primer día del siguiente mes (exclusivo)

    const creadas = rows.filter((r) => inMonth(r.created_at, monthStart, monthEnd)).length;
    const entregadas = rows.filter((r) =>
      inMonth(r.submitted_at, monthStart, monthEnd)
    ).length;

    return { mes: monthLabel(ym), creadas, entregadas };
  });

  // Serie mensual de ESTADOS para el Area Chart apilado.
  // Para cada mes contamos cuántas tareas CREADAS en ese mes tienen cada status.
  const statusSeries = months.map((ym) => {
    const [y, m] = ym.split("-").map(Number);
    const monthStart = Date.UTC(y, m - 1, 1);
    const monthEnd = Date.UTC(y, m, 1);

    let pendientes = 0;
    let encurso = 0;
    let completadas = 0;

    rows.forEach((r) => {
      if (!inMonth(r.created_at, monthStart, monthEnd)) return;
      const s = (r.status ?? "").trim().toLowerCase();
      if (isCompletedStatus(s)) completadas++;
      else if (isProgressStatus(s)) encurso++;
      else pendientes++;
    });

    return { mes: monthLabel(ym), pendientes, encurso, completadas };
  });

  // -------------------------------------------------------------------
  // Distribución por prioridad
  // -------------------------------------------------------------------
  let urgente = 0;
  let medio = 0;
  let noUrgente = 0;
  let sinPrioridad = 0;
  rows.forEach((r) => {
    const p = (r.priority ?? "").trim();
    const pl = p.toLowerCase();
    if (!p) sinPrioridad++;
    else if (pl === "urgente") urgente++;
    else if (pl === "medio") medio++;
    else if (pl === "no urgente") noUrgente++;
    else if (pl.includes("urg") && !pl.includes("no")) urgente++;
    else if (pl.includes("no urg")) noUrgente++;
    else if (pl.includes("med")) medio++;
    else sinPrioridad++;
  });

  const priorityData = [
    { name: "Urgente", value: urgente, key: "urgente" },
    { name: "Medio", value: medio, key: "medio" },
    { name: "No Urgente", value: noUrgente, key: "nourgente" },
    { name: "Sin prioridad", value: sinPrioridad, key: "sinprioridad" },
  ].filter((x) => x.value > 0);

  // -------------------------------------------------------------------
  // Top supervisores por tareas completadas
  // -------------------------------------------------------------------
  const supervisorCounts = new Map<string, { total: number; completadas: number }>();
  rows.forEach((r) => {
    const email = (r.assigned_to_email ?? "").trim().toLowerCase();
    if (!email) return;
    const existing = supervisorCounts.get(email) ?? { total: 0, completadas: 0 };
    existing.total++;
    const s = (r.status ?? "").trim().toLowerCase();
    if (isCompletedStatus(s)) existing.completadas++;
    supervisorCounts.set(email, existing);
  });

  const topSupervisores = Array.from(supervisorCounts.entries())
    .map(([email, c]) => ({
      email,
      total: c.total,
      completadas: c.completadas,
      avance: c.total > 0 ? Math.round((c.completadas / c.total) * 100) : 0,
    }))
    .sort((a, b) => b.completadas - a.completadas)
    .slice(0, 10)
    .map((s) => ({
      ...s,
      label: s.email.split("@")[0].slice(0, 18),
    }));

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <RevisorDashboard
        kpis={{ total, completadas, enCurso, pendientes, vencidas, avance }}
        monthlySeries={monthlySeries}
        statusSeries={statusSeries}
        priorityData={priorityData}
        topSupervisores={topSupervisores}
      />
    </PlatformShell>
  );
}
