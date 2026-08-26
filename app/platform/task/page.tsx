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

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^\w.\-()+\s]/g, "").replace(/\s+/g, " ").trim();
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

function extractEntregaPathFromDescription(description: string | null | undefined) {
  if (!description) return null;
  const match = /^\s*entrega:\s*(\S+)\s*$/im.exec(description);
  return match?.[1] ?? null;
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
) {
  const folder = `entregas/${ownerUserId}/${assignmentId}`;
  const { data, error } = await client.storage.from("asignaciones").list(folder, {
    limit: 20,
    offset: 0,
  });

  if (error || !data || data.length === 0) return null;

  const exact = data.find((file) => file.name.toLowerCase() === "entrega.pdf");
  const pdf = exact ?? data.find((file) => file.name.toLowerCase().endsWith(".pdf"));
  if (!pdf) return null;

  return `${folder}/${pdf.name}`;
}

async function bestEffortSyncSubmission(
  supabase: SupabaseClient,
  admin: SupabaseClient | null,
  assignmentId: string,
  description: string | null | undefined,
  objectPath: string,
  submittedByEmail?: string | null,
  submittedAtISO?: string | null,
  submissionName?: string | null
) {
  const syncedAt = submittedAtISO ?? new Date().toISOString();
  const mergedDescription = upsertEntregaIntoDescription(
    description,
    objectPath,
    submittedByEmail ?? "supervisor",
    syncedAt
  );

  const fullPayload: Record<string, unknown> = {
    status: "Completada",
    description: mergedDescription,
    submission_path: objectPath,
    submitted_at: syncedAt,
    submitted_by_email: submittedByEmail ?? null,
    submission_name: submissionName ?? "entrega.pdf",
    submission_mime: "application/pdf",
  };

  const midPayload: Record<string, unknown> = {
    status: "Completada",
    description: mergedDescription,
    submission_path: objectPath,
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
    (row) => !row.submission_path && !extractEntregaPathFromDescription(row.description)
  );

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
        if (row.submission_path || extractEntregaPathFromDescription(row.description)) {
          return row;
        }

        const ownerUserId =
          role === "usuario"
            ? user.id
            : assignedUserIdByEmail.get(normalizeEmail(row.assigned_to_email));

        if (!ownerUserId) return row;

        const submissionPath = await findSubmissionInStorage(storageClient, ownerUserId, row.id);
        if (!submissionPath) return row;

        const syncError = await bestEffortSyncSubmission(
          supabase,
          admin,
          row.id,
          row.description,
          submissionPath,
          row.submitted_by_email ?? normalizeEmail(row.assigned_to_email),
          row.submitted_at,
          row.submission_name ?? "entrega.pdf"
        );

        return {
          ...row,
          status:
            !syncError &&
            (row.status ?? "").trim().length > 0 &&
            ((row.status ?? "").toLowerCase().includes("comp") ||
              (row.status ?? "").toLowerCase().includes("done"))
              ? row.status
              : "Completada",
          submission_path: submissionPath,
          submission_name: row.submission_name ?? "entrega.pdf",
          submitted_by_email:
            row.submitted_by_email ?? normalizeEmail(row.assigned_to_email) ?? null,
          description: upsertEntregaIntoDescription(
            row.description,
            submissionPath,
            (row.submitted_by_email ?? normalizeEmail(row.assigned_to_email)) || "supervisor",
            row.submitted_at ?? new Date().toISOString()
          ),
        };
      })
    );
  }

  const assignments = (data ?? []).filter((row) => {
    if (statusFilter === "all") return true;
    const status = (row.status ?? "").trim().toLowerCase();
    if (statusFilter === "pending") return status.includes("pend");
    if (statusFilter === "progress") return status.includes("prog") || status.includes("curso");
    if (statusFilter === "completed") return status.includes("comp") || status.includes("done");
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
      .select("id, revisor_id, attachment_path")
      .eq("id", assignmentId)
      .maybeSingle();

    let row = verify.data as
      | { id: string; revisor_id?: string | null; attachment_path?: string | null }
      | null;
    let verifyError = verify.error;

    if ((!row || verifyError) && admin && verifyClient !== admin) {
      const fallback = await admin
        .from("asignaciones")
        .select("id, revisor_id, attachment_path")
        .eq("id", assignmentId)
        .maybeSingle();
      row = fallback.data as
        | { id: string; revisor_id?: string | null; attachment_path?: string | null }
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

    if (row.attachment_path) {
      const storageClient = admin ?? supabase;
      await storageClient.storage
        .from("asignaciones")
        .remove([row.attachment_path])
        .catch(() => null);
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

    const safeName = sanitizeFileName(name) || "archivo.pdf";
    const objectPath = `entregas/${user.id}/${assignmentId}/entrega.pdf`;

    const fileToUpload = new File([bytes], safeName, { type: "application/pdf" });

    const uploadA = await supabase.storage.from("asignaciones").upload(objectPath, fileToUpload, {
      contentType: "application/pdf",
      upsert: true,
    });

    if (uploadA.error && admin) {
      const uploadB = await admin.storage.from("asignaciones").upload(objectPath, fileToUpload, {
        contentType: "application/pdf",
        upsert: true,
      });

      if (uploadB.error) {
        redirect("/platform/task?error=" + encodeURIComponent(uploadB.error.message));
      }
    } else if (uploadA.error) {
      redirect("/platform/task?error=" + encodeURIComponent(uploadA.error.message));
    }

    const updateError = await bestEffortSyncSubmission(
      supabase,
      admin,
      assignmentId,
      verifyRow?.description,
      objectPath,
      userEmail,
      new Date().toISOString(),
      safeName
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

    const select = "id, revisor_id, assigned_to_email, submission_path, description";
    const rowA = await supabase
      .from("asignaciones")
      .select(select)
      .eq("id", assignmentId)
      .maybeSingle();

    let row = rowA.data as
      | { revisor_id?: string | null; assigned_to_email?: string | null; submission_path?: string | null; description?: string | null }
      | null;
    let rowError = rowA.error;

    if ((!row || rowError) && admin) {
      const rowB = await admin
        .from("asignaciones")
        .select(select)
        .eq("id", assignmentId)
        .maybeSingle();
      row = rowB.data as
        | { revisor_id?: string | null; assigned_to_email?: string | null; submission_path?: string | null; description?: string | null }
        | null;
      rowError = rowB.error;
    }

    if (rowError) {
      redirect("/platform/task?error=" + encodeURIComponent(rowError.message));
    }
    if (!row) {
      redirect("/platform/task?error=" + encodeURIComponent("No se encontró la asignación."));
    }
    const path = row?.submission_path ?? extractEntregaPathFromDescription(row?.description);
    if (!path) {
      redirect("/platform/task");
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
      .createSignedUrl(path, 60);

    let signedUrl = signedA.data?.signedUrl ?? null;
    let signedError = signedA.error;

    if ((!signedUrl || signedError) && admin) {
      const signedB = await admin.storage
        .from("asignaciones")
        .createSignedUrl(path, 60);
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
      error={error}
      errorParam={errorParam}
      messageParam={messageParam}
      assignments={assignments}
      basePath="/platform/task"
      onSubmit={submitWork}
      onDownload={downloadSubmission}
      onSaveComment={saveComment}
      onDelete={deleteAssignment}
    />
  );
}

