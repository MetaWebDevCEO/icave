"use server";

import type { SupervisorOption } from "./quick-asignar-fila";
import {
  createClient as createSupabaseAdmin,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { cleanupFolder } from "@/lib/submission-files";

const DEFAULT_AVATAR_BUCKET = "avatars";
const AVATAR_EXPIRES_SECONDS = 60 * 60;

/** Bucket donde viven las evidencias de las asignaciones. */
const EVIDENCIAS_BUCKET = "asignaciones";

/** Filas base del catálogo: 1..64 son posiciones fijas de la matriz. */
const BASE_MATRIZ_ROWS = 64;

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

/**
 * Obtiene el número de fila de matriz al que pertenece una asignación.
 * Mismo criterio que la página del Archivero: primero el marcador
 * `[Matriz] #N` de la descripción y, como respaldo, el título `#N · …`.
 */
function filaDesdeAsignacion(
  description: unknown,
  title: unknown
): number | null {
  const textoDescripcion = typeof description === "string" ? description : "";
  const textoTitulo = typeof title === "string" ? title : "";

  const marcador = /\[matriz\]\s*#\s*(\d+)/i.exec(textoDescripcion);
  if (marcador) {
    const fila = Number(marcador[1]);
    if (Number.isInteger(fila) && fila > 0) return fila;
  }

  const porTitulo = /^\s*(?:Actividad\s*#|#)\s*(\d+)\s*(?:·|$)/i.exec(textoTitulo);
  if (porTitulo) {
    const fila = Number(porTitulo[1]);
    if (Number.isInteger(fila) && fila > 0) return fila;
  }

  return null;
}

/** Resuelve el id de Auth del supervisor a partir de su correo. */
async function resolveSupervisorUserId(
  admin: SupabaseClient | null,
  email: string | null
): Promise<string | null> {
  const objetivo = (email ?? "").trim().toLowerCase();
  if (!objetivo || !admin) return null;
  try {
    const listado = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
    for (const u of listado.data?.users ?? []) {
      if ((u.email ?? "").trim().toLowerCase() === objetivo) return u.id;
    }
  } catch {
    /* sin acceso a listUsers: se intenta la búsqueda por carpetas */
  }
  return null;
}

/**
 * Borra los archivos de evidencia de una asignación:
 * el `attachment_path` suelto y la carpeta `entregas/{supervisorId}/{id}`.
 */
async function borrarEvidencias(
  client: SupabaseClient,
  admin: SupabaseClient | null,
  row: {
    id: string;
    attachment_path: string | null;
    assigned_to_email: string | null;
  }
) {
  if (row.attachment_path) {
    await client.storage
      .from(EVIDENCIAS_BUCKET)
      .remove([row.attachment_path])
      .catch(() => null);
  }

  const supervisorUserId = await resolveSupervisorUserId(
    admin,
    row.assigned_to_email
  );
  if (supervisorUserId) {
    await cleanupFolder(
      client,
      EVIDENCIAS_BUCKET,
      `entregas/${supervisorUserId}/${row.id}`
    );
    return;
  }

  // Sin id de supervisor: recorremos las carpetas de entregas.
  try {
    const root = await client.storage
      .from(EVIDENCIAS_BUCKET)
      .list("entregas", { limit: 500, offset: 0 });
    for (const folder of root.data ?? []) {
      if (folder.id) continue;
      await cleanupFolder(
        client,
        EVIDENCIAS_BUCKET,
        `entregas/${folder.name}/${row.id}`
      );
    }
  } catch {
    /* no se pudo limpiar entregas: seguimos con el borrado */
  }
}

/**
 * Elimina TODA la actividad de una fila de la matriz:
 *  - la(s) asignación(es) creada(s) desde esa fila (registro en `asignaciones`),
 *  - sus evidencias en Storage (bucket `asignaciones`),
 *  - el supervisor persistido en `matriz_supervisor_asignado`,
 *  - la propia fila de la matriz (se vacía si es una fila base 1..64, o se
 *    borra por completo si fue creada desde el Archivero, id > 64).
 */
export async function deleteMatrizActividad(params: {
  displayId: number;
}): Promise<
  | { ok: true; asignacionesEliminadas: number; filaEliminada: boolean }
  | { ok: false; error: string }
> {
  const { displayId } = params;
  try {
    if (!Number.isInteger(displayId) || displayId < 1) {
      return { ok: false, error: "Fila inválida." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sesión inválida." };

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const adminConfigurado =
      !!url && !!serviceKey && !serviceKey.includes("__REPLACE_ME__");

    // El service role evita el RLS; si no está configurado, se usa la sesión
    // del usuario (mismo criterio que el resto de acciones de este módulo).
    const admin = adminConfigurado
      ? createSupabaseAdmin(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
    const client = admin ?? supabase;

    // ---------- 1. Asignaciones creadas desde esta fila ----------
    const consulta = await client
      .from("asignaciones")
      .select("id, title, description, attachment_path, assigned_to_email, created_at")
      .ilike("description", "%[Tarea creada por revisor]%")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (consulta.error) {
      return {
        ok: false,
        error: `DB: ${consulta.error.message}${
          consulta.error.code ? ` (${consulta.error.code})` : ""
        }`,
      };
    }

    const vinculadas = (
      (consulta.data ?? []) as Array<{
        id?: unknown;
        title?: unknown;
        description?: unknown;
        attachment_path?: unknown;
        assigned_to_email?: unknown;
      }>
    ).filter(
      (row) => filaDesdeAsignacion(row.description, row.title) === displayId
    );

    let asignacionesEliminadas = 0;
    for (const row of vinculadas) {
      const id =
        typeof row.id === "string"
          ? row.id
          : row.id != null
            ? String(row.id)
            : "";
      if (!id) continue;

      await borrarEvidencias(client, admin, {
        id,
        attachment_path:
          typeof row.attachment_path === "string" ? row.attachment_path : null,
        assigned_to_email:
          typeof row.assigned_to_email === "string"
            ? row.assigned_to_email
            : null,
      });

      const borrada = await client.from("asignaciones").delete().eq("id", id);
      if (borrada.error) {
        const fallback =
          admin && client !== admin
            ? await admin.from("asignaciones").delete().eq("id", id)
            : null;
        const errorFinal = fallback ? fallback.error : borrada.error;
        if (errorFinal) {
          return {
            ok: false,
            error: `DB: ${errorFinal.message}${
              errorFinal.code ? ` (${errorFinal.code})` : ""
            }`,
          };
        }
      }
      asignacionesEliminadas += 1;
    }

    // ---------- 2. Supervisor persistido (si existía) ----------
    const desvinculado = await client
      .from("matriz_supervisor_asignado")
      .delete()
      .eq("matriz_fila_id", displayId);
    if (desvinculado.error && !/does not exist|schema cache/i.test(desvinculado.error.message)) {
      return {
        ok: false,
        error: `DB: ${desvinculado.error.message}${
          desvinculado.error.code ? ` (${desvinculado.error.code})` : ""
        }`,
      };
    }

    // ---------- 3. La fila de la matriz ----------
    let filaEliminada = false;
    if (displayId > BASE_MATRIZ_ROWS) {
      // Actividad creada desde el Archivero: se borra la fila completa.
      const borrada = await client
        .from("matriz")
        .delete()
        .eq("id", displayId)
        .select("id");
      if (borrada.error) {
        return {
          ok: false,
          error: `DB: ${borrada.error.message}${
            borrada.error.code ? ` (${borrada.error.code})` : ""
          }`,
        };
      }
      filaEliminada = (borrada.data ?? []).length > 0;
    } else {
      const vaciada = await client
        .from("matriz")
        .update({ actividad: "", frecuencia: "" })
        .eq("id", displayId)
        .select("id");
      if (vaciada.error) {
        return {
          ok: false,
          error: `DB: ${vaciada.error.message}${
            vaciada.error.code ? ` (${vaciada.error.code})` : ""
          }`,
        };
      }
      filaEliminada = (vaciada.data ?? []).length > 0;
    }

    if (!filaEliminada) {
      return {
        ok: false,
        error: `La fila #${displayId} no existe en la tabla matriz (o no tienes permiso para modificarla).`,
      };
    }

    revalidatePath("/platform/documentos");
    revalidatePath("/platform/task");
    revalidatePath("/platform/revisor/task");
    return { ok: true, asignacionesEliminadas, filaEliminada };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Error desconocido al eliminar.",
    };
  }
}

/**
 * Renombra la actividad de una fila de la matriz (catálogo del Archivero).
 * Sólo cambia el nombre: no toca asignaciones ni supervisor.
 */
export async function updateMatrizActividad(params: {
  displayId: number;
  actividad: string;
}): Promise<{ ok: true; actividad: string } | { ok: false; error: string }> {
  const { displayId } = params;
  const actividad = String(params.actividad ?? "")
    .trim()
    .replace(/\s+/g, " ");

  try {
    if (!Number.isInteger(displayId) || displayId < 1) {
      return { ok: false, error: "Fila inválida." };
    }
    if (!actividad) {
      return { ok: false, error: "El nombre de la actividad no puede quedar vacío." };
    }
    if (actividad.length > 300) {
      return { ok: false, error: "El nombre no puede pasar de 300 caracteres." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sesión inválida." };

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const adminConfigurado =
      !!url && !!serviceKey && !serviceKey.includes("__REPLACE_ME__");

    const client = adminConfigurado
      ? createSupabaseAdmin(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : supabase;

    // Otra fila distinta no puede quedar con el mismo nombre exacto.
    const dup = await client
      .from("matriz")
      .select("id, actividad")
      .ilike("actividad", actividad)
      .neq("id", displayId)
      .limit(1);
    if (dup.error) {
      return {
        ok: false,
        error: `DB: ${dup.error.message}${
          dup.error.code ? ` (${dup.error.code})` : ""
        }`,
      };
    }
    if ((dup.data ?? []).length > 0) {
      return {
        ok: false,
        error: `Ya existe la actividad "${actividad}" en la fila #${
          (dup.data ?? [])[0]?.id ?? "?"
        }.`,
      };
    }

    const updated = await client
      .from("matriz")
      .update({ actividad })
      .eq("id", displayId)
      .select("id");

    if (updated.error) {
      return {
        ok: false,
        error: `DB: ${updated.error.message}${
          updated.error.code ? ` (${updated.error.code})` : ""
        }`,
      };
    }
    if (!updated.data || updated.data.length === 0) {
      return {
        ok: false,
        error: `La fila #${displayId} no existe en la tabla matriz (o no tienes permiso para modificarla).`,
      };
    }

    revalidatePath("/platform/documentos");
    return { ok: true, actividad };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Error desconocido al guardar.",
    };
  }
}

/**
 * Crea una actividad NUEVA en la matriz (catálogo). Sólo se guarda el nombre:
 * aquí no se crea nada en `asignaciones` (Task) ni se pide supervisor/fecha.
 * key del catálogo = id de `matriz` (el siguiente disponible).
 */
export async function createMatrizActividad(params: {
  actividad: string;
}): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const actividad = String(params.actividad ?? "").trim().replace(/\s+/g, " ");
  try {
    if (!actividad) {
      return { ok: false, error: "Escribe el nombre de la actividad." };
    }
    if (actividad.length > 300) {
      return { ok: false, error: "El nombre no puede pasar de 300 caracteres." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sesión inválida." };

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const adminConfigurado =
      !!url && !!serviceKey && !serviceKey.includes("__REPLACE_ME__");

    const client = adminConfigurado
      ? createSupabaseAdmin(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : supabase;

    // Evitar duplicados exactos (sin distinguir mayúsculas) en la matriz.
    const dup = await client
      .from("matriz")
      .select("id, actividad")
      .ilike("actividad", actividad)
      .limit(1);
    if (dup.error) {
      return {
        ok: false,
        error: `DB: ${dup.error.message}${
          dup.error.code ? ` (${dup.error.code})` : ""
        }`,
      };
    }
    if ((dup.data ?? []).length > 0) {
      return {
        ok: false,
        error: `Ya existe una actividad con ese nombre (fila #${
          (dup.data ?? [])[0]?.id ?? "?"
        }).`,
      };
    }

    // El id lo asigna la tabla (identity/serial).
    const inserted = await client
      .from("matriz")
      .insert([{ actividad, frecuencia: "" }])
      .select("id");

    if (inserted.error) {
      return {
        ok: false,
        error: `DB: ${inserted.error.message}${
          inserted.error.code ? ` (${inserted.error.code})` : ""
        }`,
      };
    }

    const rawId = (inserted.data ?? [])[0]?.id;
    const newId =
      typeof rawId === "number"
        ? rawId
        : typeof rawId === "string"
          ? Number(rawId)
          : NaN;
    if (!Number.isInteger(newId)) {
      return { ok: false, error: "No se pudo obtener la fila creada." };
    }

    revalidatePath("/platform/documentos");
    return { ok: true, id: newId };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Error desconocido al crear.",
    };
  }
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
