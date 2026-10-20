import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { getRoleFromUserRolesTable, buildSections } from "@/lib/platform-roles";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SupervisorDashboard } from "@/app/platform/supervisor/dashboard";

type AssignmentRow = {
  id: string;
  status: string | null;
  created_at: string | null;
  due_at: string | null;
  submitted_at: string | null;
  priority: string | null;
};

const isCompleted = (s: string) => /comp|done|termin|final|cerrad/.test(s);
const isProgress = (s: string) => /prog|curso|inici|ejecu|desarr|entreg/.test(s);
const isDelivered = (s: string) => /entreg/.test(s);
const isPending = (s: string) => /pend|asign|abiert|nueva/.test(s) || s === "";

const parseDate = (v: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const ymdKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

const ymKey = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

const isHighPriority = (p: string | null) => {
  const pl = (p ?? "").trim().toLowerCase();
  if (!pl) return false;
  if (pl === "urgente") return true;
  if (pl.includes("no urg")) return false;
  if (pl.includes("urg")) return true;
  return false;
};

const getPriorityLabel = (p: string | null) => {
  const pl = (p ?? "").trim().toLowerCase();
  if (!pl) return "Sin prioridad";
  if (pl === "urgente") return "Urgente";
  if (pl.includes("no urg")) return "No urgente";
  if (pl.includes("urg")) return "Urgente";
  return pl.charAt(0).toUpperCase() + pl.slice(1);
};

export default async function SupervisorDashboardPage() {
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

  let role: "revisor" | "usuario";
  try {
    role = await getRoleFromUserRolesTable(supabase, user.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    redirect("/?error=" + encodeURIComponent("Rol: " + message));
  }

  if (role !== "usuario") {
    redirect("/platform");
  }

  const sections = buildSections(role);
  const userEmail = (user.email ?? "").trim().toLowerCase();

  // -------------------------------------------------------------------
  // Siempre mostramos el MES ACTUAL (no hay selector de mes)
  // -------------------------------------------------------------------
  const now = new Date();
  const currentYm = ymKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const selectedYm = currentYm;
  const [selYear, selMonth] = selectedYm.split("-").map(Number);

  // Rango del mes seleccionado: día 1 00:00 UTC al último día 23:59:59 UTC
  const monthStart = new Date(Date.UTC(selYear, selMonth - 1, 1, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(selYear, selMonth, 0, 23, 59, 59));
  const lastDay = monthEnd.getUTCDate();

  // Cargar asignaciones del supervisor
  const { data: assignments, error } = await supabase
    .from("asignaciones")
    .select("id, created_at, status, due_at, submitted_at, priority")
    .ilike("assigned_to_email", userEmail);

  const allRows: AssignmentRow[] = error ? [] : (assignments as AssignmentRow[]) ?? [];

  // Cada tarea pertenece al mes en que FUE CREADA (created_at).
  // Usamos una sola fecha definitoria para que cada asignación se
  // cuente exactamente una vez y los totales no se inflen.
  const rows = allRows.filter((r) => {
    const created = parseDate(r.created_at);
    return created && ymKey(created) === selectedYm;
  });

  // -------------------------------------------------------------------
  // KPIs del mes
  // -------------------------------------------------------------------
  const total = rows.length;
  const completadas = rows.filter((r) => isCompleted((r.status ?? "").toLowerCase())).length;
  const entregadas = rows.filter((r) => isDelivered((r.status ?? "").toLowerCase())).length;
  const pendientes = rows.filter((r) => isPending((r.status ?? "").toLowerCase())).length;
  const vencidas = rows.filter((r) => {
    const due = parseDate(r.due_at);
    if (!due) return false;
    const status = (r.status ?? "").toLowerCase();
    return due < now && !isCompleted(status) && !isProgress(status);
  }).length;
  const avance = total > 0 ? Math.round((completadas / total) * 100) : 0;
  const urgentesPendientes = rows.filter((r) => {
    const status = (r.status ?? "").toLowerCase();
    return isHighPriority(r.priority) && !isCompleted(status);
  }).length;

  // -------------------------------------------------------------------
  // Widget de advertencia: días restantes del mes y actividades sin entregar
  // -------------------------------------------------------------------
  const diasRestantes = Math.max(0, lastDay - now.getUTCDate());
  const tareasFaltantes = rows.filter((r) => {
    const status = (r.status ?? "").trim().toLowerCase();
    const entregada = status.includes("entreg");
    return !isCompleted(status) && !entregada;
  }).length;

  // Pop de bienvenida (solo cuando viene del login y hay pendientes)
  const jar = await cookies();
  const fromLogin = jar.get("icave_supervisor_login")?.value === "1";
  const loginAlert = fromLogin && tareasFaltantes > 0;

  // -------------------------------------------------------------------
  // Distribución por prioridad (del mes)
  // -------------------------------------------------------------------
  const priorityMap = new Map<string, number>();
  for (const r of rows) {
    const label = getPriorityLabel(r.priority);
    priorityMap.set(label, (priorityMap.get(label) ?? 0) + 1);
  }
  const priorityData = Array.from(priorityMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // -------------------------------------------------------------------
  // Serie diaria del mes (día 1 al último día del mes)
  // Muestra creadas (created_at) y entregadas (submitted_at) por día
  // -------------------------------------------------------------------
  const days: { dia: string; creadas: number; entregadas: number }[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(Date.UTC(selYear, selMonth - 1, day));
    const key = ymdKey(d);
    days.push({
      dia: String(day),
      creadas: rows.filter((r) => {
        const c = parseDate(r.created_at);
        return c && ymdKey(c) === key;
      }).length,
      entregadas: rows.filter((r) => {
        const s = parseDate(r.submitted_at);
        return s && ymdKey(s) === key;
      }).length,
    });
  }

  // -------------------------------------------------------------------
  // Resumen mensual (últimos 6 meses para contexto/tendencia)
  // -------------------------------------------------------------------
  const months: { mes: string; total: number; completadas: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = ymKey(d);
    const monthRows = allRows.filter((r) => {
      const created = parseDate(r.created_at);
      return created && ymKey(created) === key;
    });
    months.push({
      mes: d.toLocaleDateString("es-MX", { month: "short", timeZone: "UTC" }),
      total: monthRows.length,
      completadas: monthRows.filter((r) => isCompleted((r.status ?? "").toLowerCase())).length,
    });
  }

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <SupervisorDashboard
        kpis={{ total, completadas, entregadas, pendientes, vencidas, avance, urgentesPendientes }}
        priorityData={priorityData}
        dailySeries={days}
        monthlySeries={months}
        selectedMonth={selectedYm}
        diasRestantes={diasRestantes}
        tareasFaltantes={tareasFaltantes}
        loginAlert={loginAlert}
      />
    </PlatformShell>
  );
}
