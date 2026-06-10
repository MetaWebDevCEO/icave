import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import {
  createClient as createSupabaseAdminClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";

type UserRole = "revisor" | "usuario";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type AssignmentRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  title: string | null;
  description?: string | null;
  due_at?: string | null;
  priority?: string | null;
  assigned_to?: string | null;
  assigned_to_email?: string | null;
  attachment_name?: string | null;
  attachment_path?: string | null;
};

function isUserRole(value: unknown): value is UserRole {
  return value === "revisor" || value === "usuario";
}

function normalizeRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return isUserRole(normalized) ? normalized : null;
}

function normalizeRoleCode(value: unknown): UserRole | null {
  if (typeof value === "number") {
    if (value === 1) return "revisor";
    if (value === 2) return "usuario";
    return null;
  }

  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();

  if (isUserRole(normalized)) return normalized;
  if (normalized === "reviewer" || normalized === "rev" || normalized === "r") {
    return "revisor";
  }
  if (normalized === "admin" || normalized === "administrador") {
    return "usuario";
  }
  if (normalized === "sup" || normalized === "s") {
    return "usuario";
  }
  if (normalized.includes("usuario")) return "usuario";
  if (normalized.includes("super")) return "usuario";
  if (normalized.includes("revi")) return "revisor";

  return null;
}

async function getRoleFromUserRolesTable(
  supabase: SupabaseClient,
  userId: string
): Promise<UserRole> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No existe un registro en user_roles para este usuario");

  const record = data as Record<string, unknown>;
  const role =
    normalizeRole(record.role) ??
    normalizeRole(record.rol) ??
    normalizeRole(record.user_role) ??
    normalizeRole(record.tipo) ??
    normalizeRole(record.type) ??
    normalizeRoleCode(record.role_code);

  if (!role) {
    throw new Error("No se encontró una columna de rol válida en user_roles.");
  }

  return role;
}

function buildSections(role: UserRole): SidebarSection[] {
  const platformTitle =
    role === "usuario" ? "Plataforma (Supervisor)" : "Plataforma (Revisor)";

  return role === "usuario"
    ? [
        {
          title: platformTitle,
          items: [
            { title: "Mi Rendimiento", href: "/platform" },
            { title: "Status", href: "/platform/status" },
            { title: "Bandeja de Entrada", href: "/platform/bandeja" },
            { title: "Task", href: "/platform/task" },
          ],
        },
        {
          title: "Herramientas",
          items: [
            { title: "Chat Directo", href: "/platform/chat" },
            { title: "Correos", href: "/platform/correos" },
            { title: "Documentos", href: "/platform/documentos" },
            { title: "Planificador", href: "/platform/planificador" },
          ],
        },
        {
          title: "Setting",
          items: [
            { title: "Notificaciones", href: "/platform/settings/notificaciones" },
            { title: "Configuracion", href: "/platform/settings/configuracion" },
          ],
        },
      ]
    : [
        {
          title: platformTitle,
          items: [
            { title: "Dashboard", href: "/platform" },
            { title: "Asignacion", href: "/platform/revisor/asignacion" },
            { title: "Supervisores", href: "/platform/supervisores" },
            { title: "Task", href: "/platform/task" },
          ],
        },
        {
          title: "Herramientas",
          items: [
            { title: "Chat Directo", href: "/platform/chat" },
            { title: "Correos", href: "/platform/correos" },
            { title: "Documentos", href: "/platform/documentos" },
            { title: "Planificador", href: "/platform/planificador" },
          ],
        },
        {
          title: "Setting",
          items: [
            { title: "Roles", href: "/platform/settings/roles" },
            { title: "Usuarios", href: "/platform/settings/usuarios" },
            { title: "Notificacion", href: "/platform/settings/notificacion" },
          ],
        },
      ];
}

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function getStatusTone(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();

  if (normalized.includes("comp") || normalized.includes("done")) {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900";
  }

  if (normalized.includes("prog") || normalized.includes("curso")) {
    return "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900";
  }

  return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900";
}

