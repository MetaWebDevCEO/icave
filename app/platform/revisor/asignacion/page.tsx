import { PlatformShell } from "@/app/platform/platform-shell";
import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  resolveRoleForUser,
  buildSections,
  type UserRole,
} from "@/lib/platform-roles";
import { DeleteAssignmentForm } from "./delete-assignment-form";
import { formatCalendarDateShort } from "@/lib/calendar-date";
import {
  parseSubmissionFiles,
  isValidSubmissionPath,
  listEvidenceInFolder,
  normalizeEmail as normalizeEmailUtil,
  type SubmissionFile,
} from "@/lib/submission-files";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
  submission_files?: unknown;
  submission_path?: string | null;
  submission_name?: string | null;
  submission_mime?: string | null;
  submitted_at?: string | null;
  submitted_by_email?: string | null;
  reviewer_comment?: string | null;
  reviewer_comment_at?: string | null;
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

function isCompleted(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized.includes("comp") || normalized.includes("done");
}

function formatShortDate(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} ${hh}:${mm}`;
  } catch {
    return null;
  }
}

const DOWNLOAD_BASE_PATH = "/platform/revisor/task/download";

const MAX_ATTACHMENT_SIZE_BYTES = 10_000 * 1024;

function normalizeEmail(value: string | null | undefined) {
  return normalizeEmailUtil(value);
}

function isSchemaMismatch(err: PostgrestError | null) {
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
}

function upsertEntregaIntoDescription(
  description: string | null | undefined,
  objectPath: string,
  submittedByEmail: string,
  submittedAtISO: string
) {
  const input = String(description ?? "").trimEnd();
  const lines = input.length > 0 ? input.split(/\r?\n/) : [];
  const filtered = lines.filter((line) => {
    const normalized = line.trim().toLowerCase();
    if (normalized.startsWith("entrega:")) return false;
    if (normalized.startsWith("entregado por:")) return false;
    if (normalized.startsWith("entregado el:")) return false;
    return true;
  });

  const base = filtered.join("\n").trimEnd();
  const meta = [
    "Entrega: " + objectPath,
    "Entregado por: " + submittedByEmail,
    "Entregado el: " + submittedAtISO,
  ].join("\n");

  return base ? `${base}\n\n${meta}` : meta;
}

async function findSubmissionInStorage(
  client: SupabaseClient,
  ownerUserId: string,
  assignmentId: string
): Promise<SubmissionFile[] | null> {
  const files = await listEvidenceInFolder(
    client,
    "asignaciones",
    `entregas/${ownerUserId}/${assignmentId}`
  );
  if (files.length === 0) return null;
  return files;
}

async function bestEffortSyncSubmission(
  supabase: SupabaseClient,
  admin: SupabaseClient | null,
  assignmentId: string,
  description: string | null | undefined,
  files: SubmissionFile[],
  submittedByEmail?: string | null,
  submittedAtISO?: string | null
) {
  const validFiles = files.filter((f) => isValidSubmissionPath(f.path));
  if (validFiles.length === 0) {
    return null;
  }
  const syncedAt = submittedAtISO ?? new Date().toISOString();
  const primary = validFiles[0];
  const primaryPath = primary.path.trim().replace(/^\/+/, "");
  const mergedDescription = upsertEntregaIntoDescription(
    description,
    primaryPath,
    submittedByEmail ?? "supervisor",
    syncedAt
  );
  const filesJson = validFiles.map((f) => ({
    path: f.path.trim().replace(/^\/+/, ""),
    name: f.name,
    mime: f.mime ?? "application/pdf",
  }));

  const fullPayload: Record<string, unknown> = {
    status: "Completada",
    description: mergedDescription,
    submission_path: primaryPath,
    submission_name: primary.name,
    submission_mime: primary.mime ?? "application/pdf",
    submission_files: filesJson,
    submitted_at: syncedAt,
    submitted_by_email: submittedByEmail ?? null,
  };

  const midPayload: Record<string, unknown> = {
    status: "Completada",
    description: mergedDescription,
    submission_path: primaryPath,
    submission_files: filesJson,
    submitted_at: syncedAt,
    submitted_by_email: submittedByEmail ?? null,
  };

  const fallbackPayload: Record<string, unknown> = {
    status: "Completada",
    description: mergedDescription,
  };

  const tryPayload = async (payload: Record<string, unknown>) => {
    const first = await supabase.from("asignaciones").update(payload).eq("id", assignmentId);
    if (!first.error) return null;
    if (!admin) return first.error;
    const second = await admin.from("asignaciones").update(payload).eq("id", assignmentId);
    return second.error;
  };

  let error = await tryPayload(fullPayload);
  if (isSchemaMismatch(error)) {
    error = await tryPayload(midPayload);
  }
  if (isSchemaMismatch(error)) {
    error = await tryPayload(fallbackPayload);
  }

  return error;
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
  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/");

  const role = await resolveRoleForUser(supabase, user.id);
  if (role !== "revisor") redirect("/platform");

  const sections = buildSections(role);

  const sp = await searchParams;
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");
  const statusFilter = getSearchParam(sp, "status") ?? "all";
  const dateFrom = getSearchParam(sp, "date_from");
  const dateTo = getSearchParam(sp, "date_to");
  const supervisorFilter = getSearchParam(sp, "supervisor");
  const searchQuery = getSearchParam(sp, "q");
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

  async function deleteAssignment(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
    }

    const supabase = await createClient();
    const admin =
      serviceKey && !serviceKey.includes("__REPLACE_ME__")
        ? createSupabaseAdminClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/");

    const role = await resolveRoleForUser(supabase, user.id);
    if (role !== "revisor") redirect("/platform");

    const assignmentId = String(formData.get("assignment_id") ?? "").trim();
    if (!assignmentId) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent("Falta el identificador de la asignación.")
      );
    }

    type Row = { id: string; revisor_id?: string | null; attachment_path?: string | null };
    let existing: Row | null = null;
    const rowA = await supabase
      .from("asignaciones")
      .select("id, revisor_id, attachment_path")
      .eq("id", assignmentId)
      .maybeSingle();
    if (rowA.data) {
      existing = rowA.data as Row;
    } else if (admin) {
      const rowB = await admin
        .from("asignaciones")
        .select("id, revisor_id, attachment_path")
        .eq("id", assignmentId)
        .maybeSingle();
      if (rowB.data) existing = rowB.data as Row;
    }

    if (!existing) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent("La asignación no existe o no tienes permiso.")
      );
    }

    if (!existing.revisor_id || existing.revisor_id !== user.id) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent("Solo puedes eliminar las asignaciones que tú creaste.")
      );
    }

    if (existing.attachment_path) {
      await (admin ?? supabase).storage
        .from("asignaciones")
        .remove([existing.attachment_path])
        .catch(() => null);
    }

    const writeClient = (admin ?? supabase);
    const { error: deleteError } = await writeClient
      .from("asignaciones")
      .delete()
      .eq("id", assignmentId);

    if (deleteError) {
      redirect(
        "/platform/revisor/asignacion?error=" +
          encodeURIComponent(deleteError.message ?? "No se pudo eliminar la asignación.")
      );
    }

    revalidatePath("/platform/revisor/asignacion");

    redirect(
      "/platform/revisor/asignacion?message=" +
        encodeURIComponent("Asignación eliminada.")
    );
  }

  async function createAssignment(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
    }

    const supabase = await createClient();
    const admin =
      serviceKey && !serviceKey.includes("__REPLACE_ME__")
        ? createSupabaseAdminClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/");

    const role = await resolveRoleForUser(supabase, user.id);
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

      if (attachment.size > MAX_ATTACHMENT_SIZE_BYTES) {
        redirect(
          "/platform/revisor/asignacion?error=" +
            encodeURIComponent("El adjunto no puede superar los 10,000 KB (10 MB).")
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

    const writeClient = (admin ?? supabase);

    const tryInsert = async (payload: Record<string, unknown>) => {
      const res = await writeClient
        .from("asignaciones")
        .insert(payload)
        .select("id")
        .maybeSingle();
      return { data: (res.data ?? null) as { id?: string } | null, error: res.error };
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

      const storageClient = (admin ?? supabase);
      const upload = await storageClient.storage
        .from("asignaciones")
        .upload(objectPath, fileToUpload, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (!upload.error) {
        const updateClient = (admin ?? supabase);
        await updateClient
          .from("asignaciones")
          .update({
            attachment_name: safeName,
            attachment_mime: "application/pdf",
            attachment_path: objectPath,
          })
          .eq("id", assignmentId);
      }
    }

    revalidatePath("/platform/revisor/asignacion");

    redirect(
      "/platform/revisor/asignacion?message=" +
        encodeURIComponent("Asignación creada.")
    );
  }

  const readClient = (admin ?? supabase);
  let listData: unknown[] = [];
  let listError: PostgrestError | null = null;

  if (admin) {
    const res = await admin
      .from("asignaciones")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    listData = (res.data ?? []) as unknown[];
    listError = res.error;
  } else {
    const tryA = await supabase
      .from("asignaciones")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (tryA.data && tryA.data.length > 0) {
      listData = tryA.data as unknown[];
      listError = tryA.error;
    } else {
      const res = await readClient
        .from("asignaciones")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      listData = (res.data ?? []) as unknown[];
      listError = res.error ?? tryA.error;
    }
  }

  const userOptions = userEmails.map((email) => ({
    value: email,
    label: email,
  }));

  const allRows = (listData ?? []) as AssignmentRow[];
  const needsStorageLookup = allRows.some(
    (row) => parseSubmissionFiles(row).length === 0
  );

  let listDataSynced = allRows;
  if (needsStorageLookup && admin) {
    const storageClient = admin;
    let assignedUserIdByEmail = new Map<string, string>();
    try {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      assignedUserIdByEmail = new Map(
        (listed.data?.users ?? [])
          .map((candidate) => [normalizeEmail(candidate.email), candidate.id] as const)
          .filter(([email]) => email.length > 0)
      );
    } catch {
      /* sin listUsers: usamos fallback de escaneo completo */
    }

    listDataSynced = await Promise.all(
      allRows.map(async (row) => {
        if (parseSubmissionFiles(row).length > 0) return row;

        let found: SubmissionFile[] | null = null;

        const ownerUserId = assignedUserIdByEmail.get(normalizeEmail(row.assigned_to_email));
        if (ownerUserId) {
          found = await findSubmissionInStorage(storageClient, ownerUserId, row.id);
        }

        if (!found) {
          try {
            const root = await storageClient.storage
              .from("asignaciones")
              .list("entregas", { limit: 500, offset: 0 });
            if (root.data && root.data.length > 0) {
              for (const folder of root.data) {
                if (folder.id) continue;
                const candidate = await findSubmissionInStorage(
                  storageClient,
                  folder.name,
                  row.id
                );
                if (candidate && candidate.length > 0) {
                  found = candidate;
                  break;
                }
              }
            }
          } catch {
            /* sin listado root: no hay fallback */
          }
        }

        if (!found || found.length === 0) return row;

        const filesArr = found.filter((f) => isValidSubmissionPath(f.path));
        if (filesArr.length === 0) return row;
        const primaryPath = filesArr[0].path.trim().replace(/^\/+/, "");
        const primaryName = filesArr[0].name;
        const primaryMime = filesArr[0].mime ?? "application/pdf";
        const filesJson = filesArr.map((f) => ({
          path: f.path.trim().replace(/^\/+/, ""),
          name: f.name,
          mime: f.mime ?? "application/pdf",
        }));
        const statusWas = (row.status ?? "").trim();
        const statusIsOpen =
          statusWas.length === 0 ||
          statusWas.toLowerCase().includes("pend") ||
          statusWas.toLowerCase().includes("espera") ||
          statusWas.toLowerCase().includes("curso") ||
          statusWas.toLowerCase().includes("progreso") ||
          statusWas.toLowerCase().includes("nueva") ||
          statusWas.toLowerCase().includes("nuevo") ||
          statusWas.toLowerCase().includes("open") ||
          statusWas.toLowerCase().includes("todo");

        const syncError = await bestEffortSyncSubmission(
          supabase,
          admin,
          row.id,
          row.description,
          filesArr,
          row.submitted_by_email ?? normalizeEmail(row.assigned_to_email),
          row.submitted_at
        );

        return {
          ...row,
          status:
            syncError
              ? row.status
              : statusIsOpen
                ? "Completada"
                : row.status,
          submission_path: primaryPath,
          submission_name: row.submission_name ?? primaryName,
          submission_mime: row.submission_mime ?? primaryMime,
          submission_files: row.submission_files ?? filesJson,
          submitted_by_email:
            row.submitted_by_email ?? normalizeEmail(row.assigned_to_email) ?? null,
          submitted_at: row.submitted_at ?? new Date().toISOString(),
          description: upsertEntregaIntoDescription(
            row.description,
            primaryPath,
            (row.submitted_by_email ?? normalizeEmail(row.assigned_to_email)) || "supervisor",
            row.submitted_at ?? new Date().toISOString()
          ),
        };
      })
    );
  }

  const allAssignments = listDataSynced;
  const assignments = allAssignments.filter((row) => {
    const status = (row.status ?? "").trim().toLowerCase();
    const passStatus =
      statusFilter === "all"
        ? true
        : statusFilter === "pending"
          ? status.includes("pend")
          : statusFilter === "progress"
            ? status.includes("prog") || status.includes("curso")
            : statusFilter === "completed"
              ? status.includes("comp") || status.includes("done")
              : status.includes(statusFilter.toLowerCase());

    if (!passStatus) return false;

    const supervisorNeedle = normalizeEmail(supervisorFilter);
    if (supervisorNeedle) {
      const haystacks = [
        normalizeEmail(row.assigned_to_email),
        normalizeEmail(row.assigned_to),
        normalizeEmail(extractAssignedEmail(row.description)),
      ];
      const match = haystacks.some((h) => h && h.includes(supervisorNeedle));
      if (!match) return false;
    }

    const isoFrom = (dateFrom ?? "").trim();
    const isoTo = (dateTo ?? "").trim();
    if (isoFrom || isoTo) {
      const candidates = [
        row.created_at,
        row.due_at,
      ].filter(Boolean) as string[];

      const t = candidates.map((iso) => new Date(iso).getTime());

      if (t.length === 0) {
        return false;
      }

      if (isoFrom) {
        const d = new Date(isoFrom);
        if (!Number.isNaN(d.getTime())) {
          const fromTs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
          if (!t.some((x) => x >= fromTs)) return false;
        }
      }
      if (isoTo) {
        const d = new Date(isoTo);
        if (!Number.isNaN(d.getTime())) {
          const toTs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
          if (!t.some((x) => x <= toTs)) return false;
        }
      }
    }

    const needle = (searchQuery ?? "").trim().toLowerCase();
    if (needle.length > 0) {
      const haystack = [
        row.title ?? "",
        row.description ?? "",
        row.assigned_to_email ?? "",
        row.assigned_to ?? "",
        extractAssignedEmail(row.description) ?? "",
        row.priority ?? "",
        row.status ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });

  const basePath = "/platform/revisor/asignacion";

  function buildQuery(entries: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(entries)) {
      if (v && String(v).trim().length > 0) params.set(k, v);
    }
    const q = params.toString();
    return q ? `?${q}` : "";
  }

  function filterClass(key: string) {
    const active =
      key === "all"
        ? !statusFilter || statusFilter === "all"
        : statusFilter?.includes(key);
    return [
      "rounded-full px-3 py-1.5",
      active
        ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
        : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
    ].join(" ");
  }

  const preserve: Record<string, string | undefined> = {
    status: statusFilter && statusFilter !== "all" ? statusFilter : undefined,
    date_from: dateFrom,
    date_to: dateTo,
    supervisor: supervisorFilter,
    q: searchQuery,
  };

  const linkForStatus = (status: string) => {
    return `${basePath}${buildQuery({
      ...preserve,
      status: status === "all" ? undefined : status,
    })}`;
  };

  const clearLink = `${basePath}?status=all`;

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

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a href={linkForStatus("all")} className={filterClass("all")}>
              Todas
            </a>
            <a href={linkForStatus("pending")} className={filterClass("pend")}>
              Pendientes
            </a>
            <a href={linkForStatus("progress")} className={filterClass("prog")}>
              En curso
            </a>
            <a href={linkForStatus("completed")} className={filterClass("comp")}>
              Completadas
            </a>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <form
            method="GET"
            action={basePath}
            className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_1.3fr_auto_auto]"
          >
            <input type="hidden" name="status" value={statusFilter ?? "all"} />

            <label className="grid gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Buscar actividad
              </span>
              <input
                type="search"
                name="q"
                defaultValue={searchQuery ?? ""}
                placeholder="Título, descripción, asignado, prioridad…"
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Desde</span>
              <input
                type="date"
                name="date_from"
                defaultValue={dateFrom ?? ""}
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Hasta</span>
              <input
                type="date"
                name="date_to"
                defaultValue={dateTo ?? ""}
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">
                Asignado a
              </span>
              <select
                name="supervisor"
                defaultValue={supervisorFilter ?? ""}
                className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-800 dark:bg-black dark:text-zinc-50"
              >
                <option value="">Todos los usuarios</option>
                {userOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                className="h-10 w-full rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Filtrar
              </button>
            </div>

            <div className="flex items-end">
              <a
                href={clearLink}
                className="inline-flex h-10 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Limpiar
              </a>
            </div>
          </form>
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
                  Tipo permitido: PDF. Tamaño máximo: 10,000 KB (10 MB).
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

            {listError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
                {listError.message}
              </div>
            )}

            {!listError && assignments.length === 0 && (
              <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                No hay asignaciones por ahora.
              </div>
            )}

            {!listError && assignments.length > 0 && (
              <div className="grid gap-3">
                {assignments.map((a) => {
                  const createdLabel = a.created_at
                    ? formatCalendarDateShort(a.created_at)
                    : null;
                  const dueLabel = a.due_at
                    ? formatCalendarDateShort(a.due_at)
                    : null;
                  const assigned =
                    a.assigned_to_email ??
                    a.assigned_to ??
                    extractAssignedEmail(a.description) ??
                    a.assigned_to_user_id ??
                    null;
                  const deliveryFiles: SubmissionFile[] = parseSubmissionFiles(a);
                  const hasDelivery = deliveryFiles.length > 0;
                  const submittedAtLabel = a.submitted_at ?? null;
                  const submittedByLabel = a.submitted_by_email ?? null;

                  return (
                    <div
                      key={a.id}
                      className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      <div className="px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
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
                            <DeleteAssignmentForm
                              assignmentId={a.id}
                              formAction={deleteAssignment}
                            />
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3">
                          {isCompleted(a.status) && (
                            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-black">
                              <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                                Estado de la tarea
                              </div>
                              <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                                Completada por el supervisor.
                              </div>
                            </div>
                          )}

                          {hasDelivery && (
                            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-black">
                              <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                Evidencia de cumplimiento
                              </div>
                              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                {submittedByLabel ? `Enviado por ${submittedByLabel}` : "Documento PDF"}
                                {submittedAtLabel
                                  ? ` · ${formatShortDate(submittedAtLabel)}`
                                  : ""}
                              </div>

                              {deliveryFiles.length > 0 && (
                                <div className="mt-3 grid gap-2">
                                  {deliveryFiles.map((f, idx) => (
                                    <div
                                      key={`${f.path}-${idx}`}
                                      className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40"
                                    >
                                      <div className="flex min-w-0 items-center gap-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900">
                                          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-5 w-5">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M14 2v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                            <path d="M9 15h6M9 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                          </svg>
                                        </div>
                                        <div className="min-w-0">
                                          <div className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">
                                            {f.name}
                                          </div>
                                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                            Evidencia {idx + 1} · PDF
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex shrink-0 items-center gap-2">
                                        <a
                                          href={`${DOWNLOAD_BASE_PATH}?assignment_id=${encodeURIComponent(a.id)}&idx=${encodeURIComponent(String(idx))}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                        >
                                          Ver
                                        </a>
                                        <a
                                          href={`${DOWNLOAD_BASE_PATH}?assignment_id=${encodeURIComponent(a.id)}&idx=${encodeURIComponent(String(idx))}&disposition=attachment`}
                                          className="inline-flex h-8 items-center rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
                                        >
                                          Descargar
                                        </a>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
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
