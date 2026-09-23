import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TaskRow } from "@/app/platform/task/task-board";
import { TaskPageContent } from "@/app/platform/task/task-page-content";
import {
  createClient as createSupabaseAdminClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  buildSections,
  resolveRoleForUser,
} from "@/lib/platform-roles";
import {
  buildEvidenceDescription,
  cleanupFolder,
  getUpdatePayload,
  isPdfBytes,
  isSchemaMismatchPostgres,
  listEvidenceInFolder,
  maxEvidenceFiles,
  maxSubmissionSizeBytes,
  normalizeEmail,
  parseSubmissionFiles,
  sanitizeFileName,
  sortByMostRecentMonthFirst,
  type SubmissionFile,
} from "@/lib/submission-files";

export const revalidate = 15;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type AssignmentRow = TaskRow & { revisor_id?: string | null };

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}



const MAX_SUBMISSION_SIZE_BYTES = maxSubmissionSizeBytes();
const MAX_EVIDENCE_FILES = maxEvidenceFiles();

async function bestEffortSyncSubmission(
  supabaseClient: SupabaseClient,
  adminClient: SupabaseClient | null,
  assignmentId: string,
  description: string | null | undefined,
  files: SubmissionFile[],
  submittedByEmail?: string | null,
  submittedAtISO?: string | null
) {
  const syncedAt = submittedAtISO ?? new Date().toISOString();
  const email = submittedByEmail ?? "supervisor";
  const mergedDescription = buildEvidenceDescription(
    description,
    files,
    email,
    syncedAt
  );
  const { full, mid, fallback } = getUpdatePayload(files);
    const withDesc = (p: Record<string, unknown>) => ({
      ...p,
      status: "Completada",
      description: mergedDescription,
      submitted_at: syncedAt,
      submitted_by_email: submittedByEmail ?? null,
    });

  const tryPayload = async (payload: Record<string, unknown>) => {
    const first = await supabaseClient
      .from("asignaciones")
      .update(payload)
      .eq("id", assignmentId);
    if (!first.error) return null;
    if (!adminClient) return first.error;
    const second = await adminClient
      .from("asignaciones")
      .update(payload)
      .eq("id", assignmentId);
    return second.error;
  };

  let err = await tryPayload(withDesc(full));
  if (isSchemaMismatchPostgres(err)) err = await tryPayload(withDesc(mid));
  if (isSchemaMismatchPostgres(err)) err = await tryPayload(withDesc(fallback));
  return err;
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const role = await resolveRoleForUser(supabase, user.id);
  if (role !== "revisor") {
    redirect("/platform/task?error=" + encodeURIComponent("No tienes permisos para eliminar."));
  }

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) {
    redirect("/platform/task?error=" + encodeURIComponent("Falta assignment_id."));
  }

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  const verifyClient = admin ?? supabase;
  const verify = await verifyClient
    .from("asignaciones")
    .select("id, revisor_id, attachment_path, assigned_to_email")
    .eq("id", assignmentId)
    .maybeSingle();

  let row = verify.data as
    | { id: string; revisor_id?: string | null; attachment_path?: string | null; assigned_to_email?: string | null }
    | null;
  let verifyError = verify.error;

  if ((!row || verifyError) && admin && verifyClient !== admin) {
    const fallback = await admin
      .from("asignaciones")
      .select("id, revisor_id, attachment_path, assigned_to_email")
      .eq("id", assignmentId)
      .maybeSingle();
    row = fallback.data as
      | { id: string; revisor_id?: string | null; attachment_path?: string | null; assigned_to_email?: string | null }
      | null;
    verifyError = fallback.error;
  }

  if (verifyError || !row) {
    redirect(
      "/platform/task?error=" +
        encodeURIComponent(verifyError?.message ?? "La asignación no existe.")
    );
  }

  if (!row.revisor_id || row.revisor_id !== user.id) {
    redirect(
      "/platform/task?error=" +
        encodeURIComponent("Solo puedes eliminar las asignaciones que tú creaste.")
    );
  }

  const storageClient = admin ?? supabase;

  if (row.attachment_path) {
    await storageClient.storage
      .from("asignaciones")
      .remove([row.attachment_path])
      .catch(() => null);
  }

  const assignedTo = normalizeEmail(row.assigned_to_email);
  let assignedUserId: string | null = null;
  if (assignedTo && admin) {
    try {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
      for (const u of listed.data?.users ?? []) {
        if (normalizeEmail(u.email) === assignedTo) {
          assignedUserId = u.id;
          break;
        }
      }
    } catch {
      /* sin acceso listUsers: intentamos búsqueda por carpetas */
    }
  }

  if (assignedUserId) {
    await cleanupFolder(storageClient, "asignaciones", `entregas/${assignedUserId}/${assignmentId}`);
  } else {
    try {
      const root = await storageClient.storage
        .from("asignaciones")
        .list("entregas", { limit: 500, offset: 0 });
      if (root.data && root.data.length > 0) {
        for (const folder of root.data) {
          if (folder.id) continue;
          await cleanupFolder(
            storageClient,
            "asignaciones",
            `entregas/${folder.name}/${assignmentId}`
          );
        }
      }
    } catch {
      /* no se pudo limpiar entregas: seguimos con el delete */
    }
  }

  const deleteClient = admin ?? supabase;
  const deleted = await deleteClient.from("asignaciones").delete().eq("id", assignmentId);

  if (deleted.error && admin && deleteClient !== admin) {
    const fallback = await admin.from("asignaciones").delete().eq("id", assignmentId);
    if (fallback.error) {
      redirect("/platform/task?error=" + encodeURIComponent(fallback.error.message));
    }
  } else if (deleted.error) {
    redirect("/platform/task?error=" + encodeURIComponent(deleted.error.message));
  }

  revalidatePath("/platform/task");
  redirect("/platform/task?message=" + encodeURIComponent("Asignación eliminada."));
}

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
  const role = await resolveRoleForUser(supabase, user.id);
  if (role !== "usuario") {
    redirect("/platform/task?error=" + encodeURIComponent("No tienes permisos para entregar."));
  }

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const uploadedFiles: File[] = [];
  const legacySingle = formData.get("file");
  if (legacySingle instanceof File && legacySingle.size > 0) {
    uploadedFiles.push(legacySingle);
  } else {
    const allFiles = formData.getAll("files");
    for (const value of allFiles) {
      if (value instanceof File && value.size > 0) {
        uploadedFiles.push(value);
      }
    }
  }

  if (!assignmentId) {
    redirect("/platform/task?error=" + encodeURIComponent("Falta assignment_id."));
  }

  if (uploadedFiles.length === 0) {
    redirect("/platform/task?error=" + encodeURIComponent("Selecciona al menos un PDF."));
  }

  if (uploadedFiles.length > MAX_EVIDENCE_FILES) {
    redirect(
      "/platform/task?error=" +
        encodeURIComponent(
          `No se permiten más de ${MAX_EVIDENCE_FILES} archivos por entrega.`
        )
    );
  }

  for (const f of uploadedFiles) {
    const lower = (f.name || "archivo.pdf").toLowerCase();
    if (!lower.endsWith(".pdf")) {
      redirect("/platform/task?error=" + encodeURIComponent("Solo se permiten archivos PDF."));
    }
    if (f.size > MAX_SUBMISSION_SIZE_BYTES) {
      redirect(
        "/platform/task?error=" +
          encodeURIComponent(
            "Cada archivo no puede superar los 10,000 KB (10 MB)."
          )
      );
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!isPdfBytes(bytes)) {
      redirect(
        "/platform/task?error=" +
          encodeURIComponent("Uno de los archivos no parece ser un PDF válido.")
      );
    }
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

  const fetchVerify = async (client: SupabaseClient) => {
    const extended = await client
      .from("asignaciones")
      .select("id, assigned_to_email, submission_path, description")
      .eq("id", assignmentId)
      .maybeSingle();

    if (!isSchemaMismatchPostgres(extended.error)) return extended;

    return client
      .from("asignaciones")
      .select("id, assigned_to_email, description")
      .eq("id", assignmentId)
      .maybeSingle();
  };

  const verifyA = await fetchVerify(supabase);
  let verifyRow = verifyA.data as
    | { assigned_to_email?: string | null; submission_path?: string | null; description?: string | null }
    | null;
  let verifyError = verifyA.error;

  if ((!verifyRow || verifyError) && admin) {
    const verifyB = await fetchVerify(admin);
    verifyRow = verifyB.data as
      | { assigned_to_email?: string | null; submission_path?: string | null; description?: string | null }
      | null;
    verifyError = verifyB.error;
  }

  if (verifyError) {
    redirect("/platform/task?error=" + encodeURIComponent(verifyError.message));
  }

  const assignedTo = normalizeEmail(verifyRow?.assigned_to_email);
  if (!assignedTo || assignedTo !== userEmail) {
    redirect("/platform/task?error=" + encodeURIComponent("Esta tarea no está asignada a tu usuario."));
  }

  const folderPath = `entregas/${user.id}/${assignmentId}`;

  if (admin) {
    await cleanupFolder(admin, "asignaciones", folderPath);
  } else {
    await cleanupFolder(supabase, "asignaciones", folderPath);
  }

  const uploadedEvidence: SubmissionFile[] = [];
  for (const file of uploadedFiles) {
    const safeName =
      sanitizeFileName(file.name || "") ||
      `evidencia-${uploadedEvidence.length + 1}.pdf`;
    const objectPath = `${folderPath}/${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileToUpload = new File([bytes], safeName, {
      type: "application/pdf",
    });

    const uploadA = await supabase.storage
      .from("asignaciones")
      .upload(objectPath, fileToUpload, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadA.error && admin) {
      const uploadB = await admin.storage
        .from("asignaciones")
        .upload(objectPath, fileToUpload, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadB.error) {
        redirect(
          "/platform/task?error=" + encodeURIComponent(uploadB.error.message)
        );
      }
    } else if (uploadA.error) {
      redirect(
        "/platform/task?error=" + encodeURIComponent(uploadA.error.message)
      );
    }

    uploadedEvidence.push({
      path: objectPath,
      name: safeName,
      mime: "application/pdf",
    });
  }

  const updateError = await bestEffortSyncSubmission(
    supabase,
    admin,
    assignmentId,
    verifyRow?.description,
    uploadedEvidence,
    userEmail,
    new Date().toISOString()
  );

  if (updateError) {
    redirect("/platform/task?error=" + encodeURIComponent(updateError.message));
  }

  redirect("/platform/task");
}

async function saveComment(formData: FormData) {
  "use server";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
  }

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim();
  if (!assignmentId) {
    redirect("/platform/task?error=" + encodeURIComponent("Falta assignment_id."));
  }
  if (!comment) {
    redirect("/platform/task?error=" + encodeURIComponent("Comentario vacío."));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/platform/task?error=" + encodeURIComponent("Sesión inválida."));
  }

  const role = await resolveRoleForUser(supabase, user.id);
  if (role !== "revisor") {
    redirect("/platform/task?error=" + encodeURIComponent("No tienes permisos para comentar."));
  }

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

  if (rowError) {
    redirect("/platform/task?error=" + encodeURIComponent(rowError.message));
  }
  if (!row || row.revisor_id !== user.id) {
    redirect("/platform/task?error=" + encodeURIComponent("Solo puedes comentar tus asignaciones."));
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
      redirect(
        "/platform/task?error=" +
          encodeURIComponent(
            "Faltan columnas para guardar el comentario (reviewer_comment, reviewer_comment_at)."
          )
      );
    }

    redirect("/platform/task?error=" + encodeURIComponent(updateError.message));
  }

  redirect("/platform/task?message=" + encodeURIComponent("Comentario enviado."));
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

  const role = await resolveRoleForUser(supabase, user.id);
  const sections = buildSections(role);
  const sp = await searchParams;
  const statusFilter = getSearchParam(sp, "status") ?? "all";
  const dateFrom = getSearchParam(sp, "date_from");
  const dateTo = getSearchParam(sp, "date_to");
  const supervisorFilter = getSearchParam(sp, "supervisor");
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");

  const userEmail = normalizeEmail(user.email);
  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  const selectFieldsBase =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email";
  const selectFieldsMid =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email, submission_path, submitted_at, submitted_by_email";
  const selectFieldsExtended =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email, submission_name, submission_path, submitted_at, submitted_by_email";

  const fetchSupervisor = async (client: SupabaseClient) => {
    const extended = await client
      .from("asignaciones")
      .select(selectFieldsExtended)
      .ilike("assigned_to_email", userEmail)
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);

    if (isSchemaMismatchPostgres(extended.error)) {
      const mid = await client
        .from("asignaciones")
        .select(selectFieldsMid)
        .ilike("assigned_to_email", userEmail)
        .order("due_at", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(200);

      if (!isSchemaMismatchPostgres(mid.error)) return mid;

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
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);

    if (isSchemaMismatchPostgres(extended.error)) {
      const mid = await client
        .from("asignaciones")
        .select(selectFieldsMid)
        .order("due_at", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(200);

      if (!isSchemaMismatchPostgres(mid.error)) return mid;

      return client
        .from("asignaciones")
        .select(selectFieldsBase)
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
      !serviceKey.includes("__REPLACE_ME__") &&
      admin
    ) {
      const second = await fetchSupervisor(admin);
      data = (second.data ?? []) as AssignmentRow[];
      error = second.error;
    }
  } else {
    const preferredClient = admin ?? supabase;
    const result = await fetchRevisor(preferredClient);
    data = (result.data ?? []) as AssignmentRow[];
    error = result.error;

    if (
      (error || data.length === 0) &&
      admin &&
      preferredClient !== admin
    ) {
      const fallback = await fetchRevisor(admin);
      data = (fallback.data ?? []) as AssignmentRow[];
      error = fallback.error;
    }
  }

  const rows = data ?? [];
  const needsStorageLookup = rows.some(
    (row) => parseSubmissionFiles(row).length === 0
  );

  type UserOption = { value: string; label: string };
  let userOptions: UserOption[] = [];
  {
    const set = new Map<string, string>();

    for (const r of rows) {
      const haystacks = [
        (r as { assigned_to_email?: string | null }).assigned_to_email,
        (r as { assigned_to?: string | null }).assigned_to,
      ];
      for (const h of haystacks) {
        const email = normalizeEmail(h);
        if (email && !set.has(email)) set.set(email, email);
      }
    }

    if (admin) {
      const emailByUserId = new Map<string, string>();
      try {
        const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
        for (const u of listed.data?.users ?? []) {
          const email = normalizeEmail(u.email);
          if (email) {
            if (!set.has(email)) set.set(email, email);
            if (u.id) emailByUserId.set(u.id, email);
          }
        }
      } catch {
        // sin acceso admin listUsers: seguimos con emails de asignaciones
      }

      try {
        const rolesRes = await admin
          .from("user_roles")
          .select("user_id, role_code")
          .limit(1000);
        const rowsR = rolesRes.data ?? [];
        for (const row of rowsR) {
          const code = String((row as { role_code?: unknown }).role_code ?? "").trim();
          const isSupervisor =
            code === "2" || code === "usuario" || code === "supervisor";
          if (!isSupervisor) continue;
          const uid = String((row as { user_id?: unknown }).user_id ?? "").trim();
          if (!uid) continue;
          const email = emailByUserId.get(uid);
          if (email && !set.has(email)) set.set(email, email);
        }
      } catch {
        // sin acceso user_roles: seguimos con lo que tenemos
      }
    }

    userOptions = Array.from(set.values())
      .sort((a, b) => a.localeCompare(b))
      .map((email) => ({ value: email, label: email }));
  }

  if (needsStorageLookup) {
    const storageClient = admin ?? supabase;
    let assignedUserIdByEmail = new Map<string, string>();

    if (role === "revisor" && admin) {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      assignedUserIdByEmail = new Map(
        (listed.data?.users ?? [])
          .map((candidate) => [normalizeEmail(candidate.email), candidate.id] as const)
          .filter(([email]) => email.length > 0)
      );
    }

    data = await Promise.all(
      rows.map(async (row) => {
        if (parseSubmissionFiles(row).length > 0) return row;

        let foundFiles: SubmissionFile[] = [];

        const ownerUserId =
          role === "usuario"
            ? user.id
            : assignedUserIdByEmail.get(normalizeEmail(row.assigned_to_email));

        if (ownerUserId) {
          const folder = `entregas/${ownerUserId}/${row.id}`;
          foundFiles = await listEvidenceInFolder(
            storageClient,
            "asignaciones",
            folder
          );
        }

        if (foundFiles.length === 0) {
          try {
            const root = await storageClient.storage
              .from("asignaciones")
              .list("entregas", { limit: 500, offset: 0 });
            if (root.data && root.data.length > 0) {
              for (const folder of root.data) {
                if (folder.id) continue;
                const candidate = await listEvidenceInFolder(
                  storageClient,
                  "asignaciones",
                  `entregas/${folder.name}/${row.id}`
                );
                if (candidate.length > 0) {
                  foundFiles = candidate;
                  break;
                }
              }
            }
          } catch {
            /* sin acceso a listado root: seguimos sin archivos */
          }
        }

        if (foundFiles.length === 0) return row;

        const ownerEmail =
          normalizeEmail(row.assigned_to_email) ||
          normalizeEmail(row.submitted_by_email) ||
          "supervisor";

        const syncErr = await bestEffortSyncSubmission(
          supabase,
          admin,
          row.id,
          row.description,
          foundFiles,
          ownerEmail,
          row.submitted_at
        );

        const primary = foundFiles[0];
        const derivedStatus = (row.status ?? "").trim();
        return {
          ...row,
          status: syncErr
            ? row.status
            : derivedStatus === "" ||
                derivedStatus.toLowerCase().includes("pend") ||
                derivedStatus.toLowerCase().includes("espera") ||
                derivedStatus.toLowerCase().includes("curso") ||
                derivedStatus.toLowerCase().includes("progreso") ||
                derivedStatus.toLowerCase().includes("open") ||
                derivedStatus.toLowerCase().includes("todo") ||
                derivedStatus.toLowerCase().includes("nueva") ||
                derivedStatus.toLowerCase().includes("nuevo")
              ? "Completada"
              : row.status,
          submission_path: primary?.path ?? row.submission_path,
          submission_name:
            row.submission_name ?? primary?.name ?? "evidencia.pdf",
          submission_mime: primary?.mime ?? "application/pdf",
          submission_files: foundFiles as unknown as unknown,
          submitted_by_email: row.submitted_by_email ?? ownerEmail,
          description: buildEvidenceDescription(
            row.description,
            foundFiles,
            ownerEmail,
            row.submitted_at ?? new Date().toISOString()
          ),
        };
      })
    );
  }

  const assignments = sortByMostRecentMonthFirst((data ?? []).filter((row) => {
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
              : true;

    if (!passStatus) return false;

    const supervisorNeedle = normalizeEmail(supervisorFilter);
    if (supervisorNeedle) {
      const haystacks = [
        normalizeEmail((row as { assigned_to_email?: string | null }).assigned_to_email),
        normalizeEmail((row as { assigned_to?: string | null }).assigned_to),
      ];
      const match = haystacks.some((h) => h && h.includes(supervisorNeedle));
      if (!match) return false;
    }

    const isoFrom = (dateFrom ?? "").trim();
    const isoTo = (dateTo ?? "").trim();
    if (isoFrom || isoTo) {
      const candidates = [
        row.created_at,
        (row as { due_at?: string | null }).due_at,
        (row as { submitted_at?: string | null }).submitted_at,
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

    return true;
  }));

  return (
    <TaskPageContent
      role={role}
      currentUserId={user.id}
      currentUserEmail={user.email ?? undefined}
      sections={sections}
      statusFilter={statusFilter}
      dateFrom={dateFrom}
      dateTo={dateTo}
      supervisorFilter={supervisorFilter}
      userOptions={userOptions}
      error={error}
      errorParam={errorParam}
      messageParam={messageParam}
      assignments={assignments}
      basePath="/platform/task"
      onSubmit={submitWork}
      downloadBasePath="/platform/task/download"
      onSaveComment={saveComment}
      onDelete={deleteAssignment}
    />
  );
}

