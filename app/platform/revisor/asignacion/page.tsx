import { PlatformShell } from "@/app/platform/platform-shell";
import type { SidebarSection } from "@/app/platform/components/sidebar";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";

type UserRole = "revisor" | "usuario";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function normalizeRoleCode(value: unknown): UserRole | null {
  if (typeof value === "number") {
    if (value === 1) return "revisor";
    if (value === 2) return "usuario";
    return null;
  }

  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();

  if (normalized === "revisor") return "revisor";
  if (normalized === "usuario") return "usuario";

  if (normalized.includes("revi")) return "revisor";
  if (normalized.includes("admin")) return "usuario";
  if (normalized.includes("usuario")) return "usuario";
  if (normalized.includes("super")) return "usuario";

  return null;
}

async function getRoleFromUserRolesTable(
  supabase: SupabaseClient,
  userId: string
): Promise<UserRole> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role_code")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  const role = normalizeRoleCode(data?.role_code);
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

type AssignmentRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  title: string | null;
  description?: string | null;
  due_at?: string | null;
  priority?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to?: string | null;
  assigned_to_email?: string | null;
  attachment_name?: string | null;
  attachment_mime?: string | null;
  attachment_path?: string | null;
};

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

function getLastDayOfCurrentMonthISO() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const yyyy = String(lastDay.getFullYear());
  const mm = String(lastDay.getMonth() + 1).padStart(2, "0");
  const dd = String(lastDay.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseISODate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^\w.\-()+\s]/g, "").replace(/\s+/g, " ").trim();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value.trim());
}

function extractAssignedEmail(description: string | null | undefined) {
  if (!description) return null;
  const match = /asignad[ao]\s+a:\s*([^\s]+@[^\s]+)/i.exec(description);
  return match?.[1] ?? null;
}

function computeNotifyAtISO(priority: string, dueAt: Date) {
  const now = new Date();
  const normalized = priority.trim().toLowerCase();

  if (normalized.includes("urg")) {
    return now.toISOString();
  }

  const due = dueAt.getTime();
  const hours = normalized.includes("med") ? 48 : 24;
  const notify = new Date(due - hours * 60 * 60 * 1000);
  if (notify.getTime() < now.getTime()) {
    return now.toISOString();
  }
  return notify.toISOString();
}

