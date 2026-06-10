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

  const selectFieldsBase =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email";
  const selectFieldsExtended =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email, submission_name, submission_path, submitted_at, submitted_by_email";

  const isSchemaMismatch = (err: PostgrestError | null) => {
    if (!err) return false;
    const code = (err as unknown as { code?: string } | null)?.code ?? "";
    const msg = (err.message ?? "").toLowerCase();
    return (
      code === "PGRST204" ||
      msg.includes("schema cache") ||
      msg.includes("could not find") ||
      msg.includes("does not exist") ||
      msg.includes("column")
    );
  };

  const fetchSupervisor = async (client: SupabaseClient) => {
    const extended = await client
      .from("asignaciones")
      .select(selectFieldsExtended)
      .ilike("assigned_to_email", userEmail)
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);

    if (isSchemaMismatch(extended.error)) {
      return client
        .from("asignaciones")
        .select(selectFieldsBase)
        .ilike("assigned_to_email", userEmail)
        .order("due_at", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(200);
    }

    return extended;
  };

  const fetchRevisor = async (client: SupabaseClient) => {
    const extended = await client
      .from("asignaciones")
      .select(selectFieldsExtended)
      .eq("revisor_id", user.id)
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);

    if (isSchemaMismatch(extended.error)) {
      return client
        .from("asignaciones")
        .select(selectFieldsBase)
        .eq("revisor_id", user.id)
        .order("due_at", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(200);
    }

    return extended;
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

    const admin =
      serviceKey && !serviceKey.includes("__REPLACE_ME__")
        ? createSupabaseAdminClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;

    const verifyA = await supabase
      .from("asignaciones")
      .select("id, assigned_to_email, submission_path")
      .eq("id", assignmentId)
      .maybeSingle();

    let verifyRow = verifyA.data as { assigned_to_email?: string | null; submission_path?: string | null } | null;
    let verifyError = verifyA.error;

    if ((!verifyRow || verifyError) && admin) {
      const verifyB = await admin
        .from("asignaciones")
        .select("id, assigned_to_email, submission_path")
        .eq("id", assignmentId)
        .maybeSingle();
      verifyRow = verifyB.data as { assigned_to_email?: string | null; submission_path?: string | null } | null;
      verifyError = verifyB.error;
    }

    if (verifyError) {
      redirect("/platform/task?error=" + encodeURIComponent(verifyError.message));
    }

    const assignedTo = normalizeEmail(verifyRow?.assigned_to_email);
    if (!assignedTo || assignedTo !== userEmail) {
      redirect("/platform/task?error=" + encodeURIComponent("Esta tarea no está asignada a tu usuario."));
    }

    const safeName = sanitizeFileName(name) || "archivo.pdf";
    const previousPath = (verifyRow?.submission_path ?? "").trim() || null;
    const objectPath = `entregas/${user.id}/${assignmentId}/${Date.now()}-${safeName}`;

    const fileToUpload = new File([bytes], safeName, { type: "application/pdf" });

    if (previousPath) {
      const removeA = await supabase.storage.from("asignaciones").remove([previousPath]);
      if (removeA.error && admin) {
        await admin.storage.from("asignaciones").remove([previousPath]);
      }
    }

    const uploadA = await supabase.storage.from("asignaciones").upload(objectPath, fileToUpload, {
      contentType: "application/pdf",
      upsert: false,
    });

    if (uploadA.error && admin) {
      const uploadB = await admin.storage.from("asignaciones").upload(objectPath, fileToUpload, {
        contentType: "application/pdf",
        upsert: false,
      });

      if (uploadB.error) {
        redirect("/platform/task?error=" + encodeURIComponent(uploadB.error.message));
      }
    } else if (uploadA.error) {
      redirect("/platform/task?error=" + encodeURIComponent(uploadA.error.message));
    }

    const fullPayload: Record<string, unknown> = {
      status: "Completada",
      submission_name: safeName,
      submission_mime: "application/pdf",
      submission_path: objectPath,
      submitted_at: new Date().toISOString(),
      submitted_by_email: userEmail,
    };

    const updatedA = await supabase.from("asignaciones").update(fullPayload).eq("id", assignmentId);
    let updateError = updatedA.error;

    if (updateError && admin) {
      const updatedB = await admin.from("asignaciones").update(fullPayload).eq("id", assignmentId);
      updateError = updatedB.error;
    }

    if (updateError) {
      const msg = (updateError.message ?? "").toLowerCase();
      const code = (updateError as unknown as { code?: string } | null)?.code ?? "";
      const schemaMismatch =
        msg.includes("schema cache") ||
        msg.includes("could not find") ||
        msg.includes("does not exist") ||
        code === "PGRST204";

      if (schemaMismatch) {
        const statusA = await supabase
          .from("asignaciones")
          .update({ status: "Completada" })
          .eq("id", assignmentId);

        let statusError = statusA.error;
        if (statusError && admin) {
          const statusB = await admin
            .from("asignaciones")
            .update({ status: "Completada" })
            .eq("id", assignmentId);
          statusError = statusB.error;
        }

        if (statusError) {
          redirect("/platform/task?error=" + encodeURIComponent(statusError.message));
        }
      } else {
        redirect("/platform/task?error=" + encodeURIComponent(updateError.message));
      }
    }

    redirect("/platform/task?message=" + encodeURIComponent("Entrega enviada."));
  }

  async function downloadSubmission(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
    }

    const assignmentId = String(formData.get("assignment_id") ?? "").trim();
    if (!assignmentId) {
      redirect("/platform/task?error=" + encodeURIComponent("Falta assignment_id."));
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/");

    const role = await getRoleFromUserRolesTable(supabase, user.id);

    const admin =
      serviceKey && !serviceKey.includes("__REPLACE_ME__")
        ? createSupabaseAdminClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;

    const select = "id, revisor_id, assigned_to_email, submission_path";
    const rowA = await supabase
      .from("asignaciones")
      .select(select)
      .eq("id", assignmentId)
      .maybeSingle();

    let row = rowA.data as
      | { revisor_id?: string | null; assigned_to_email?: string | null; submission_path?: string | null }
      | null;
    let rowError = rowA.error;

    if ((!row || rowError) && admin) {
      const rowB = await admin
        .from("asignaciones")
        .select(select)
        .eq("id", assignmentId)
        .maybeSingle();
      row = rowB.data as
        | { revisor_id?: string | null; assigned_to_email?: string | null; submission_path?: string | null }
        | null;
      rowError = rowB.error;
    }

    if (rowError) {
      redirect("/platform/task?error=" + encodeURIComponent(rowError.message));
    }
    if (!row?.submission_path) {
      redirect("/platform/task?error=" + encodeURIComponent("No hay entrega para descargar."));
    }

    const userEmail = normalizeEmail(user.email);
    const assignedTo = normalizeEmail(row.assigned_to_email);
    const canAccess =
      (role === "usuario" && userEmail && assignedTo && userEmail === assignedTo) ||
      (role === "revisor" && row.revisor_id === user.id);

    if (!canAccess) {
      redirect("/platform/task?error=" + encodeURIComponent("No tienes permisos para descargar."));
    }

    const signedA = await supabase.storage
      .from("asignaciones")
      .createSignedUrl(row.submission_path, 60);

    let signedUrl = signedA.data?.signedUrl ?? null;
    let signedError = signedA.error;

    if ((!signedUrl || signedError) && admin) {
      const signedB = await admin.storage
        .from("asignaciones")
        .createSignedUrl(row.submission_path, 60);
      signedUrl = signedB.data?.signedUrl ?? null;
      signedError = signedB.error;
    }

    if (signedError || !signedUrl) {
      redirect(
        "/platform/task?error=" +
          encodeURIComponent(signedError?.message ?? "No se pudo generar el enlace.")
      );
    }

    redirect(signedUrl);
  }

  async function getPreviewUrl(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      return { ok: false as const, error: "Configura Supabase primero (env vars)." };
    }

    const assignmentId = String(formData.get("assignment_id") ?? "").trim();
    if (!assignmentId) {
      return { ok: false as const, error: "Falta assignment_id." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { ok: false as const, error: "Sesión inválida." };

    const role = await getRoleFromUserRolesTable(supabase, user.id);

    const admin =
      serviceKey && !serviceKey.includes("__REPLACE_ME__")
        ? createSupabaseAdminClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;

    const select = "id, revisor_id, assigned_to_email, submission_path";
    const rowA = await supabase
      .from("asignaciones")
      .select(select)
      .eq("id", assignmentId)
      .maybeSingle();

    let row = rowA.data as
      | { revisor_id?: string | null; assigned_to_email?: string | null; submission_path?: string | null }
      | null;
    let rowError = rowA.error;

    if ((!row || rowError) && admin) {
      const rowB = await admin
        .from("asignaciones")
        .select(select)
        .eq("id", assignmentId)
        .maybeSingle();
      row = rowB.data as
        | { revisor_id?: string | null; assigned_to_email?: string | null; submission_path?: string | null }
        | null;
      rowError = rowB.error;
    }

    if (rowError) return { ok: false as const, error: rowError.message };
    if (!row?.submission_path) return { ok: false as const, error: "No hay entrega para ver." };

    const userEmail = normalizeEmail(user.email);
    const assignedTo = normalizeEmail(row.assigned_to_email);
    const canAccess =
      (role === "usuario" && userEmail && assignedTo && userEmail === assignedTo) ||
      (role === "revisor" && row.revisor_id === user.id);

    if (!canAccess) return { ok: false as const, error: "No tienes permisos para ver este archivo." };

    const signedA = await supabase.storage
      .from("asignaciones")
      .createSignedUrl(row.submission_path, 60);

    let signedUrl = signedA.data?.signedUrl ?? null;
    let signedError = signedA.error;

    if ((!signedUrl || signedError) && admin) {
      const signedB = await admin.storage
        .from("asignaciones")
        .createSignedUrl(row.submission_path, 60);
      signedUrl = signedB.data?.signedUrl ?? null;
      signedError = signedB.error;
    }

    if (signedError || !signedUrl) {
      return {
        ok: false as const,
        error: signedError?.message ?? "No se pudo generar el enlace.",
      };
    }

    return { ok: true as const, url: signedUrl };
  }

  async function saveComment(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      return { ok: false as const, error: "Configura Supabase primero (env vars)." };
    }

    const assignmentId = String(formData.get("assignment_id") ?? "").trim();
    const comment = String(formData.get("comment") ?? "").trim();
    if (!assignmentId) return { ok: false as const, error: "Falta assignment_id." };
    if (!comment) return { ok: false as const, error: "Comentario vacío." };

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { ok: false as const, error: "Sesión inválida." };

    const role = await getRoleFromUserRolesTable(supabase, user.id);
    if (role !== "revisor") return { ok: false as const, error: "No tienes permisos para comentar." };

    const admin =
      serviceKey && !serviceKey.includes("__REPLACE_ME__")
        ? createSupabaseAdminClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;

    const verifyA = await supabase
      .from("asignaciones")
      .select("id, revisor_id")
      .eq("id", assignmentId)
      .maybeSingle();

    let row = verifyA.data as { revisor_id?: string | null } | null;
    let rowError = verifyA.error;

    if ((!row || rowError) && admin) {
      const verifyB = await admin
        .from("asignaciones")
        .select("id, revisor_id")
        .eq("id", assignmentId)
        .maybeSingle();
      row = verifyB.data as { revisor_id?: string | null } | null;
      rowError = verifyB.error;
    }

    if (rowError) return { ok: false as const, error: rowError.message };
    if (!row || row.revisor_id !== user.id) {
      return { ok: false as const, error: "Solo puedes comentar tus asignaciones." };
    }

    const payload: Record<string, unknown> = {
      reviewer_comment: comment,
      reviewer_comment_at: new Date().toISOString(),
    };

    const updatedA = await supabase.from("asignaciones").update(payload).eq("id", assignmentId);
    let updateError = updatedA.error;

    if (updateError && admin) {
      const updatedB = await admin.from("asignaciones").update(payload).eq("id", assignmentId);
      updateError = updatedB.error;
    }

    if (updateError) {
      const msg = (updateError.message ?? "").toLowerCase();
      const code = (updateError as unknown as { code?: string } | null)?.code ?? "";
      const schemaMismatch =
        msg.includes("schema cache") ||
        msg.includes("could not find") ||
        msg.includes("does not exist") ||
        code === "PGRST204";

      if (schemaMismatch) {
        return {
          ok: false as const,
          error: "Faltan columnas para guardar el comentario (reviewer_comment, reviewer_comment_at).",
        };
      }

      return { ok: false as const, error: updateError.message };
    }

    return { ok: true as const };
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
          <TaskBoard
            role={role}
            tasks={assignments}
            onSubmit={submitWork}
            onDownload={downloadSubmission}
            onGetPreviewUrl={getPreviewUrl}
            onSaveComment={saveComment}
          />
        )}
      </div>
    </PlatformShell>
  );
}

