"use server";

import { revalidatePath } from "next/cache";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { resolveRoleForUser } from "@/lib/platform-roles";

/**
 * Valores EXACTOS que acepta el CHECK constraint
 * `asignaciones_priority_check`. Cualquier otra variante falla.
 */
type PriorityValue = "Urgente" | "Medio" | "No Urgente";

export type UpdateAssignmentResult =
  | { ok: true }
  | { ok: false; error: string };

/** Normaliza cualquier variante de prioridad al literal exacto de la DB. */
function normalizePriorityValue(input: string): PriorityValue | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  // "No Urgente" contiene "urg", así que se evalúa primero.
  if (value.includes("no urg") || value.startsWith("baj") || value.includes("low") || value === "3") {
    return "No Urgente";
  }
  if (value.includes("urg") || value.includes("alt") || value === "high" || value === "1") {
    return "Urgente";
  }
  if (value.includes("med") || value === "medium" || value === "2") {
    return "Medio";
  }
  return null;
}

/**
 * `due_at` es una columna DATE, por lo que se guarda en formato `YYYY-MM-DD`
 * (misma convención usada al crear la asignación).
 */
function normalizeDueAt(input: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Reemplaza las líneas de metadatos `[Vence]` y `[Prioridad]` del encabezado
 * que genera el formulario de asignación, para que la descripción no quede
 * contradiciendo a las columnas actualizadas.
 */
function syncDescriptionMeta(
  description: string | null | undefined,
  dueAtDate: string,
  priority: PriorityValue
): string | null {
  const text = description ?? "";
  if (!/^\s*\[(vence|prioridad)\]/im.test(text)) return null;

  const updated = text
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*\[vence\]/i.test(line)) return `[Vence] ${dueAtDate}`;
      if (/^\s*\[prioridad\]/i.test(line)) return `[Prioridad] ${priority}`;
      return line;
    })
    .join("\n");

  return updated === text ? null : updated;
}

export async function updateAssignment(
  formData: FormData
): Promise<UpdateAssignmentResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    return { ok: false, error: "Configura Supabase primero (env vars)." };
  }

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) return { ok: false, error: "Falta assignment_id." };

  const priority = normalizePriorityValue(String(formData.get("priority") ?? ""));
  if (!priority) return { ok: false, error: "Selecciona una prioridad válida." };

  const dueAt = normalizeDueAt(String(formData.get("due_at") ?? ""));
  if (!dueAt) return { ok: false, error: "Selecciona una fecha de entrega válida." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión inválida." };

  const role = await resolveRoleForUser(supabase, user.id, { email: user.email ?? null });
  if (role !== "revisor") {
    return { ok: false, error: "No tienes permisos para editar asignaciones." };
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
    .select("id, description")
    .eq("id", assignmentId)
    .maybeSingle();

  if (current.error || !current.data) {
    return {
      ok: false,
      error: current.error?.message ?? "La asignación no existe.",
    };
  }

  const payload: Record<string, unknown> = {
    priority,
    due_at: dueAt,
  };

  const syncedDescription = syncDescriptionMeta(
    (current.data as { description?: string | null }).description,
    dueAt,
    priority
  );
  if (syncedDescription !== null) payload.description = syncedDescription;

  const tryUpdate = async (client: SupabaseClient) =>
    client.from("asignaciones").update(payload).eq("id", assignmentId);

  let updated = await tryUpdate(supabase);
  if (updated.error && admin) {
    updated = await tryUpdate(admin);
  }

  if (updated.error) {
    return { ok: false, error: updated.error.message };
  }

  revalidatePath("/platform/task");
  revalidatePath("/platform/revisor/task");
  return { ok: true };
}
