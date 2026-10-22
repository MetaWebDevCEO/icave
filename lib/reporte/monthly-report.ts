/**
 * Servicio de cálculo del "Reporte Mensual de Cierre".
 *
 * Es una función PURA: recibe las asignaciones crudas + los catálogos (matriz,
 * nombres de supervisores) y devuelve el `MonthlyReport` completo. No toca la
 * base de datos, lo que la hace testeable y reutilizable tanto desde los
 * endpoints como desde el script que genera el PDF de ejemplo.
 *
 * La regla de cumplimiento NO vive aquí: vive en `lib/reporte/compliance.ts`.
 */

import {
  COMPLIANCE_RULE_VERSION,
  DEFAULT_COMPLIANCE_CONFIG,
  addToCounters,
  buildKpis,
  classifyAssignment,
  compareValues,
  computeCompliance,
  emptyCounters,
  normalizeStatusText,
  pendingFromCounters,
  round1,
  semaforoFor,
  type ComplianceCounters,
} from "./compliance";
import { buildHallazgos, buildRecomendaciones, buildResumenEjecutivo } from "./narrative";
import {
  belongsToMonth,
  cutoffForMonth,
  daysElapsedInMonth,
  dayOfMonthUtc,
  formatDateEs,
  formatDateTimeEs,
  lastNMonthKeys,
  monthKeyOf,
  monthLabelEs,
  monthLabelLowerEs,
  monthRangeUtc,
  parseDateValue,
  previousMonthKey,
} from "./period";
import type {
  ActivityStat,
  AssignmentRow,
  ComplianceConfig,
  DailyPoint,
  KpiComparison,
  KpiUnit,
  MonthKey,
  MonthlyReport,
  PriorityStat,
  ReportKpis,
  RiskTask,
  SupervisorRiskDetail,
  SupervisorRow,
  TaskAnnexRow,
  TrendPoint,
} from "./types";

export interface ReportSupervisorInfo {
  /** Puede faltar cuando el filtro se resuelve sólo por correo electrónico. */
  id?: string;
  email: string;
  nombre: string;
}

export interface BuildMonthlyReportInput {
  /** Mes solicitado (`YYYY-MM`, UTC). */
  monthKey: MonthKey;
  /** true → avance parcial del mes en curso (marca de agua PRELIMINAR). */
  parcial: boolean;
  /** Instante con el que se decide el corte y el mes en curso. */
  now?: Date;
  /** Folio consecutivo ya reservado para este reporte. */
  folio: string;
  generadoEn?: Date;
  generadoPor: { id: string; email: string; nombre: string };
  supervisorFiltro?: ReportSupervisorInfo | null;
  /**
   * Dataset amplio: todas las asignaciones que tocan el mes solicitado o
   * cualquiera de los `trendMonths` meses previos. El servicio se encarga de
   * asignar cada fila al mes que le corresponde.
   */
  rows: AssignmentRow[];
  /** Actividades de la Matriz de Control (para detectar las no asignadas). */
  actividadesMatriz?: string[];
  /** email (minúsculas) → nombre visible del supervisor. */
  supervisorNames?: Record<string, string>;
  config?: ComplianceConfig;
  /** Cantidad de meses de la gráfica de tendencia. Default: 6. */
  trendMonths?: number;
}

/* ------------------------------------------------------------------ */
/* Utilidades internas                                                 */
/* ------------------------------------------------------------------ */

const SIN_SUPERVISOR = "__sin_supervisor__";

function emailKey(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

function textOf(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw);
}

