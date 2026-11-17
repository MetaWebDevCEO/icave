"use server";

import { revalidatePath } from "next/cache";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { normalizeEmail } from "@/lib/submission-files";
import { resolveRoleForUser } from "@/lib/platform-roles";
import { ACTIVIDADES_BUCKET } from "@/app/platform/actividades-diarias/tipos";

const EXTRAORDINARIA_TIPO_ACTIVIDAD_ID = 3;
const ROUTES = [
  "/platform/actividades-diarias",
  "/platform/actividades-diarias/extraordinarias",
];

const ACTIVIDADES_POR_CATEGORIA: Record<string, string[]> = {
  "Atención a Incidentes": ["INCIDENTE PERSONAL", "INCIDENTE MATERIAL"],
  "Atención de Emergencias": [
    "CONATO DE INCENDIO",
    "ATENCION A DERRAME",
    "SISMO",
    "RESCATE ACUATICO",
    "TRASLADO DE LESIONADO",
    "TRASLADO POR ENFERMEDAD GENERAL",
  ],
  "Actos Inseguros Detectados": ["ACTOS INSEGUROS DETECTADOS"],
  "Condición Insegura Detectada": ["CONDICION INSEGURA DETECTADA"],
  "Actividades referente al Clima": ["ACTIVIDADES REFERENTE AL CLIMA"],
  "Reporte de Riesgo": ["REPORTE DE RIESGO"],
  Capacitación: ["CAPACITACION", "CAPACITACION A BRIGADAS", "CAPACITACION EN LINEA"],
  "Actividades de Mejora": ["ACTIVIDADES DE MEJORA"],
  "Actividades Varias": [
    "Surtir dispensadores shampoo/ gel antibacterial",
    "Checar niveles de los vehículos utilitarios",
    "Carga de combustible en vehículos del departamento",
    "Retiro/Recepción de extintores para recarga",
    "Entrega de Equipo de protección personal para visitas.",
    "Apoyo de guía a visitas en la TEC",
    "Colocación / Retiro de barreras para visita.",
    "Lavado de vehículos del área.",
    "Trabajador Sindicalizado",
  ],
};

const SUBCATEGORIAS_POR_CATEGORIA: Record<string, string[]> = {
  "Atención a Incidentes": ["INCIDENTE PERSONAL", "INCIDENTE MATERIAL"],
  "Atención de Emergencias": [
    "CONATO DE INCENDIO",
    "ATENCION A DERRAME",
    "SISMO",
    "RESCATE ACUATICO",
    "TRASLADO DE LESIONADO",
    "TRASLADO POR ENFERMEDAD GENERAL",
  ],
  "Actos Inseguros Detectados": [],
  "Condición Insegura Detectada": [],
  "Actividades referente al Clima": [],
  "Reporte de Riesgo": [],
  Capacitación: ["CAPACITACION", "CAPACITACION A BRIGADAS", "CAPACITACION EN LINEA"],
  "Actividades de Mejora": [],
  "Actividades Varias": [],
};

const CAMPOS_DETALLE_POR_ACTIVIDAD: Record<string, string[]> = {
  "INCIDENTE PERSONAL": ["Lesionado", "Tipo de incidente personal", "Área del lesionado"],
  "INCIDENTE MATERIAL": ["Equipo Involucrado", "Área del incidente"],
  "CONATO DE INCENDIO": ["Área del conato"],
  "ATENCION A DERRAME": [
    "Tipo de derrame",
    "Tipo (Contenedor / Mercancía)",
    "Tipo (Equipo Portuario)",
  ],
  "ACTOS INSEGUROS DETECTADOS": ["Tipo"],
  "CONDICION INSEGURA DETECTADA": ["Tipo"],
  "ACTIVIDADES REFERENTE AL CLIMA": ["Actividades referentes al clima"],
  "REPORTE DE RIESGO": ["Reportes de riesgo"],
  CAPACITACION: ["Tipo de capacitación"],
  "CAPACITACION A BRIGADAS": ["Tipo de capacitación a brigadas"],
  "CAPACITACION EN LINEA": ["Tipo de curso"],
  "ACTIVIDADES DE MEJORA": ["Tipo de actividad de mejora"],
};

