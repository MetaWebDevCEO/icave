import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { TaskBoard, type TaskRow } from "@/app/platform/task/task-board";
import {
  createClient as createSupabaseAdminClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";

type UserRole = "revisor" | "usuario";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type AssignmentRow = TaskRow & { revisor_id?: string | null };

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

  if (!role) throw new Error("Rol inválido");
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

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^\w.\-()+\s]/g, "").replace(/\s+/g, " ").trim();
}

export default async function TaskPage({
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
  const sections = buildSections(role);
  const sp = await searchParams;
  const statusFilter = getSearchParam(sp, "status") ?? "all";
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");

  const userEmail = normalizeEmail(user.email);

  const selectFields =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email";

  const fetchSupervisor = async (client: SupabaseClient) => {
    return client
      .from("asignaciones")
      .select(selectFields)
      .ilike("assigned_to_email", userEmail)
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);
  };

  const fetchRevisor = async (client: SupabaseClient) => {
    return client
      .from("asignaciones")
      .select(selectFields)
      .eq("revisor_id", user.id)
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);
  };

  let data: AssignmentRow[] | null = null;
  let error: PostgrestError | null = null;

  if (role === "usuario") {
    if (!userEmail) {
      redirect(
        "/platform?error=" + encodeURIComponent("No se encontró el correo del supervisor.")
      );
    }

    const first = await fetchSupervisor(supabase);
    data = (first.data ?? []) as AssignmentRow[];
    error = first.error;

    if (
      (error || data.length === 0) &&
      serviceKey &&
      !serviceKey.includes("__REPLACE_ME__")
    ) {
      const admin = createSupabaseAdminClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const second = await fetchSupervisor(admin);
      data = (second.data ?? []) as AssignmentRow[];
      error = second.error;
    }
  } else {
    const result = await fetchRevisor(supabase);
    data = (result.data ?? []) as AssignmentRow[];
    error = result.error;
  }

  const assignments = (data ?? []).filter((row) => {
    if (statusFilter === "all") return true;
    const status = (row.status ?? "").trim().toLowerCase();
    if (statusFilter === "pending") return status.includes("pend");
    if (statusFilter === "progress") return status.includes("prog") || status.includes("curso");
    if (statusFilter === "completed") return status.includes("comp") || status.includes("done");
    return true;
  });

  async function submitWork(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/");

    const role = await getRoleFromUserRolesTable(supabase, user.id);
    if (role !== "usuario") {
      redirect("/platform/task?error=" + encodeURIComponent("No tienes permisos para entregar."));
    }

    const assignmentId = String(formData.get("assignment_id") ?? "").trim();
    const file = formData.get("file");

    if (!assignmentId) {
      redirect("/platform/task?error=" + encodeURIComponent("Falta assignment_id."));
    }

    if (!(file instanceof File) || file.size <= 0) {
      redirect("/platform/task?error=" + encodeURIComponent("Selecciona un PDF."));
    }

    const name = file.name || "archivo.pdf";
    const lower = name.toLowerCase();
    if (!lower.endsWith(".pdf")) {
      redirect("/platform/task?error=" + encodeURIComponent("Solo se permiten archivos PDF."));
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const header =
      String.fromCharCode(bytes[0] ?? 0) +
      String.fromCharCode(bytes[1] ?? 0) +
      String.fromCharCode(bytes[2] ?? 0) +
      String.fromCharCode(bytes[3] ?? 0);
    if (header !== "%PDF") {
      redirect("/platform/task?error=" + encodeURIComponent("El archivo no parece ser un PDF válido."));
    }

    const userEmail = normalizeEmail(user.email);
    if (!userEmail) {
      redirect("/platform/task?error=" + encodeURIComponent("No se encontró tu correo."));
    }

    const verify = await supabase
      .from("asignaciones")
      .select("id, assigned_to_email")
      .eq("id", assignmentId)
      .maybeSingle();

    if (verify.error) {
      redirect("/platform/task?error=" + encodeURIComponent(verify.error.message));
    }

    const assignedTo = normalizeEmail((verify.data as { assigned_to_email?: string | null } | null)?.assigned_to_email);
    if (!assignedTo || assignedTo !== userEmail) {
      redirect("/platform/task?error=" + encodeURIComponent("Esta tarea no está asignada a tu usuario."));
    }

    const safeName = sanitizeFileName(name) || "archivo.pdf";
    const objectPath = `entregas/${user.id}/${assignmentId}/${Date.now()}-${safeName}`;

    const upload = await supabase.storage
      .from("asignaciones")
      .upload(objectPath, new File([bytes], safeName, { type: "application/pdf" }), {
        contentType: "application/pdf",
        upsert: false,
      });

    if (upload.error) {
      redirect("/platform/task?error=" + encodeURIComponent(upload.error.message));
    }

    const updatePayload: Record<string, unknown> = {
      submission_name: safeName,
      submission_mime: "application/pdf",
      submission_path: objectPath,
      submitted_at: new Date().toISOString(),
      submitted_by_email: userEmail,
    };

    const updated = await supabase.from("asignaciones").update(updatePayload).eq("id", assignmentId);
    if (updated.error) {
      const msg = (updated.error.message ?? "").toLowerCase();
      const code = (updated.error as unknown as { code?: string } | null)?.code ?? "";
      const schemaMismatch =
        msg.includes("schema cache") ||
        msg.includes("could not find") ||
        msg.includes("does not exist") ||
        code === "PGRST204";

      if (!schemaMismatch) {
        redirect("/platform/task?error=" + encodeURIComponent(updated.error.message));
      }
    }

    redirect("/platform/task?message=" + encodeURIComponent("Entrega enviada."));
  }

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
              Task
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Actividades asignadas en una vista de tarjetas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a
              href="/platform/task?status=all"
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
              href="/platform/task?status=pending"
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
              href="/platform/task?status=progress"
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
              href="/platform/task?status=completed"
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

        {(errorParam || messageParam) && (
          <div
            className={[
              "mt-4 rounded-lg border p-4 text-sm",
              errorParam
                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100"
                : "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-100",
            ].join(" ")}
          >
            {errorParam ?? messageParam}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
            {assignments.length} actividades
          </div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {role === "usuario"
              ? "Asignadas a tu correo."
              : "Publicadas por tu cuenta."}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
            {error.message}
          </div>
        )}

        {!error && assignments.length === 0 && (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            No hay actividades para los filtros seleccionados.
          </div>
        )}

        {!error && assignments.length > 0 && (
          <TaskBoard role={role} tasks={assignments} onSubmit={submitWork} />
        )}
      </div>
    </PlatformShell>
  );
}