/** Nombre legible a partir del correo: "juan.perez@x.com" → "Juan Perez". */
export function displayNameFromEmail(email: string): string {
  if (!email || email === SIN_SUPERVISOR) return "Sin supervisor";
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Etiqueta normalizada de prioridad. */
export function priorityLabel(raw: unknown): string {
  const s = normalizeStatusText(raw);
  if (s === "") return "Sin prioridad";
  if (s.includes("no urg")) return "No Urgente";
  if (s.includes("urg")) return "Urgente";
  if (s.includes("med")) return "Medio";
  if (s.includes("alt")) return "Alta";
  if (s.includes("baj")) return "Baja";
  const original = textOf(raw);
  return original.charAt(0).toUpperCase() + original.slice(1);
}

const PRIORITY_ORDER = ["Urgente", "Medio", "No Urgente", "Alta", "Baja", "Sin prioridad"];

function priorityRank(label: string): number {
  const idx = PRIORITY_ORDER.indexOf(label);
  return idx === -1 ? PRIORITY_ORDER.length : idx;
}

/** Hash estable (FNV-1a) de la firma del dataset. Detecta cambios del contenido. */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/* ------------------------------------------------------------------ */
/* Métricas                                                            */
/* ------------------------------------------------------------------ */

interface Metricas {
  counters: ComplianceCounters;
  kpis: ReportKpis;
  evidenciaEntregadas: number;
  evidenciaFaltante: number;
  retroalimentacionPendiente: number;
  puntualidad: { aTiempo: number; extemporaneas: number; sinEntregar: number; diasPromedioAtraso: number | null };
}

function calcularMetricas(
  rows: AssignmentRow[],
  corte: Date,
  config: ComplianceConfig
): Metricas {
  const counters = emptyCounters();

  let evidenciaEntregadas = 0;
  let evidenciaFaltante = 0;
  let retroalimentacionPendiente = 0;
  let sumaEntrega = 0;
  let nEntrega = 0;
  let aTiempo = 0;
  let extemporaneas = 0;
  let sumaAtrasoExtemp = 0;
  let nAtrasoExtemp = 0;
  let sumaAtrasoAtrasadas = 0;
  let nAtrasoAtrasadas = 0;

  for (const row of rows) {
    const k = classifyAssignment(row, { corte });
    addToCounters(counters, k);

    if (k.completada || k.base === "completada" || k.entregada) {
      evidenciaEntregadas += 1;
      if (!k.tieneEvidencia) evidenciaFaltante += 1;
    }

    const comentario = textOf(row.reviewer_comment);
    if (comentario.length > 0 && k.base !== "completada") retroalimentacionPendiente += 1;

    const creada = parseDateValue(row.created_at);
    const entregada = parseDateValue(row.submitted_at);
    if (creada && entregada) {
      const dias = (entregada.getTime() - creada.getTime()) / 86_400_000;
      if (dias >= 0) {
        sumaEntrega += dias;
        nEntrega += 1;
      }
    }

    if (k.completada) aTiempo += 1;
    if (k.completadaExtemporanea) {
      extemporaneas += 1;
      if (k.diasAtraso !== null) {
        sumaAtrasoExtemp += k.diasAtraso;
        nAtrasoExtemp += 1;
      }
    }
    if (k.atrasada && k.diasAtraso !== null) {
      sumaAtrasoAtrasadas += k.diasAtraso;
      nAtrasoAtrasadas += 1;
    }
  }

  const tiempoPromedioEntregaDias = nEntrega > 0 ? round1(sumaEntrega / nEntrega) : null;
  const porcentajeEntregasATiempo =
    aTiempo + extemporaneas > 0 ? round1((aTiempo / (aTiempo + extemporaneas)) * 100) : null;
  const diasPromedioAtraso =
    nAtrasoExtemp > 0
      ? round1(sumaAtrasoExtemp / nAtrasoExtemp)
      : nAtrasoAtrasadas > 0
        ? round1(sumaAtrasoAtrasadas / nAtrasoAtrasadas)
        : null;

  const kpis = buildKpis(
    counters,
    { tiempoPromedioEntregaDias, porcentajeEntregasATiempo },
    config
  );

  return {
    counters,
    kpis,
    evidenciaEntregadas,
    evidenciaFaltante,
    retroalimentacionPendiente,
    puntualidad: {
      aTiempo,
      extemporaneas,
      sinEntregar: pendingFromCounters(counters),
      diasPromedioAtraso,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Construcción de secciones                                           */
/* ------------------------------------------------------------------ */

function buildComparativo(actual: ReportKpis | null, previo: ReportKpis | null): KpiComparison[] {
  const defs: { key: keyof ReportKpis; label: string; unit: KpiUnit; mejorAlto: boolean }[] = [
    { key: "total", label: "Asignadas", unit: "count", mejorAlto: false },
    { key: "completadas", label: "Completadas", unit: "count", mejorAlto: true },
    { key: "entregadas", label: "Entregadas", unit: "count", mejorAlto: false },
    { key: "pendientes", label: "Pendientes", unit: "count", mejorAlto: false },
    { key: "atrasadas", label: "Atrasadas", unit: "count", mejorAlto: false },
    { key: "extemporaneas", label: "Extemporáneas", unit: "count", mejorAlto: false },
    { key: "cumplimiento", label: "% Cumplimiento", unit: "percent", mejorAlto: true },
    { key: "tiempoPromedioEntregaDias", label: "Tiempo prom. entrega (días)", unit: "days", mejorAlto: false },
    { key: "porcentajeEntregasATiempo", label: "% Entregas a tiempo", unit: "percent", mejorAlto: true },
  ];

  return defs.map((def) => {
    const current = actual ? (actual[def.key] as number | null) : null;
    const previous = previo ? (previo[def.key] as number | null) : null;
    const cmp = compareValues(current, previous, def.mejorAlto);
    return {
      key: def.key,
      label: def.label,
      unit: def.unit,
      current,
      previous,
      delta: cmp.delta,
      deltaPct: cmp.deltaPct,
      trend: cmp.trend,
      favorable: cmp.favorable,
    };
  });
}

function buildSupervisores(
  monthRows: AssignmentRow[],
  prevRows: AssignmentRow[],
  corte: Date,
  cortePrevio: Date,
  config: ComplianceConfig,
  supervisorNames: Record<string, string>
): SupervisorRow[] {
  const actual = new Map<string, AssignmentRow[]>();
  for (const row of monthRows) {
    const key = emailKey(row.assigned_to_email) || SIN_SUPERVISOR;
    const list = actual.get(key);
    if (list) list.push(row);
    else actual.set(key, [row]);
  }

  const previo = new Map<string, AssignmentRow[]>();
  for (const row of prevRows) {
    const key = emailKey(row.assigned_to_email) || SIN_SUPERVISOR;
    const list = previo.get(key);
    if (list) list.push(row);
    else previo.set(key, [row]);
  }

  const filas: Omit<SupervisorRow, "rank">[] = [];

  for (const [key, list] of actual) {
    const counters = emptyCounters();
    for (const row of list) addToCounters(counters, classifyAssignment(row, { corte }));
    const cumplimiento = computeCompliance(counters, config);

    const listPrev = previo.get(key);
    let variacionPuntos: number | null = null;
    if (listPrev && listPrev.length > 0) {
      const countersPrev = emptyCounters();
      for (const row of listPrev) addToCounters(countersPrev, classifyAssignment(row, { corte: cortePrevio }));
      variacionPuntos = round1(cumplimiento - computeCompliance(countersPrev, config));
    }

    filas.push({
      email: key === SIN_SUPERVISOR ? "" : key,
      nombre: key === SIN_SUPERVISOR ? "Sin supervisor" : supervisorNames[key] ?? displayNameFromEmail(key),
      total: counters.total,
      completadas: counters.completadas,
      extemporaneas: counters.extemporaneas,
      entregadas: counters.entregadas,
      pendientes: pendingFromCounters(counters),
      atrasadas: counters.atrasadas,
      cumplimiento,
      semaforo: semaforoFor(cumplimiento, counters.total),
      variacionPuntos,
    });
  }

  filas.sort((a, b) => b.cumplimiento - a.cumplimiento || b.total - a.total || a.nombre.localeCompare(b.nombre));

  return filas.map((fila, index) => ({ ...fila, rank: index + 1 }));
}

function buildRiesgo(
  rows: AssignmentRow[],
  supervisores: SupervisorRow[],
  corte: Date
): SupervisorRiskDetail[] {
  const porSupervisor = new Map<string, RiskTask[]>();

  for (const row of rows) {
    const k = classifyAssignment(row, { corte });
    if (k.base === "completada") continue;
    const key = emailKey(row.assigned_to_email) || SIN_SUPERVISOR;
    const tarea: RiskTask = {
      actividad: textOf(row.title) || "Sin título",
      estado: textOf(row.status) || "Sin estado",
      prioridad: priorityLabel(row.priority),
      limite: formatDateEs(parseDateValue(row.due_at)),
      diasAtraso: k.diasAtraso,
    };
    const list = porSupervisor.get(key);
    if (list) list.push(tarea);
    else porSupervisor.set(key, [tarea]);
  }

  return supervisores
    .filter((s) => s.semaforo === "critico" || s.semaforo === "riesgo")
    .sort((a, b) => a.cumplimiento - b.cumplimiento)
    .map((s) => {
      const key = s.email || SIN_SUPERVISOR;
      const tareas = (porSupervisor.get(key) ?? [])
        .sort((a, b) => (b.diasAtraso ?? -1) - (a.diasAtraso ?? -1))
        .slice(0, 10);
      return {
        email: s.email,
        nombre: s.nombre,
        cumplimiento: s.cumplimiento,
        semaforo: s.semaforo,
        total: s.total,
        atrasadas: s.atrasadas,
        tareas,
      };
    });
}

function buildActividades(
  rows: AssignmentRow[],
  corte: Date,
  config: ComplianceConfig,
  actividadesMatriz: string[]
): MonthlyReport["actividades"] {
  const mapa = new Map<string, { label: string; counters: ComplianceCounters }>();

  for (const row of rows) {
    const label = textOf(row.title) || "Sin actividad";
    const key = normalizeStatusText(label);
    let entry = mapa.get(key);
    if (!entry) {
      entry = { label, counters: emptyCounters() };
      mapa.set(key, entry);
    }
    addToCounters(entry.counters, classifyAssignment(row, { corte }));
  }

  const stats: ActivityStat[] = [...mapa.values()].map(({ label, counters }) => ({
    actividad: label,
    total: counters.total,
    completadas: counters.completadas + counters.extemporaneas,
    atrasadas: counters.atrasadas,
    cumplimiento: computeCompliance(counters, config),
  }));

  const topCumplidas = [...stats]
    .sort((a, b) => b.cumplimiento - a.cumplimiento || b.total - a.total || a.actividad.localeCompare(b.actividad))
    .slice(0, 5);

  const topAtrasadas = [...stats]
    .filter((s) => s.atrasadas > 0)
    .sort((a, b) => b.atrasadas - a.atrasadas || a.cumplimiento - b.cumplimiento)
    .slice(0, 5);

  const asignadas = new Set(mapa.keys());
  const noAsignadas = actividadesMatriz.filter((a) => {
    const key = normalizeStatusText(a);
    return key.length > 0 && !asignadas.has(key);
  });

  return { topCumplidas, topAtrasadas, noAsignadas };
}

function buildPrioridad(
  rows: AssignmentRow[],
  corte: Date,
  config: ComplianceConfig
): PriorityStat[] {
  const mapa = new Map<string, ComplianceCounters>();
  for (const row of rows) {
    const label = priorityLabel(row.priority);
    let counters = mapa.get(label);
    if (!counters) {
      counters = emptyCounters();
      mapa.set(label, counters);
    }
    addToCounters(counters, classifyAssignment(row, { corte }));
  }

  return [...mapa.entries()]
    .map(([prioridad, counters]) => ({
      prioridad,
      total: counters.total,
      completadas: counters.completadas + counters.extemporaneas,
      cumplimiento: computeCompliance(counters, config),
    }))
    .sort((a, b) => priorityRank(a.prioridad) - priorityRank(b.prioridad) || b.total - a.total);
}

function buildActividadDiaria(rows: AssignmentRow[], monthKey: MonthKey, dias: number): DailyPoint[] {
  const puntos: DailyPoint[] = [];
  for (let dia = 1; dia <= dias; dia++) {
    puntos.push({ dia, creadas: 0, entregadas: 0, completadas: 0 });
  }

  const idx = (raw: unknown, dia: number): boolean => {
    const d = parseDateValue(raw);
    if (!d) return false;
    if (monthKeyOf(raw) !== monthKey) return false;
    return dayOfMonthUtc(d) === dia;
  };

  for (const row of rows) {
    const base = normalizeStatusText(row.status);
    for (let dia = 1; dia <= dias; dia++) {
      const punto = puntos[dia - 1];
      if (idx(row.created_at, dia)) punto.creadas += 1;
      if (idx(row.submitted_at, dia)) {
        punto.entregadas += 1;
        if (base.includes("complet") || base.includes("done") || base.includes("final") || base.includes("cerrad")) {
          punto.completadas += 1;
        }
      }
    }
  }

  return puntos;
}

function buildTendencia(
  rows: AssignmentRow[],
  monthKey: MonthKey,
  meses: number,
  now: Date,
  config: ComplianceConfig
): TrendPoint[] {
  return lastNMonthKeys(monthKey, meses).map((key) => {
    const corte = cutoffForMonth(key, now, key >= monthKey);
    const counters = emptyCounters();
    for (const row of rows) {
      if (!belongsToMonth(row, key)) continue;
      addToCounters(counters, classifyAssignment(row, { corte }));
    }
    return {
      monthKey: key,
      label: monthLabelEs(key),
      cumplimiento: computeCompliance(counters, config),
      total: counters.total,
    };
  });
}

function buildAnexo(
  rows: AssignmentRow[],
  corte: Date,
  supervisorNames: Record<string, string>
): TaskAnnexRow[] {
  return rows
    .map((row) => {
      const k = classifyAssignment(row, { corte });
      const email = emailKey(row.assigned_to_email);
      const puntualidad: TaskAnnexRow["puntualidad"] =
        k.base !== "completada" ? "no_aplica" : k.extemporanea ? "extemporanea" : "a_tiempo";
      return {
        id: row.id,
        actividad: textOf(row.title) || "Sin título",
        supervisor: email ? supervisorNames[email] ?? displayNameFromEmail(email) : "Sin supervisor",
        supervisorEmail: email,
        prioridad: priorityLabel(row.priority),
        publicacion: formatDateEs(parseDateValue(row.created_at)),
        limite: formatDateEs(parseDateValue(row.due_at)),
        entrega: formatDateEs(parseDateValue(row.submitted_at)),
        estado: textOf(row.status) || "Sin estado",
        puntualidad,
        evidencia: k.tieneEvidencia,
        ultimoComentario: textOf(row.reviewer_comment) || null,
      };
    })
    .sort((a, b) => a.supervisor.localeCompare(b.supervisor) || a.actividad.localeCompare(b.actividad));
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

export function buildMonthlyReport(input: BuildMonthlyReportInput): MonthlyReport {
  const config = input.config ?? DEFAULT_COMPLIANCE_CONFIG;
  const now = input.now ?? new Date();
  const generadoEn = input.generadoEn ?? now;
  const { monthKey, parcial } = input;

  const corte = cutoffForMonth(monthKey, now, parcial);
  const prevKey = previousMonthKey(monthKey);
  const cortePrevio = cutoffForMonth(prevKey, now, false);

  const monthRows = input.rows.filter((r) => belongsToMonth(r, monthKey));
  const prevRows = input.rows.filter((r) => belongsToMonth(r, prevKey));

  const supervisorNames: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.supervisorNames ?? {})) supervisorNames[k.toLowerCase()] = v;

  const metricas = calcularMetricas(monthRows, corte, config);
  const metricasPrevias = calcularMetricas(prevRows, cortePrevio, config);
  const hayMesAnterior = metricasPrevias.counters.total > 0;

  const supervisores = buildSupervisores(
    monthRows,
    prevRows,
    corte,
    cortePrevio,
    config,
    supervisorNames
  );

  const actividades = buildActividades(
    monthRows,
    corte,
    config,
    input.actividadesMatriz ?? []
  );

  const prioridad = buildPrioridad(monthRows, corte, config);
  const dias = parcial ? daysElapsedInMonth(monthKey, now) : monthRangeUtc(monthKey).lastDay;
  const actividadDiaria = buildActividadDiaria(monthRows, monthKey, dias);
  const tendencia = buildTendencia(input.rows, monthKey, input.trendMonths ?? 6, now, config);
  const anexo = buildAnexo(monthRows, corte, supervisorNames);

  const hashDatos = stableHash(
    monthRows
      .map((r) => `${r.id}:${textOf(r.status)}:${textOf(r.submitted_at)}:${textOf(r.due_at)}`)
      .sort()
      .join("|")
  );

  const narrative = {
    monthLabelLower: monthLabelLowerEs(monthKey),
    prevMonthLabelLower: hayMesAnterior ? monthLabelLowerEs(prevKey) : null,
    parcial,
    kpis: metricas.kpis,
    prevKpis: hayMesAnterior ? metricasPrevias.kpis : null,
    supervisores,
    puntualidad: metricas.puntualidad,
    actividades,
    prioridad,
    evidencia: {
      entregadas: metricas.evidenciaEntregadas,
      sinEvidencia: metricas.evidenciaFaltante,
    },
    retroalimentacionPendiente: metricas.retroalimentacionPendiente,
  };

  return {
    meta: {
      monthKey,
      monthLabel: monthLabelEs(monthKey),
      corte: corte.toISOString(),
      corteLabel: formatDateEs(corte),
      generadoEn: generadoEn.toISOString(),
      generadoEnLabel: formatDateTimeEs(generadoEn),
      parcial,
      folio: input.folio,
      generadoPor: input.generadoPor,
      supervisorFiltro: input.supervisorFiltro ?? null,
      sinDatos: metricas.counters.total === 0,
      hashDatos,
      reglaVersion: COMPLIANCE_RULE_VERSION,
    },
    resumenEjecutivo: buildResumenEjecutivo(narrative),
    kpis: metricas.kpis,
    kpisMesAnterior: hayMesAnterior ? metricasPrevias.kpis : null,
    comparativo: buildComparativo(metricas.kpis, hayMesAnterior ? metricasPrevias.kpis : null),
    supervisores,
    supervisoresEnRiesgo: buildRiesgo(monthRows, supervisores, corte),
    actividades,
    puntualidad: metricas.puntualidad,
    prioridad,
    actividadDiaria,
    tendencia,
    hallazgos: buildHallazgos(narrative),
    recomendaciones: buildRecomendaciones(narrative),
    anexo,
  };
}
