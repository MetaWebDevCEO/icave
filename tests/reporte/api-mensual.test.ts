import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/reporte/auth", () => ({
  requireRevisor: vi.fn(),
}));

vi.mock("@/lib/reporte/service", () => ({
  getReportAdminClient: vi.fn(),
  getHistoryEntry: vi.fn(),
  generateMonthlyReport: vi.fn(),
  resolveSupervisorEmail: vi.fn(),
}));

vi.mock("@/lib/reporte/pdf/render", () => ({
  renderMonthlyReportPdf: vi.fn(),
  monthlyReportFileName: vi.fn(() => "reporte.pdf"),
}));

import { GET } from "@/app/api/reporte/mensual/route";
import { requireRevisor } from "@/lib/reporte/auth";
import {
  generateMonthlyReport,
  getHistoryEntry,
  getReportAdminClient,
  resolveSupervisorEmail,
} from "@/lib/reporte/service";
import { renderMonthlyReportPdf } from "@/lib/reporte/pdf/render";
import { currentMonthKeyUtc } from "@/lib/reporte/period";
import type { MonthlyReport } from "@/lib/reporte/types";

const REVISOR_OK = {
  ok: true as const,
  ctx: { id: "u1", email: "revisor@icave.mx", nombre: "Revisor" },
};

const REPORT = {
  meta: {
    monthKey: "2026-09",
    parcial: false,
    folio: "REP-2026-09-0001",
    supervisorFiltro: null,
  },
} as unknown as MonthlyReport;

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/reporte/mensual${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRevisor).mockResolvedValue(REVISOR_OK);
  vi.mocked(getReportAdminClient).mockReturnValue({} as never);
  vi.mocked(renderMonthlyReportPdf).mockResolvedValue(Buffer.from("%PDF-1.4 fake"));
  vi.mocked(generateMonthlyReport).mockResolvedValue({
    report: REPORT,
    fromSnapshot: false,
    historyId: null,
  });
  vi.mocked(resolveSupervisorEmail).mockResolvedValue(null);
  vi.mocked(getHistoryEntry).mockResolvedValue(null);
});

describe("GET /api/reporte/mensual — autorización", () => {
  it("rechaza sin sesión con 401", async () => {
    vi.mocked(requireRevisor).mockResolvedValue({
      ok: false,
      status: 401,
      message: "Sesión no válida.",
    });
    const res = await GET(request("?mes=2026-09"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Sesión no válida." });
  });

  it("rechaza a quien no es Revisor con 403", async () => {
    vi.mocked(requireRevisor).mockResolvedValue({
      ok: false,
      status: 403,
      message: "Sólo Revisor.",
    });
    const res = await GET(request("?mes=2026-09"));
    expect(res.status).toBe(403);
    expect(renderMonthlyReportPdf).not.toHaveBeenCalled();
  });

  it("falla con 500 si no hay llave de servicio", async () => {
    vi.mocked(getReportAdminClient).mockReturnValue(null);
    const res = await GET(request("?mes=2026-09"));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/reporte/mensual — validación del periodo", () => {
  it("rechaza un mes con formato inválido", async () => {
    const res = await GET(request("?mes=septiembre"));
    expect(res.status).toBe(400);
    expect(generateMonthlyReport).not.toHaveBeenCalled();
  });

  it("rechaza el reporte oficial del mes en curso", async () => {
    const mes = currentMonthKeyUtc();
    const res = await GET(request(`?mes=${mes}`));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("se habilita a partir del día 1 del mes siguiente");
  });

  it("permite el avance parcial del mes en curso", async () => {
    const mes = currentMonthKeyUtc();
    const res = await GET(request(`?mes=${mes}&parcial=true`));
    expect(res.status).toBe(200);
    expect(generateMonthlyReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ monthKey: mes, parcial: true })
    );
  });

  it("devuelve 404 si el supervisor no existe", async () => {
    vi.mocked(resolveSupervisorEmail).mockResolvedValue(null);
    const res = await GET(request("?mes=2026-09&supervisor=desconocido"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/reporte/mensual — generación", () => {
  it("genera el PDF del mes cerrado y aplica el filtro de supervisor", async () => {
    vi.mocked(resolveSupervisorEmail).mockResolvedValue({
      email: "juan.perez@icave.mx",
      nombre: "Juan Perez",
    });

    const res = await GET(request("?mes=2026-09&supervisor=juan.perez@icave.mx"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("attachment");

    expect(generateMonthlyReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        monthKey: "2026-09",
        parcial: false,
        supervisor: { email: "juan.perez@icave.mx", nombre: "Juan Perez" },
        user: REVISOR_OK.ctx,
      })
    );
  });

  it("re-descarga un reporte guardado por id", async () => {
    vi.mocked(getHistoryEntry).mockResolvedValue({
      id: "h1",
      folio: "REP-2026-09-0001",
      monthKey: "2026-09",
      monthLabel: "Septiembre 2026",
      parcial: false,
      generadoEn: "2026-10-01T10:00:00.000Z",
      generadoEnLabel: "01/10/2026 10:00",
      generadoPorEmail: "revisor@icave.mx",
      generadoPorNombre: "Revisor",
      supervisorEmail: null,
      cumplimiento: 68,
      total: 100,
      snapshot: REPORT,
    });

    const res = await GET(request("?id=h1"));
    expect(res.status).toBe(200);
    expect(generateMonthlyReport).not.toHaveBeenCalled();
    expect(renderMonthlyReportPdf).toHaveBeenCalledWith(REPORT);
  });

  it("devuelve 404 cuando el id no existe", async () => {
    const res = await GET(request("?id=inexistente"));
    expect(res.status).toBe(404);
  });
});
