/**
 * Capa de acceso a datos y orquestación del "Reporte Mensual de Cierre".
 *
 * Sólo se ejecuta en el servidor (usa la SERVICE ROLE KEY). Se encarga de:
 *   - traer las asignaciones del periodo (y de los 6 meses previos),
 *   - reservar el folio consecutivo,
 *   - congelar el snapshot oficial de los meses cerrados,
 *   - registrar la bitácora de descargas,
 *   - devolver el `MonthlyReport` ya calculado.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { makeAdminClientOrNull, safeListUsers } from "@/lib/safe-auth";
import { DEFAULT_COMPLIANCE_CONFIG } from "./compliance";
import { buildMonthlyReport, displayNameFromEmail, type ReportSupervisorInfo } from "./monthly-report";
import { addMonths, formatDateTimeEs, monthLabelEs, monthRangeUtc } from "./period";
import type { AssignmentRow, MonthKey, MonthlyReport, ReportHistoryEntry } from "./types";

/** Columnas de `asignaciones`, de la más completa a la más básica. */
const ASSIGNMENT_SELECTS = [
  [
    "id",
    "created_at",
    "status",
    "title",
    "description",
    "due_at",
    "priority",
    "revisor_id",
    "assigned_to_email",
    "submitted_at",
    "submitted_by_email",
    "submission_files",
    "submission_path",
    "submission_name",
    "reviewer_comment",
    "reviewer_comment_at",
  ].join(","),
  [
    "id",
    "created_at",
    "status",
    "title",
    "description",
    "due_at",
    "priority",
    "revisor_id",
    "assigned_to_email",
    "submitted_at",
    "submission_path",
    "reviewer_comment",
    "reviewer_comment_at",
  ].join(","),
  [
    "id",
    "created_at",
    "status",
    "title",
    "description",
    "due_at",
    "priority",
    "revisor_id",
    "assigned_to_email",
    "reviewer_comment",
    "reviewer_comment_at",
  ].join(","),
];

export const REPORT_TREND_MONTHS = 6;
export const REPORT_HISTORY_LIMIT = 60;

export interface ReportUserContext {
  id: string;
  email: string;
  nombre: string;
}

/* ------------------------------------------------------------------ */
/* Clientes y catálogos                                                */
/* ------------------------------------------------------------------ */

export function getReportAdminClient(): SupabaseClient | null {
  return makeAdminClientOrNull();
}

function toIso(value: Date): string {
  return value.toISOString();
}

/**
 * Trae las asignaciones del mes solicitado y de los meses de la tendencia.
 * El mes de una asignación es el de su `created_at`, así que basta con filtrar
 * por esa columna. Se intenta primero el SELECT más completo y se degrada si
 * alguna columna no existe (schema cache desactualizado).
 */
export async function fetchReportRows(
  client: SupabaseClient,
  opts: { monthKey: MonthKey; supervisorEmail?: string | null; trendMonths?: number }
): Promise<AssignmentRow[]> {
  const trend = opts.trendMonths ?? REPORT_TREND_MONTHS;
  const windowStartKey = addMonths(opts.monthKey, -(trend - 1));
  const startIso = toIso(monthRangeUtc(windowStartKey).start);
  const endIso = toIso(monthRangeUtc(opts.monthKey).end);

  let lastError: unknown = null;
  for (const select of ASSIGNMENT_SELECTS) {
    let query = client
      .from("asignaciones")
      .select(select)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .limit(20000);
    if (opts.supervisorEmail) {
      query = query.eq("assigned_to_email", opts.supervisorEmail.toLowerCase());
    }
    const { data, error } = await query;
    if (!error) return (data ?? []) as unknown as AssignmentRow[];
    lastError = error;
  }

  console.warn(
    "[reporte] fetchReportRows degradó todas las proyecciones. Último error:",
    lastError instanceof Error ? lastError.message : String(lastError)
  );
  return [];
}

/** Actividades registradas en la Matriz de Control. */
export async function fetchMatrizActividades(client: SupabaseClient): Promise<string[]> {
  for (const select of ["actividad", "id, actividad"]) {
    const { data, error } = await client.from("matriz").select(select).limit(5000);
    if (error) continue;
    const out: string[] = [];
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const actividad = typeof row.actividad === "string" ? row.actividad.trim() : "";
      if (actividad) out.push(actividad);
    }
    return out;
  }
  return [];
}

/** email (minúsculas) → nombre visible, usando auth.users + asignaciones. */
export async function fetchSupervisorNames(
  client: SupabaseClient
): Promise<Record<string, string>> {
  const catalog = await fetchSupervisorCatalog(client);
  const names: Record<string, string> = {};
  for (const s of catalog) names[s.email] = s.nombre;
  return names;
}

