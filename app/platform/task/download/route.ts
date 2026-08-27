import { createClient } from "@/utils/supabase/server";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { resolveRoleForUser } from "@/lib/platform-roles";

export const dynamic = "force-dynamic";

const BASE_PATH = "/platform/task";

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function extractFileName(p: string | null | undefined): string {
  if (!p) return "";
  const lastSlash = p.lastIndexOf("/");
  return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
}

function resolveSubmissionName(
  submissionName: string | null | undefined,
  submissionPath: string | null | undefined,
  fallback: string
) {
  const trimmed = submissionName?.trim() ?? "";
  if (trimmed.length > 0 && trimmed.toLowerCase() !== "entrega.pdf") {
    return trimmed;
  }
  const fromPath = extractFileName(submissionPath);
  if (fromPath.length > 0) return fromPath;
  return fallback;
}

function extractEntregaPathFromDescription(
  description: string | null | undefined
) {
  if (!description) return null;
  const marker = "[Entrega]";
  const start = description.indexOf(marker);
  if (start === -1) return null;
  const tail = description.slice(start + marker.length);
  const line = tail
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return null;
  const cleaned = line
    .replace(
      /^[A-Za-z0-9_\- /:.()+\u00C0-\u024F]+(?:\.(?:pdf|PDF))/,
      (m) => m
    )
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

type FoundFile = { path: string; name: string };

async function findSubmissionInStorage(
  client: SupabaseClient,
  ownerUserId: string | null | undefined,
  assignmentId: string
): Promise<FoundFile | null> {
  if (ownerUserId) {
    const folder = `entregas/${ownerUserId}/${assignmentId}`;
    const { data, error } = await client.storage
      .from("asignaciones")
      .list(folder, { limit: 20, offset: 0 });
    if (!error && data && data.length > 0) {
      const exact = data.find(
        (file) => file.name.toLowerCase() === "entrega.pdf"
      );
      const pdf =
        exact ?? data.find((file) => file.name.toLowerCase().endsWith(".pdf"));
      if (pdf) {
        return {
          path: `${folder}/${pdf.name}`,
          name: pdf.name,
        };
      }
    }
  }

  // Fallback: listar entregas/ y todas las carpetas buscando el assignmentId
  try {
    const { data: root } = await client.storage
      .from("asignaciones")
      .list("entregas", { limit: 500, offset: 0 });
    if (!root || root.length === 0) return null;
    for (const userFolder of root) {
      if (!userFolder || userFolder.id) continue; // skip files, only folders
      const folder = `entregas/${userFolder.name}/${assignmentId}`;
      const { data: files } = await client.storage
        .from("asignaciones")
        .list(folder, { limit: 20, offset: 0 });
      if (!files || files.length === 0) continue;
      const exact = files.find(
        (file) => file.name.toLowerCase() === "entrega.pdf"
      );
      const pdf =
        exact ??
        files.find((file) => file.name.toLowerCase().endsWith(".pdf"));
      if (pdf) {
        return {
          path: `${folder}/${pdf.name}`,
          name: pdf.name,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

let __foundNameFallback: string | undefined;
function popFoundNameFallback() {
  const v = __foundNameFallback;
  __foundNameFallback = undefined;
  return v;
}

const FAVICON_HREF = "/iso%20(2).svg";
const DOC_TITLE = "Promas Download";

function errorHtml(title: string, message: string, backUrl: string) {
  const safeTitle = String(title).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeMessage = String(message)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeBack = String(backUrl);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${DOC_TITLE}</title><link rel="icon" type="image/svg+xml" href="${FAVICON_HREF}"/><link rel="shortcut icon" type="image/svg+xml" href="${FAVICON_HREF}"/><style>
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
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${DOC_TITLE}</title><link rel="icon" type="image/svg+xml" href="${FAVICON_HREF}"/><link rel="shortcut icon" type="image/svg+xml" href="${FAVICON_HREF}"/><style>
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

  const select =
    "id, revisor_id, assigned_to_email, submission_path, submission_name, description";

  type Row = {
    revisor_id?: string | null;
    assigned_to_email?: string | null;
    submission_path?: string | null;
    submission_name?: string | null;
    description?: string | null;
    assigned_to?: string | null; // fallback para user id
  };

  let row: Row | null = null;
  let lastMessage = "No se encontró la asignación.";

  const rowA = await supabase
    .from("asignaciones")
    .select(select)
    .eq("id", assignmentId)
    .maybeSingle();
  if (rowA.data) {
    row = rowA.data as Row;
  } else if (rowA.error) {
    lastMessage = rowA.error.message;
  }

  if (!row && admin) {
    const rowB = await admin
      .from("asignaciones")
      .select(select)
      .eq("id", assignmentId)
      .maybeSingle();
    if (rowB.data) {
      row = rowB.data as Row;
    } else if (rowB.error) {
      lastMessage = rowB.error.message;
    }
  }

  if (!row) {
    return new NextResponse(
      errorHtml("Asignación no encontrada", lastMessage, fallbackUrl),
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  let path = row.submission_path ?? extractEntregaPathFromDescription(row.description);
  let fallbackResolvedName: string | undefined;

  if (!path) {
    // Intentar sacar el user_id del usuario supervisor asignado para escanear su carpeta
    let ownerUserId: string | null | undefined = undefined;
    if (admin && row.assigned_to_email) {
      const { data: profiles } = await admin
        .from("user_roles")
        .select("user_id")
        .limit(1000);
      if (profiles && profiles.length > 0) {
        const emails = await Promise.all(
          profiles.map(async (p) => {
            const u = await admin.auth.admin.getUserById((p as any).user_id).catch(() => null);
            if (u?.data?.user?.email && normalizeEmail(u.data.user.email) === normalizeEmail(row!.assigned_to_email)) {
              return (p as any).user_id as string;
            }
            return null;
          })
        );
        ownerUserId = emails.find((x) => x) ?? undefined;
      }
    }

    const storageClient = (admin ?? supabase) as SupabaseClient;
    const found = await findSubmissionInStorage(
      storageClient,
      ownerUserId,
      assignmentId
    );
    if (found) {
      path = found.path;
      fallbackResolvedName = found.name;
    }
  }
  if (!path) {
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
    .createSignedUrl(path, ttlSeconds);
  if (signedA.data?.signedUrl) {
    signedUrl = signedA.data.signedUrl;
  } else if (signedA.error) {
    signedMsg = signedA.error.message;
  }

  if (!signedUrl && admin) {
    const signedB = await admin.storage
      .from("asignaciones")
      .createSignedUrl(path, ttlSeconds);
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

  const fileName = fallbackResolvedName
    ? fallbackResolvedName
    : resolveSubmissionName(
        row.submission_name,
        path,
        "entrega.pdf"
      );

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
    return new NextResponse(pdfWrapperHtml(signedUrl, fileName), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error inesperado al descargar.";
    return new NextResponse(
      errorHtml("Error al descargar", msg, fallbackUrl),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}
