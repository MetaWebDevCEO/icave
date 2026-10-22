/**
 * Modelo de datos del "Reporte Mensual de Cierre" (PROMAS ICAVE).
 *
 * Este archivo es el CONTRATO entre:
 *   - el servicio de cálculo (lib/reporte/monthly-report.ts)
 *   - la plantilla PDF (lib/reporte/pdf/reporte-mensual-pdf.tsx)
 *   - los endpoints API (app/api/reporte/**)
 *
 * Regla de oro: ningún texto del reporte se inventa. Todo número que aparece
 * en el PDF proviene de este modelo, y todo enunciado narrativo cita la cifra
 * que lo respalda.
 */

/** Clave de mes en formato UTC `YYYY-MM`. */
export type MonthKey = string;

/** Unidad de un KPI, para saber cómo formatearlo y compararlo. */
export type KpiUnit = "count" | "percent" | "days";

/**
 * Configuración de la regla de cumplimiento.
 * Permite al cliente decidir si las tareas "Entregadas" (entregadas por el
 * supervisor y aún sin revisar) cuentan como cumplidas.
 */
export interface ComplianceConfig {
  /** true → el numerador incluye las "Entregadas". Default: false. */
  includeEntregadas: boolean;
}

/** Estado base normalizado de una asignación. */
export type BaseStatus = "completada" | "entregada" | "en_curso" | "pendiente" | "otro";

/** Semáforo de desempeño por supervisor. */
export type Semaforo = "optimo" | "riesgo" | "critico" | "sin_datos";

/** Fila cruda de `public.asignaciones` tal como la consume el servicio. */
export interface AssignmentRow {
  id: string;
  title?: unknown;
  description?: unknown;
  status?: unknown;
  priority?: unknown;
  created_at?: unknown;
  due_at?: unknown;
  submitted_at?: unknown;
  assigned_to_email?: unknown;
  submitted_by_email?: unknown;
  submission_files?: unknown;
  submission_path?: unknown;
  submission_name?: unknown;
  reviewer_comment?: unknown;
  reviewer_comment_at?: unknown;
}

/** Resultado de clasificar una asignación contra una fecha de corte. */
export interface AssignmentClassification {
  base: BaseStatus;
  /** Completada en plazo (cuenta al numerador de cumplimiento). */
  completada: boolean;
  /** Completada después de la fecha límite (cuenta al numerador). */
  completadaExtemporanea: boolean;
  /** Entregada por el supervisor, pendiente de revisión. */
  entregada: boolean;
  /** No completada (pendiente / en curso / sin estado). */
  pendiente: boolean;
  /** No completada y la fecha de corte supera la fecha límite. */
  atrasada: boolean;
  /** Completada después de la fecha límite. */
  extemporanea: boolean;
  /** null cuando la tarea no está completada (no aplica). */
  aTiempo: boolean | null;
  /** Días de atraso (entrega tardía) o de mora (tarea vencida). */
  diasAtraso: number | null;
  /** ¿La entrega trae al menos un archivo de evidencia? */
  tieneEvidencia: boolean;
}

/** KPIs de un mes. */
export interface ReportKpis {
  /** Total de asignaciones creadas en el mes (denominador de cumplimiento). */
  total: number;
  /** Completadas dentro del plazo. */
  completadas: number;
  /** Completadas después de la fecha límite. */
  extemporaneas: number;
  /** Entregadas y aún sin revisar. */
  entregadas: number;
  /** Ni completadas ni entregadas. */
  pendientes: number;
  /** No completadas con fecha límite vencida al corte. */
  atrasadas: number;
  /** % cumplimiento = (completadas + extemporáneas [+ entregadas]) / total. */
  cumplimiento: number;
  /** Tiempo promedio de entrega en días (creación → primera entrega). */
  tiempoPromedioEntregaDias: number | null;
  /** % de entregas realizadas dentro del plazo. */
  porcentajeEntregasATiempo: number | null;
}

/** Comparación de un KPI contra el mes anterior. */
export interface KpiComparison {
  key: keyof ReportKpis | "cumplimiento";
  label: string;
  unit: KpiUnit;
  current: number | null;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
  trend: "up" | "down" | "flat" | "none";
  /** ¿El movimiento es bueno? (subir en cumplimiento sí, subir en atrasadas no). */
  favorable: boolean | null;
}

