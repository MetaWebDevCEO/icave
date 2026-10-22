import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPLIANCE_CONFIG,
  buildKpis,
  classifyAssignment,
  compareValues,
  computeCompliance,
  pendingFromCounters,
  semaforoFor,
} from "@/lib/reporte/compliance";
import type { AssignmentRow } from "@/lib/reporte/types";

const CORTE = new Date("2026-10-31T23:59:59.999Z");

function row(overrides: Partial<AssignmentRow> & { status?: unknown }): AssignmentRow {
  return { id: "a1", ...overrides };
}

describe("computeCompliance — regla única de cumplimiento", () => {
  it("suma completadas + completadas extemporáneas sobre el total", () => {
    expect(
      computeCompliance({ total: 100, completadas: 60, extemporaneas: 8 })
    ).toBe(68);
  });

  it("no cuenta las entregadas cuando includeEntregadas es false", () => {
    const counters = { total: 20, completadas: 10, extemporaneas: 0, entregadas: 5 };
    expect(computeCompliance(counters, DEFAULT_COMPLIANCE_CONFIG)).toBe(50);
  });

  it("cuenta las entregadas cuando el cliente lo decide", () => {
    const counters = { total: 20, completadas: 10, extemporaneas: 0, entregadas: 5 };
    expect(computeCompliance(counters, { includeEntregadas: true })).toBe(75);
  });

  it("devuelve 0 cuando no hay asignaciones", () => {
    expect(computeCompliance({ total: 0, completadas: 0, extemporaneas: 0 })).toBe(0);
  });

  it("redondea a un decimal", () => {
    expect(computeCompliance({ total: 3, completadas: 2, extemporaneas: 0 })).toBe(66.7);
  });
});

describe("classifyAssignment — definiciones de atraso", () => {
  it("marca atrasada cuando no está completada y el corte pasó la fecha límite", () => {
    const k = classifyAssignment(
      row({ status: "Pendiente", due_at: "2026-10-10T00:00:00.000Z" }),
      { corte: CORTE }
    );
    expect(k.base).toBe("pendiente");
    expect(k.atrasada).toBe(true);
    expect(k.diasAtraso).toBeGreaterThan(0);
  });

  it("no marca atrasada si la fecha límite todavía no vence", () => {
    const k = classifyAssignment(
      row({ status: "En curso", due_at: "2026-11-15T00:00:00.000Z" }),
      { corte: CORTE }
    );
    expect(k.atrasada).toBe(false);
    expect(k.diasAtraso).toBeNull();
  });

  it("marca extemporánea cuando se completó después de la fecha límite", () => {
    const k = classifyAssignment(
      row({
        status: "Completada",
        due_at: "2026-10-10T00:00:00.000Z",
        submitted_at: "2026-10-14T00:00:00.000Z",
      }),
      { corte: CORTE }
    );
    expect(k.completadaExtemporanea).toBe(true);
    expect(k.completada).toBe(false);
    expect(k.atrasada).toBe(false);
    expect(k.diasAtraso).toBe(4);
  });

  it("marca a tiempo cuando se completó dentro del plazo", () => {
    const k = classifyAssignment(
      row({
        status: "Completada",
        due_at: "2026-10-20T00:00:00.000Z",
        submitted_at: "2026-10-18T00:00:00.000Z",
      }),
      { corte: CORTE }
    );
    expect(k.completada).toBe(true);
    expect(k.aTiempo).toBe(true);
    expect(k.atrasada).toBe(false);
  });

  it("trata 'Entregada' como no completada (cuenta aparte)", () => {
    const k = classifyAssignment(
      row({ status: "Entregada", due_at: "2026-10-01T00:00:00.000Z" }),
      { corte: CORTE }
    );
    expect(k.entregada).toBe(true);
    expect(k.completada).toBe(false);
    expect(k.pendiente).toBe(true);
    expect(k.atrasada).toBe(true);
  });

  it("detecta evidencia por submission_files o submission_path", () => {
    expect(
      classifyAssignment(row({ submission_files: [{}] }), { corte: CORTE }).tieneEvidencia
    ).toBe(true);
    expect(
      classifyAssignment(row({ submission_path: "entregas/u/1/a.pdf" }), { corte: CORTE })
        .tieneEvidencia
    ).toBe(true);
    expect(classifyAssignment(row({}), { corte: CORTE }).tieneEvidencia).toBe(false);
  });
});

describe("pendientes y semáforo", () => {
  it("pendientes = total − completadas − extemporáneas − entregadas (nunca negativo)", () => {
    expect(
      pendingFromCounters({ total: 10, completadas: 4, extemporaneas: 2, entregadas: 3 })
    ).toBe(1);
    expect(
      pendingFromCounters({ total: 1, completadas: 5, extemporaneas: 5, entregadas: 5 })
    ).toBe(0);
  });

  it("aplica los umbrales 75 / 50", () => {
    expect(semaforoFor(75, 10)).toBe("optimo");
    expect(semaforoFor(74.9, 10)).toBe("riesgo");
    expect(semaforoFor(50, 10)).toBe("riesgo");
    expect(semaforoFor(49.9, 10)).toBe("critico");
    expect(semaforoFor(90, 0)).toBe("sin_datos");
  });
});

describe("compareValues — comparación contra el mes anterior", () => {
  it("subir es favorable en cumplimiento", () => {
    const c = compareValues(68, 56, true);
    expect(c.delta).toBe(12);
    expect(c.trend).toBe("up");
    expect(c.favorable).toBe(true);
  });

  it("subir es desfavorable en atrasadas", () => {
    const c = compareValues(9, 4, false);
    expect(c.delta).toBe(5);
    expect(c.favorable).toBe(false);
  });

  it("sin mes anterior no hay comparación", () => {
    const c = compareValues(68, null, true);
    expect(c.delta).toBeNull();
    expect(c.trend).toBe("none");
  });
});

describe("buildKpis", () => {
  it("compone los indicadores con la regla oficial", () => {
    const kpis = buildKpis(
      { total: 50, completadas: 30, extemporaneas: 5, entregadas: 4, atrasadas: 6 },
      { tiempoPromedioEntregaDias: 2.5, porcentajeEntregasATiempo: 85.7 }
    );
    expect(kpis.cumplimiento).toBe(70);
    expect(kpis.pendientes).toBe(11);
    expect(kpis.atrasadas).toBe(6);
    expect(kpis.porcentajeEntregasATiempo).toBe(85.7);
  });
});
