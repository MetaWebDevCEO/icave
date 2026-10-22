/**
 * REGLA ÚNICA DE CUMPLIMIENTO (PROMAS ICAVE).
 *
 * Este archivo es la fuente de verdad del cálculo de cumplimiento. Cualquier
 * vista que muestre un % de cumplimiento (Dashboard del Revisor, Supervisores,
 * Reporte mensual) debe usar estas funciones y NO reimplementar la regla.
 *
 * Definiciones oficiales:
 *   % cumplimiento = (Completadas + Completadas extemporáneas) / Total asignadas
 *   (configurable: `includeEntregadas` suma también las "Entregadas")
 *
 *   Atrasada      = NO completada y (fecha de corte > fecha límite)
 *   Extemporánea  = completada DESPUÉS de la fecha límite
 *   A tiempo      = completada en o antes de la fecha límite
 */

import type {
  AssignmentClassification,
  AssignmentRow,
  BaseStatus,
  ComplianceConfig,
  ReportKpis,
  Semaforo,
} from "./types";

/** Versión de la regla. Se guarda en cada snapshot para trazabilidad. */
export const COMPLIANCE_RULE_VERSION = "2026-10-v1";

/** Configuración por defecto: estricta (solo completadas cuentan). */
export const DEFAULT_COMPLIANCE_CONFIG: ComplianceConfig = {
  includeEntregadas: false,
};

/** Umbrales del semáforo por supervisor. */
export const SEMAFORO_UMBRALES = {
  optimo: 75,
  riesgo: 50,
} as const;

