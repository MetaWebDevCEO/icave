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
import { parseAsCalendarDate } from "@/lib/calendar-date";
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
  stripLegacyEntregaLines,
  type SubmissionFile,
} from "@/lib/submission-files";

export const revalidate = 60;

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
  console.log("[bestEffortSync] payload full.submission_files:", JSON.stringify(full.submission_files));
  console.log("[bestEffortSync] payload full.submission_path:", full.submission_path);
    const withDesc = (p: Record<string, unknown>) => ({
      ...p,
      status: "Entregada",
      description: mergedDescription,
      submitted_at: syncedAt,
      submitted_by_email: submittedByEmail ?? null,
    });

  const tryPayload = async (payload: Record<string, unknown>) => {
    console.log("[bestEffortSync] intentando payload con claves:", Object.keys(payload));
    const first = await supabaseClient
      .from("asignaciones")
      .update(payload)
      .eq("id", assignmentId);
    if (!first.error) {
      console.log("[bestEffortSync] payload OK con claves:", Object.keys(payload));
      return null;
    }
    console.log("[bestEffortSync] error en payload:", first.error.message, "code:", first.error.code);
    if (!adminClient) return first.error;
    const second = await adminClient
      .from("asignaciones")
      .update(payload)
      .eq("id", assignmentId);
    if (second.error) {
      console.error("[bestEffortSync] error en admin payload:", second.error.message);
    } else {
      console.log("[bestEffortSync] admin payload OK");
    }
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

  // DEBUG: ver qué archivos llegan al servidor
  console.log("[submitWork] assignmentId:", assignmentId);
  console.log("[submitWork] archivos recibidos:", uploadedFiles.length, uploadedFiles.map(f => ({ name: f.name, size: f.size })));

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
            "Cada archivo no puede superar los 10 MB."
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
      .select("id, assigned_to_email, submission_path, submission_files, description")
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
    | {
        assigned_to_email?: string | null;
        submission_path?: string | null;
        submission_files?: unknown;
        description?: string | null;
      }
    | null;
  let verifyError = verifyA.error;

  if ((!verifyRow || verifyError) && admin) {
    const verifyB = await fetchVerify(admin);
    verifyRow = verifyB.data as
      | {
          assigned_to_email?: string | null;
          submission_path?: string | null;
          submission_files?: unknown;
          description?: string | null;
        }
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

  // Archivos ya existentes — se conservan y se suman los nuevos
  const existingFiles = parseSubmissionFiles(verifyRow ?? {});
  const maxFiles = maxEvidenceFiles();
  if (existingFiles.length + uploadedFiles.length > maxFiles) {
    redirect(
      "/platform/task?error=" +
        encodeURIComponent(
          `No puedes subir más de ${maxFiles} archivos. Ya tienes ${existingFiles.length} y seleccionaste ${uploadedFiles.length}.`
        )
    );
  }

  const folderPath = `entregas/${user.id}/${assignmentId}`;

  // NO limpiamos la carpeta: conservamos los archivos existentes.
  const uploadedEvidence: SubmissionFile[] = [...existingFiles];
  const usedNames = new Set(existingFiles.map((f) => (f.name || "").toLowerCase()));
  // Timestamp único para esta entrega — garantiza que NUNCA haya colisiones
  // de nombres aunque el usuario suba archivos con el mismo nombre.
  const ts = Date.now();
  for (let i = 0; i < uploadedFiles.length; i++) {
    const file = uploadedFiles[i];
    const rawName = sanitizeFileName(file.name || "") || `evidencia.pdf`;
    const dot = rawName.lastIndexOf(".");
    const stem = dot > 0 ? rawName.slice(0, dot) : rawName;
    const ext = dot > 0 ? rawName.slice(dot) : ".pdf";
    // Nombre único: stem-ts-idx.ext
    let safeName = `${stem}-${ts}-${i + 1}${ext}`;
    let counter = 1;
    while (usedNames.has(safeName.toLowerCase())) {
      safeName = `${stem}-${ts}-${i + 1}-${counter}${ext}`;
      counter++;
    }
    usedNames.add(safeName.toLowerCase());

    const objectPath = `${folderPath}/${safeName}`;
    console.log(`[submitWork] subiendo ${i + 1}/${uploadedFiles.length}: "${safeName}" -> ${objectPath}`);
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

  console.log("[submitWork] uploadedEvidence final:", JSON.stringify(uploadedEvidence, null, 2));

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
    console.error("[submitWork] error al guardar en DB:", updateError.message);
    redirect("/platform/task?error=" + encodeURIComponent(updateError.message));
  }

  console.log("[submitWork] entrega guardada correctamente con", uploadedEvidence.length, "archivos");
  redirect("/platform/task");
}

async function deleteEvidenceFile(formData: FormData) {
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
    redirect("/platform/task?error=" + encodeURIComponent("No tienes permisos para eliminar evidencias."));
  }

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const fileToRemove = String(formData.get("file_path") ?? "").trim();
  const userEmail = normalizeEmail(user.email);

  if (!assignmentId || !fileToRemove) {
    redirect("/platform/task?error=" + encodeURIComponent("Faltan datos para eliminar el archivo."));
  }

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  // Verificar que la asignación pertenece al usuario
  const verifyClient = admin ?? supabase;
  const verify = await verifyClient
    .from("asignaciones")
    .select("id, assigned_to_email, submission_files, submission_path, submission_name, submission_mime, description")
    .eq("id", assignmentId)
    .maybeSingle();

  if (verify.error || !verify.data) {
    redirect("/platform/task?error=" + encodeURIComponent("La asignación no existe."));
  }

  const row = verify.data as {
    assigned_to_email?: string | null;
    submission_files?: unknown;
    submission_path?: string | null;
    submission_name?: string | null;
    submission_mime?: string | null;
    description?: string | null;
  };

  const assignedTo = normalizeEmail(row.assigned_to_email);
  if (!assignedTo || assignedTo !== userEmail) {
    redirect("/platform/task?error=" + encodeURIComponent("Esta tarea no está asignada a tu usuario."));
  }

  const currentFiles = parseSubmissionFiles(row);
  const remaining = currentFiles.filter((f) => f.path !== fileToRemove);

  // Eliminar del storage
  try {
    await supabase.storage.from("asignaciones").remove([fileToRemove]).catch(() => null);
    if (admin) {
      await admin.storage.from("asignaciones").remove([fileToRemove]).catch(() => null);
    }
  } catch {
    /* ignore */
  }

  // Actualizar la DB
  const payload: Record<string, unknown> = {
    submission_files: remaining.length > 0 ? remaining : null,
  };

  if (remaining.length === 0) {
    payload.submission_path = null;
    payload.submission_name = null;
    payload.submission_mime = null;
    // Limpiar líneas de entrega de la descripción
    payload.description = stripLegacyEntregaLines(row.description);
  } else if (row.submission_path === fileToRemove) {
    // Si se eliminó el primario, promover el primero restante
    payload.submission_path = remaining[0].path;
    payload.submission_name = remaining[0].name;
    payload.submission_mime = remaining[0].mime ?? "application/pdf";
  }

  const updateA = await supabase
    .from("asignaciones")
    .update(payload)
    .eq("id", assignmentId);

  if (updateA.error && admin) {
    await admin.from("asignaciones").update(payload).eq("id", assignmentId);
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
  const priorityFilter = getSearchParam(sp, "priority") ?? "all";
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
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email, submission_path, submission_files, submitted_at, submitted_by_email";
  const selectFieldsExtended =
    "id, created_at, status, title, description, due_at, priority, revisor_id, assigned_to_email, submission_name, submission_path, submission_files, submitted_at, submitted_by_email";

  const fetchSupervisor = async (client: SupabaseClient) => {
    // NOTA: ordenamos POR created_at DESC (las más recientes PRIMERO) y ampliamos
    // el límite a 1000 para no cortar tareas creadas en octubre cuando hay cientos
    // de tareas antiguas con fecha límite vieja.
    // (antes order by due_at ASC + limit 200 excluía las nuevas con due_at futuro).
    const extended = await client
      .from("asignaciones")
      .select(selectFieldsExtended)
      .ilike("assigned_to_email", userEmail)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (isSchemaMismatchPostgres(extended.error)) {
      const mid = await client
        .from("asignaciones")
        .select(selectFieldsMid)
        .ilike("assigned_to_email", userEmail)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (!isSchemaMismatchPostgres(mid.error)) return mid;

      return client
        .from("asignaciones")
        .select(selectFieldsBase)
        .ilike("assigned_to_email", userEmail)
        .order("created_at", { ascending: false })
        .limit(1000);
    }

    return extended;
  };

  const fetchRevisor = async (client: SupabaseClient) => {
    const extended = await client
      .from("asignaciones")
      .select(selectFieldsExtended)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (isSchemaMismatchPostgres(extended.error)) {
      const mid = await client
        .from("asignaciones")
        .select(selectFieldsMid)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (!isSchemaMismatchPostgres(mid.error)) return mid;

      return client
        .from("asignaciones")
        .select(selectFieldsBase)
        .order("created_at", { ascending: false })
        .limit(1000);
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

        // NOTA: se eliminó el escaneo brute-force de TODAS las carpetas de
        // entregas/ (O(assignments × users)) porque era el cuello de botella
        // principal. Si el ownerUserId no se pudo resolver, simplemente se
        // salta la búsqueda en storage y se muestra la tarea sin evidencia.
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
              ? "Entregada"
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
    // =================================================================
    // 1) FILTRO DE STATUS — variantes comunes en español/inglés.
    //    (el CHECK constraint de la DB suele usar: Pendiente / En progreso / Completada,
    //     pero también aceptamos variantes como Asignada, Iniciada, Finalizada...)
    // =================================================================
    const status = (row.status ?? "").trim().toLowerCase();

    const isPending =
      status.includes("pend") ||   // Pendiente / Pending
      status.includes("asign") ||  // Asignada
      status.includes("abiert") || // Abierta / Abierto
      status.includes("inici") ||  // Iniciada (a veces se usa como "aún no terminada")
      status === "" ||             // vacío → se trata como pendiente
      status === "new" ||
      status.includes("nueva");

    const isProgress =
      status.includes("prog") ||    // Progreso / Progress
      status.includes("curso") ||   // En curso
      status.includes("inici") ||   // Iniciada
      status.includes("ejecu") ||   // En ejecución
      status.includes("desarr");    // En desarrollo

    const isCompleted =
      status.includes("comp") ||    // Completada / Completed
      status.includes("done") ||    // Done
      status.includes("termin") ||  // Terminada
      status.includes("final") ||   // Finalizada / Finalizada
      status.includes("cerrad") ||  // Cerrada
      status.includes("entreg");    // Entregada

    const passStatus =
      statusFilter === "all"
        ? true
        : statusFilter === "pending"
          ? isPending && !isCompleted
          : statusFilter === "progress"
            ? isProgress && !isCompleted
            : statusFilter === "completed"
              ? isCompleted
              : true;

    if (!passStatus) return false;

    // =================================================================
    // 2) FILTRO DE PRIORIDAD — compatible con los 3 valores EXACTOS
    //    del CHECK constraint: Urgente · Medio · No Urgente
    //    (importante: "No Urgente" contiene 'urg', así que lo detectamos ANTES)
    // =================================================================
    const priority = ((row as { priority?: string | null }).priority ?? "")
      .trim()
      .toLowerCase();
    const hasNoUrgente =
      priority.includes("no urg") ||
      priority.startsWith("no urg") ||
      priority.startsWith("nourg") ||
      priority.includes("baja") ||
      priority.includes("bajo") ||
      priority === "low" ||
      priority === "3";
    const isHighPriority =
      !hasNoUrgente &&
      (priority.startsWith("urg") ||
        priority.includes("alta") ||
        priority === "high" ||
        priority === "1");
    const isLowPriority =
      hasNoUrgente ||
      (!isHighPriority &&
        (priority.startsWith("baj") ||
          priority === "low" ||
          priority === "3"));
    const isMedPriority =
      !isHighPriority &&
      !isLowPriority &&
      (priority.includes("med") || priority === "medium" || priority === "2" || priority === "");
    const passPriority =
      priorityFilter === "all"
        ? true
        : priorityFilter === "urgent"
          ? isHighPriority
          : priorityFilter === "medium"
            ? isMedPriority
            : priorityFilter === "low"
              ? isLowPriority
              : true;

    if (!passPriority) return false;

    // =================================================================
    // 3) FILTRO POR SUPERVISOR / ASIGNADO (assigned_to_email)
    // =================================================================
    const supervisorNeedle = normalizeEmail(supervisorFilter);
    if (supervisorNeedle) {
      const haystacks = [
        normalizeEmail((row as { assigned_to_email?: string | null }).assigned_to_email),
        normalizeEmail((row as { assigned_to?: string | null }).assigned_to),
      ];
      const match = haystacks.some((h) => h && h.includes(supervisorNeedle));
      if (!match) return false;
    }

    // =================================================================
    // 4) FILTRO DE FECHAS.
    //    El usuario filtra en la UI la "Fecha límite" (due_at), y la
    //    tarjeta también muestra "Fecha límite: <due_at>". Así que el
    //    filtro de fecha PRINCIPAL es due_at. Solo si due_at es NULL
    //    hacemos fallback a created_at.
    //    NO usamos submitted_at en este filtro (no se muestra en la
    //    tarjeta como fecha límite, y causaba que "tareas de septiembre
    //    creadas en octubre se colaran al filtrar por octubre a pesar de due_at=septiembre).
    // =================================================================
    const isoFrom = (dateFrom ?? "").trim();
    const isoTo = (dateTo ?? "").trim();
    if (isoFrom || isoTo) {
      // Construimos fromTs / toTs en UTC para no desfase.
      const parseUtcDate = (yyyy_mm_dd: string): number | null => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyy_mm_dd);
        if (!m) return null;
        return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      };

      const fromTs = isoFrom ? parseUtcDate(isoFrom) : null;
      // Para "hasta" incluimos el final del día 23:59:59.999 UTC
      const toTs = isoTo
        ? (() => {
            const start = parseUtcDate(isoTo);
            if (start == null) return null;
            return start + 86_399_999; // 23h 59m 59.999s
          })()
        : null;

      if (fromTs == null && isoFrom) return true; // fecha-from inválida → no filtrar
      if (toTs == null && isoTo) return true;     // fecha-to inválida → no filtrar

      // Candidatos que participan en el filtro (AMBOS, SIEMPRE, para
      // resolver: "muéstrame tareas con fecha límite o creadas en octubre").
      // IMPORTANTE: NO incluimos submitted_at (fecha de entrega) para
      // evitar el colado de "tareas de sep creadas en sep pero entregadas en
      // oct que aparecen al filtrar oct a pesar de due_at=sep".
      const candidates: string[] = [];
      const due_at = (row as { due_at?: string | null }).due_at;
      if (due_at) candidates.push(due_at);
      if (row.created_at) candidates.push(row.created_at);

      if (candidates.length === 0) return false;

      const candidateTs = candidates
        .map((iso) => {
          const d = parseAsCalendarDate(iso);
          return d ? d.getTime() : null;
        })
        .filter((t): t is number => t != null);

      // Fallback defensivo: si NO se pudo parsear ninguna fecha de la fila,
      // NO la tiramos (devolvemos true). Evita que formatos de fecha atípicos
      // hagan desaparecer toda la pantalla.
      if (candidateTs.length === 0) return true;

      if (fromTs != null) {
        if (!candidateTs.some((t) => t >= fromTs)) return false;
      }
      if (toTs != null) {
        if (!candidateTs.some((t) => t <= toTs)) return false;
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
      priorityFilter={priorityFilter}
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
      onDeleteEvidence={deleteEvidenceFile}
    />
  );
}

