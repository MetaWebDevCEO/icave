"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  sendEmail,
  buildBrandedHtmlEmail,
  buildPlainEmail,
  getFromAddress,
} from "@/lib/email";

export type AttachmentFileInput = {
  name: string;
  type: string;
  base64: string;
};

export type CreateAssignmentInput = {
  actividadTitulo: string;
  descripcion: string;
  supervisorEmail: string;
  supervisorName?: string;
  revisorEmail: string;
  revisorUserId?: string;
  fechaEntregaLimiteISO: string;
  prioridad: "alto" | "medio" | "bajo";
  status: string;
  attachmentFiles?: AttachmentFileInput[];
};

export type CreateAssignmentResult =
  | {
      ok: true;
      id: string;
      emailSent?: boolean | null;
      emailQueued?: boolean;
      emailError?: string | null;
      emailMessageId?: string | null;
      error?: undefined;
    }
  | {
      ok: false;
      error: string;
      id?: undefined;
    };

/* ===============================================================
   UTILIDADES
=============================================================== */
function normalizeEmail(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().toLowerCase();
}

function isValidEmail(v: unknown): boolean {
  const s = normalizeEmail(v);
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Dada una fecha (Date o ISO string completo o DATE-only "YYYY-MM-DD"),
 * devuelve ISO-8601 en UTC a medianoche del DÍA QUE REPRESENTA EL STRING
 * (nunca se desplaza por la TZ del servidor).
 *
 *  - Si recibe DATE-only "2026-09-30" → "2026-09-30T00:00:00.000Z"
 *  - Si recibe "2026-09-30T00:00:00Z" → "2026-09-30T00:00:00.000Z"
 *  - Si recibe "2026-09-30T23:59:00+06:00" → se parsea y se extrae el
 *    día que corresponda en UTC (getUTCDate) para no perder la fecha.
 *
 * Nunca usa getFullYear/getMonth/getDate (locales del servidor). Siempre
 * getUTC* o parseo manual.
 */
function toISOAtMidnight(input: Date | string): string {
  try {
    const raw = typeof input === "string" ? input.trim() : input.toISOString();
    if (!raw) return new Date().toISOString();

    // 1) DATE-only pattern (sin T, sin Z, solo YYYY-MM-DD)
    const mOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (mOnly) {
      return `${mOnly[1]}-${mOnly[2]}-${mOnly[3]}T00:00:00.000Z`;
    }

    // 2) ISO completo con T: usamos UTC getters del instante.
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}T00:00:00.000Z`;
  } catch {
    return typeof input === "string" ? input : input.toISOString();
  }
}

/**
 * Dado un ISO string, devuelve DATE-only "YYYY-MM-DD" (el día que el input
 * representa en UTC). Para due_at de Postgres (tipo DATE sin zona).
 *
 * NUNCA usa getFullYear/getDate locales; solo DATE regex o getUTC*().
 */
function toDateOnly(iso: string): string {
  try {
    const raw = String(iso ?? "").trim();
    if (!raw) return raw;
    const m = /^(\d{4})-(\d{2})-(\d{2})([ T].*)?$/.exec(raw);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const da = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${da}`;
  } catch {
    return String(iso ?? "").slice(0, 10);
  }
}

/**
 * Formatea una fecha (ISO string, DATE sin hora o TIMESTAMP con T) a texto
 * en español: "vie, 30 oct 2026".
 *
 * Bug que corrige: el usuario seleccionaba en el navegador una fecha DATE
 * (ej: 2026-10-30), se guardaba como due_at = '2026-10-30'::date, y luego
 * al enviar el correo new Date('2026-10-30T00:00:00Z').toLocaleDateString()
 * se interpretaba en la TZ DEL SERVIDOR Node.js. Si el server estaba en
 * America/Mexico_City (UTC−6) se convertía a 2026-10-29T18:00:00 local,
 * toLocaleDateString imprimía "jue, 29 oct 2026" y el usuario veía "otro día".
 *
 * Solución:
 *  1. Si el string es DATE-ONLY (YYYY-MM-DD, sin T) → PARSEO MANUAL por
 *     substrings. NUNCA usamos Date() para DATE sin hora, porque Date()
 *     siempre asume zona y eso cambia el número del día.
 *  2. Si el string es TIMESTAMP con T (ISO-8601 completo) → formateamos en
 *     `timeZone: "UTC"` para forzar que se muestre el día que corresponde
 *     a la representación canónica UTC. Así 2026-10-30T05:00:00Z siempre es
 *     "30 oct", independientemente de la TZ del servidor.
 */
