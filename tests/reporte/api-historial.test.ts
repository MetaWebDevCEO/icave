import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/reporte/auth", () => ({
  requireRevisor: vi.fn(),
}));

vi.mock("@/lib/reporte/service", () => ({
  getReportAdminClient: vi.fn(),
  listHistorial: vi.fn(),
}));

import { GET } from "@/app/api/reporte/historial/route";
import { requireRevisor } from "@/lib/reporte/auth";
import { getReportAdminClient, listHistorial } from "@/lib/reporte/service";
import type { MonthlyReport, ReportHistoryEntry } from "@/lib/reporte/types";

const SNAPSHOT = { meta: { monthKey: "2026-09" } } as unknown as MonthlyReport;

const ENTRY: ReportHistoryEntry = {
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
  snapshot: SNAPSHOT,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRevisor).mockResolvedValue({
    ok: true,
    ctx: { id: "u1", email: "revisor@icave.mx", nombre: "Revisor" },
  });
  vi.mocked(getReportAdminClient).mockReturnValue({} as never);
  vi.mocked(listHistorial).mockResolvedValue([ENTRY]);
});

describe("GET /api/reporte/historial", () => {
  it("rechaza a quien no es Revisor", async () => {
    vi.mocked(requireRevisor).mockResolvedValue({
      ok: false,
      status: 403,
      message: "Sólo Revisor.",
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listHistorial).not.toHaveBeenCalled();
  });

  it("devuelve la bitácora sin el snapshot", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { entries: Array<Record<string, unknown>> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].folio).toBe("REP-2026-09-0001");
    expect(body.entries[0].cumplimiento).toBe(68);
    expect(body.entries[0].generadoPorNombre).toBe("Revisor");
    expect(body.entries[0]).not.toHaveProperty("snapshot");
  });
});
