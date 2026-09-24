"use server";

import type { SupervisorOption } from "./quick-asignar-fila";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

const DEFAULT_AVATAR_BUCKET = "avatars";
const AVATAR_EXPIRES_SECONDS = 60 * 60;

function deriveDisplayName(
  email: string | null | undefined,
  metadata: Record<string, unknown>
): string {
  const metadataName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.display_name === "string"
        ? metadata.display_name
        : typeof metadata.name === "string"
          ? metadata.name
          : "";

  if (metadataName.trim()) return metadataName.trim();
  if (!email) return "Sin nombre";

  const localPart = email.split("@")[0] ?? "supervisor";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function setMatrizSupervisor(params: {
  displayId: number;
  supervisorUserId: string | null;
}): Promise<
  | { ok: true; supervisor: SupervisorOption | null }
  | { ok: false; error: string }
> {
  const { displayId, supervisorUserId } = params;
  try {
    if (!Number.isInteger(displayId) || displayId <= 0) {
      return { ok: false, error: "Fila inválida." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sesión inválida." };

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (!url || !serviceKey || serviceKey.includes("__REPLACE_ME__")) {
      return { ok: false, error: "Falta configuración de Supabase." };
    }
    const admin = createSupabaseAdmin(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const displayIdSafe = Number(displayId);
    if (!Number.isInteger(displayIdSafe) || displayIdSafe < 1) {
      return { ok: false, error: "Fila inválida (debe ser entero positivo)." };
    }

    // Comprobamos que la tabla exista y se pueda consultar.
    // Si el error es 42P01 (relation does not exist), informamos de la migración.
    // Cualquier otro error (RLS 42501, 42P10, schema mismatch, timeout...) lo propagamos
    // como mensaje claro para que aparezca en el modal de selección y el usuario
    // lo vea inmediatamente (antes se ignoraba y parecía "no se guarda").
    try {
      const probe = await admin
        .from("matriz_supervisor_asignado")
        .select("matriz_fila_id")
        .limit(1)
        .maybeSingle();
      const err = probe.error as
        | null
        | { code?: string; message?: string }
        | undefined;
      if (err) {
        const msg = err.message ?? "Error en la consulta.";
        if (err.code === "42P01" || /relation.*does not exist/i.test(msg)) {
          return {
            ok: false,
            error:
              "Falta crear la tabla 'matriz_supervisor_asignado' en Supabase. Ejecuta la migración en SQL Editor (supabase/migrations/20260923070000_create_matriz_supervisor_asignado.sql) y vuelve a intentar.",
          };
        }
        return {
          ok: false,
          error: `DB (probe): ${msg}${err.code ? ` (${err.code})` : ""}`,
        };
      }
    } catch (err) {
      return {
        ok: false,
        error:
          "DB (probe/catch): " +
          (err instanceof Error ? err.message : "Error desconocido."),
      };
    }

    // Caso 1: Desasignar
    if (!supervisorUserId) {
      const q = await admin
        .from("matriz_supervisor_asignado")
        .delete()
        .eq("matriz_fila_id", displayIdSafe);
      if (q.error) {
        return {
          ok: false,
          error: `DB: ${q.error.message}${q.error.code ? ` (${q.error.code})` : ""}`,
        };
      }
      revalidatePath("/platform/documentos");
      return { ok: true, supervisor: null };
    }

    // Caso 2: Asignar. Confirmamos que existe en Auth.
    const lu = await admin.auth.admin.getUserById(supervisorUserId);
    const u = lu?.data?.user ?? null;
    if (!u) {
      return { ok: false, error: "El usuario supervisor no existe en Auth." };
    }
    const meta =
      u.user_metadata && typeof u.user_metadata === "object"
        ? (u.user_metadata as Record<string, unknown>)
        : {};
    const displayName = deriveDisplayName(u.email ?? null, meta);
    const bucket =
      typeof meta.avatar_bucket === "string" && meta.avatar_bucket.trim()
        ? meta.avatar_bucket.trim()
        : DEFAULT_AVATAR_BUCKET;
    const path =
      typeof meta.avatar_path === "string" && meta.avatar_path.trim()
        ? meta.avatar_path.trim()
        : "";
    let avatarUrl: string | null =
      typeof (meta as { avatar_url?: unknown }).avatar_url === "string"
        ? (meta as { avatar_url: string }).avatar_url
        : typeof (meta as { picture?: unknown }).picture === "string"
          ? (meta as { picture: string }).picture
          : null;
    if (!avatarUrl && path) {
      try {
        const r = await admin.storage
          .from(bucket)
          .createSignedUrl(path, AVATAR_EXPIRES_SECONDS);
        if (r?.data?.signedUrl && !r.error) avatarUrl = r.data.signedUrl;
      } catch {
        /* ignore */
      }
    }

    const supervisorOption: SupervisorOption = {
      id: u.id,
      userId: u.id,
      email: u.email ?? null,
      displayName,
      avatarUrl,
    };

    const upsert = await admin
      .from("matriz_supervisor_asignado")
      .upsert(
        {
          matriz_fila_id: displayIdSafe,
          supervisor_user_id: supervisorUserId,
          assigned_by: user.id,
        },
        { onConflict: "matriz_fila_id" }
      );
    if (upsert.error) {
      return {
        ok: false,
        error: `DB: ${upsert.error.message}${
          upsert.error.code ? ` (${upsert.error.code})` : ""
        }`,
      };
    }
    revalidatePath("/platform/documentos");
    return { ok: true, supervisor: supervisorOption };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Error desconocido al guardar.",
    };
  }
}
