import { createClient } from "@/utils/supabase/server";
import {
  createClient as createSupabaseAdminClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { resolveRoleForUser } from "@/lib/platform-roles";
import {
  listEvidenceInFolder,
  normalizeEmail,
  parseSubmissionFiles,
  isValidSubmissionPath,
  isSchemaMismatchPostgres,
  type SubmissionFile,
} from "@/lib/submission-files";

export const dynamic = "force-dynamic";

const BASE_PATH = "/platform/task";

const FAVICON_HREF = "/iso (2).svg";
const DOC_TITLE = "Promas Download";

function errorHtml(title: string, message: string, backUrl: string) {
  const safeTitle = String(title).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeMessage = String(message)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeBack = String(backUrl);
  const icon = FAVICON_HREF.replace(/"/g, "&quot;");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${DOC_TITLE}</title><link rel="icon" type="image/svg+xml" href="${icon}"/><link rel="shortcut icon" type="image/svg+xml" href="${icon}"/><link rel="apple-touch-icon" type="image/svg+xml" href="${icon}"/><style>
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#fafafa;color:#18181b;}
    .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;}
    .card{max-width:480px;width:100%;background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:1.75rem 2rem;box-shadow:0 10px 30px rgba(0,0,0,.04);}
    h1{margin:0 0 .5rem;font-size:1.15rem;}
    p{margin:.5rem 0 1.25rem;color:#52525b;line-height:1.5;}
    a{display:inline-flex;height:2.5rem;align-items:center;justify-content:center;padding:0 1rem;border-radius:.5rem;background:#09090b;color:#fff;text-decoration:none;font-weight:500;}
    a:hover{background:#27272a;}
    @media (prefers-color-scheme: dark){
      body{background:#09090b;color:#fafafa;}
      .card{background:#111113;border-color:#27272a;}
      p{color:#a1a1aa;}
      a{background:#fafafa;color:#09090b;}
      a:hover{background:#d4d4d8;}
    }
  </style></head><body><div class="wrap"><div class="card">
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
    <a href="${safeBack}">Volver</a>
  </div></div></body></html>`;
}

function pdfWrapperHtml(signedUrl: string, fileName: string) {
  const safeUrl = String(signedUrl).replace(/"/g, "&quot;");
  const safeName = String(fileName)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const icon = FAVICON_HREF.replace(/"/g, "&quot;");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${DOC_TITLE}</title><link rel="icon" type="image/svg+xml" href="${icon}"/><link rel="shortcut icon" type="image/svg+xml" href="${icon}"/><link rel="apple-touch-icon" type="image/svg+xml" href="${icon}"/><style>
    html,body{margin:0;padding:0;height:100%;width:100%;background:#f4f4f5;}
    iframe{border:0;width:100vw;height:100vh;display:block;}
  </style></head><body><iframe src="${safeUrl}" title="${safeName}"></iframe></body></html>`;
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const fallbackUrl = `${origin}${BASE_PATH}`;

  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const configOk =
    sbUrl &&
    anonKey &&
    !sbUrl.includes("__REPLACE_ME__") &&
    !anonKey.includes("__REPLACE_ME__");

  if (!configOk) {
    return new NextResponse(
      errorHtml(
        "Falta configurar Supabase",
        "Configura las variables de entorno antes de continuar.",
        fallbackUrl
      ),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const assignmentId = String(
    req.nextUrl.searchParams.get("assignment_id") ?? ""
  ).trim();
  const idxRaw = req.nextUrl.searchParams.get("idx");
  const idx = Number.isInteger(Number(idxRaw)) ? Math.max(0, Number(idxRaw)) : 0;

  if (!assignmentId) {
    return new NextResponse(
      errorHtml(
        "Solicitud inválida",
        "Falta el identificador de la asignación.",
        fallbackUrl
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const supabase: SupabaseClient = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/`);
  }

  const role = await resolveRoleForUser(supabase, user.id);

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(sbUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  const selectExtended =
    "id, revisor_id, assigned_to_email, submission_path, submission_name, submission_mime, submission_files, description";
  const selectMid =
    "id, revisor_id, assigned_to_email, submission_path, submission_name, description";
  const selectBase =
    "id, revisor_id, assigned_to_email, description";

  type Row = {
    revisor_id?: string | null;
    assigned_to_email?: string | null;
    submission_path?: string | null;
    submission_name?: string | null;
    submission_mime?: string | null;
    submission_files?: unknown;
    description?: string | null;
    assigned_to?: string | null;
  };

  type QueryResult = { data: Row | null; error: PostgrestError | null };

  async function trySelect(client: SupabaseClient, query: string): Promise<QueryResult> {
    const res = await client
      .from("asignaciones")
      .select(query)
      .eq("id", assignmentId)
      .maybeSingle();
    return { data: (res.data ?? null) as Row | null, error: (res.error ?? null) as PostgrestError | null };
  }

  let row: Row | null = null;
  let lastMessage = "No se encontró la asignación.";

  const rowA = await trySelect(supabase, selectExtended);
  if (rowA.data) {
    row = rowA.data;
  } else if (rowA.error) {
    lastMessage = rowA.error.message;
    if (isSchemaMismatchPostgres(rowA.error)) {
      const mid = await trySelect(supabase, selectMid);
      if (mid.data) {
        row = mid.data;
      } else if (mid.error) {
        lastMessage = mid.error.message;
        if (isSchemaMismatchPostgres(mid.error)) {
          const base = await trySelect(supabase, selectBase);
          if (base.data) row = base.data;
          else if (base.error) lastMessage = base.error.message;
        }
      }
    }
  }

  if (!row && admin) {
    const rowB = await trySelect(admin, selectExtended);
    if (rowB.data) {
      row = rowB.data;
    } else if (rowB.error) {
      lastMessage = rowB.error.message;
      if (isSchemaMismatchPostgres(rowB.error)) {
        const mid = await trySelect(admin, selectMid);
        if (mid.data) {
          row = mid.data;
        } else if (mid.error) {
          lastMessage = mid.error.message;
          if (isSchemaMismatchPostgres(mid.error)) {
            const base = await trySelect(admin, selectBase);
            if (base.data) row = base.data;
            else if (base.error) lastMessage = base.error.message;
          }
        }
      }
    }
  }

  if (!row) {
    return new NextResponse(
      errorHtml("Asignación no encontrada", lastMessage, fallbackUrl),
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  let files: SubmissionFile[] = parseSubmissionFiles(row);
  let fallbackResolvedName: string | undefined;

  if (files.length === 0) {
    let ownerUserId: string | null | undefined = undefined;
    if (admin && row.assigned_to_email) {
      try {
        const profiles = (
          await admin.from("user_roles").select("user_id").limit(1000)
        ).data;
        if (profiles && profiles.length > 0) {
          const emails = await Promise.all(
            profiles.map(async (p) => {
              const u = await admin.auth.admin
                .getUserById((p as { user_id: string }).user_id)
                .catch(() => null);
              if (
                u?.data?.user?.email &&
                normalizeEmail(u.data.user.email) ===
                  normalizeEmail(row!.assigned_to_email)
              ) {
                return (p as { user_id: string }).user_id;
              }
              return null;
            })
          );
          ownerUserId = emails.find((x) => x) ?? undefined;
        }
      } catch {
        /* fallthrough: storage search con fallback amplio */
      }
    }

    const storageClient = (admin ?? supabase) as SupabaseClient;
    const fallbackList: SubmissionFile[] = [];
    const tryFolder = async (uid: string) => {
      const f = await listEvidenceInFolder(
        storageClient,
        "asignaciones",
        `entregas/${uid}/${assignmentId}`
      );
      if (f.length > 0) return f;
      return null;
    };
    if (ownerUserId) {
      const r = await tryFolder(ownerUserId);
      if (r) fallbackList.push(...r);
    }
    if (fallbackList.length === 0) {
      try {
        const root = (
          await storageClient.storage
            .from("asignaciones")
            .list("entregas", { limit: 500, offset: 0 })
        ).data;
        if (root && root.length > 0) {
          for (const folder of root) {
            if (folder.id) continue;
            const r = await tryFolder(folder.name);
            if (r) {
              fallbackList.push(...r);
              break;
            }
          }
        }
      } catch {
        /* fallback empty */
      }
    }
    files = fallbackList;
    if (files.length > 0 && !files[idx]) {
      fallbackResolvedName = files[0].name;
    }
  }

  const chosen = files[idx] ?? files[0];
  if (!chosen || !isValidSubmissionPath(chosen.path)) {
    return new NextResponse(
      errorHtml(
        "No hay archivo adjunto",
        "Esta asignación no tiene una entrega registrada en la base de datos ni en el almacenamiento.",
        fallbackUrl
      ),
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const userEmail = normalizeEmail(user.email);
  const assignedTo = normalizeEmail(row.assigned_to_email);
  const canAccess =
    (role === "usuario" && userEmail && assignedTo && userEmail === assignedTo) ||
    role === "revisor";

  if (!canAccess) {
    return new NextResponse(
      errorHtml(
        "Sin permisos",
        "No tienes autorización para visualizar esta entrega.",
        fallbackUrl
      ),
      { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const ttlSeconds = 60 * 30;
  let signedUrl: string | null = null;
  let signedMsg = "No se pudo generar el enlace del almacenamiento.";

  const signedA = await supabase.storage
    .from("asignaciones")
    .createSignedUrl(chosen.path, ttlSeconds);
  if (signedA.data?.signedUrl) {
    signedUrl = signedA.data.signedUrl;
  } else if (signedA.error) {
    signedMsg = signedA.error.message;
  }

  if (!signedUrl && admin) {
    const signedB = await admin.storage
      .from("asignaciones")
      .createSignedUrl(chosen.path, ttlSeconds);
    if (signedB.data?.signedUrl) {
      signedUrl = signedB.data.signedUrl;
    } else if (signedB.error) {
      signedMsg = signedB.error.message;
    }
  }

  if (!signedUrl) {
    return new NextResponse(
      errorHtml("No se pudo acceder al archivo", signedMsg, fallbackUrl),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const fileName = fallbackResolvedName ?? chosen.name;
  const disposition =
    String(req.nextUrl.searchParams.get("disposition") ?? "inline")
      .toLowerCase() === "attachment"
      ? "attachment"
      : "inline";

  try {
    const resp = await fetch(signedUrl, { cache: "no-store" });
    if (!resp.ok) {
      return new NextResponse(
        errorHtml(
          "No se pudo leer el archivo",
          `El almacenamiento respondió con código ${resp.status}.`,
          fallbackUrl
        ),
        { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }
    const blob = await resp.blob();
    const bytes = await blob.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const encodedName = encodeURIComponent(fileName).replace(/'/g, "%27");
    const finalMime =
      chosen.mime && chosen.mime.trim().length > 0
        ? chosen.mime
        : (blob.type || "application/pdf");
    const headers = new Headers({
      "Content-Type": finalMime + "; charset=utf-8",
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition":
        `${disposition}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    });
    return new NextResponse(buffer, { status: 200, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error inesperado al descargar.";
    return new NextResponse(
      errorHtml("Error al descargar", msg, fallbackUrl),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}
