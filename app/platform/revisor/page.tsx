import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/service";
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
  completed_at: string | null;
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

// Normalizar prioridad para agrupar métricas del dashboard
const getPriorityBucket = (p: string | null) => {
  const pl = (p ?? "").trim().toLowerCase();
  if (!pl) return "medio" as const;
  if (pl.includes("no urg")) return "no_urgente" as const;
  if (pl.includes("urg")) return "urgente" as const;
  if (pl.includes("med")) return "medio" as const;
  return "medio" as const;
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
  // Siempre mostramos el MES ACTUAL (no hay selector de mes)
  // -------------------------------------------------------------------
  const today = new Date();
  const currentYm = ymKey(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const selectedYm = currentYm;
  const [selYear, selMonth] = selectedYm.split("-").map(Number);

  // -------------------------------------------------------------------
  // Carga de asignaciones (todas, sin límite de página)
  // -------------------------------------------------------------------
  const selectFieldsBase =
    "id, created_at, status, title, description, due_at, completed_at, priority, revisor_id, assigned_to_email";
  const selectFieldsMid =
    "id, created_at, status, title, description, due_at, completed_at, priority, revisor_id, assigned_to_email, submission_path, submission_files, submitted_at, submitted_by_email";
  const selectFieldsExtended =
    "id, created_at, status, title, description, due_at, completed_at, priority, revisor_id, assigned_to_email, submission_name, submission_path, submission_files, submitted_at, submitted_by_email";

  // Fallback de esquema igual que en task/page.tsx
  const isSchemaMismatch = (err: unknown) => {
    if (!err) return false;
    const msg = (err as { message?: string }).message ?? "";
    return msg.includes("column") && msg.includes("does not exist");
  };

  let assignmentsData: AssignmentStat[] = [];

  // Usamos el service client para leer TODAS las asignaciones,
  // sin que RLS limite al revisor logueado. El dashboard del revisor
  // debe mostrar datos de TODOS los supervisores y asignaciones.
  const serviceSupabase = createServiceClient();

  const fetchAssignments = async (fields: string): Promise<AssignmentStat[]> => {
    const { data, error } = await serviceSupabase
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

  const allRows: AssignmentStat[] = assignmentsData;

  // -------------------------------------------------------------------
  // Filtrar por mes: cada tarea pertenece al mes en que FUE CREADA
  // (created_at). Usamos una sola fecha definitoria para que cada
  // asignación se cuente exactamente una vez y los totales no se inflen.
  // -------------------------------------------------------------------
  const monthRows = allRows.filter((r) => {
    const created = parseDate(r.created_at);
    return created && ymKey(created) === selectedYm;
  });

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

  // Vencidas: asignaciones del mes con due_at anterior a hoy y no completadas
  const now = new Date();
  const vencidas = monthRows.filter((r) => {
    const s = (r.status ?? "").trim().toLowerCase();
    if (isCompletedStatus(s)) return false;
    const due = parseDate(r.due_at);
    return due ? due < now : false;
  }).length;

  const avance = total > 0 ? Math.round((completadas / total) * 100) : 0;

  // -------------------------------------------------------------------
  // 1. Cumplimiento de Actividades por supervisor (0-100%)
  //    Usa las asignaciones del mes seleccionado
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
  // 2. Días de Actividad (mes SELECCIONADO) - día 1 al último día del mes
  //    Muestra creadas (created_at), entregadas (submitted_at) y completadas (completed_at) por día
  // -------------------------------------------------------------------
  const lastDay = new Date(Date.UTC(selYear, selMonth, 0)).getUTCDate();

  const dailySeries = [];
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(Date.UTC(selYear, selMonth - 1, day));
    const key = ymdKey(d);

    const creadas = monthRows.filter((r) => {
      const c = parseDate(r.created_at);
      return c && ymdKey(c) === key;
    }).length;
    const entregadas = monthRows.filter((r) => {
      const s = parseDate(r.submitted_at);
      return s && ymdKey(s) === key;
    }).length;
    const completadas = monthRows.filter((r) => {
      const c = parseDate(r.completed_at);
      return c && ymdKey(c) === key;
    }).length;

    dailySeries.push({
      dia: String(day),
      creadas,
      entregadas,
      completadas,
      total: creadas + entregadas + completadas,
    });
  }

  // -------------------------------------------------------------------
  // 3. Clasificación de Impacto (tareas creadas por prioridad)
  // -------------------------------------------------------------------
  const impactoUrgente = monthRows.filter((r) => getPriorityBucket(r.priority) === "urgente").length;
  const impactoMedio = monthRows.filter((r) => getPriorityBucket(r.priority) === "medio").length;
  const impactoNoUrgente = monthRows.filter(
    (r) => getPriorityBucket(r.priority) === "no_urgente"
  ).length;
  const impactoTotal = impactoUrgente + impactoMedio + impactoNoUrgente;

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
          total: impactoTotal,
          urgente: impactoUrgente,
          medio: impactoMedio,
          noUrgente: impactoNoUrgente,
        }}
        selectedMonth={selectedYm}
      />
    </PlatformShell>
  );
}
