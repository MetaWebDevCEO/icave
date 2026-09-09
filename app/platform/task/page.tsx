import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
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
  extractFileName,
  getUpdatePayload,
  isPdfBytes,
  isSchemaMismatchPostgres,
  listEvidenceInFolder,
  maxEvidenceFiles,
  maxSubmissionSizeBytes,
  normalizeEmail,
  parseSubmissionFiles,
  sanitizeFileName,
  stripLegacyEntregaLines,
  type SubmissionFile,
} from "@/lib/submission-files";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type AssignmentRow = TaskRow & { revisor_id?: string | null };

function getSearchParam(
  sp: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = sp[key];
  return typeof value === "string" ? value : undefined;
}

function extractEntregaPathFromDescription(description: string | null | undefined) {
  if (!description) return null;
  const match = /^\s*entrega:\s*(\S+)\s*$/im.exec(description);
  return match?.[1] ?? null;
}

function isSchemaMismatch(err: PostgrestError | null) {
  return isSchemaMismatchPostgres(err);
}

const MAX_SUBMISSION_SIZE_BYTES = maxSubmissionSizeBytes();
const MAX_EVIDENCE_FILES = maxEvidenceFiles();

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

    if (isSchemaMismatch(extended.error)) {
      const mid = await client
        .from("asignaciones")
        .select(selectFieldsMid)
        .ilike("assigned_to_email", userEmail)
        .order("due_at", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(200);

      if (!isSchemaMismatch(mid.error)) return mid;

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

    if (isSchemaMismatch(extended.error)) {
      const mid = await client
        .from("asignaciones")
        .select(selectFieldsMid)
        .order("due_at", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(200);

      if (!isSchemaMismatch(mid.error)) return mid;

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
    (row) =>
      parseSubmissionFiles(row).length === 0 &&
      (row.status ?? "").toLowerCase().includes("comp")
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
    if (isSchemaMismatch(err)) err = await tryPayload(withDesc(mid));
    if (isSchemaMismatch(err)) err = await tryPayload(withDesc(fallback));
    return err;
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

        const ownerUserId =
          role === "usuario"
            ? user.id
            : assignedUserIdByEmail.get(normalizeEmail(row.assigned_to_email));
        if (!ownerUserId) return row;

        const folder = `entregas/${ownerUserId}/${row.id}`;
        const foundFiles = await listEvidenceInFolder(
          storageClient,
          "asignaciones",
          folder
        );
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
        return {
          ...row,
          status: syncErr
            ? row.status
            : (row.status ?? "").trim().length > 0
              ? row.status
              : "Completada",
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

  const assignments = (data ?? []).filter((row) => {
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
  });

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
      .select("id, revisor_id, attachment_path, submission_path, assigned_to_email, submission_files, description")
      .eq("id", assignmentId)
      .maybeSingle();

    let row = verify.data as
      | {
          id: string;
          revisor_id?: string | null;
          attachment_path?: string | null;
          submission_path?: string | null;
          assigned_to_email?: string | null;
          submission_files?: unknown;
          description?: string | null;
        }
      | null;
    let verifyError = verify.error;

    if ((!row || verifyError) && admin && verifyClient !== admin) {
      const fallback = await admin
        .from("asignaciones")
        .select("id, revisor_id, attachment_path, submission_path, assigned_to_email, submission_files, description")
        .eq("id", assignmentId)
        .maybeSingle();
      row = fallback.data as
        | {
            id: string;
            revisor_id?: string | null;
            attachment_path?: string | null;
            submission_path?: string | null;
            assigned_to_email?: string | null;
            submission_files?: unknown;
            description?: string | null;
          }
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
    const toRemove: string[] = [];

    if (row.attachment_path) {
      toRemove.push(row.attachment_path);
    }

    const evFiles = parseSubmissionFiles(row);
    for (const ev of evFiles) {
      if (ev.path) toRemove.push(ev.path);
    }

    if (toRemove.length > 0) {
      await storageClient.storage
        .from("asignaciones")
        .remove(toRemove)
        .catch(() => null);
    }

    const assignedUserId = (() => {
      try {
        const p = row?.submission_path;
        if (p) {
          const parts = p.split("/");
          if (parts.length >= 3 && parts[0] === "entregas") return parts[1];
        }
      } catch {
        /* ignore */
      }
      return null;
    })();
    if (assignedUserId) {
      await cleanupFolder(storageClient, "asignaciones", `entregas/${assignedUserId}/${assignmentId}`);
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
    if (!assignmentId) {
      redirect("/platform/task?error=" + encodeURIComponent("Falta assignment_id."));
    }

    const uploadedFiles: File[] = [];
    const legacySingle = formData.get("file");
    if (legacySingle instanceof File && legacySingle.size > 0) {
      uploadedFiles.push(legacySingle);
    } else {
      const multiFiles = formData.getAll("files");
      for (const value of multiFiles) {
        if (value instanceof File && value.size > 0) {
          uploadedFiles.push(value);
        }
      }
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

      if (!isSchemaMismatch(extended.error)) return extended;

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

    const validatedBuffers: { file: File; ab: ArrayBuffer }[] = [];
    for (const f of uploadedFiles) {
      const ab = await f.arrayBuffer();
      const bytes = new Uint8Array(ab);
      if (!isPdfBytes(bytes)) {
        redirect(
          "/platform/task?error=" +
            encodeURIComponent("Uno de los archivos no parece ser un PDF válido.")
        );
      }
      validatedBuffers.push({ file: f, ab });
    }

    const uploadedEvidence: SubmissionFile[] = [];
    for (const { file, ab } of validatedBuffers) {
      const safeName =
        sanitizeFileName(file.name || "") ||
        `evidencia-${uploadedEvidence.length + 1}.pdf`;
      const objectPath = `${folderPath}/${safeName}`;
      const uploadBytes = new Uint8Array(ab) as unknown as BlobPart;
      const fileToUpload = new File([uploadBytes], safeName, {
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

  async function downloadSubmission(formData: FormData) {
    "use server";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
      redirect("/?error=" + encodeURIComponent("Configura Supabase primero (env vars)."));
    }

    const assignmentId = String(formData.get("assignment_id") ?? "").trim();
    const idxRaw = formData.get("idx");
    const idx = Number.isInteger(Number(idxRaw)) ? Math.max(0, Number(idxRaw)) : 0;

    if (!assignmentId) {
      redirect("/platform/task?error=" + encodeURIComponent("Falta assignment_id."));
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/");

    const role = await resolveRoleForUser(supabase, user.id);

    const admin =
      serviceKey && !serviceKey.includes("__REPLACE_ME__")
        ? createSupabaseAdminClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;

    type Row = {
      revisor_id?: string | null;
      assigned_to_email?: string | null;
      submission_path?: string | null;
      submission_name?: string | null;
      submission_mime?: string | null;
      submission_files?: unknown;
      description?: string | null;
    };

    const select =
      "id, revisor_id, assigned_to_email, submission_path, submission_name, submission_mime, submission_files, description";
    const rowA = await supabase
      .from("asignaciones")
      .select(select)
      .eq("id", assignmentId)
      .maybeSingle();

    let row: Row | null = rowA.data as Row | null;
    let rowError = rowA.error;

    if ((!row || rowError) && admin) {
      const rowB = await admin
        .from("asignaciones")
        .select(select)
        .eq("id", assignmentId)
        .maybeSingle();
      row = rowB.data as Row | null;
      rowError = rowB.error;
    }

    if (rowError) {
      redirect("/platform/task?error=" + encodeURIComponent(rowError.message));
    }
    if (!row) {
      redirect("/platform/task?error=" + encodeURIComponent("No se encontró la asignación."));
    }

    const files = parseSubmissionFiles(row);
    const chosen = files[idx] ?? files[0];
    if (!chosen) {
      redirect("/platform/task");
    }

    const userEmail = normalizeEmail(user.email);
    const assignedTo = normalizeEmail(row.assigned_to_email);
    const canAccess =
      (role === "usuario" && userEmail && assignedTo && userEmail === assignedTo) ||
      role === "revisor";

    if (!canAccess) {
      redirect("/platform/task?error=" + encodeURIComponent("No tienes permisos para descargar."));
    }

    const signedA = await supabase.storage
      .from("asignaciones")
      .createSignedUrl(chosen.path, 60);

    let signedUrl = signedA.data?.signedUrl ?? null;
    let signedError = signedA.error;

    if ((!signedUrl || signedError) && admin) {
      const signedB = await admin.storage
        .from("asignaciones")
        .createSignedUrl(chosen.path, 60);
      signedUrl = signedB.data?.signedUrl ?? null;
      signedError = signedB.error;
    }

    if (signedError || !signedUrl) {
      redirect(
        "/platform/task?error=" +
          encodeURIComponent(signedError?.message ?? "No se pudo generar el enlace.")
      );
    }

    let submissionName: string | undefined = chosen.name?.trim();
    if (!submissionName || submissionName.toLowerCase() === "entrega.pdf") {
      submissionName = extractFileName(chosen.path) ?? undefined;
    }
    submissionName = submissionName && submissionName.trim().length > 0
      ? submissionName
      : "evidencia.pdf";

    try {
      const resp = await fetch(signedUrl, { cache: "no-store" });
      if (!resp.ok) {
        redirect(
          "/platform/task?error=" +
            encodeURIComponent("No se pudo leer el archivo del almacenamiento.")
        );
      }
      const blob = await resp.blob();
      const bytes = await blob.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const fileName = encodeURIComponent(submissionName).replace(/'/g, "%27");
      const headers = new Headers({
        "Content-Type": (chosen.mime || blob.type || "application/pdf") + "; charset=utf-8",
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + fileName,
        "Cache-Control": "no-store, no-transform",
      });
      return new NextResponse(buffer, { status: 200, headers });
    } catch (err) {
      redirect(
        "/platform/task?error=" +
          encodeURIComponent("Error al descargar el archivo.")
      );
    }
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

