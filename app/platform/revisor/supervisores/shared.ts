/**
 * Utilidades compartidas de la pestaña "Supervisores" (rol Revisor).
 *
 * Se extrajeron de `page.tsx` para que la página de detalle de un supervisor
 * (supervisores/[id]) use exactamente el mismo criterio de mes y la misma
 * clasificación de estado, y los números de la tarjeta cuadren con la lista.
 */

export const MONTH_LABELS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

export function getMonthRange(year: number, month0Idx: number): { startISO: string; endISO: string } {
  const start = new Date(Date.UTC(year, month0Idx, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month0Idx + 1, 1, 0, 0, 0, 0));
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
  };
}

export function monthKey(year: number, month0Idx: number) {
  return `${year}-${pad2(month0Idx + 1)}`;
}

export function parseMonthKey(v: string | undefined): { year: number; month0Idx: number } | null {
  if (!v) return null;
  const match = /^(\d{4})-(\d{1,2})$/.exec(v.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(mm)) return null;
  const month0Idx = Math.min(11, Math.max(0, mm - 1));
  if (year < 2000 || year > 2100) return null;
  return { year, month0Idx };
}

export function buildMonthOptions(currentYear: number): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (let y = currentYear + 1; y >= currentYear - 1; y--) {
    for (let m = 11; m >= 0; m--) {
      opts.push({ value: monthKey(y, m), label: `${MONTH_LABELS[m]} ${y}` });
    }
  }
  return opts;
}

export function normalizeEmail(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function deriveDisplayName(
  email: string | null | undefined,
  metadata: Record<string, unknown>
): string {
  const metadataName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.display_name === "string"
        ? metadata.display_name
        : typeof metadata.name === "string"
          ? metadata.name
          : "";

  if (metadataName.trim()) return metadataName.trim();
  if (!email) return "Sin nombre";

  const localPart = email.split("@")[0] ?? "supervisor";
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export type StatusBucket = "completadas" | "entregadas" | "pendientes";

export function classifyStatus(raw: unknown): StatusBucket {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s.includes("entreg")) {
    return "entregadas";
  }
  if (s.includes("complet") || s.includes("done") || s.includes("finaliz")) {
    return "completadas";
  }
  if (s.includes("curso") || s.includes("progreso") || s.includes("progress")) {
    return "entregadas";
  }
  if (
    s.includes("open") ||
    s.includes("nueva") ||
    s.includes("nuevo") ||
    s.includes("espera")
  ) {
    if (s.includes("pend")) return "pendientes";
    return "entregadas";
  }
  if (s.includes("pend")) return "pendientes";
  return s.length === 0 ? "pendientes" : "pendientes";
}

/** ¿La asignación cae dentro del mes? El mes se define por `created_at`. */
export function fallsInMonth(
  dateFields: { created_at?: unknown },
  startISO: string,
  endISO: string
): boolean {
  const c = dateFields.created_at;
  if (typeof c !== "string" || !c) return false;
  const t = new Date(c).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= new Date(startISO).getTime() && t < new Date(endISO).getTime();
}
