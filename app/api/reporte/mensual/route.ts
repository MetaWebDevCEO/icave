/**
 * GET /api/reporte/mensual
 *
 * Genera (o re-descarga) el PDF del Reporte Mensual de Cumplimiento.
 * Exclusivo del rol Revisor.
 *
 * Parámetros:
 *   mes         YYYY-MM  — periodo solicitado (obligatorio salvo que se use `id`)
 *   supervisor  email|id — filtro opcional por supervisor
 *   parcial     true|false — avance del mes en curso (default false)
 *   id          uuid     — re-descarga un reporte guardado, tal cual se generó
 *   disposition inline|attachment (default attachment)
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireRevisor } from "@/lib/reporte/auth";
import { monthlyReportFileName, renderMonthlyReportPdf } from "@/lib/reporte/pdf/render";
import { isClosedMonth, isMonthKey } from "@/lib/reporte/period";
import {
  generateMonthlyReport,
  getHistoryEntry,
  getReportAdminClient,
  resolveSupervisorEmail,
} from "@/lib/reporte/service";
import type { MonthlyReport } from "@/lib/reporte/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  const auth = await requireRevisor();
  if (!auth.ok) return fail(auth.message, auth.status);

  const client = getReportAdminClient();
  if (!client) {
    return fail(
      "Falta configurar SUPABASE_SERVICE_ROLE_KEY para generar el reporte.",
      500
    );
  }

  const params = req.nextUrl.searchParams;
  const historyId = (params.get("id") ?? "").trim();
  const parcial = (params.get("parcial") ?? "").toLowerCase() === "true";
  const disposition =
    (params.get("disposition") ?? "attachment").toLowerCase() === "inline"
      ? "inline"
      : "attachment";

  let report: MonthlyReport;

  if (historyId) {
    const entry = await getHistoryEntry(client, historyId);
    if (!entry?.snapshot) return fail("No se encontró el reporte solicitado.", 404);
    report = entry.snapshot;
  } else {
    const mes = (params.get("mes") ?? "").trim();
    if (!isMonthKey(mes)) {
      return fail("El parámetro 'mes' es obligatorio y debe tener el formato YYYY-MM.", 400);
    }
    if (!parcial && !isClosedMonth(mes)) {
      return fail(
        `El reporte oficial de ${mes} se habilita a partir del día 1 del mes siguiente. Usa "parcial=true" para el avance del mes en curso.`,
        400
      );
    }

    const supervisorRaw = (params.get("supervisor") ?? "").trim();
    const supervisor = supervisorRaw ? await resolveSupervisorEmail(client, supervisorRaw) : null;
    if (supervisorRaw && !supervisor) {
      return fail("No se encontró el supervisor indicado.", 404);
    }

    const result = await generateMonthlyReport(client, {
      monthKey: mes,
      parcial,
      supervisor,
      user: auth.ctx,
    });
    report = result.report;
  }

  let buffer: Buffer;
  try {
    buffer = await renderMonthlyReportPdf(report);
  } catch (e) {
    console.error("[reporte] render PDF error:", e instanceof Error ? e.message : String(e));
    return fail("No se pudo generar el PDF del reporte.", 500);
  }

  const fileName = monthlyReportFileName(report);
  const encoded = encodeURIComponent(fileName).replace(/'/g, "%27");

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": `${disposition}; filename="${encoded}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