const CAMPOS_DETALLE_PERMITIDOS = new Set(
  Object.values(CAMPOS_DETALLE_POR_ACTIVIDAD).flat(),
);

export type SaveExtraordinariaResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function toIntOrNull(input: string): number | null {
  if (!input) return null;
  const number = Number(input);
  return Number.isSafeInteger(number) ? number : null;
}

function describeSaveError(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo guardar el registro extraordinario.";
  if (
    ["42703", "PGRST204", "PGRST205", "42P01"].includes(error.code ?? "") ||
    /column .* does not exist|schema cache/i.test(error.message ?? "")
  ) {
    return "Falta aplicar una migración de Actividades Diarias en Supabase; revisa el bucket actdiarias y los campos extraordinarios.";
  }
  return error.message || "No se pudo guardar el registro extraordinario.";
}

function normalizeFecha(input: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === input ? input : null;
}

function parseDetails(input: string): Record<string, string> | null {
  if (!input || input.length > 12000) return null;

  try {
    const value: unknown = JSON.parse(input);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const entries = Object.entries(value);
    if (entries.length > CAMPOS_DETALLE_PERMITIDOS.size) return null;
    const result: Record<string, string> = {};

    for (const [key, item] of entries) {
      if (!CAMPOS_DETALLE_PERMITIDOS.has(key) || typeof item !== "string") return null;
      const answer = item.trim();
      if (!answer || answer.length > 300) return null;
      result[key] = answer;
    }

    return result;
  } catch {
    return null;
  }
}

