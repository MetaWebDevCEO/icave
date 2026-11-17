"use server";

import { revalidatePath } from "next/cache";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { resolveRoleForUser } from "@/lib/platform-roles";
import { normalizeEmail, sanitizeFileName } from "@/lib/submission-files";
import { ACTIVIDADES_BUCKET } from "@/app/platform/actividades-diarias/tipos";

const ROUTE = "/platform/actividades-diarias";

export type SaveActividadResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** Valida y normaliza una fecha de calendario `YYYY-MM-DD`. */
function normalizeFecha(input: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Convierte un valor de FormData a entero, o null si está vacío/ inválido. */
function toIntOrNull(input: string): number | null {
  const value = input.trim();
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export async function saveActividadDiaria(formData: FormData): Promise<SaveActividadResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    return { ok: false, error: "Configura Supabase primero (env vars)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión inválida." };

  const role = await resolveRoleForUser(supabase, user.id, { email: user.email ?? null });
  if (role !== "usuario") {
    return { ok: false, error: "Solo los supervisores pueden llenar este formulario." };
  }

  const id = String(formData.get("id") ?? "").trim();
  const fecha = normalizeFecha(String(formData.get("fecha") ?? ""));
  if (!fecha) return { ok: false, error: "Selecciona una fecha válida." };

  const idPuesto = toIntOrNull(String(formData.get("id_puesto") ?? ""));
  if (idPuesto === null) return { ok: false, error: "Selecciona un puesto." };

  const idTurno = toIntOrNull(String(formData.get("id_turno") ?? ""));
  if (idTurno === null) return { ok: false, error: "Selecciona un turno." };

  const idTipo = toIntOrNull(String(formData.get("id_tipo") ?? ""));
  if (idTipo === null) return { ok: false, error: "Selecciona un tipo." };

  const idArea = toIntOrNull(String(formData.get("id_area") ?? ""));

  const idTipoActividad = toIntOrNull(String(formData.get("id_tipo_actividad") ?? ""));
  if (idTipoActividad === null) {
    return { ok: false, error: "Selecciona una categoría de actividad." };
  }

  const idActividad = toIntOrNull(String(formData.get("id_actividad") ?? ""));
  if (idActividad === null) return { ok: false, error: "Selecciona una actividad." };

  const userEmail = normalizeEmail(user.email) || null;

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  // La actividad debe corresponder a la categoría elegida y estar
  // habilitada para la combinación tipo/área elegida.
  const catalogClient = admin ?? supabase;

  const { data: actividadRow, error: actividadError } = await catalogClient
    .from("actividad")
    .select("nombre, id_tipo_actividad")
    .eq("id_actividad", idActividad)
    .maybeSingle();
  if (actividadError || !actividadRow) {
    return { ok: false, error: "No se pudo validar la actividad seleccionada." };
  }

  const selectedActivity = actividadRow as {
    nombre: string;
    id_tipo_actividad: number | null;
  };
  if (
    selectedActivity.id_tipo_actividad !== null &&
    selectedActivity.id_tipo_actividad !== idTipoActividad
  ) {
    return {
      ok: false,
      error: "La actividad no corresponde al tipo de actividad seleccionado.",
    };
  }

  const { data: tipoAreas, error: tipoAreasError } = await catalogClient
    .from("tipo_area")
    .select("id_area")
    .eq("id_tipo", idTipo)
    .eq("activo", true);
  if (tipoAreasError) {
    return { ok: false, error: "No se pudieron validar las áreas permitidas para este tipo." };
  }

  const allowedAreaIds = (tipoAreas ?? []).map(
    (tipoArea: { id_area: number }) => tipoArea.id_area,
  );
  if (allowedAreaIds.length > 0 && idArea === null) {
    return { ok: false, error: "Selecciona un área permitida para el tipo elegido." };
  }
  if (idArea !== null && !allowedAreaIds.includes(idArea)) {
    return { ok: false, error: "El área seleccionada no está permitida para el tipo elegido." };
  }

  let comboQuery = catalogClient
    .from("actividad_asignacion")
    .select("id_asignacion")
    .eq("id_actividad", idActividad)
    .eq("id_tipo", idTipo);
  comboQuery = idArea === null ? comboQuery.is("id_area", null) : comboQuery.eq("id_area", idArea);
  const { data: combo, error: comboError } = await comboQuery.limit(1);
  if (comboError) {
    return { ok: false, error: "No se pudo validar la combinación de actividad, tipo y área." };
  }
  if (!combo || combo.length === 0) {
    return {
      ok: false,
      error: "La actividad no corresponde al tipo y área seleccionados.",
    };
  }

  const tryRead = (client: SupabaseClient, select: string) =>
    client.from("actividades_diarias").select(select);

  let savedId = id;

  if (id) {
    // ---------- EDITAR: verificar propiedad ----------
    let current = await tryRead(supabase, "id, user_id").eq("id", id).maybeSingle();
    if ((current.error || !current.data) && admin) {
      current = await tryRead(admin, "id, user_id").eq("id", id).maybeSingle();
    }
    if (current.error || !current.data) {
      return { ok: false, error: current.error?.message ?? "El registro no existe." };
    }
    const ownerId = (current.data as { user_id?: string }).user_id;
    if (ownerId !== user.id) {
      return { ok: false, error: "No puedes editar un registro que no es tuyo." };
    }

    const payload: Record<string, unknown> = {
      fecha,
      id_puesto: idPuesto,
      id_turno: idTurno,
      id_tipo: idTipo,
      id_area: idArea,
      id_tipo_actividad: idTipoActividad,
      id_actividad: idActividad,
      user_email: userEmail,
    };

    let updated = await supabase
      .from("actividades_diarias")
      .update(payload)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if ((updated.error || !updated.data) && admin) {
      updated = await admin
        .from("actividades_diarias")
        .update(payload)
        .eq("id", id)
        .select("id")
        .maybeSingle();
    }
    if (updated.error || !updated.data) {
      return { ok: false, error: updated.error?.message ?? "No se pudo actualizar el registro." };
    }
    savedId = String(updated.data.id);
  } else {
    // ---------- CREAR ----------
    const payload: Record<string, unknown> = {
      user_id: user.id,
      user_email: userEmail,
      fecha,
      id_puesto: idPuesto,
      id_turno: idTurno,
      id_tipo: idTipo,
      id_area: idArea,
      id_tipo_actividad: idTipoActividad,
      id_actividad: idActividad,
      file_path: null,
      file_bucket: ACTIVIDADES_BUCKET,
      file_name: null,
      file_mime: null,
    };

    let inserted = await supabase
      .from("actividades_diarias")
      .insert(payload)
      .select("id")
      .single();
    if (inserted.error && admin) {
      inserted = await admin
        .from("actividades_diarias")
        .insert(payload)
        .select("id")
        .single();
    }
    if (inserted.error) return { ok: false, error: inserted.error.message };
    savedId = String(inserted.data.id);
  }

  revalidatePath(ROUTE);
  return { ok: true, id: savedId };
}

export async function attachActividadDiariaPdf(
  idInput: string,
  fileNameInput: string,
): Promise<SaveActividadResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || url.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    return { ok: false, error: "Configura Supabase primero (env vars)." };
  }

  const id = idInput.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, error: "El identificador del registro no es válido." };
  }

  const fileName = sanitizeFileName(fileNameInput).slice(0, 180);
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return { ok: false, error: "El adjunto debe ser un archivo PDF." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesión inválida." };

  const role = await resolveRoleForUser(supabase, user.id, { email: user.email ?? null });
  if (role !== "usuario") {
    return { ok: false, error: "Solo los supervisores pueden adjuntar un PDF." };
  }

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  const storageClient = admin ?? supabase;
  const objectPath = `${user.id}/${id}/documento.pdf`;

  const listResult = await storageClient.storage
    .from(ACTIVIDADES_BUCKET)
    .list(`${user.id}/${id}`, { limit: 20, offset: 0 });
  if (listResult.error || !listResult.data?.some((object) => object.name === "documento.pdf")) {
    return { ok: false, error: "No se encontró el PDF cargado en el bucket actdiarias." };
  }

  let current = await supabase
    .from("actividades_diarias")
    .select("id, user_id, file_path, file_bucket")
    .eq("id", id)
    .maybeSingle();
  if ((current.error || !current.data) && admin) {
    current = await admin
      .from("actividades_diarias")
      .select("id, user_id, file_path, file_bucket")
      .eq("id", id)
      .maybeSingle();
  }
  if (current.error || !current.data) {
    return { ok: false, error: current.error?.message ?? "El registro no existe." };
  }
  if (current.data.user_id !== user.id) {
    return { ok: false, error: "No puedes adjuntar un PDF a un registro que no es tuyo." };
  }

  const payload = {
    file_path: objectPath,
    file_bucket: ACTIVIDADES_BUCKET,
    file_name: fileName,
    file_mime: "application/pdf",
  };
  let updated = await supabase
    .from("actividades_diarias")
    .update(payload)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if ((updated.error || !updated.data) && admin) {
    updated = await admin
      .from("actividades_diarias")
      .update(payload)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
  }
  if (updated.error || !updated.data) {
    return { ok: false, error: updated.error?.message ?? "No se pudo asociar el PDF al registro." };
  }

  const oldPath = current.data.file_path;
  const oldBucket = current.data.file_bucket || "asignaciones";
  const isOwnedOldPath =
    (oldBucket === "asignaciones" &&
      oldPath?.startsWith(`actividades/${user.id}/`) &&
      oldPath.toLowerCase().endsWith(".pdf")) ||
    (oldBucket === ACTIVIDADES_BUCKET && oldPath === objectPath);
  if (
    oldPath &&
    isOwnedOldPath &&
    (oldBucket !== ACTIVIDADES_BUCKET || oldPath !== objectPath)
  ) {
    await storageClient.storage.from(oldBucket).remove([oldPath]).catch(() => null);
  }

  revalidatePath(ROUTE);
  return { ok: true, id };
}
