/**
 * Render del PDF del reporte mensual en el servidor.
 *
 * Vive en un archivo `.tsx` porque `renderToBuffer` recibe el elemento JSX del
 * documento; los Route Handlers (`route.ts`) no admiten JSX.
 */

import { renderToBuffer } from "@react-pdf/renderer";
import type { MonthlyReport } from "../types";
import { ReporteMensualPDF } from "./reporte-mensual-pdf";

export async function renderMonthlyReportPdf(report: MonthlyReport): Promise<Buffer> {
  return renderToBuffer(<ReporteMensualPDF report={report} />);
}

/** Nombre del archivo descargable, sin acentos ni espacios. */
export function monthlyReportFileName(report: MonthlyReport): string {
  const { monthKey, parcial, folio, supervisorFiltro } = report.meta;
  const supervisor = supervisorFiltro?.email ? `-${supervisorFiltro.email.split("@")[0]}` : "";
  const suffix = parcial ? "-Parcial" : "-Cierre";
  return `Reporte-Mensual-${monthKey}${supervisor}${suffix}-${folio}.pdf`;
}