export async function saveActividadExtraordinaria(
  formData: FormData,
): Promise<SaveExtraordinariaResult> {
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
    return { ok: false, error: "Solo los supervisores pueden registrar actividades." };
  }

  const fecha = normalizeFecha(field(formData, "fecha"));
  if (!fecha) return { ok: false, error: "Selecciona una fecha válida." };

  const idPuesto = toIntOrNull(field(formData, "id_puesto"));
  const idTurno = toIntOrNull(field(formData, "id_turno"));
  const idTipo = toIntOrNull(field(formData, "id_tipo"));
  const idArea = toIntOrNull(field(formData, "id_area"));
  if (idPuesto === null) return { ok: false, error: "Selecciona un puesto." };
  if (idTurno === null) return { ok: false, error: "Selecciona un turno." };
  if (idTipo === null) return { ok: false, error: "Selecciona un tipo." };
  if (field(formData, "id_area") && idArea === null) {
    return { ok: false, error: "El área seleccionada no es válida." };
  }

  const categoria = field(formData, "categoria");
  const subcategoria = field(formData, "subcategoria");
  const nombreActividad = field(formData, "nombre_actividad");
  const opcionesCategoria = ACTIVIDADES_POR_CATEGORIA[categoria];
  if (!opcionesCategoria) return { ok: false, error: "La categoría seleccionada no es válida." };
  if (!opcionesCategoria.includes(nombreActividad)) {
    return { ok: false, error: "La actividad no corresponde a la categoría seleccionada." };
  }

  const subcategorias = SUBCATEGORIAS_POR_CATEGORIA[categoria];
  if (
    (subcategorias.length > 0 && !subcategorias.includes(subcategoria)) ||
    (subcategorias.length === 0 && subcategoria)
  ) {
    return { ok: false, error: "La subcategoría no corresponde a la categoría seleccionada." };
  }

  const detalle = parseDetails(field(formData, "detalle_actividad"));
  if (!detalle) return { ok: false, error: "Revisa los campos del detalle de la actividad." };
  const camposActividad = CAMPOS_DETALLE_POR_ACTIVIDAD[nombreActividad] ?? [];
  if (Object.keys(detalle).some((campo) => !camposActividad.includes(campo))) {
    return { ok: false, error: "Hay campos de detalle que no corresponden a la actividad." };
  }

  const camposRequeridos = camposActividad.filter(
    (campo) =>
      campo !== "Tipo (Contenedor / Mercancía)" && campo !== "Tipo (Equipo Portuario)",
  );
  if (nombreActividad === "ATENCION A DERRAME") {
    if (detalle["Tipo de derrame"] === "Contenedor (Mercancía)") {
      camposRequeridos.push("Tipo (Contenedor / Mercancía)");
    } else if (detalle["Tipo de derrame"] === "Equipo Portuario") {
      camposRequeridos.push("Tipo (Equipo Portuario)");
    }
  }
  if (camposRequeridos.some((campo) => !detalle[campo])) {
    return { ok: false, error: "Completa los campos obligatorios del detalle." };
  }

  const id = field(formData, "id");
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, error: "El identificador del registro no es válido." };
  }

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  const catalogClient = admin ?? (supabase as unknown as SupabaseClient);
  const { data: activity, error: activityError } = await catalogClient
    .from("actividad")
    .select("id_actividad, id_tipo_actividad")
    .eq("nombre", nombreActividad)
    .eq("id_tipo_actividad", EXTRAORDINARIA_TIPO_ACTIVIDAD_ID)
    .eq("activo", true)
    .maybeSingle();

  if (activityError) {
    return {
      ok: false,
      error: "No se pudo consultar el catálogo de actividades extraordinarias.",
    };
  }

  const payload = {
    user_id: user.id,
    user_email: normalizeEmail(user.email) || null,
    fecha,
    id_puesto: idPuesto,
    id_turno: idTurno,
    id_tipo: idTipo,
    id_area: idArea,
    id_tipo_actividad: EXTRAORDINARIA_TIPO_ACTIVIDAD_ID,
    id_actividad: activity?.id_actividad ?? null,
    categoria_actividad: categoria,
    subcategoria_actividad: subcategoria || null,
    nombre_actividad: nombreActividad,
    detalle_actividad: detalle,
    file_path: null,
    file_bucket: ACTIVIDADES_BUCKET,
    file_name: null,
    file_mime: null,
  };

  let savedId = id;
  if (id) {
    let current = await supabase
      .from("actividades_diarias")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();
    if ((current.error || !current.data) && admin) {
      current = await admin
        .from("actividades_diarias")
        .select("id, user_id")
        .eq("id", id)
        .maybeSingle();
    }
    if (current.error || !current.data) {
      return { ok: false, error: "No se encontró el registro extraordinario." };
    }
    if (current.data.user_id !== user.id) {
      return { ok: false, error: "No puedes editar un registro que no es tuyo." };
    }

    const updatePayload = {
      user_email: payload.user_email,
      fecha: payload.fecha,
      id_puesto: payload.id_puesto,
      id_turno: payload.id_turno,
      id_tipo: payload.id_tipo,
      id_area: payload.id_area,
      id_tipo_actividad: payload.id_tipo_actividad,
      id_actividad: payload.id_actividad,
      categoria_actividad: payload.categoria_actividad,
      subcategoria_actividad: payload.subcategoria_actividad,
      nombre_actividad: payload.nombre_actividad,
      detalle_actividad: payload.detalle_actividad,
    };
    let updated = await supabase
      .from("actividades_diarias")
      .update(updatePayload)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if ((updated.error || !updated.data) && admin) {
      updated = await admin
        .from("actividades_diarias")
        .update(updatePayload)
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();
    }
    if (updated.error || !updated.data) {
      return { ok: false, error: describeSaveError(updated.error) };
    }
    savedId = String(updated.data.id);
  } else {
    let inserted = await supabase.from("actividades_diarias").insert(payload).select("id").single();
    if (inserted.error && admin) {
      inserted = await admin.from("actividades_diarias").insert(payload).select("id").single();
    }
    if (inserted.error) {
      return { ok: false, error: describeSaveError(inserted.error) };
    }
    savedId = String(inserted.data.id);
  }

  for (const route of ROUTES) revalidatePath(route);
  return { ok: true, id: savedId };
}