/**
 * Catálogo de supervisores para el filtro de la UI: los usuarios dados de alta
 * en auth.users más cualquier correo que aparezca asignado en `asignaciones`.
 */
export async function fetchSupervisorCatalog(client: SupabaseClient): Promise<ReportSupervisorInfo[]> {
  const byEmail = new Map<string, ReportSupervisorInfo>();

  const users = await safeListUsers({ perPage: 1000, label: "reporte:supervisorCatalog" });
  for (const user of users) {
    if (!user.email) continue;
    const email = user.email.trim().toLowerCase();
    const meta = user.user_metadata ?? {};
    const nombre =
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta.display_name === "string" && meta.display_name.trim()) ||
      (typeof meta.name === "string" && meta.name.trim()) ||
      displayNameFromEmail(email);
    byEmail.set(email, { id: user.id, email, nombre });
  }

  const { data } = await client
    .from("asignaciones")
    .select("assigned_to_email")
    .limit(5000);
  for (const row of (data ?? []) as Array<{ assigned_to_email?: unknown }>) {
    const email = typeof row.assigned_to_email === "string" ? row.assigned_to_email.trim().toLowerCase() : "";
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, { id: email, email, nombre: displayNameFromEmail(email) });
  }

  return [...byEmail.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Acepta el email o el id del supervisor y devuelve email + nombre. */
export async function resolveSupervisorEmail(
  client: SupabaseClient,
  raw: string | null | undefined
): Promise<{ email: string; nombre: string } | null> {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;

  const lower = value.toLowerCase();
  const catalog = await fetchSupervisorCatalog(client);
  const found = catalog.find((s) => s.id === value || s.email === lower);
  if (found) return { email: found.email, nombre: found.nombre };
  if (lower.includes("@")) return { email: lower, nombre: displayNameFromEmail(lower) };
  return null;
}

/* ------------------------------------------------------------------ */
/* Folio y persistencia                                                */
/* ------------------------------------------------------------------ */

/**
 * Reserva el folio consecutivo del reporte. Usa la función SQL
 * `reporte_next_folio`; si no existe, cae a un conteo local.
 */
export async function reserveFolio(
  client: SupabaseClient,
  monthKey: MonthKey,
  parcial: boolean
): Promise<string> {
  const rpc = await client.rpc("reporte_next_folio", { p_month: monthKey, p_parcial: parcial });
  if (!rpc.error && typeof rpc.data === "string" && rpc.data.trim()) return rpc.data.trim();

  const { count } = await client
    .from("reporte_mensual")
    .select("id", { count: "exact", head: true })
    .eq("month_key", monthKey)
    .eq("parcial", parcial);
  const n = (count ?? 0) + 1;
  return `REP-${monthKey}${parcial ? "-P" : ""}-${String(n).padStart(4, "0")}`;
}

interface ReportRowShape {
  id?: string;
  folio?: string;
  month_key?: string;
  parcial?: boolean;
  supervisor_email?: string | null;
  supervisor_nombre?: string | null;
  total?: number | null;
  cumplimiento?: number | string | null;
  snapshot?: MonthlyReport | null;
  generado_por_email?: string | null;
  generado_por_nombre?: string | null;
  generado_en?: string | null;
}

function mapHistoryRow(row: ReportRowShape): ReportHistoryEntry {
  const monthKey = typeof row.month_key === "string" ? row.month_key : "";
  return {
    id: typeof row.id === "string" ? row.id : "",
    folio: typeof row.folio === "string" ? row.folio : "",
    monthKey,
    monthLabel: monthKey ? monthLabelEs(monthKey) : "",
    parcial: row.parcial === true,
    generadoEn: typeof row.generado_en === "string" ? row.generado_en : "",
    generadoEnLabel: formatDateTimeEs(row.generado_en ?? null),
    generadoPorEmail: row.generado_por_email ?? null,
    generadoPorNombre: row.generado_por_nombre ?? null,
    supervisorEmail: row.supervisor_email ?? null,
    cumplimiento: row.cumplimiento === null || row.cumplimiento === undefined ? null : Number(row.cumplimiento),
    total: row.total ?? null,
    snapshot: (row.snapshot as MonthlyReport | null) ?? null,
  };
}

/** Snapshot oficial congelado del mes (si ya se generó alguna vez). */
export async function getOfficialSnapshot(
  client: SupabaseClient,
  monthKey: MonthKey
): Promise<ReportHistoryEntry | null> {
  const { data, error } = await client
    .from("reporte_mensual")
    .select("*")
    .eq("month_key", monthKey)
    .eq("parcial", false)
    .is("supervisor_email", null)
    .order("generado_en", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapHistoryRow(data as ReportRowShape);
}

/** Descarga / re-descarga un reporte guardado por su id. */
export async function getHistoryEntry(
  client: SupabaseClient,
  id: string
): Promise<ReportHistoryEntry | null> {
  const { data, error } = await client
    .from("reporte_mensual")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return mapHistoryRow(data as ReportRowShape);
}

export async function listHistorial(
  client: SupabaseClient,
  limit = REPORT_HISTORY_LIMIT
): Promise<ReportHistoryEntry[]> {
  const { data, error } = await client
    .from("reporte_mensual")
    .select("*")
    .order("generado_en", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[reporte] listHistorial error:", error.message);
    return [];
  }
  return ((data ?? []) as ReportRowShape[]).map(mapHistoryRow);
}

/** Inserta un reporte en la bitácora. Devuelve null si la tabla no existe. */
async function persistReport(
  client: SupabaseClient,
  report: MonthlyReport,
  user: ReportUserContext
): Promise<string | null> {
  const { data, error } = await client
    .from("reporte_mensual")
    .insert({
      folio: report.meta.folio,
      month_key: report.meta.monthKey,
      parcial: report.meta.parcial,
      supervisor_email: report.meta.supervisorFiltro?.email ?? null,
      supervisor_nombre: report.meta.supervisorFiltro?.nombre ?? null,
      total: report.kpis.total,
      cumplimiento: report.kpis.cumplimiento,
      regla_version: report.meta.reglaVersion,
      hash_datos: report.meta.hashDatos,
      snapshot: report,
      generado_por: user.id,
      generado_por_email: user.email,
      generado_por_nombre: user.nombre,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[reporte] persistReport error:", error.code, error.message);
    return null;
  }
  return (data as { id?: string } | null)?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Orquestación                                                        */
/* ------------------------------------------------------------------ */

export interface GenerateReportOptions {
  monthKey: MonthKey;
  parcial: boolean;
  supervisor?: { email: string; nombre: string } | null;
  user: ReportUserContext;
  now?: Date;
  /** Reusa el snapshot oficial del mes si ya existe (default: true). */
  reuseOfficialSnapshot?: boolean;
  /**
   * true (default) → reserva folio y registra la descarga en la bitácora.
   * false → sólo calcula el reporte (vista previa de KPIs, sin bitácora).
   */
  persist?: boolean;
}

export interface GenerateReportResult {
  report: MonthlyReport;
  /** true cuando el PDF se sirve desde el snapshot congelado. */
  fromSnapshot: boolean;
  /** id en la bitácora (null si la tabla aún no existe). */
  historyId: string | null;
}

export async function generateMonthlyReport(
  client: SupabaseClient,
  options: GenerateReportOptions
): Promise<GenerateReportResult> {
  const now = options.now ?? new Date();
  const oficialGlobal = !options.parcial && !options.supervisor;
  const persist = options.persist !== false;

  if (persist && oficialGlobal && options.reuseOfficialSnapshot !== false) {
    const existente = await getOfficialSnapshot(client, options.monthKey);
    if (existente?.snapshot) {
      return { report: existente.snapshot, fromSnapshot: true, historyId: existente.id || null };
    }
  }

  const [rows, actividadesMatriz, supervisorNames] = await Promise.all([
    fetchReportRows(client, {
      monthKey: options.monthKey,
      supervisorEmail: options.supervisor?.email ?? null,
    }),
    fetchMatrizActividades(client),
    fetchSupervisorNames(client),
  ]);

  const folio = persist ? await reserveFolio(client, options.monthKey, options.parcial) : "PREVIEW";

  const report = buildMonthlyReport({
    monthKey: options.monthKey,
    parcial: options.parcial,
    now,
    folio,
    generadoEn: now,
    generadoPor: options.user,
    supervisorFiltro: options.supervisor ?? null,
    rows,
    actividadesMatriz,
    supervisorNames,
    config: DEFAULT_COMPLIANCE_CONFIG,
    trendMonths: REPORT_TREND_MONTHS,
  });

  const historyId = persist ? await persistReport(client, report, options.user) : null;
  return { report, fromSnapshot: false, historyId };
}

/** Vista previa de KPIs: calcula sin reservar folio ni escribir en la bitácora. */
export async function previewMonthlyReport(
  client: SupabaseClient,
  options: Omit<GenerateReportOptions, "persist" | "reuseOfficialSnapshot">
): Promise<MonthlyReport> {
  const result = await generateMonthlyReport(client, {
    ...options,
    persist: false,
    reuseOfficialSnapshot: false,
  });
  return result.report;
}
