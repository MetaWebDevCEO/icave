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

function toISOAtMidnight(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T00:00:00.000Z`;
}

// Tu columna due_at es DATE (no timestamptz) → devolver "YYYY-MM-DD"
function toDateOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtEsDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("es-ES", {
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
   SERVER ACTION PRINCIPAL
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

  // Normalizamos la prioridad a un valor base para luego probar variantes
  // que pueda exigir el CHECK constraint asignaciones_priority_check.
  // Como no sabemos el formato exacto, probamos todas las combinaciones
  // típicas en orden hasta que el INSERT pase.
  const rawPrioridad = String(data.prioridad ?? "medio").toLowerCase().trim();
  const priorityCandidates: string[] =
    rawPrioridad.startsWith("alt")
      ? ["Alta", "alta", "ALTA", "Alto", "alto", "Urgent", "urgent", "Alta prioridad"]
      : rawPrioridad.startsWith("baj")
      ? ["Baja", "baja", "BAJA", "Bajo", "bajo", "Low", "low", "Baja prioridad"]
      : ["Media", "media", "MEDIA", "Medio", "medio", "Normal", "normal", "Medio prioridad"];
  const labelPrioridad = priorityCandidates[0];
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
    return { ok: false, error: insertError || "No se pudo crear la tarea." };
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

  const prioridadLabel =
    args.prioridad === "alto"
      ? "Alta"
      : args.prioridad === "bajo"
      ? "Baja"
      : "Media";
  const prioridadColor =
    args.prioridad === "alto"
      ? "#dc2626"
      : args.prioridad === "bajo"
      ? "#65a30d"
      : "#d97706";

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