/** Texto sin acentos, minúsculas y sin espacios sobrantes. */
export function normalizeStatusText(raw: unknown): string {
  const value = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Reduce el `status` de la base a un estado base.
 * Tolera acentos, mayúsculas y etiquetas heredadas en inglés.
 */
export function baseStatus(raw: unknown): BaseStatus {
  const s = normalizeStatusText(raw);
  if (s === "") return "pendiente";
  if (
    s.includes("complet") ||
    s.includes("completad") ||
    s.includes("done") ||
    s.includes("termin") ||
    s.includes("final") ||
    s.includes("cerrad")
  ) {
    return "completada";
  }
  if (s.includes("entreg")) return "entregada";
  if (
    s.includes("curso") ||
    s.includes("progres") ||
    s.includes("inici") ||
    s.includes("ejecu") ||
    s.includes("desarr")
  ) {
    return "en_curso";
  }
  if (
    s.includes("pend") ||
    s.includes("nueva") ||
    s.includes("nuevo") ||
    s.includes("abiert") ||
    s.includes("asign") ||
    s.includes("espera") ||
    s.includes("open")
  ) {
    return "pendiente";
  }
  return "otro";
}

/** ¿La entrega trae al menos un archivo de evidencia? */
export function hasEvidence(row: AssignmentRow): boolean {
  const files = row.submission_files;
  let count = 0;
  if (Array.isArray(files)) count = files.length;
  else if (files && typeof files === "object") count = Object.keys(files).length;
  if (count > 0) return true;
  const path = typeof row.submission_path === "string" ? row.submission_path.trim() : "";
  return path.length > 0;
}

/** Días completos entre dos instantes (nunca negativo). */
export function diffDays(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  if (ms <= 0) return 0;
  return Math.round((ms / 86_400_000) * 10) / 10;
}

/**
 * Clasifica una asignación contra la fecha de corte.
 * `corte` es el último instante considerado (fin de mes o "hoy" en el parcial).
 */
export function classifyAssignment(
  row: AssignmentRow,
  opts: { corte: Date }
): AssignmentClassification {
  const base = baseStatus(row.status);
  const due = parseDate(row.due_at);
  const submitted = parseDate(row.submitted_at);
  const corte = opts.corte;

  const completadaBase = base === "completada";
  const entregada = base === "entregada";
  const extemporanea =
    completadaBase && !!due && !!submitted && submitted.getTime() > due.getTime();
  const completada = completadaBase && !extemporanea;
  const aTiempo = completadaBase ? !extemporanea : null;

  let atrasada = false;
  if (!completadaBase && due && corte.getTime() > due.getTime()) atrasada = true;

  let diasAtraso: number | null = null;
  if (extemporanea && due && submitted) diasAtraso = diffDays(submitted, due);
  else if (atrasada && due) diasAtraso = diffDays(corte, due);

  return {
    base,
    completada,
    completadaExtemporanea: extemporanea,
    entregada,
    pendiente: !completadaBase,
    atrasada,
    extemporanea,
    aTiempo,
    diasAtraso,
    tieneEvidencia: hasEvidence(row),
  };
}

/** Redondeo a 1 decimal. */
export function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/** Redondeo a entero. */
export function round0(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** Acumulador de contadores usado por el servicio de cálculo. */
export interface ComplianceCounters {
  total: number;
  completadas: number;
  extemporaneas: number;
  entregadas: number;
  atrasadas: number;
}

export function emptyCounters(): ComplianceCounters {
  return { total: 0, completadas: 0, extemporaneas: 0, entregadas: 0, atrasadas: 0 };
}

export function addToCounters(c: ComplianceCounters, k: AssignmentClassification): void {
  c.total += 1;
  if (k.completada) c.completadas += 1;
  if (k.completadaExtemporanea) c.extemporaneas += 1;
  if (k.entregada) c.entregadas += 1;
  if (k.atrasada) c.atrasadas += 1;
}

/**
 * FÓRMULA OFICIAL DE CUMPLIMIENTO.
 * `total` es el denominador (asignaciones creadas en el periodo).
 */
export function computeCompliance(
  counters: {
    total: number;
    completadas: number;
    extemporaneas: number;
    entregadas?: number;
  },
  config: ComplianceConfig = DEFAULT_COMPLIANCE_CONFIG
): number {
  const total = counters.total ?? 0;
  if (total <= 0) return 0;
  const numerador =
    (counters.completadas ?? 0) +
    (counters.extemporaneas ?? 0) +
    (config.includeEntregadas ? counters.entregadas ?? 0 : 0);
  return round1((numerador / total) * 100);
}

/** Pendientes = total − completadas − extemporáneas − entregadas. */
export function pendingFromCounters(c: {
  total: number;
  completadas: number;
  extemporaneas: number;
  entregadas: number;
}): number {
  const v = c.total - c.completadas - c.extemporaneas - c.entregadas;
  return v > 0 ? v : 0;
}

/** Semáforo: ≥75 óptimo · 50–74 en riesgo · <50 crítico. */
export function semaforoFor(cumplimiento: number, total: number): Semaforo {
  if (total <= 0) return "sin_datos";
  if (cumplimiento >= SEMAFORO_UMBRALES.optimo) return "optimo";
  if (cumplimiento >= SEMAFORO_UMBRALES.riesgo) return "riesgo";
  return "critico";
}

/** Etiqueta legible del semáforo. */
export function semaforoLabel(s: Semaforo): string {
  switch (s) {
    case "optimo":
      return "Óptimo";
    case "riesgo":
      return "En riesgo";
    case "critico":
      return "Crítico";
    default:
      return "Sin datos";
  }
}

/** Compara un valor contra el mes anterior y decide si el movimiento es bueno. */
export function compareValues(
  current: number | null,
  previous: number | null,
  betterWhenHigher: boolean
): {
  delta: number | null;
  deltaPct: number | null;
  trend: "up" | "down" | "flat" | "none";
  favorable: boolean | null;
} {
  if (current === null || previous === null) {
    return { delta: null, deltaPct: null, trend: "none", favorable: null };
  }
  const delta = round1(current - previous);
  const deltaPct =
    previous === 0 ? null : round1(((current - previous) / Math.abs(previous)) * 100);
  let trend: "up" | "down" | "flat" = "flat";
  if (delta > 0) trend = "up";
  else if (delta < 0) trend = "down";
  const favorable = delta === 0 ? null : betterWhenHigher ? delta > 0 : delta < 0;
  return { delta, deltaPct, trend, favorable };
}

/** Construye los KPIs a partir de contadores + métricas de puntualidad. */
export function buildKpis(
  counters: ComplianceCounters,
  extra: {
    tiempoPromedioEntregaDias: number | null;
    porcentajeEntregasATiempo: number | null;
  },
  config: ComplianceConfig = DEFAULT_COMPLIANCE_CONFIG
): ReportKpis {
  return {
    total: counters.total,
    completadas: counters.completadas,
    extemporaneas: counters.extemporaneas,
    entregadas: counters.entregadas,
    pendientes: pendingFromCounters(counters),
    atrasadas: counters.atrasadas,
    cumplimiento: computeCompliance(counters, config),
    tiempoPromedioEntregaDias: extra.tiempoPromedioEntregaDias,
    porcentajeEntregasATiempo: extra.porcentajeEntregasATiempo,
  };
}