function statusBadgeClasses(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  if (!normalized) {
    return "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
  }
  if (
    normalized.includes("pend") ||
    normalized.includes("open") ||
    normalized.includes("nuevo")
  ) {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200";
  }
  if (normalized.includes("prog") || normalized.includes("proc")) {
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200";
  }
  if (normalized.includes("hech") || normalized.includes("done") || normalized.includes("comp")) {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200";
  }
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

export default async function AsignacionRevisorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !url ||
    !anonKey ||
    url.includes("__REPLACE_ME__") ||
    anonKey.includes("__REPLACE_ME__")
  ) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const role = await getRoleFromUserRolesTable(supabase, user.id);
  if (role !== "revisor") redirect("/platform");

  const sections = buildSections(role);

  const sp = await searchParams;
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");
  const statusFilter = getSearchParam(sp, "status");
  const maxDueISO = getLastDayOfCurrentMonthISO();

  let userEmails: string[] = [];
  if (serviceKey && !serviceKey.includes("__REPLACE_ME__")) {
    const admin = createSupabaseAdminClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    userEmails = (data?.users ?? [])
      .map((u) => u.email)
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .map((v) => v.trim().toLowerCase())
      .filter((v) => isEmail(v))
      .sort((a, b) => a.localeCompare(b));
  }

  async function createAssignment(formData: FormData) {
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
    if (role !== "revisor") redirect("/platform");

    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const dueAt = String(formData.get("due_at") ?? "").trim();
    const priorityRaw = String(formData.get("priority") ?? "").trim();
    const priority = priorityRaw || "Medio";
    const assignedEmailRaw = String(formData.get("assigned_to_email") ?? "");
    const assignedEmail = assignedEmailRaw
      .trim()
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .toLowerCase();
    const attachment = formData.get("attachment");

    if (!title) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent("El título es obligatorio.")
      );
    }

    if (!assignedEmail || !isEmail(assignedEmail)) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent("Escribe un correo válido para asignar la tarea.")
      );
    }

    if (!dueAt) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent("La fecha límite es obligatoria.")
      );
    }

    const dueDate = parseISODate(dueAt);
    if (!dueDate) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent("Fecha límite inválida.")
      );
    }

    const lastDay = parseISODate(getLastDayOfCurrentMonthISO());
    if (!lastDay) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent("No se pudo validar el último día del mes.")
      );
    }

    if (dueDate.getTime() > lastDay.getTime()) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent(
            "La fecha de entrega no puede superar el último día del mes en curso."
          )
      );
    }

    if (
      !priority.trim().toLowerCase().includes("urg") &&
      !priority.trim().toLowerCase().includes("med") &&
      !priority.trim().toLowerCase().includes("no")
    ) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent("Prioridad inválida.")
      );
    }

    let fileToUpload: File | null = null;
    if (attachment instanceof File && attachment.size > 0) {
      const name = attachment.name || "archivo.pdf";
      const lower = name.toLowerCase();
      if (!lower.endsWith(".pdf")) {
        redirect(
          "/platform/revisor/asignacion?error=" +
            encodeURIComponent("Solo se permiten archivos PDF.")
        );
      }

      const bytes = new Uint8Array(await attachment.arrayBuffer());
      const header = String.fromCharCode(bytes[0] ?? 0) +
        String.fromCharCode(bytes[1] ?? 0) +
        String.fromCharCode(bytes[2] ?? 0) +
        String.fromCharCode(bytes[3] ?? 0);
      if (header !== "%PDF") {
        redirect(
          "/platform/revisor/asignacion?error=" +
            encodeURIComponent("El archivo no parece ser un PDF válido.")
        );
      }

      fileToUpload = new File([bytes], name, { type: "application/pdf" });
    }

    const payloadFull: Record<string, unknown> = {
      title,
      status: "Pendiente",
      revisor_id: user.id,
    };

    if (description) {
      payloadFull.description = `${description}\n\nAsignada a: ${assignedEmail}`;
    }
    payloadFull.due_at = dueAt;
    payloadFull.priority = priority;
    payloadFull.notify_at = computeNotifyAtISO(priority, dueDate);
    payloadFull.assigned_to_email = assignedEmail;

    const tryInsert = async (payload: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("asignaciones")
        .insert(payload)
        .select("id")
        .maybeSingle();
      return { data: data as { id?: string } | null, error };
    };

    let inserted = await tryInsert(payloadFull);

    if (inserted.error) {
      const message = inserted.error.message ?? "";
      const lower = message.toLowerCase();
      const code = (inserted.error as unknown as { code?: string } | null)?.code ?? "";

      const payloadA: Record<string, unknown> = {
        title,
        status: "Pendiente",
        revisor_id: user.id,
        due_at: dueAt,
        priority,
        notify_at: computeNotifyAtISO(priority, dueDate),
        assigned_to: assignedEmail,
      };

      if (description) payloadA.description = `${description}\n\nAsignada a: ${assignedEmail}`;

      if (
        (lower.includes("column") ||
          lower.includes("schema cache") ||
          lower.includes("could not find") ||
          lower.includes("does not exist") ||
          code === "PGRST204") &&
        (lower.includes("assigned_to_email") || lower.includes("assigned_to"))
      ) {
        inserted = await tryInsert(payloadA);
      }

      if (inserted.error) {
        const payloadB: Record<string, unknown> = {
          title,
          status: "Pendiente",
          revisor_id: user.id,
          due_at: dueAt,
          priority,
          notify_at: computeNotifyAtISO(priority, dueDate),
          assigned_to_email: assignedEmail,
        };

        if (description) payloadB.description = `${description}\n\nAsignada a: ${assignedEmail}`;

        inserted = await tryInsert(payloadB);
      }
    }

    if (inserted.error || !inserted.data?.id) {
      const lower = (inserted.error?.message ?? "").toLowerCase();
      const code = (inserted.error as unknown as { code?: string } | null)?.code ?? "";
      const friendly =
        code === "23514" && lower.includes("assigned_to_email_check")
          ? "El correo fue rechazado por una validación de la base de datos (CHECK assigned_to_email). Si el correo es válido, revisa ese CHECK (a veces \\s queda mal escapado)."
          : inserted.error?.message ?? "No se pudo crear la asignación.";
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent(friendly)
      );
    }

    const assignmentId = inserted.data.id;

    if (fileToUpload) {
      const safeName = sanitizeFileName(fileToUpload.name || "archivo.pdf") || "archivo.pdf";
      const objectPath = `asignaciones/${user.id}/${assignmentId}/${Date.now()}-${safeName}`;
      const upload = await supabase.storage
        .from("asignaciones")
        .upload(objectPath, fileToUpload, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (!upload.error) {
        await supabase
          .from("asignaciones")
          .update({
            attachment_name: safeName,
            attachment_mime: "application/pdf",
            attachment_path: objectPath,
          })
          .eq("id", assignmentId);
      }
    }

    redirect(
      "/platform/revisor/asignacion?message=" +
        encodeURIComponent("Asignación creada.")
    );
  }

  const { data, error } = await supabase
    .from("asignaciones")
    .select("*")
    .eq("revisor_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const allAssignments = (data ?? []) as AssignmentRow[];
  const assignments =
    statusFilter && statusFilter !== "all"
      ? allAssignments.filter((a) =>
          (a.status ?? "")
            .toLowerCase()
            .includes(statusFilter.toLowerCase())
        )
      : allAssignments;

  return (
    <PlatformShell
      sections={sections}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg font-semibold">Asignación</h1>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              Crea tareas y compártelas como en Classroom.
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <a
              href="/platform/revisor/asignacion?status=all"
              className={[
                "rounded-full px-3 py-1.5",
                !statusFilter || statusFilter === "all"
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              Todas
            </a>
            <a
              href="/platform/revisor/asignacion?status=pend"
              className={[
                "rounded-full px-3 py-1.5",
                statusFilter?.includes("pend")
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              Pendientes
            </a>
            <a
              href="/platform/revisor/asignacion?status=comp"
              className={[
                "rounded-full px-3 py-1.5",
                statusFilter?.includes("comp")
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

        <div className="mt-4 grid gap-4 lg:grid-cols-[420px_1fr]">
          <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                Crear tarea
              </div>
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Publica una asignación para tus revisiones.
              </div>
            </div>

            <form action={createAssignment} className="grid gap-4 p-5">
              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">Título</span>
                <input
                  name="title"
                  required
                  placeholder="Ej. Revisión de documento 001"
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Instrucciones detalladas
                </span>
                <textarea
                  name="description"
                  rows={4}
                  placeholder="Escribe las instrucciones para el revisor…"
                  required
                  className="resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Prioridad
                </span>
                <div className="grid gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="priority"
                        value="Urgente"
                        className="peer sr-only"
                        required
                      />
                      <div className="flex items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-900 transition-colors peer-checked:border-red-500 peer-checked:bg-red-50 peer-checked:text-red-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900 dark:peer-checked:border-red-400 dark:peer-checked:bg-red-950/40 dark:peer-checked:text-red-200">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                        Urgente
                      </div>
                    </label>

                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="priority"
                        value="Medio"
                        className="peer sr-only"
                        defaultChecked
                      />
                      <div className="flex items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-900 transition-colors peer-checked:border-amber-500 peer-checked:bg-amber-50 peer-checked:text-amber-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900 dark:peer-checked:border-amber-400 dark:peer-checked:bg-amber-950/40 dark:peer-checked:text-amber-200">
                        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                        Medio
                      </div>
                    </label>

                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="priority"
                        value="No Urgente"
                        className="peer sr-only"
                      />
                      <div className="flex items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-900 transition-colors peer-checked:border-emerald-500 peer-checked:bg-emerald-50 peer-checked:text-emerald-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900 dark:peer-checked:border-emerald-400 dark:peer-checked:bg-emerald-950/40 dark:peer-checked:text-emerald-200">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                        No urgente
                      </div>
                    </label>
                  </div>

                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Urgente: notificación inmediata. Medio: recordatorio 48h
                    antes del vencimiento. No urgente: seguimiento estándar.
                  </div>
                </div>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Asignar a (correo)
                </span>
                {userEmails.length > 0 ? (
                  <select
                    name="assigned_to_email"
                    required
                    defaultValue=""
                    className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                  >
                    <option value="" disabled hidden>
                      Seleccionar correo
                    </option>
                    {userEmails.map((email) => (
                      <option key={email} value={email}>
                        {email}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name="assigned_to_email"
                    type="email"
                    required
                    placeholder="correo@dominio.com"
                    className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                  />
                )}
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Se asigna por correo (usuarios dados de alta).
                </div>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Fecha límite
                </span>
                <input
                  name="due_at"
                  type="date"
                  required
                  max={maxDueISO}
                  className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
                />
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  No se permite una fecha posterior al último día del mes actual
                  ({maxDueISO}).
                </div>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Adjuntos (solo PDF)
                </span>
                <input
                  name="attachment"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="block w-full text-sm text-zinc-700 file:mr-4 file:rounded-md file:border file:border-zinc-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-900 hover:file:bg-zinc-100 dark:text-zinc-300 dark:file:border-zinc-800 dark:file:bg-black dark:file:text-zinc-100 dark:hover:file:bg-zinc-900"
                />
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Tipo permitido: PDF.
                </div>
              </label>

              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Publicar
              </button>

              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Si tu tabla <span className="font-medium">asignaciones</span> no
                tiene columnas como <span className="font-medium">description</span>{" "}
                o <span className="font-medium">due_at</span>, se guardará solo
                lo básico (título/fecha).
              </div>
            </form>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                    Tareas publicadas
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {assignments.length} resultados
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
                {error.message}
              </div>
            )}

            {!error && assignments.length === 0 && (
              <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                No hay asignaciones por ahora.
              </div>
            )}

            {!error && assignments.length > 0 && (
              <div className="grid gap-3">
                {assignments.map((a) => {
                  const createdLabel = a.created_at
                    ? new Date(a.created_at).toLocaleDateString()
                    : null;
                  const dueLabel = a.due_at
                    ? new Date(a.due_at).toLocaleDateString()
                    : null;
                  const assigned =
                    a.assigned_to_email ??
                    a.assigned_to ??
                    extractAssignedEmail(a.description) ??
                    a.assigned_to_user_id ??
                    null;

                  return (
                    <div
                      key={a.id}
                      className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      <div className="flex items-start justify-between gap-4 px-5 py-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">
                              {a.title ?? "Sin título"}
                            </div>
                            <span
                              className={[
                                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                statusBadgeClasses(a.status),
                              ].join(" ")}
                            >
                              {a.status ?? "—"}
                            </span>
                            {a.priority && (
                              <span className="inline-flex items-center rounded-full bg-white/0 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                                {a.priority}
                              </span>
                            )}
                          </div>

                          {(a.description || createdLabel || dueLabel || assigned) && (
                            <div className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                              {a.description && (
                                <div className="line-clamp-2">{a.description}</div>
                              )}
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                {createdLabel && (
                                  <span>Creada: {createdLabel}</span>
                                )}
                                {dueLabel && <span>Límite: {dueLabel}</span>}
                                {assigned && (
                                  <span>
                                    Asignada a:{" "}
                                    <span className="font-medium">
                                      {assigned}
                                    </span>
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <a
                            href="#"
                            className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-100 dark:hover:bg-zinc-900"
                          >
                            Abrir
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
