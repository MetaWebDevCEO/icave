/**
 * Utilidades de periodo mensual, SIEMPRE en UTC.
 *
 * Toda la plataforma trabaja con fechas en UTC para evitar el desfase de un
 * día entre la base de datos y la interfaz. Este archivo centraliza el cálculo
 * de rangos de mes, etiquetas en español y fechas de corte.
 */

import type { MonthKey } from "./types";

const MESES_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** ¿El valor es una clave de mes válida (`YYYY-MM`)? */
export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.trim());
}

/** Mes actual en UTC. */
export function currentMonthKeyUtc(now: Date = new Date()): MonthKey {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Clave de mes UTC de una fecha ISO. */
export function monthKeyOf(raw: unknown): MonthKey | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Rango [inicio, fin) del mes en UTC y su último instante. */
export function monthRangeUtc(monthKey: MonthKey): {
  start: Date;
  end: Date;
  lastMoment: Date;
  lastDay: number;
} {
  const [y, m] = monthKey.split("-").map((v) => Number(v));
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const lastMoment = new Date(end.getTime() - 1);
  return { start, end, lastMoment, lastDay: new Date(end.getTime() - 86_400_000).getUTCDate() };
}

/** "Octubre 2026" */
export function monthLabelEs(monthKey: MonthKey): string {
  if (!isMonthKey(monthKey)) return monthKey;
  const [y, m] = monthKey.split("-").map((v) => Number(v));
  const mes = MESES_ES[m - 1] ?? "";
  const capitalizado = mes.charAt(0).toUpperCase() + mes.slice(1);
  return `${capitalizado} ${y}`;
}

/** "octubre 2026" (minúsculas, para textos narrativos). */
export function monthLabelLowerEs(monthKey: MonthKey): string {
  if (!isMonthKey(monthKey)) return monthKey;
  const [y, m] = monthKey.split("-").map((v) => Number(v));
  return `${MESES_ES[m - 1] ?? ""} ${y}`;
}

/** Suma (o resta) meses a una clave de mes. */
export function addMonths(monthKey: MonthKey, delta: number): MonthKey {
  const [y, m] = monthKey.split("-").map((v) => Number(v));
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12 + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** Mes anterior a la clave dada. */
export function previousMonthKey(monthKey: MonthKey): MonthKey {
  return addMonths(monthKey, -1);
}

/** Últimos `count` meses terminando en `endKey` (orden cronológico). */
export function lastNMonthKeys(endKey: MonthKey, count: number): MonthKey[] {
  const out: MonthKey[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addMonths(endKey, -i));
  return out;
}

/**
 * Un mes está cerrado cuando ya empezó el mes siguiente.
 * El reporte oficial se habilita a partir del día 1 del mes siguiente.
 */
export function isClosedMonth(monthKey: MonthKey, now: Date = new Date()): boolean {
  return monthKey < currentMonthKeyUtc(now);
}

/** Días transcurridos del mes en curso (1..31) en UTC. */
export function daysElapsedInMonth(monthKey: MonthKey, now: Date = new Date()): number {
  if (monthKey !== currentMonthKeyUtc(now)) return monthRangeUtc(monthKey).lastDay;
  return now.getUTCDate();
}

/**
 * Fecha de corte del reporte.
 *   - Oficial (mes cerrado): último instante del mes.
 *   - Parcial (mes en curso): "ahora".
 */
export function cutoffForMonth(
  monthKey: MonthKey,
  now: Date = new Date(),
  parcial = false
): Date {
  const { end, lastMoment } = monthRangeUtc(monthKey);
  if (parcial) return now.getTime() < end.getTime() ? now : lastMoment;
  return lastMoment;
}

/** Convierte cualquier valor de fecha en `Date` (o null si no es válido). */
export function parseDateValue(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ¿La fila pertenece al mes?
 *
 * El mes de una asignación es el mes en que FUE CREADA (`created_at`), igual
 * que en el Dashboard del Revisor. Usar una sola fecha definitoria garantiza
 * que cada asignación se cuente exactamente una vez y que los totales no se
 * inflen por tareas que sólo tienen el `due_at` o el `submitted_at` en el mes.
 */
export function belongsToMonth(
  row: { created_at?: unknown },
  monthKey: MonthKey
): boolean {
  const { start, end } = monthRangeUtc(monthKey);
  const d = parseDateValue(row.created_at);
  if (!d) return false;
  const t = d.getTime();
  return t >= start.getTime() && t < end.getTime();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "31/10/2026" a partir de una fecha (UTC). */
export function formatDateEs(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** "31/10/2026 14:05" a partir de una fecha (UTC). */
export function formatDateTimeEs(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDateEs(d)} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** Fecha ISO (solo día) para el nombre de archivo: "2026-10-31". */
export function formatIsoDayEs(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Día del mes (1..31) en UTC. */
export function dayOfMonthUtc(value: Date | string): number {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getUTCDate();
}
