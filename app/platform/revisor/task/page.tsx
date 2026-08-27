import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TaskPageContent } from "@/app/platform/task/task-page-content";
import type { TaskRow } from "@/app/platform/task/task-board";
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

const BASE_PATH = "/platform/revisor/task";

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

  const displayName =
    pdf.name.toLowerCase() !== "entrega.pdf" ? pdf.name : pdf.name;

  return {
    path: `${folder}/${pdf.name}`,
    name: displayName,
  };
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

export default async function RevisorTaskPage({
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

  if (role !== "revisor") {
    redirect("/platform?error=" + encodeURIComponent("Esta sección es sólo para revisores."));
  }

  const sections = buildSections(role);
  const sp = await searchParams;
  const statusFilter = getSearchParam(sp, "status") ?? "all";
  const errorParam = getSearchParam(sp, "error");
  const messageParam = getSearchParam(sp, "message");

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

  const rows = data ?? [];
  const needsStorageLookup = rows.some(
    (row) => !row.submission_path && !extractEntregaPathFromDescription(row.description)
  );

  if (needsStorageLookup && admin) {
    const storageClient = admin;
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const assignedUserIdByEmail = new Map(
      (listed.data?.users ?? [])
        .map((candidate) => [normalizeEmail(candidate.email), candidate.id] as const)
        .filter(([email]) => email.length > 0)
    );

    data = await Promise.all(
      rows.map(async (row) => {
        if (row.submission_path || extractEntregaPathFromDescription(row.description)) {
          return row;
        }

        const ownerUserId = assignedUserIdByEmail.get(normalizeEmail(row.assigned_to_email));
        if (!ownerUserId) return row;

        const found = await findSubmissionInStorage(storageClient, ownerUserId, row.id);
        if (!found) return row;

        const submissionPath = found.path;
        const submissionName = found.name;

        const syncError = await bestEffortSyncSubmission(
          supabase,
          admin,
          row.id,
          row.description,
          submissionPath,
          row.submitted_by_email ?? normalizeEmail(row.assigned_to_email),
          row.submitted_at,
          row.submission_name ?? submissionName
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
          submission_name: row.submission_name ?? submissionName,
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
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("No tienes permisos para eliminar."));
    }

    const assignmentId = String(formData.get("assignment_id") ?? "").trim();
    if (!assignmentId) {
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("Falta assignment_id."));
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
        `${BASE_PATH}?error=` +
          encodeURIComponent(verifyError?.message ?? "La asignación no existe.")
      );
    }

    if (!row.revisor_id || row.revisor_id !== user.id) {
      redirect(
        `${BASE_PATH}?error=` +
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
        redirect(`${BASE_PATH}?error=` + encodeURIComponent(fallback.error.message));
      }
    } else if (deleted.error) {
      redirect(`${BASE_PATH}?error=` + encodeURIComponent(deleted.error.message));
    }

    revalidatePath(BASE_PATH);
    redirect(`${BASE_PATH}?message=` + encodeURIComponent("Asignación eliminada."));
  }

  async function submitWork(_formData: FormData) {
    "use server";
    redirect(`${BASE_PATH}?error=` + encodeURIComponent("Sólo los supervisores entregan tareas."));
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
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("Falta assignment_id."));
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

    const select = "id, revisor_id, assigned_to_email, submission_path, submission_name, description";
    const rowA = await supabase
      .from("asignaciones")
      .select(select)
      .eq("id", assignmentId)
      .maybeSingle();

    let row = rowA.data as
      | { revisor_id?: string | null; assigned_to_email?: string | null; submission_path?: string | null; submission_name?: string | null; description?: string | null }
      | null;
    let rowError = rowA.error;

    if ((!row || rowError) && admin) {
      const rowB = await admin
        .from("asignaciones")
        .select(select)
        .eq("id", assignmentId)
        .maybeSingle();
      row = rowB.data as
        | { revisor_id?: string | null; assigned_to_email?: string | null; submission_path?: string | null; submission_name?: string | null; description?: string | null }
        | null;
      rowError = rowB.error;
    }

    if (rowError) {
      redirect(`${BASE_PATH}?error=` + encodeURIComponent(rowError.message));
    }
    if (!row) {
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("No se encontró la asignación."));
    }
    const path = row?.submission_path ?? extractEntregaPathFromDescription(row?.description);
    if (!path) {
      redirect(`${BASE_PATH}`);
    }

    const canAccess = role === "revisor";

    if (!canAccess) {
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("No tienes permisos para descargar."));
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
        `${BASE_PATH}?error=` +
          encodeURIComponent(signedError?.message ?? "No se pudo generar el enlace.")
      );
    }

    const extractFileName = (p: string) => {
      const lastSlash = p.lastIndexOf("/");
      return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
    };

    let submissionName = (row as { submission_name?: string | null } | null)?.submission_name?.trim();
    if (!submissionName || submissionName.toLowerCase() === "entrega.pdf") {
      submissionName = extractFileName(path);
    }
    submissionName = submissionName && submissionName.trim().length > 0
      ? submissionName
      : "entrega.pdf";

    try {
      const resp = await fetch(signedUrl, { cache: "no-store" });
      if (!resp.ok) {
        redirect(
          `${BASE_PATH}?error=` +
            encodeURIComponent("No se pudo leer el archivo del almacenamiento.")
        );
      }
      const blob = await resp.blob();
      const bytes = await blob.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const fileName = encodeURIComponent(submissionName).replace(/'/g, "%27");
      const headers = new Headers({
        "Content-Type": (blob.type || "application/pdf") + "; charset=utf-8",
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + fileName,
        "Cache-Control": "no-store, no-transform",
      });
      return new NextResponse(buffer, { status: 200, headers });
    } catch (err) {
      redirect(
        `${BASE_PATH}?error=` +
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
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("Falta assignment_id."));
    }
    if (!comment) {
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("Comentario vacío."));
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("Sesión inválida."));
    }

    const role = await resolveRoleForUser(supabase, user.id);
    if (role !== "revisor") {
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("No tienes permisos para comentar."));
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
      redirect(`${BASE_PATH}?error=` + encodeURIComponent(rowError.message));
    }
    if (!row || row.revisor_id !== user.id) {
      redirect(`${BASE_PATH}?error=` + encodeURIComponent("Solo puedes comentar tus asignaciones."));
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
          `${BASE_PATH}?error=` +
            encodeURIComponent(
              "Faltan columnas para guardar el comentario (reviewer_comment, reviewer_comment_at)."
            )
        );
      }

      redirect(`${BASE_PATH}?error=` + encodeURIComponent(updateError.message));
    }

    redirect(`${BASE_PATH}?message=` + encodeURIComponent("Comentario enviado."));
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
      basePath={BASE_PATH}
      onSubmit={submitWork}
      downloadBasePath={`${BASE_PATH}/download`}
      onSaveComment={saveComment}
      onDelete={deleteAssignment}
    />
  );
}