function getPriorityTone(priority: string | null | undefined) {
  const normalized = (priority ?? "").trim().toLowerCase();

  if (normalized.includes("urg") || normalized.includes("alta")) {
    return "text-red-700 dark:text-red-300";
  }

  if (normalized.includes("med")) {
    return "text-amber-700 dark:text-amber-300";
  }

  return "text-emerald-700 dark:text-emerald-300";
}

function getDueTone(value: string | null | undefined, status: string | null | undefined) {
  if (!value) return "text-zinc-500 dark:text-zinc-400";

  const normalizedStatus = (status ?? "").trim().toLowerCase();
  if (normalizedStatus.includes("comp") || normalizedStatus.includes("done")) {
    return "text-zinc-500 dark:text-zinc-400";
  }

  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return "text-zinc-500 dark:text-zinc-400";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  if (due.getTime() < today.getTime()) {
    return "text-red-600 dark:text-red-400";
  }

  return "text-zinc-700 dark:text-zinc-200";
}

function getSummary(rows: AssignmentRow[]) {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;

  rows.forEach((row) => {
    const normalized = (row.status ?? "").trim().toLowerCase();
    if (normalized.includes("comp") || normalized.includes("done")) {
      completed += 1;
      return;
    }
    if (normalized.includes("prog") || normalized.includes("curso")) {
      inProgress += 1;
      return;
    }
    pending += 1;
  });

  return { pending, inProgress, completed };
}