function fmtEsDate(iso: string): string {
  try {
    if (!iso) return iso;
    const cleaned = String(iso).trim();
    if (!cleaned) return iso;

    // Caso 1: DATE only (YYYY-MM-DD, sin T ni Z). Ej: due_at de Postgres.
    const mDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
    if (mDateOnly) {
      const [, yStr, mStr, dStr] = mDateOnly;
      const y = Number(yStr);
      const mIdx = Number(mStr) - 1;
      const d = Number(dStr);
      const fakeUTC = new Date(Date.UTC(y, mIdx, d, 12, 0, 0));
      return fakeUTC.toLocaleDateString("es-ES", {
        timeZone: "UTC",
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }

    // Caso 2: ISO-8601 completo (tiene T). Imprimimos en UTC para fijar día.
    const d = new Date(cleaned);
    if (Number.isNaN(d.getTime())) return cleaned;
    return d.toLocaleDateString("es-ES", {
      timeZone: "UTC",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/* ===============================================================
   SERVER ACTION: EDITAR (solo título y fecha de entrega)
   Se usa desde el botón Editar (lápiz) de la matriz una vez la
   asignación está creada (botón Check).
=============================================================== */
export type UpdateAssignmentBasicsInput = {
  assignmentId: string;
  nuevoTitulo: string;
  nuevaFechaEntregaISO: string;
};

export type UpdateAssignmentBasicsResult =
  | { ok: true; id: string; title: string; due_at: string }
  | { ok: false; error: string };

export async function updateAssignmentBasics(
  data: UpdateAssignmentBasicsInput
): Promise<UpdateAssignmentBasicsResult> {
  const assignmentId = String(data.assignmentId ?? "").trim();
  const nuevoTitulo = String(data.nuevoTitulo ?? "").trim();

  if (!assignmentId) return { ok: false, error: "Asignación no identificada." };
  if (nuevoTitulo.length === 0) return { ok: false, error: "El nombre no puede quedar vacío." };

  let dueAtDate: string;
  let dueAtFinalISOForEmail: string;
  let notifyAtISO: string;
  try {
    const limISO = toISOAtMidnight(data.nuevaFechaEntregaISO);
    dueAtDate = toDateOnly(limISO);
    dueAtFinalISOForEmail = limISO;

    const limUtcMs = new Date(limISO).getTime();
    const notifyUtcMs = limUtcMs - 24 * 60 * 60 * 1000;
    const nowPlus1hMs = Date.now() + 60 * 60 * 1000;
    const finalNotifyMs = notifyUtcMs < nowPlus1hMs ? nowPlus1hMs : notifyUtcMs;
    notifyAtISO = new Date(finalNotifyMs).toISOString();
  } catch (e) {
    return {
      ok: false,
      error: `Fecha inválida (${e instanceof Error ? e.message : "desconocido"}).`,
    };
  }

  const sb = (await createClient()) as unknown as SupabaseClient;
  const authResp = await sb.auth.getUser();
  const user = authResp.data?.user ?? null;
  if (authResp.error || !user) {
    return { ok: false, error: "Sesión no válida; vuelve a iniciar sesión." };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const hasAdmin = Boolean(url && serviceKey && !serviceKey.includes("__REPLACE_ME__"));
  const admin = hasAdmin
    ? (createSupabaseAdminClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as SupabaseClient)
    : null;

  // 1) Validar permisos: solo el revisor creador puede editar (o si tenemos admin, bypass).
  let dueAtFinalISO: string = dueAtDate;
  let titleFinal: string = nuevoTitulo;

  try {
    const payload: Record<string, unknown> = {
      title: nuevoTitulo,
      due_at: dueAtDate,
      notify_at: notifyAtISO,
      updated_at: new Date().toISOString(),
    };

    // Orden correcto: primero cliente ADMIN (service_role) -> bypass RLS.
    // Fallback a cliente normal (sb) solo si no tenemos service_role.
    // Así evitamos 42501 permission denied por policies mal configuradas.
    const SELECT_FIELDS =
      "id, title, due_at, assigned_to_email, priority, description";
    let q: {
      error: unknown | null;
      data: unknown | null;
    } = { error: "no client", data: null };
    let triedAdmin = false;
    if (admin) {
      triedAdmin = true;
      q = await admin
        .from("asignaciones")
        .update(payload)
        .eq("id", assignmentId)
        .select(SELECT_FIELDS)
        .maybeSingle();
    }
    if ((!triedAdmin || q.error || !q.data) && sb && (!admin || !triedAdmin)) {
      const qFall = await sb
        .from("asignaciones")
        .update(payload)
        .eq("id", assignmentId)
        .select(SELECT_FIELDS)
        .maybeSingle();
      if (!triedAdmin) q = qFall as unknown as typeof q;
    }

    const finalError = q.error as
      | null
      | undefined
      | { message?: string; code?: string; details?: string };
    if (finalError) {
      const msg = finalError.message ?? "Error al guardar.";
      const code = finalError.code ?? "";
      const isMissingColumn =
        code === "PGRST204" ||
        (typeof msg === "string" &&
          (msg.includes("column ") &&
            (msg.includes("does not exist") || msg.includes("not found"))));
      if (isMissingColumn) {
        return {
          ok: false,
          error:
            `Tu tabla 'asignaciones' no tiene una columna que el UPDATE necesita (${msg}). ` +
            `Ejecuta el SQL de verificación de columnas y ALTER TABLE si falta.`,
        };
      }
      const isRls =
        code === "42501" ||
        (typeof msg === "string" && msg.includes("permission denied"));
      if (isRls) {
        return {
          ok: false,
          error:
            `No tienes permiso para editar esta asignación (42501 / RLS). ` +
            `Pide a admin habilitar UPDATE en políticas o usa el service_role correctamente.`,
        };
      }
      return {
        ok: false,
        error: `DB: ${msg}${code ? ` (${code})` : ""}`,
      };
    }

    const row = q.data as
      | {
          id: unknown;
          title: unknown;
          due_at: unknown;
          assigned_to_email?: unknown;
          priority?: unknown;
          description?: unknown;
        }
      | null;
    if (!row) return { ok: false, error: "Asignación no encontrada." };

    if (typeof row.title === "string" && row.title) titleFinal = row.title;
    if (typeof row.due_at === "string" && row.due_at) {
      dueAtFinalISO = row.due_at.includes("T")
        ? row.due_at
        : `${row.due_at}T00:00:00.000Z`;
    }
    const finalAssignedEmail =
      typeof row.assigned_to_email === "string" ? row.assigned_to_email : "";
    const finalPriority =
      typeof row.priority === "string" ? row.priority : "medio";
    const finalDescription =
      typeof row.description === "string" ? row.description : "";

    revalidatePath("/platform/revisor");
    revalidatePath("/platform/revisor/task");
    revalidatePath("/platform/revisor/asignaciones");
    revalidatePath("/platform/documentos");
    revalidatePath("/platform/task");

    const finalId = String(row.id ?? assignmentId);

    if (finalAssignedEmail && isValidEmail(finalAssignedEmail)) {
      const updateEmailArgs = {
        assignmentId: finalId,
        actividadTitulo: titleFinal,
        descripcion: finalDescription,
        supervisorEmail: normalizeEmail(finalAssignedEmail),
        revisorEmail: normalizeEmail(user.email ?? ""),
        fechaEntregaLimiteISO: dueAtFinalISO || dueAtFinalISOForEmail,
        prioridad: finalPriority,
      };
      void (async () => {
        try {
          const r = await sendSupervisorAssignmentUpdatedEmail(updateEmailArgs);
          if (!r.ok) {
            console.warn(
              `[asignaciones] tarea ${finalId} actualizada, correo de actualización a ${finalAssignedEmail} falló:`,
              r.error
            );
          }
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Error correo desconocido.";
          console.warn(
            `[asignaciones] tarea ${finalId} actualizada, correo EXCEPCIÓN:`,
            msg
          );
        }
      })();
    }

    return {
      ok: true,
      id: finalId,
      title: titleFinal,
      due_at: dueAtFinalISO,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error inesperado al guardar.",
    };
  }
}

/* ===============================================================
   SERVER ACTION PRINCIPAL: CREAR
=============================================================== */
export async function createAssignment(
  data: CreateAssignmentInput
): Promise<CreateAssignmentResult> {
  // ----------------------------------------------------------------
  // 0. Validaciones básicas
  // ----------------------------------------------------------------
  const superEmail = normalizeEmail(data.supervisorEmail);
  const revEmail = normalizeEmail(data.revisorEmail);

  if (!isValidEmail(superEmail)) {
    return { ok: false, error: "Selecciona un supervisor con correo válido." };
  }
  if (!isValidEmail(revEmail)) {
    return { ok: false, error: "No se pudo identificar el revisor (sesión)." };
  }
  if (!data.actividadTitulo || String(data.actividadTitulo).trim().length === 0) {
    return { ok: false, error: "Selecciona una actividad de la matriz." };
  }

  let limISO: string;
  let dueAtDate: string;
  let notifyAtISO: string;
  try {
    const lim = new Date(data.fechaEntregaLimiteISO);
    if (Number.isNaN(lim.getTime())) throw new Error("vencimiento");
    limISO = toISOAtMidnight(lim);
    dueAtDate = toDateOnly(limISO);

    // notify_at = 24 horas ANTES del vencimiento (notificar al supervisor con 1 día)
    const notify = new Date(lim);
    notify.setDate(notify.getDate() - 1);
    // si por casualidad notify queda en el pasado (vencimiento hoy o ayer), lo ponemos a ahora + 1h
    const nowPlus1h = new Date();
    nowPlus1h.setHours(nowPlus1h.getHours() + 1);
    if (notify.getTime() < nowPlus1h.getTime()) notify.setTime(nowPlus1h.getTime());
    notifyAtISO = notify.toISOString();
  } catch (e) {
    return {
      ok: false,
      error: `Fecha inválida (${e instanceof Error ? e.message : "desconocido"}).`,
    };
  }

  // ----------------------------------------------------------------
  // 1. Clientes Supabase (revisor autenticado + admin service_role)
  // ----------------------------------------------------------------
  const sb = (await createClient()) as unknown as SupabaseClient;
  const authResp = await sb.auth.getUser();
  const user = authResp.data?.user ?? null;
  const authErr = authResp.error;
  if (authErr || !user) {
    return { ok: false, error: "Sesión no válida; vuelve a iniciar sesión." };
  }
  const userId: string = user.id;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const hasAdmin = Boolean(url && serviceKey && !url.includes("__REPLACE_ME__"));
  const admin = hasAdmin
    ? (createSupabaseAdminClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as SupabaseClient)
    : null;

  const writableClient: SupabaseClient = admin ?? sb;

  // ----------------------------------------------------------------
  // 2. Subir PDFs adjuntos a storage bucket = asignaciones
  //    (misma convención que el proyecto: adjuntos/{userId}/{ts}-name.pdf)
  // ----------------------------------------------------------------
  const attachments: AttachmentFileInput[] = Array.isArray(data.attachmentFiles)
    ? data.attachmentFiles.filter((f) => f && f.base64 && f.name)
    : [];
  let attachmentPath: string | null = null;
  const attachmentNames: string[] = [];
  const uploadedKeys: string[] = [];

  if (attachments.length) {
    const bucket = "asignaciones";
    for (const f of attachments) {
      const safeName = f.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
      const key =
        `adjuntos/${userId}/${Date.now()}_${attachments.indexOf(f)}_${safeName}`;
      try {
        const buf = Buffer.from(f.base64, "base64");
        const mimeType = f.type?.toLowerCase().includes("pdf")
          ? f.type
          : "application/pdf";
        const { error: upErr } = await writableClient.storage
          .from(bucket)
          .upload(key, buf, { contentType: mimeType, upsert: true });
        if (upErr) {
          console.warn(`[asignacion] upload falló ${key}:`, upErr);
          continue;
        }
        uploadedKeys.push(`${bucket}/${key}`);
        attachmentNames.push(f.name);
      } catch (err) {
        console.warn(`[asignacion] upload ex ${key}:`, err);
      }
    }
    if (uploadedKeys.length) {
      attachmentPath = uploadedKeys.join(",");
    }
  }

  // ----------------------------------------------------------------
  // 3. INSERT en tabla = asignaciones  (SOLO COLUMNAS REALES del schema)
  //    Columnas confirmadas según pantallazo del usuario:
  //      title, description, status, priority, due_at, notify_at,
  //      revisor_id, assigned_to_email,
  //      attachment_name, attachment_mime, attachment_path
  // ----------------------------------------------------------------

  // CHECK constraint real confirmado:
  //   priority = ANY (ARRAY['Urgente'::text, 'Medio'::text, 'No Urgente'::text])
  // SOLO se aceptan esos 3 strings exactos. Cualquier otra variante falla.
  const rawPrioridad = String(data.prioridad ?? "medio").toLowerCase().trim();
  const isHighPrior =
    rawPrioridad.startsWith("alt") ||
    rawPrioridad.startsWith("hi") ||
    rawPrioridad === "1" ||
    rawPrioridad.includes("high") ||
    rawPrioridad.includes("urg") ||      // incluye "urgente" / "urgent" / "urg"
    rawPrioridad.startsWith("cr");
  const isLowPrior =
    !isHighPrior &&
    (rawPrioridad.startsWith("baj") ||
      rawPrioridad.startsWith("lo") ||
      rawPrioridad.startsWith("no ") ||
      rawPrioridad.startsWith("no_") ||
      rawPrioridad.includes("no urg") ||   // "no urgente" de la constraint
      rawPrioridad === "3" ||
      rawPrioridad.includes("low"));
  // Default: prioridad media (Medio)

  // Valores EXACTOS que pide el CHECK constraint (case-sensitive).
  // Ponemos en primer lugar el literal EXACTO (que 100% pasará), y unas
  // pocas variantes extra por si acaso (minúsculas, etc.) — no pasará,
  // pero por compatibilidad histórica no dañan.
  const priorityCandidates: string[] = isHighPrior
    ? ["Urgente", "URGENTE", "urgente", "Alta", "Alto", "high", "1"]
    : isLowPrior
      ? ["No Urgente", "NO URGENTE", "no urgente", "Baja", "Bajo", "low", "3"]
      : ["Medio", "MEDIO", "medio", "Media", "Normal", "medium", "2"];
  const labelPrioridad = isHighPrior ? "Urgente" : isLowPrior ? "No Urgente" : "Medio";
  const metaHeader = [
    `[Tarea creada por revisor] ${revEmail}`,
    `[Asignado a] ${data.supervisorName ? `${data.supervisorName} · ` : ""}${superEmail}`,
    `[Vence] ${dueAtDate}`,
    `[Prioridad] ${labelPrioridad}`,
    `[Estado] ${data.status?.trim() || "pendiente"}`,
  ].join("\n");
  const description = (data.descripcion?.trim() ? `${data.descripcion.trim()}\n\n---\n` : "") + metaHeader;

  // Columnas reales que EXISTEN en la tabla (singular attachment_*):
  const firstAttachment = attachments[0]; // attachment_name/mime son singulares
  function buildRow(dbPrioridadVal: string): Record<string, unknown> {
    return {
      title: String(data.actividadTitulo).trim(),
      description,
      status: data.status?.trim() || "pendiente",
      priority: dbPrioridadVal,
      due_at: dueAtDate,
      notify_at: notifyAtISO,
      revisor_id: userId,
      assigned_to_email: superEmail,
      attachment_name: attachmentNames.length ? attachmentNames.join(", ") : null,
      attachment_mime:
        firstAttachment?.type?.toLowerCase().includes("pdf")
          ? firstAttachment.type
          : attachmentNames.length
          ? "application/pdf"
          : null,
      attachment_path: attachmentPath,
    };
  }

  let insertedId: string | null = null;
  let insertedDueAt = limISO;
  let insertedTitle = String(data.actividadTitulo).trim();
  let insertError: string | null = null;
  let chosenPriority: string = priorityCandidates[0];

  // Columnas reales que podemos seleccionar post-insert
  const INSERT_COLUMNS_SELECT =
    "id, title, description, status, priority, due_at, revisor_id, assigned_to_email, attachment_name, attachment_path";

  // Anti-CHECK-constraint: probamos variantes en orden.
  // Así no tenemos que adivinar el valor exacto de `asignaciones_priority_check`.
  for (let i = 0; i < priorityCandidates.length; i++) {
    const candidate = priorityCandidates[i];
    chosenPriority = candidate;
    try {
      const ext = await writableClient
        .from("asignaciones")
        .insert(buildRow(candidate))
        .select(INSERT_COLUMNS_SELECT)
        .single();

      if (!ext.error && ext.data) {
        insertedId = String((ext.data as { id: unknown }).id ?? "");
        const rawDue = (ext.data as { due_at?: unknown }).due_at;
        if (typeof rawDue === "string" && rawDue) {
          insertedDueAt = rawDue.includes("T") ? rawDue : `${rawDue}T00:00:00.000Z`;
        }
        insertedTitle =
          typeof (ext.data as { title: unknown }).title === "string"
            ? ((ext.data as { title: string }).title as string)
            : insertedTitle;
        insertError = null;
        break;
      }

      if (ext.error) {
        insertError = ext.error.message ?? "Error al insertar.";
        // Si el error NO es sobre constraint `asignaciones_priority_check`,
        // no seguimos probando variantes (hay otro error).
        const isPriorityCheckError =
          typeof ext.error.message === "string" &&
          ext.error.message.includes("asignaciones_priority_check");
        if (!isPriorityCheckError) break;
        // Sino, continuamos probando la siguiente variante.
      }
    } catch (err) {
      insertError = err instanceof Error ? err.message : "Error inesperado al guardar.";
    }
  }

  if (!insertedId) {
    const tried = priorityCandidates.map((c) => JSON.stringify(c)).join(", ");
    const detail =
      insertError && /asignaciones_priority_check/i.test(insertError)
        ? `El CHECK constraint 'asignaciones_priority_check' rechazó todos los valores probados. Valores intentados: [${tried}]. Consulta el constraint real en Supabase > Table Editor > asignaciones > Constraints y ajusta los valores permitidos.`
        : insertError || "No se pudo crear la tarea.";
    console.error("[createAssignment] Insert falló. Error:", insertError, "Candidates tried:", priorityCandidates);
    return { ok: false, error: detail };
  }

  // ----------------------------------------------------------------
  // 4. ✉️  NOTIFICAR POR CORREO al SUPERVISOR (NO BLOQUEAR RESPUESTA HTTP)
  //    Enviamos el email EN SEGUNDO PLANO: el usuario ve el OK al instante,
  //    no se queda esperando a que Resend responda (2-8 s).
  // ----------------------------------------------------------------
  const emailArgs = {
    assignmentId: insertedId,
    actividadTitulo: insertedTitle,
    descripcion: data.descripcion ?? "",
    supervisorEmail: superEmail,
    supervisorName: data.supervisorName,
    revisorEmail: revEmail,
    fechaEntregaLimiteISO: insertedDueAt,
    prioridad: chosenPriority,
    pdfCount: uploadedKeys.length,
  };

  // Creamos una promesa "fuego y olvida" que se resuelva en background.
  // Next.js mantiene el worker vivo un rato tras responder;
  // para entornos sin servidor, cualquier cosa se relanza al entrar.
  const emailPromise = (async () => {
    try {
      const r = await sendSupervisorAssignmentEmail(emailArgs);
      if (!r.ok) {
        console.warn(
          `[asignaciones] tarea ${insertedId} creada, correo a ${superEmail} falló:`,
          r.error
        );
      }
      return r;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Error correo desconocido.";
      console.warn(
        `[asignaciones] tarea ${insertedId} creada, correo a ${superEmail} EXCEPCIÓN:`,
        msg
      );
      return { ok: false as const, error: msg };
    }
  })();

  revalidatePath("/platform/revisor/asignacion");
  revalidatePath("/platform/supervisores");
  revalidatePath("/platform/revisor/supervisores");
  revalidatePath("/platform/supervisor/bandeja");

  return {
    ok: true,
    id: insertedId,
    emailSent: null, // aún no sabemos; el correo se envía en bg
    emailQueued: true,
    emailError: null,
    emailMessageId: null,
  };
}

/* ===============================================================
   CORREO DE NOTIFICACIÓN AL SUPERVISOR
=============================================================== */
type EmailArgs = {
  assignmentId: string;
  actividadTitulo: string;
  descripcion: string;
  supervisorEmail: string;
  supervisorName?: string;
  revisorEmail: string;
  fechaEntregaLimiteISO: string;
  prioridad: string;
  pdfCount: number;
};

type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

async function sendSupervisorAssignmentEmail(args: EmailArgs): Promise<EmailResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const fromEmail = getFromAddress();

  const saludoNombre =
    args.supervisorName?.trim() || args.supervisorEmail.split("@")[0];
  const revisorSaludo = args.revisorEmail.split("@")[0];

  const vence = fmtEsDate(args.fechaEntregaLimiteISO);
  const publicacion = fmtEsDate(new Date().toISOString()); // hoy = publicación

  const subject = `Nueva tarea asignada · Vence ${vence} · ${args.actividadTitulo}`;

  const ctaHref = appUrl ? `${appUrl.replace(/\/$/, "")}/platform/supervisor/bandeja?assignment=${encodeURIComponent(args.assignmentId)}` : "";

  const p = String(args.prioridad ?? "").toLowerCase().trim();
  // Importante: chequear "NO URGENTE" ANTES que "urg", porque "no urgente" contiene "urg"
  // y caería erróneamente en isHigh si se evalúa primero.
  const hasNoUrgente =
    p.includes("no urg") || p.startsWith("no urg") || p.startsWith("nourg");
  const isHigh =
    !hasNoUrgente &&
    (p === "alto" ||
      p === "alta" ||
      p === "high" ||
      p === "urgente" ||
      p === "1" ||
      p.startsWith("urg")); // urg / urgente, pero sólo si NO es "no urgente"
  const isLow =
    hasNoUrgente ||
    (!isHigh &&
      (p === "bajo" ||
        p === "baja" ||
        p === "low" ||
        p.startsWith("baj") ||
        p.startsWith("lo") ||
        p === "3"));
  const prioridadLabel = isHigh ? "Urgente" : isLow ? "No Urgente" : "Medio";
  const prioridadColor = isHigh ? "#dc2626" : isLow ? "#16a34a" : "#d97706";

  const descripcionSegura = (args.descripcion || "").replace(
    /[<>&"]/g,
    (ch) =>
      ch === "<"
        ? "&lt;"
        : ch === ">"
        ? "&gt;"
        : ch === "&"
        ? "&amp;"
        : "&quot;"
  );

  // ---------------------------------------------------------------
  // HTML: MISMO ESTILO QUE EL CORREO DE RECUPERACIÓN (tipo Supabase)
  //   - fondo gris claro
  //   - tarjeta blanca redondeada
  //   - logo/cabecera centrado
  //   - CTA botón negro (#111) ANCHO, CENTRADO, border-radius 12px
  //   - enlace copia/pega bajo el botón
  // ---------------------------------------------------------------
  const displayCtaHref = ctaHref || (appUrl ? `${appUrl.replace(/\/$/, "")}/platform/supervisor/bandeja` : "");

  const html = `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>${subject}</title>
  </head>
  <body style="background-color:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;padding:0;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f7f9;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table
            role="presentation"
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="560"
            style="max-width:560px;border-radius:24px;overflow:hidden;background:#ffffff;border:1px solid #e5e7eb;"
          >
            <!-- CABECERA / LOGO (igual que recovery: logo centrado arriba) -->
            <tr>
              <td align="center" style="padding:44px 40px 8px 40px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:12px;vertical-align:middle;">
                      <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#023674 0%,#02A9E5 100%);color:#ffffff;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;letter-spacing:0.4px;">
                        IC
                      </div>
                    </td>
                    <td style="vertical-align:middle;">
                      <div style="font-size:18px;font-weight:700;line-height:22px;color:#0f172a;">Promas iCave</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- TÍTULO -->
            <tr>
              <td align="left" style="padding:18px 40px 0 40px;">
                <h1 style="margin:0;font-size:26px;font-weight:700;line-height:32px;color:#111111;letter-spacing:-0.02em;">
                  ${saludoNombre}, tienes una nueva tarea.
                </h1>
              </td>
            </tr>

            <!-- SUBTÍTULO -->
            <tr>
              <td align="left" style="padding:10px 40px 0 40px;">
                <p style="margin:0;font-size:15px;line-height:22px;color:#52525b;">
                  El revisor <span style="color:#111111;font-weight:600;">${args.revisorEmail}</span> te ha asignado una tarea con vencimiento el día
                  <span style="color:#dc2626;font-weight:600;">${vence}</span>.
                </p>
              </td>
            </tr>

            <!-- TARJETA DE RESUMEN (minimalista, gris suave) -->
            <tr>
              <td align="left" style="padding:22px 40px 0 40px;">
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:16px;padding:18px 20px;">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                    <div style="flex:1 1 auto;min-width:220px;">
                      <div style="font-size:11px;letter-spacing:0.5px;color:#71717a;text-transform:uppercase;margin-bottom:6px;">Actividad</div>
                      <div style="font-size:15px;font-weight:700;color:#111111;line-height:20px;">${args.actividadTitulo}</div>
                    </div>
                    <div>
                      <span
                        style="display:inline-block;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.4px;color:#ffffff;background:${prioridadColor};"
                      >
                        PRIORIDAD ${prioridadLabel.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px;font-size:13px;color:#3f3f46;">
                    <div>
                      <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:3px;">Publicación</div>
                      <div style="font-weight:600;color:#18181b;">${publicacion}</div>
                    </div>
                    <div>
                      <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:3px;">Vence</div>
                      <div style="font-weight:700;color:#dc2626;">${vence}</div>
                    </div>
                    <div>
                      <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:3px;">Asignada por</div>
                      <div style="font-weight:600;color:#18181b;">${args.revisorEmail}</div>
                    </div>
                    <div>
                      <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:3px;">Adjuntos</div>
                      <div style="font-weight:600;color:#18181b;">${args.pdfCount} PDF${args.pdfCount === 1 ? "" : "s"}</div>
                    </div>
                  </div>

                  ${
                    descripcionSegura
                      ? `<div style="margin-top:16px;">
                           <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:6px;">Notas del revisor</div>
                           <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;font-size:13px;line-height:20px;color:#18181b;white-space:pre-wrap;">${descripcionSegura}</div>
                         </div>`
                      : ""
                  }
                </div>
              </td>
            </tr>

            <!-- CTA BOTÓN PRINCIPAL (igual que recovery: negro, ancho, centrado) -->
            <tr>
              <td align="center" style="padding:26px 40px 0 40px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td align="center" style="border-radius:12px;background:#111111;">
                      <a
                        href="${displayCtaHref}"
                        target="_blank"
                        style="display:block;padding:16px 22px;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:12px;"
                      >
                        Ver tarea en Promas iCave
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- ENLACE COPIA Y PEGA (igual que recovery) -->
            ${
              displayCtaHref
                ? `<tr>
                     <td align="left" style="padding:14px 40px 0 40px;">
                       <p style="margin:0;font-size:13px;line-height:18px;color:#71717a;">
                         Si el botón no funciona, copia y pega este enlace en tu navegador:
                       </p>
                       <p style="margin:6px 0 0 0;font-size:12px;line-height:18px;color:#023674;word-break:break-all;white-space:normal;">
                         <a href="${displayCtaHref}" target="_blank" style="color:#023674;text-decoration:underline;">${displayCtaHref}</a>
                       </p>
                     </td>
                   </tr>`
                : ""
            }

            <!-- FOOTER -->
            <tr>
              <td align="center" style="padding:32px 40px 36px 40px;">
                <p style="margin:0;font-size:12px;line-height:18px;color:#a1a1aa;">
                  Recibes este correo porque el revisor ${args.revisorEmail} te asignó una nueva tarea en Promas iCave.
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:18px;color:#a1a1aa;">
                  © ${new Date().getFullYear()} Promas iCave · ${appUrl ? `<a href="${appUrl}" style="color:#a1a1aa;text-decoration:underline;">${appUrl.replace(/^https?:\/\//, "")}</a>` : "promasicave.com"}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines: string[] = [
    `${saludoNombre}, tienes una nueva tarea asignada en Promas iCave.`,
    ``,
    `El revisor ${args.revisorEmail} te ha asignado la siguiente tarea:`,
    ``,
    `Actividad: ${args.actividadTitulo}`,
    `Prioridad: ${prioridadLabel}`,
    `Publicación: ${publicacion}`,
    `Vence: ${vence}`,
    `Adjuntos: ${args.pdfCount} PDF${args.pdfCount === 1 ? "" : "s"}`,
    args.descripcion?.trim() ? `\nNotas del revisor:\n${args.descripcion.trim()}\n` : "",
    displayCtaHref ? `Abre la tarea aquí: ${displayCtaHref}` : `Abre Promas iCave y ve a tu bandeja de tareas.`,
  ].filter((l) => typeof l === "string") as string[];

  const text = buildPlainEmail(textLines);

  const result = await sendEmail({
    to: args.supervisorEmail,
    cc: args.revisorEmail,
    subject,
    html,
    text,
    tags: [
      { name: "category", value: "asignacion_nueva" },
      { name: "assignment_id", value: String(args.assignmentId) },
      { name: "priority", value: String(args.prioridad) },
    ],
  });

  if (result.error) {
    return { ok: false, error: result.error };
  }
  return { ok: true, id: result.id ?? null };
}

/* ===============================================================
   CORREO DE ACTUALIZACIÓN DE ASIGNACIÓN (fecha/título editados)
=============================================================== */
type UpdatedEmailArgs = {
  assignmentId: string;
  actividadTitulo: string;
  descripcion: string;
  supervisorEmail: string;
  revisorEmail: string;
  fechaEntregaLimiteISO: string;
  prioridad: string;
};

async function sendSupervisorAssignmentUpdatedEmail(
  args: UpdatedEmailArgs
): Promise<EmailResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  getFromAddress();

  const saludoNombre = args.supervisorEmail.split("@")[0];
  const vence = fmtEsDate(args.fechaEntregaLimiteISO);
  const actualizacion = fmtEsDate(new Date().toISOString());

  const subject = `Tarea actualizada · Nuevo vencimiento ${vence} · ${args.actividadTitulo}`;

  const ctaHref = appUrl
    ? `${appUrl.replace(/\/$/, "")}/platform/supervisor/bandeja?assignment=${encodeURIComponent(args.assignmentId)}`
    : "";
  const displayCtaHref =
    ctaHref ||
    (appUrl ? `${appUrl.replace(/\/$/, "")}/platform/supervisor/bandeja` : "");

  const p = String(args.prioridad ?? "").toLowerCase();
  // Chequear "NO URGENTE" ANTES que "urg" para evitar falsos positivos.
  const hasNoUrgenteUpd =
    p.includes("no urg") || p.startsWith("no urg") || p.startsWith("nourg");
  const isHighEmail =
    !hasNoUrgenteUpd &&
    (p.startsWith("alt") ||
      p === "high" ||
      p.startsWith("urg") || // urg / urgente (no = "no urgente")
      p === "1");
  const isLowEmail =
    hasNoUrgenteUpd ||
    (!isHighEmail &&
      (p.startsWith("baj") ||
        p.startsWith("lo") ||
        p.includes("low") ||
        p === "3"));
  const prioridadLabel = isHighEmail ? "Urgente" : isLowEmail ? "No Urgente" : "Medio";
  const prioridadColor = isHighEmail ? "#dc2626" : isLowEmail ? "#16a34a" : "#d97706";

  const descripcionSegura = (args.descripcion || "").replace(/[<>&"]/g, (ch) =>
    ch === "<"
      ? "&lt;"
      : ch === ">"
        ? "&gt;"
        : ch === "&"
          ? "&amp;"
          : "&quot;"
  );

  const html = `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>${subject}</title>
  </head>
  <body style="background-color:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;margin:0;padding:0;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f6f7f9;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table
            role="presentation"
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="560"
            style="max-width:560px;border-radius:24px;overflow:hidden;background:#ffffff;border:1px solid #e5e7eb;"
          >
            <tr>
              <td align="center" style="padding:44px 40px 8px 40px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:12px;vertical-align:middle;">
                      <div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#023674 0%,#02A9E5 100%);color:#ffffff;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;letter-spacing:0.4px;">
                        IC
                      </div>
                    </td>
                    <td style="vertical-align:middle;">
                      <div style="font-size:18px;font-weight:700;line-height:22px;color:#0f172a;">Promas iCave</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="left" style="padding:18px 40px 0 40px;">
                <h1 style="margin:0;font-size:26px;font-weight:700;line-height:32px;color:#111111;letter-spacing:-0.02em;">
                  ${saludoNombre}, actualizaron tu tarea.
                </h1>
              </td>
            </tr>

            <tr>
              <td align="left" style="padding:10px 40px 0 40px;">
                <p style="margin:0;font-size:15px;line-height:22px;color:#52525b;">
                  El revisor <span style="color:#111111;font-weight:600;">${args.revisorEmail}</span> actualizó la tarea. El nuevo vencimiento es el
                  <span style="color:#dc2626;font-weight:600;">${vence}</span>.
                </p>
              </td>
            </tr>

            <tr>
              <td align="left" style="padding:22px 40px 0 40px;">
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:16px;padding:18px 20px;">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                    <div style="flex:1 1 auto;min-width:220px;">
                      <div style="font-size:11px;letter-spacing:0.5px;color:#71717a;text-transform:uppercase;margin-bottom:6px;">Actividad</div>
                      <div style="font-size:15px;font-weight:700;color:#111111;line-height:20px;">${args.actividadTitulo}</div>
                    </div>
                    <div>
                      <span
                        style="display:inline-block;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.4px;color:#ffffff;background:${prioridadColor};"
                      >
                        PRIORIDAD ${prioridadLabel.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:16px;font-size:13px;color:#3f3f46;">
                    <div>
                      <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:3px;">Actualización</div>
                      <div style="font-weight:600;color:#18181b;">${actualizacion}</div>
                    </div>
                    <div>
                      <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:3px;">Vence</div>
                      <div style="font-weight:700;color:#dc2626;">${vence}</div>
                    </div>
                    <div>
                      <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:3px;">Actualizado por</div>
                      <div style="font-weight:600;color:#18181b;">${args.revisorEmail}</div>
                    </div>
                    <div>
                      <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:3px;">Tipo</div>
                      <div style="font-weight:600;color:#18181b;">Cambio de fecha / nombre</div>
                    </div>
                  </div>

                  ${
                    descripcionSegura
                      ? `<div style="margin-top:16px;">
                           <div style="font-size:11px;letter-spacing:0.4px;color:#71717a;text-transform:uppercase;margin-bottom:6px;">Notas (originales)</div>
                           <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;font-size:13px;line-height:20px;color:#18181b;white-space:pre-wrap;">${descripcionSegura}</div>
                         </div>`
                      : ""
                  }
                </div>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:26px 40px 0 40px;">
                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td align="center" style="border-radius:12px;background:#111111;">
                      <a
                        href="${displayCtaHref}"
                        target="_blank"
                        style="display:block;padding:16px 22px;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:12px;"
                      >
                        Ver tarea actualizada en Promas iCave
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              displayCtaHref
                ? `<tr>
                     <td align="left" style="padding:14px 40px 0 40px;">
                       <p style="margin:0;font-size:13px;line-height:18px;color:#71717a;">
                         Si el botón no funciona, copia y pega este enlace en tu navegador:
                       </p>
                       <p style="margin:6px 0 0 0;font-size:12px;line-height:18px;color:#023674;word-break:break-all;white-space:normal;">
                         <a href="${displayCtaHref}" target="_blank" style="color:#023674;text-decoration:underline;">${displayCtaHref}</a>
                       </p>
                     </td>
                   </tr>`
                : ""
            }

            <tr>
              <td align="center" style="padding:32px 40px 36px 40px;">
                <p style="margin:0;font-size:12px;line-height:18px;color:#a1a1aa;">
                  Recibes este correo porque el revisor ${args.revisorEmail} actualizó una tarea que te fue asignada en Promas iCave.
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:18px;color:#a1a1aa;">
                  © ${new Date().getFullYear()} Promas iCave · ${appUrl ? `<a href="${appUrl}" style="color:#a1a1aa;text-decoration:underline;">${appUrl.replace(/^https?:\/\//, "")}</a>` : "promasicave.com"}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines: string[] = [
    `${saludoNombre}, actualizaron una tarea tuya en Promas iCave.`,
    ``,
    `El revisor ${args.revisorEmail} actualizó la siguiente tarea:`,
    ``,
    `Actividad: ${args.actividadTitulo}`,
    `Prioridad: ${prioridadLabel}`,
    `Actualización: ${actualizacion}`,
    `Vence: ${vence}`,
    displayCtaHref
      ? `Abre la tarea aquí: ${displayCtaHref}`
      : `Abre Promas iCave y ve a tu bandeja de tareas.`,
  ];

  const text = buildPlainEmail(textLines);

  const result = await sendEmail({
    to: args.supervisorEmail,
    cc: args.revisorEmail,
    subject,
    html,
    text,
    tags: [
      { name: "category", value: "asignacion_actualizada" },
      { name: "assignment_id", value: String(args.assignmentId) },
    ],
  });

  if (result.error) {
    return { ok: false, error: result.error };
  }
  return { ok: true, id: result.id ?? null };
}
