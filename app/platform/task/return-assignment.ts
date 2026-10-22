"use server";

import { revalidatePath } from "next/cache";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { resolveRoleForUser } from "@/lib/platform-roles";
import { parseSubmissionFiles } from "@/lib/submission-files";

export type ReturnToPendingResult =
  | { ok: true; notified: boolean }
  | { ok: false; error: string };

/**
 * Envía la notificación al supervisor dueño de la actividad.
 * Es "best effort": si la tabla `notificaciones` todavía no existe,
 * la devolución de la actividad NO se bloquea.
 */
async function notifySupervisor(
  client: SupabaseClient,
  input: {
    email: string | null;
    title: string | null;
    assignmentId: string;
    reason: string;
  }
): Promise<boolean> {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) return false;

  try {
    const { error } = await client.from("notificaciones").insert({
      user_email: email,
      type: "actividad_devuelta",
      title: "Actividad devuelta a pendiente",
      body: `${input.title ?? "Actividad"} — Motivo: ${input.reason}`,
      assignment_id: input.assignmentId,
      href: "/platform/task?status=pending",
    });
    if (error) {
      console.error("[returnAssignmentToPending] notificación:", error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[returnAssignmentToPending] notificación:", error);
    return false;
  }
}

/**
 * Regresa una actividad entregada a "Pendiente" cuando el revisor detecta
 * que algo no está correcto. Conserva la evidencia ya subida por el
 * supervisor y guarda el motivo en la retroalimentación.
 */
export async function returnAssignmentToPending(
  formData: FormData
): Promise<ReturnToPendingResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    return { ok: false, error: "Configura Supabase primero (env vars)." };
  }

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) return { ok: false, error: "Falta assignment_id." };

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "Escribe el motivo de la devolución." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión inválida." };

  const role = await resolveRoleForUser(supabase, user.id, { email: user.email ?? null });
  if (role !== "revisor") {
    return { ok: false, error: "Solo el revisor puede devolver la actividad." };
  }

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  const readClient: SupabaseClient = admin ?? supabase;
  const current = await readClient
    .from("asignaciones")
    .select("id, title, assigned_to_email, submission_path, submission_files")
    .eq("id", assignmentId)
    .maybeSingle();

  if (current.error || !current.data) {
    return {
      ok: false,
      error: current.error?.message ?? "La asignación no existe.",
    };
  }

  const row = current.data as {
    id: string;
    title?: string | null;
    assigned_to_email?: string | null;
    submission_path?: string | null;
    submission_files?: unknown;
  };

  const hasEvidence =
    parseSubmissionFiles(row).length > 0 ||
    Boolean((row.submission_path ?? "").trim());
  if (!hasEvidence) {
    return {
      ok: false,
      error: "Esta actividad todavía no tiene una entrega que devolver.",
    };
  }

  const payload: Record<string, unknown> = {
    status: "Pendiente",
    reviewer_comment: reason,
    reviewer_comment_at: new Date().toISOString(),
  };

  const tryUpdate = async (client: SupabaseClient) =>
    client.from("asignaciones").update(payload).eq("id", assignmentId);

  let updated = await tryUpdate(supabase);
  if (updated.error && admin) updated = await tryUpdate(admin);
  if (updated.error) return { ok: false, error: updated.error.message };

  const notified = await notifySupervisor(admin ?? supabase, {
    email: row.assigned_to_email ?? null,
    title: row.title ?? null,
    assignmentId,
    reason,
  });

  revalidatePath("/platform/task");
  revalidatePath("/platform/revisor/task");
  revalidatePath("/platform/settings/notificaciones");
  revalidatePath("/platform/settings/notificacion");

  return { ok: true, notified };
}