/** Fila del ranking de supervisores. */
export interface SupervisorRow {
  email: string;
  nombre: string;
  total: number;
  completadas: number;
  extemporaneas: number;
  entregadas: number;
  pendientes: number;
  atrasadas: number;
  cumplimiento: number;
  semaforo: Semaforo;
  /** Puntos de diferencia contra el mes anterior (null si no hay base). */
  variacionPuntos: number | null;
  rank: number;
}

/** Detalle de un supervisor crítico o en riesgo. */
export interface SupervisorRiskDetail {
  email: string;
  nombre: string;
  cumplimiento: number;
  semaforo: Semaforo;
  total: number;
  atrasadas: number;
  /** Tareas que sustentan el diagnóstico. */
  tareas: RiskTask[];
}

export interface RiskTask {
  actividad: string;
  estado: string;
  prioridad: string;
  limite: string | null;
  diasAtraso: number | null;
}

/** Estadística por actividad de la Matriz de Control. */
export interface ActivityStat {
  actividad: string;
  total: number;
  completadas: number;
  atrasadas: number;
  cumplimiento: number;
}

/** Estadística por prioridad. */
export interface PriorityStat {
  prioridad: string;
  total: number;
  completadas: number;
  cumplimiento: number;
}

/** Punto de la serie diaria del mes. */
export interface DailyPoint {
  dia: number;
  creadas: number;
  entregadas: number;
  completadas: number;
}

/** Punto de la tendencia de 6 meses. */
export interface TrendPoint {
  monthKey: MonthKey;
  label: string;
  cumplimiento: number;
  total: number;
}

/** Fila del anexo detallado de tareas. */
export interface TaskAnnexRow {
  id: string;
  actividad: string;
  supervisor: string;
  supervisorEmail: string;
  prioridad: string;
  publicacion: string | null;
  limite: string | null;
  entrega: string | null;
  estado: string;
  puntualidad: "a_tiempo" | "extemporanea" | "no_aplica";
  evidencia: boolean;
  ultimoComentario: string | null;
}

/** Encabezado / metadatos del reporte. */
export interface ReportMeta {
  monthKey: MonthKey;
  /** "Octubre 2026" */
  monthLabel: string;
  /** ISO de la fecha de corte. */
  corte: string;
  /** "31/10/2026" */
  corteLabel: string;
  generadoEn: string;
  generadoEnLabel: string;
  /** true → reporte preliminar del mes en curso (marca de agua PRELIMINAR). */
  parcial: boolean;
  folio: string;
  generadoPor: { id: string; email: string; nombre: string };
  supervisorFiltro: { id?: string; email: string; nombre: string } | null;
  /** true cuando el mes/filtro no tiene ninguna asignación. */
  sinDatos: boolean;
  /** Firma del dataset usado (para detectar cambios entre snapshot y datos vivos). */
  hashDatos: string;
  /** Versión de la regla de cumplimiento aplicada. */
  reglaVersion: string;
}

/** Modelo completo del reporte. */
export interface MonthlyReport {
  meta: ReportMeta;
  resumenEjecutivo: string[];
  kpis: ReportKpis;
  kpisMesAnterior: ReportKpis | null;
  comparativo: KpiComparison[];
  supervisores: SupervisorRow[];
  supervisoresEnRiesgo: SupervisorRiskDetail[];
  actividades: {
    topCumplidas: ActivityStat[];
    topAtrasadas: ActivityStat[];
    noAsignadas: string[];
  };
  puntualidad: {
    aTiempo: number;
    extemporaneas: number;
    sinEntregar: number;
    diasPromedioAtraso: number | null;
  };
  prioridad: PriorityStat[];
  actividadDiaria: DailyPoint[];
  tendencia: TrendPoint[];
  hallazgos: string[];
  recomendaciones: string[];
  anexo: TaskAnnexRow[];
}

/** Registro de bitácora / historial de reportes generados. */
export interface ReportHistoryEntry {
  id: string;
  folio: string;
  monthKey: MonthKey;
  monthLabel: string;
  parcial: boolean;
  generadoEn: string;
  generadoEnLabel: string;
  generadoPorEmail: string | null;
  generadoPorNombre: string | null;
  supervisorEmail: string | null;
  cumplimiento: number | null;
  total: number | null;
  /** Datos guardados en el snapshot (permite re-descargar idéntico). */
  snapshot: MonthlyReport | null;
}
