/**
 * GET /api/reporte/historial
 *
 * Bitácora de reportes generados: mes, folio, fecha, quién lo descargó y el
 * cumplimiento registrado. Exclusivo del rol Revisor.
 *
 * El snapshot completo se omite en la respuesta (es pesado); para re-descargar
 * un reporte se usa `GET /api/reporte/mensual?id=<id>`.
 */

import { NextResponse } from "next/server";
import { requireRevisor } from "@/lib/reporte/auth";
import { getReportAdminClient, listHistorial } from "@/lib/reporte/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireRevisor();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const client = getReportAdminClient();
  if (!client) {
    return NextResponse.json(
      { error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const entries = await listHistorial(client);

  return NextResponse.json({
    entries: entries.map(({ snapshot: _snapshot, ...rest }) => rest),
  });
}
