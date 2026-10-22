/**
 * Paleta y tipografía del PDF institucional del Reporte Mensual.
 *
 * Los colores provienen de la identidad de ICAVE / Hutchison Ports
 * (azul marino profundo + azul vibrante). No se usan degradados ni colores
 * fuera de la paleta corporativa.
 */

export const PDF_COLORS = {
  /** Azul marino profundo (encabezados, títulos). */
  navy: "#032F6C",
  /** Azul marino de la marca (bloques y acentos). */
  navyDeep: "#023674",
  /** Azul vibrante corporativo. */
  azul: "#009ADD",
  /** Azul claro de la marca, para series secundarias. */
  azulClaro: "#02A9E5",
  /** Texto principal. */
  ink: "#1F2937",
  /** Texto secundario / etiquetas. */
  muted: "#6B7280",
  /** Rejilla de gráficas. */
  grid: "#D7DEE8",
  /** Fondo de las pistas de barras. */
  track: "#EDF1F7",
  /** Fondos suaves de bloque. */
  soft: "#F4F7FB",
  /** Bordes de tabla. */
  border: "#DCE3EC",
  /** Semáforo. */
  verde: "#1B8A4B",
  ambar: "#C77700",
  rojo: "#B32020",
  /** Blanco. */
  blanco: "#FFFFFF",
} as const;

/** Serie de colores para gráficas de dona / pastel. */
export const DONUT_COLORS = [
  PDF_COLORS.verde,
  PDF_COLORS.ambar,
  PDF_COLORS.rojo,
  PDF_COLORS.azul,
  PDF_COLORS.navy,
] as const;

/** Colores del semáforo de desempeño por supervisor. */
export const SEMAFORO_COLORS: Record<string, string> = {
  optimo: PDF_COLORS.verde,
  riesgo: PDF_COLORS.ambar,
  critico: PDF_COLORS.rojo,
  sin_datos: PDF_COLORS.muted,
};

export const PDF_FONT = "Helvetica";
