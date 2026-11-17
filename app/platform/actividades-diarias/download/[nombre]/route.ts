import { createClient } from "@/utils/supabase/server";
import {
  createClient as createSupabaseAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { resolveRoleForUser } from "@/lib/platform-roles";
import { ACTIVIDADES_BUCKET } from "@/app/platform/actividades-diarias/tipos";

export const dynamic = "force-dynamic";

/**
 * El último segmento de la URL es el nombre del PDF (solo estético) para que
 * el navegador muestre el nombre correcto al abrir o guardar el archivo.
 * El nombre real y la ruta se resuelven desde la fila usando `id`.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!sbUrl || !anonKey || sbUrl.includes("__REPLACE_ME__") || anonKey.includes("__REPLACE_ME__")) {
    return new NextResponse("Falta configurar Supabase.", { status: 500 });
  }

  const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return new NextResponse("Solicitud inválida.", { status: 400 });

  const supabase: SupabaseClient = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/`);

  const admin =
    serviceKey && !serviceKey.includes("__REPLACE_ME__")
      ? createSupabaseAdminClient(sbUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  const readClient: SupabaseClient = admin ?? supabase;
  const { data: row, error } = await readClient
    .from("actividades_diarias")
    .select("id, user_id, file_path, file_bucket, file_name, file_mime")
    .eq("id", id)
    .maybeSingle();

  if (error || !row) {
    return new NextResponse("Actividad no encontrada.", { status: 404 });
  }

  const ownerId = String((row as { user_id?: string }).user_id ?? "");
  const role = await resolveRoleForUser(supabase, user.id, { email: user.email ?? null });
  const canAccess = ownerId === user.id || role === "revisor";
  if (!canAccess) {
    return new NextResponse("No tienes permisos para ver este archivo.", { status: 403 });
  }

  const path = String((row as { file_path?: string | null }).file_path ?? "").trim();
  if (!path) return new NextResponse("Esta actividad no tiene adjunto.", { status: 404 });

  const activityId = String((row as { id: string }).id);
  const bucket =
    (row as { file_bucket?: string | null }).file_bucket === ACTIVIDADES_BUCKET
      ? ACTIVIDADES_BUCKET
      : "asignaciones";
  const validPath =
    bucket === ACTIVIDADES_BUCKET
      ? path === `${ownerId}/${activityId}/documento.pdf`
      : path.startsWith(`actividades/${ownerId}/`) && path.toLowerCase().endsWith(".pdf");
  if (!validPath) {
    return new NextResponse("La ruta del PDF no corresponde a esta actividad.", { status: 404 });
  }

  const ttlSeconds = 60 * 30;
  let signedResult = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if ((signedResult.error || !signedResult.data?.signedUrl) && admin) {
    signedResult = await admin.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  }
  const signedUrl = signedResult.data?.signedUrl ?? null;
  if (!signedUrl) {
    return new NextResponse("No se pudo acceder al archivo.", { status: 500 });
  }

  const disposition =
    String(req.nextUrl.searchParams.get("disposition") ?? "inline").toLowerCase() === "attachment"
      ? "attachment"
      : "inline";
  const fileName =
    String((row as { file_name?: string | null }).file_name ?? "").trim() ||
    path.split("/").pop() ||
    "actividad.pdf";

  try {
    const resp = await fetch(signedUrl, { cache: "no-store" });
    if (!resp.ok) {
      return new NextResponse(`No se pudo leer el archivo (${resp.status}).`, { status: 502 });
    }
    const blob = await resp.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const encodedName = encodeURIComponent(fileName).replace(/'/g, "%27");
    const finalMime =
      String((row as { file_mime?: string | null }).file_mime ?? "").trim() ||
      blob.type ||
      "application/pdf";

    const headers = new Headers({
      "Content-Type": finalMime,
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": `${disposition}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    });
    return new NextResponse(buffer, { status: 200, headers });
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : "Error inesperado al descargar.",
      { status: 500 }
    );
  }
}