export default async function BandejaSupervisorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const role = await getRoleFromUserRolesTable(supabase, user.id);
  if (role !== "usuario") redirect("/platform");

  const sections = buildSections(role);
  const sp = await searchParams;
  const statusFilter = getSearchParam(sp, "status") ?? "all";
  const priorityFilter = getSearchParam(sp, "priority") ?? "all";

  const userEmail = normalizeEmail(user.email);
  if (!userEmail) {
    redirect(
      "/platform?error=" + encodeURIComponent("No se encontró el correo del supervisor.")
    );
  }

  const selectFields =
    "id, created_at, status, title, description, due_at, priority, assigned_to_email, attachment_name, attachment_path";

  const fetchAssignments = async (client: SupabaseClient) => {
    return client
      .from("asignaciones")
      .select(selectFields)
      .ilike("assigned_to_email", userEmail)
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);
  };

  let data: AssignmentRow[] | null = null;
  let error: PostgrestError | null = null;

  const firstResult = await fetchAssignments(supabase);
  data = (firstResult.data ?? []) as AssignmentRow[];
  error = firstResult.error;

  if (
    (error || data.length === 0) &&
    serviceKey &&
    !serviceKey.includes("__REPLACE_ME__")
  ) {
    const admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const fallbackResult = await fetchAssignments(admin);
    data = (fallbackResult.data ?? []) as AssignmentRow[];
    error = fallbackResult.error;
  }

  const assignments = ((data ?? []) as AssignmentRow[]).filter((row) => {
    const status = (row.status ?? "").trim().toLowerCase();
    const priority = (row.priority ?? "").trim().toLowerCase();

    const statusOk =
      statusFilter === "all"
        ? true
        : statusFilter === "pending"
          ? status.includes("pend")
          : statusFilter === "progress"
            ? status.includes("prog") || status.includes("curso")
            : statusFilter === "completed"
              ? status.includes("comp") || status.includes("done")
              : true;

    const priorityOk =
      priorityFilter === "all"
        ? true
        : priorityFilter === "urgent"
          ? priority.includes("urg") || priority.includes("alta")
          : priorityFilter === "medium"
            ? priority.includes("med")
            : priorityFilter === "low"
              ? priority.includes("no") || priority.includes("baja")
              : true;

    return statusOk && priorityOk;
  });

  const summary = getSummary(assignments);

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Bandeja de entrada
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Consulta tus tareas asignadas con una vista clara, ordenada y profesional.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a
              href="/platform/bandeja?status=all"
              className={[
                "rounded-full px-3 py-1.5",
                statusFilter === "all"
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              Todas
            </a>
            <a
              href="/platform/bandeja?status=pending"
              className={[
                "rounded-full px-3 py-1.5",
                statusFilter === "pending"
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              Pendientes
            </a>
            <a
              href="/platform/bandeja?status=progress"
              className={[
                "rounded-full px-3 py-1.5",
                statusFilter === "progress"
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              En curso
            </a>
            <a
              href="/platform/bandeja?status=completed"
              className={[
                "rounded-full px-3 py-1.5",
                statusFilter === "completed"
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              Completadas
            </a>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">Pendientes</div>
            <div className="mt-2 text-2xl font-semibold">{summary.pending}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">En curso</div>
            <div className="mt-2 text-2xl font-semibold">{summary.inProgress}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">Completadas</div>
            <div className="mt-2 text-2xl font-semibold">{summary.completed}</div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                Tareas asignadas
              </div>
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {assignments.length} resultados para {user.email ?? "tu cuenta"}.
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              <a
                href={`/platform/bandeja?status=${statusFilter}&priority=all`}
                className={[
                  "rounded-full px-3 py-1.5",
                  priorityFilter === "all"
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                Todas las prioridades
              </a>
              <a
                href={`/platform/bandeja?status=${statusFilter}&priority=urgent`}
                className={[
                  "rounded-full px-3 py-1.5",
                  priorityFilter === "urgent"
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                Alta
              </a>
              <a
                href={`/platform/bandeja?status=${statusFilter}&priority=medium`}
                className={[
                  "rounded-full px-3 py-1.5",
                  priorityFilter === "medium"
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                Media
              </a>
              <a
                href={`/platform/bandeja?status=${statusFilter}&priority=low`}
                className={[
                  "rounded-full px-3 py-1.5",
                  priorityFilter === "low"
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                Baja
              </a>
            </div>
          </div>

          {error && (
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
              {error.message}
            </div>
          )}

          {!error && assignments.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">
              No hay tareas asignadas para los filtros seleccionados.
            </div>
          )}

          {!error && assignments.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/40 dark:text-zinc-400">
                  <tr>
                    <th className="w-12 px-5 py-3" />
                    <th className="px-5 py-3">Nombre</th>
                    <th className="px-5 py-3">Estado</th>
                    <th className="px-5 py-3">Prioridad</th>
                    <th className="px-5 py-3">Fecha límite</th>
                    <th className="px-5 py-3">Adjunto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {assignments.map((assignment) => (
                    <tr
                      key={assignment.id}
                      className="bg-white transition-colors hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900/60"
                    >
                      <td className="px-5 py-4 align-top">
                        <span className="inline-flex h-4 w-4 rounded-full border border-zinc-300 dark:border-zinc-700" />
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-950 dark:text-zinc-50">
                            {assignment.title ?? "Sin título"}
                          </div>
                          {assignment.description && (
                            <div className="mt-1 line-clamp-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
                              {assignment.description}
                            </div>
                          )}
                          {assignment.created_at && (
                            <div className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                              Creada: {formatShortDate(assignment.created_at)}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={[
                            "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                            getStatusTone(assignment.status),
                          ].join(" ")}
                        >
                          {assignment.status ?? "Pendiente"}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span className={["font-medium", getPriorityTone(assignment.priority)].join(" ")}>
                          {assignment.priority ?? "Media"}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span className={getDueTone(assignment.due_at, assignment.status)}>
                          {formatShortDate(assignment.due_at)}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top">
                        {assignment.attachment_path ? (
                          <span className="inline-flex rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
                            {assignment.attachment_name ?? "PDF adjunto"}
                          </span>
                        ) : (
                          <span className="text-zinc-400 dark:text-zinc-500">Sin archivo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PlatformShell>
  );
}
