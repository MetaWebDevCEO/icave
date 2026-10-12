/**
 * Helpers de fecha diseñados para "fecha de calendario" (dd/mm/aaaa, yyyy-mm-dd).
 * Todas las fechas que vienen de Supabase (due_at, created_at, submitted_at, etc.)
 * suelen guardarse como ISO 8601 en UTC (ej: "2026-10-01T00:00:00Z").
 *
 * Para evitar desfases ("pongo mes X y me muestra X-1") NUNCA formateamos
 * con la zona horaria local del navegador. Usamos siempre:
 *   - Parseo que preserve el componente de calendario (año/mes/día)
 *   - Formateo con timeZone UTC para Intl.DateTimeFormat.
 */

// ---------------------------------------------------------------------------
// Extracción UTC: dado cualquier Date, devuelve [yyyy, mm, dd] en UTC.
// Útil para "proyectar" una fecha ISO UTC a su fecha de calendario real.
// ---------------------------------------------------------------------------
function utcParts(d: Date): [number, number, number] {
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/**
 * Parsea un valor de fecha ISO/calendario a un Date de JavaScript.
 * - Para inputs `yyyy-mm-dd` (date-only) crea un Date con ese día a las
 *   12:00 UTC (de modo que en cualquier zona horaria, el DÍA DEL MES siga
 *   siendo el mismo cuando se formatea en UTC).
 * - Para ISO strings con TZ (Z / +hh:mm / -hh:mm) parsea nativamente y
 *   luego los formatters lo muestran en UTC → mes/día correctos.
 * - Para ISO strings sin TZ (ej: "2026-10-01T00:00:00") los interpretamos
 *   como UTC (comportamiento de Supabase).
 */
export function parseAsCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const input = value.trim();
  if (!input) return null;

  // 1) Fecha de calendario simple: yyyy-mm-dd
  const calendarMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (calendarMatch) {
    const year = Number(calendarMatch[1]);
    const month = Number(calendarMatch[2]);
    const day = Number(calendarMatch[3]);
    // Construimos en UTC con 12:00 para evitar desviaciones por DST/zonas.
    const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  // 2) ISO datetime con zona (Z o +hh:mm / -hh:mm)
  const datetimeTZMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      input
    );
  if (datetimeTZMatch && datetimeTZMatch[8]) {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  // 3) ISO datetime SIN zona (asumimos UTC, igual que Supabase al almacenar)
  const datetimeNaiveMatch =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(input);
  if (datetimeNaiveMatch) {
    const year = Number(datetimeNaiveMatch[1]);
    const month = Number(datetimeNaiveMatch[2]);
    const day = Number(datetimeNaiveMatch[3]);
    const hour = Number(datetimeNaiveMatch[4]);
    const minute = Number(datetimeNaiveMatch[5]);
    const second = datetimeNaiveMatch[6] ? Number(datetimeNaiveMatch[6]) : 0;
    const ms = datetimeNaiveMatch[7]
      ? Math.min(999, Math.floor(Number("0." + datetimeNaiveMatch[7]) * 1000))
      : 0;
    const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  // 4) Fallback al parser nativo (proteger contra NaN)
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Formato corto: 01/10/26
 * - Fuerza `timeZone: UTC` para que nunca haya desfase de un día.
 */
export function formatCalendarDateShort(value: string | null | undefined) {
  const d = parseAsCalendarDate(value);
  if (!d) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(d);
}

/**
 * Formato largo: miércoles, 1 de octubre de 2026
 * - Fuerza `timeZone: UTC`.
 */
export function formatCalendarDateLong(value: string | null | undefined) {
  const d = parseAsCalendarDate(value);
  if (!d) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * Utilidad para operaciones donde necesites el "mes de calendario" (1..12)
 * independientemente de la zona horaria local. Devuelve [yyyy, mm (1-12), dd (1-31)]
 * calculados en UTC sobre la fecha parseada por `parseAsCalendarDate`.
 * Si no puede parsear, devuelve null.
 */
export function getUtcYmd(value: string | null | undefined): [number, number, number] | null {
  const d = parseAsCalendarDate(value);
  if (!d) return null;
  return utcParts(d);
}
