/**
 * Plantilla del "Reporte Mensual de Cumplimiento" (PROMAS ICAVE).
 *
 * Documento tamaño CARTA con 13 secciones. Todo el contenido proviene del
 * modelo `MonthlyReport`; la plantilla no calcula ni inventa datos, sólo
 * formatea y dibuja.
 *
 * Sólo debe importarse desde código de servidor: los logotipos se leen del
 * disco (`node:fs`) y el documento se renderiza con `renderToBuffer`.
 */

import fs from "node:fs";
import path from "node:path";
import { Document, Image, Page, Polygon, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { KpiComparison, MonthlyReport, TaskAnnexRow } from "../types";
import { DonutChart, HBarChart, LineChart } from "./charts";
import { AssetSvg, loadSvgAsset } from "./svg-asset";
import { PDF_COLORS, SEMAFORO_COLORS } from "./theme";

const PAGE_WIDTH = 612;
const PAGE_PADDING = 34;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_PADDING * 2;

function loadCoverImageDataUri(fileName: string): string | null {
  try {
    const filePath = path.join(process.cwd(), "public", fileName);
    const raw = fs.readFileSync(filePath);
    return `data:image/jpeg;base64,${raw.toString("base64")}`;
  } catch (error) {
    console.warn(
      `[reporte:pdf] No se pudo cargar ${fileName}:`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

const COVER_IMAGE_SRC = loadCoverImageDataUri("login.jpg");

/* ------------------------------------------------------------------ */
/* Formato                                                             */
/* ------------------------------------------------------------------ */

function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-MX").format(value);
}

function fmtValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "days") return `${value.toFixed(1)} d`;
  return fmtCount(value);
}

function fmtDelta(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  if (unit === "percent") return `${sign}${value.toFixed(1)} pts`;
  if (unit === "days") return `${sign}${value.toFixed(1)} d`;
  return `${sign}${fmtCount(value)}`;
}

const SEMAFORO_LABEL: Record<string, string> = {
  optimo: "Óptimo",
  riesgo: "En riesgo",
  critico: "Crítico",
  sin_datos: "Sin datos",
};

function semaforoColor(key: string): string {
  return SEMAFORO_COLORS[key] ?? PDF_COLORS.muted;
}

function deltaColor(comparison: KpiComparison): string {
  if (comparison.favorable === null || comparison.delta === null || comparison.delta === 0) {
    return PDF_COLORS.muted;
  }
  return comparison.favorable ? PDF_COLORS.verde : PDF_COLORS.rojo;
}

/* ------------------------------------------------------------------ */
/* Estilos                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  page: {
    paddingTop: 74,
    paddingBottom: 56,
    paddingHorizontal: PAGE_PADDING,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: PDF_COLORS.ink,
    lineHeight: 1.4,
  },
  cover: {
    paddingTop: 46,
    paddingBottom: 46,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: PDF_COLORS.ink,
  },
  header: {
    position: "absolute",
    top: 26,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 0.8,
    borderBottomColor: PDF_COLORS.border,
    paddingBottom: 6,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 9.5, color: PDF_COLORS.navy, fontFamily: "Helvetica-Bold" },
  headerSub: { fontSize: 7.5, color: PDF_COLORS.muted },
  headerRight: { alignItems: "flex-end" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: PAGE_PADDING,
    right: PAGE_PADDING,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 0.8,
    borderTopColor: PDF_COLORS.border,
    paddingTop: 6,
  },
  footerText: { fontSize: 7, color: PDF_COLORS.muted },
  footerPageNumber: {
    position: "absolute",
    bottom: 24,
    left: PAGE_PADDING,
    width: CONTENT_WIDTH,
    height: 10,
    textAlign: "center",
    fontSize: 7,
    color: PDF_COLORS.muted,
  },
  watermark: {
    position: "absolute",
    top: 300,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 96,
    letterSpacing: 8,
    color: PDF_COLORS.navy,
    opacity: 0.08,
    transform: "rotate(-28deg)",
  },
  coverBand: {
    marginTop: 22,
    backgroundColor: PDF_COLORS.navy,
    paddingVertical: 22,
    paddingHorizontal: 20,
  },
  coverTitle: {
    color: PDF_COLORS.blanco,
    fontSize: 21,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
  },
  coverSubtitle: { color: "#BFD4EA", fontSize: 10.5, marginTop: 6 },
  coverLogos: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  coverRule: { height: 3, width: 120, backgroundColor: PDF_COLORS.azul, marginTop: 12 },
  coverPhotoCard: {
    marginTop: 14,
    borderWidth: 0.8,
    borderColor: PDF_COLORS.border,
    backgroundColor: "#F5F8FC",
  },
  coverPhoto: { width: "100%", height: 138, objectFit: "cover" },
  coverPhotoCaptionWrap: {
    borderTopWidth: 0.8,
    borderTopColor: PDF_COLORS.border,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: PDF_COLORS.blanco,
  },
  coverPhotoCaption: { fontSize: 7.2, color: PDF_COLORS.muted },
  coverHero: {
    marginTop: 18,
    flexDirection: "row",
    borderWidth: 0.8,
    borderColor: PDF_COLORS.border,
  },
  coverHeroCol: { flex: 1, paddingVertical: 10, paddingHorizontal: 6, alignItems: "center" },
  coverHeroDivider: { borderLeftWidth: 0.8, borderLeftColor: PDF_COLORS.border },
  coverHeroValue: { fontSize: 19, fontFamily: "Helvetica-Bold", color: PDF_COLORS.navy },
  coverHeroLabel: {
    fontSize: 6.6,
    color: PDF_COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
    textAlign: "center",
  },
  coverHeroNote: { fontSize: 6.4, color: PDF_COLORS.azul, marginTop: 2, textAlign: "center" },
  coverIndexTitle: {
    fontSize: 7.5,
    color: PDF_COLORS.navy,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.8,
    marginTop: 18,
    marginBottom: 5,
  },
  coverIndex: { flexDirection: "row", borderWidth: 0.8, borderColor: PDF_COLORS.border },
  coverIndexCol: { flex: 1, paddingVertical: 7, paddingHorizontal: 10 },
  coverIndexColRight: { borderLeftWidth: 0.8, borderLeftColor: PDF_COLORS.border },
  coverIndexItem: { fontSize: 7, color: PDF_COLORS.ink, marginBottom: 2.5 },
  coverIndexNum: { color: PDF_COLORS.azul, fontFamily: "Helvetica-Bold" },
  coverMeta: {
    marginTop: 16,
    flexDirection: "row",
    borderWidth: 0.8,
    borderColor: PDF_COLORS.border,
  },
  coverMetaCol: { flex: 1, padding: 10 },
  coverMetaLabel: {
    fontSize: 7,
    color: PDF_COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  coverMetaValue: { fontSize: 10, color: PDF_COLORS.navy, marginTop: 3, fontFamily: "Helvetica-Bold" },
  coverPreliminar: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: PDF_COLORS.rojo,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  coverPreliminarText: { fontSize: 9, color: PDF_COLORS.rojo, fontFamily: "Helvetica-Bold" },
  coverFoot: { marginTop: 18, fontSize: 8, color: PDF_COLORS.muted },
  coverBrandFooter: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 0.8,
    borderTopColor: PDF_COLORS.border,
    alignItems: "center",
  },
  coverBrandRow: { flexDirection: "row", alignItems: "center" },
  coverBrandText: { fontSize: 8.3, color: "#7B766F" },
  coverBrandMetawrap: { marginLeft: 4, marginRight: 4 },
  coverBrandIsoWrap: { marginLeft: 5, marginRight: 5 },
  section: { marginBottom: 15 },
  sectionTitle: {
    fontSize: 11.5,
    color: PDF_COLORS.navy,
    fontFamily: "Helvetica-Bold",
    marginBottom: 7,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.azul,
  },
  paragraph: { fontSize: 8.8, color: PDF_COLORS.ink, marginBottom: 4 },
  bullet: { flexDirection: "row", marginBottom: 4 },
  bulletMark: { width: 12, fontSize: 8.8, color: PDF_COLORS.azul, fontFamily: "Helvetica-Bold" },
  bulletText: { flex: 1, fontSize: 8.8, color: PDF_COLORS.ink, lineHeight: 1.45 },
  empty: {
    fontSize: 8.8,
    color: PDF_COLORS.muted,
    padding: 10,
    backgroundColor: PDF_COLORS.soft,
  },
  /* Tablas */
  table: { borderWidth: 0.8, borderColor: PDF_COLORS.border },
  tr: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: PDF_COLORS.border },
  trHead: { backgroundColor: PDF_COLORS.soft },
  trLast: { borderBottomWidth: 0 },
  th: {
    fontSize: 7,
    color: PDF_COLORS.navy,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  td: { fontSize: 7, color: PDF_COLORS.ink, paddingVertical: 3.5, paddingHorizontal: 4 },
  tdNum: { textAlign: "right" },
  trendCell: { flexDirection: "row", alignItems: "center", gap: 3 },
  /* Riesgo */
  riskCard: {
    borderWidth: 0.8,
    borderColor: PDF_COLORS.border,
    marginBottom: 7,
    padding: 8,
  },
  riskHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  riskName: { fontSize: 9.5, color: PDF_COLORS.navy, fontFamily: "Helvetica-Bold" },
  riskMeta: { flexDirection: "row", gap: 10 },
  riskMetaText: { fontSize: 7.5, color: PDF_COLORS.muted },
  chip: { fontSize: 7, paddingVertical: 1.5, paddingHorizontal: 6, borderRadius: 8 },
  /* Gráficas */
  chart: {
    borderWidth: 0.8,
    borderColor: PDF_COLORS.border,
    padding: 8,
    marginTop: 6,
  },
  chartTitle: { fontSize: 7.5, color: PDF_COLORS.muted, marginBottom: 4 },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendSwatch: { width: 7, height: 7 },
  legendText: { fontSize: 7, color: PDF_COLORS.ink },
  /* KPIs */
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kpiCard: {
    width: (CONTENT_WIDTH - 12) / 3,
    borderWidth: 0.8,
    borderColor: PDF_COLORS.border,
    padding: 7,
  },
  kpiLabel: { fontSize: 7, color: PDF_COLORS.muted },
  kpiValue: { fontSize: 14, color: PDF_COLORS.navy, fontFamily: "Helvetica-Bold", marginTop: 2 },
  kpiCompare: { fontSize: 7, marginTop: 2 },
});

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

/** Triángulo de tendencia dibujado como vector (los glifos ▲▼ no existen en Helvetica). */
function TrendGlyph({ trend, color }: { trend: string; color: string }) {
  if (trend === "none" || trend === "flat") {
    return (
      <Svg width={8} height={8} viewBox="0 0 8 8">
        <Rect x={1} y={3.4} width={6} height={1.4} fill={PDF_COLORS.muted} />
      </Svg>
    );
  }
  const up = trend === "up";
  return (
    <Svg width={8} height={8} viewBox="0 0 8 8">
      <Polygon points={up ? "4,1 7.4,6.6 0.6,6.6" : "4,7 7.4,1.4 0.6,1.4"} fill={color} />
    </Svg>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <Text style={styles.empty}>Sin elementos para mostrar.</Text>;
  }
  return (
    <View>
      {items.map((text, index) => (
        <View key={index} style={styles.bullet} wrap={false}>
          <Text style={styles.bulletMark}>•</Text>
          <Text style={styles.bulletText}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({
  title,
  children,
  breakBefore = false,
}: {
  title: string;
  children: React.ReactNode;
  breakBefore?: boolean;
}) {
  return (
    <View style={styles.section} break={breakBefore}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function TableHead({ labels, widths }: { labels: string[]; widths: number[] }) {
  return (
    <View style={[styles.tr, styles.trHead]}>
      {labels.map((label, index) => (
        <Text
          key={`${label}-${index}`}
          style={[styles.th, { width: widths[index] }, index >= 2 ? styles.tdNum : {}]}
        >
          {label}
        </Text>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Documento                                                           */
/* ------------------------------------------------------------------ */

/** Índice de portada. Debe reflejar el orden real de las secciones. */
const CONTENIDO_SECCIONES = [
  "Resumen ejecutivo",
  "Indicadores del mes",
  "Comparativo contra el mes anterior",
  "Comparativo por supervisor",
  "Supervisores críticos y en riesgo",
  "Análisis por actividad de la Matriz",
  "Puntualidad de las entregas",
  "Cumplimiento por prioridad",
  "Actividad diaria del mes",
  "Tendencia de los últimos 6 meses",
  "Hallazgos",
  "Recomendaciones",
  "Anexo: detalle de tareas del mes",
];

export function ReporteMensualPDF({ report }: { report: MonthlyReport }) {
  const { meta, kpis, comparativo } = report;
  const logoIcave = loadSvgAsset("logo.svg");
  const logoIcaveIso = loadSvgAsset("iso (2).svg");
  const logoMetaweb = loadSvgAsset("metaweb.svg");

  const cumplimientoCmp = comparativo.find((c) => c.key === "cumplimiento") ?? null;

  const kpiCards: Array<{ label: string; value: string; comparison?: KpiComparison }> = [
    { label: "Cumplimiento", value: `${kpis.cumplimiento.toFixed(1)}%`, comparison: cumplimientoCmp ?? undefined },
    { label: "Asignadas", value: fmtCount(kpis.total) },
    { label: "Completadas", value: fmtCount(kpis.completadas) },
    { label: "Completadas extemporáneas", value: fmtCount(kpis.extemporaneas) },
    { label: "Entregadas (sin revisar)", value: fmtCount(kpis.entregadas) },
    { label: "Pendientes", value: fmtCount(kpis.pendientes) },
    { label: "Atrasadas", value: fmtCount(kpis.atrasadas) },
    { label: "Tiempo promedio de entrega", value: fmtValue(kpis.tiempoPromedioEntregaDias, "days") },
    { label: "Entregas a tiempo", value: fmtValue(kpis.porcentajeEntregasATiempo, "percent") },
  ];

  const supervisorWidths = [20, 112, 38, 42, 42, 40, 40, 44, 54, 62];
  const kpiWidths = [214, 78, 88, 88, 76];

  // Cifras destacadas de portada. Si el periodo no tiene datos se muestra "—".
  const sinDatos = meta.sinDatos;
  const notaCumplimiento = sinDatos
    ? "Sin asignaciones en el periodo"
    : cumplimientoCmp && cumplimientoCmp.delta !== null
      ? `${cumplimientoCmp.delta > 0 ? "+" : ""}${cumplimientoCmp.delta.toFixed(1)} pts vs mes anterior`
      : "Sin base comparativa";

  const heroItems: Array<{ value: string; label: string; note: string }> = [
    {
      value: sinDatos ? "—" : `${kpis.cumplimiento.toFixed(1)}%`,
      label: "Cumplimiento",
      note: notaCumplimiento,
    },
    {
      value: fmtCount(kpis.total),
      label: "Asignaciones",
      note: `${fmtCount(kpis.completadas)} completadas en plazo`,
    },
    {
      value: fmtCount(report.supervisores.length),
      label: "Supervisores",
      note: `${fmtCount(kpis.atrasadas)} atrasadas al corte`,
    },
    {
      value: fmtValue(kpis.tiempoPromedioEntregaDias, "days"),
      label: "Tiempo prom. entrega",
      note: `${fmtValue(kpis.porcentajeEntregasATiempo, "percent")} a tiempo`,
    },
  ];

  const mitadIndice = Math.ceil(CONTENIDO_SECCIONES.length / 2);
  const indiceIzquierda = CONTENIDO_SECCIONES.slice(0, mitadIndice);
  const indiceDerecha = CONTENIDO_SECCIONES.slice(mitadIndice);

  return (
    <Document
      title={`Reporte Mensual de Cumplimiento — ${meta.monthLabel}`}
      author="MetaWeb Dev Solutions"
      subject={`Cumplimiento ${meta.monthLabel} — PROMAS ICAVE`}
      creator="MetaWeb Dev Solutions"
      producer="PROMAS ICAVE"
      keywords={`ICAVE, PROMAS, cumplimiento, ${meta.monthKey}, ${meta.folio}`}
      language="es-MX"
    >
      {/* ---------------- Portada ---------------- */}
      <Page size="LETTER" style={styles.cover}>
        <View style={styles.coverLogos}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {logoIcaveIso ? <AssetSvg asset={logoIcaveIso} width={30} height={38} /> : null}
            <View>
              <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: PDF_COLORS.navy }}>
                ICAVE
              </Text>
              <Text style={{ fontSize: 7.5, color: PDF_COLORS.muted }}>Hutchison Ports</Text>
            </View>
          </View>
          {logoMetaweb ? <AssetSvg asset={logoMetaweb} width={92} height={34} /> : null}
        </View>

        <View style={styles.coverRule} />

        <View style={styles.coverBand}>
          <Text style={styles.coverTitle}>REPORTE MENSUAL DE CUMPLIMIENTO</Text>
          <Text style={styles.coverSubtitle}>
            {meta.monthLabel} · PROMAS ICAVE · Matriz de Control Operativo
          </Text>
        </View>

        {COVER_IMAGE_SRC ? (
          <View style={styles.coverPhotoCard}>
            <Image src={COVER_IMAGE_SRC} style={styles.coverPhoto} />
            <View style={styles.coverPhotoCaptionWrap}>
            </View>
          </View>
        ) : null}

        {meta.parcial ? (
          <View style={styles.coverPreliminar}>
            <Text style={styles.coverPreliminarText}>
              DOCUMENTO PRELIMINAR — Avance del mes en curso al {meta.corteLabel}. No es un reporte
              oficial de cierre.
            </Text>
          </View>
        ) : null}

        <View style={styles.coverHero}>
          {heroItems.map((item, index) => (
            <View
              key={item.label}
              style={[styles.coverHeroCol, index > 0 ? styles.coverHeroDivider : {}]}
            >
              <Text style={styles.coverHeroValue}>{item.value}</Text>
              <Text style={styles.coverHeroLabel}>{item.label}</Text>
              <Text style={styles.coverHeroNote}>{item.note}</Text>
            </View>
          ))}
        </View>

        <View style={styles.coverMeta}>
          <View style={styles.coverMetaCol}>
            <Text style={styles.coverMetaLabel}>Periodo</Text>
            <Text style={styles.coverMetaValue}>{meta.monthLabel}</Text>
          </View>
          <View style={styles.coverMetaCol}>
            <Text style={styles.coverMetaLabel}>Fecha de corte</Text>
            <Text style={styles.coverMetaValue}>{meta.corteLabel}</Text>
          </View>
          <View style={styles.coverMetaCol}>
            <Text style={styles.coverMetaLabel}>Folio</Text>
            <Text style={styles.coverMetaValue}>{meta.folio}</Text>
          </View>
        </View>

        <View style={[styles.coverMeta, { marginTop: 8 }]}>
          <View style={styles.coverMetaCol}>
            <Text style={styles.coverMetaLabel}>Generado por</Text>
            <Text style={styles.coverMetaValue}>{meta.generadoPor.nombre}</Text>
            <Text style={{ fontSize: 8, color: PDF_COLORS.muted, marginTop: 2 }}>
              {meta.generadoPor.email}
            </Text>
          </View>
          <View style={styles.coverMetaCol}>
            <Text style={styles.coverMetaLabel}>Fecha de generación</Text>
            <Text style={styles.coverMetaValue}>{meta.generadoEnLabel}</Text>
          </View>
          <View style={styles.coverMetaCol}>
            <Text style={styles.coverMetaLabel}>Filtro de supervisor</Text>
            <Text style={styles.coverMetaValue}>
              {meta.supervisorFiltro ? meta.supervisorFiltro.nombre : "Todos los supervisores"}
            </Text>
          </View>
        </View>

        <Text style={styles.coverIndexTitle}>CONTENIDO DEL DOCUMENTO</Text>
        <View style={styles.coverIndex}>
          <View style={styles.coverIndexCol}>
            {indiceIzquierda.map((titulo, index) => (
              <Text key={titulo} style={styles.coverIndexItem}>
                <Text style={styles.coverIndexNum}>{index + 1}. </Text>
                {titulo}
              </Text>
            ))}
          </View>
          <View style={[styles.coverIndexCol, styles.coverIndexColRight]}>
            {indiceDerecha.map((titulo, index) => (
              <Text key={titulo} style={styles.coverIndexItem}>
                <Text style={styles.coverIndexNum}>{mitadIndice + index + 1}. </Text>
                {titulo}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.coverBrandFooter}>
          <View style={styles.coverBrandRow}>
            <Text style={styles.coverBrandText}>Plataforma desarrollada por MetaWeb Dev Solutions </Text>
  
          </View>
        </View>
      </Page>

      {/* ---------------- Contenido ---------------- */}
      <Page size="LETTER" style={styles.page} wrap>
        {meta.parcial ? <Text style={styles.watermark} fixed>PRELIMINAR</Text> : null}

        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            {logoIcave ? <AssetSvg asset={logoIcave} width={20} height={20} /> : null}
            <View>
              <Text style={styles.headerTitle}>Reporte Mensual de Cumplimiento</Text>
              <Text style={styles.headerSub}>
                {meta.monthLabel}
                {meta.parcial ? " · Avance parcial" : " · Cierre oficial"}
                {meta.supervisorFiltro ? ` · ${meta.supervisorFiltro.nombre}` : ""}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerSub}>Folio {meta.folio}</Text>
            <Text style={styles.headerSub}>Corte {meta.corteLabel}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>PROMAS ICAVE · MetaWeb Dev Solutions</Text>
          <Text style={styles.footerText}>Generado el {meta.generadoEnLabel}</Text>
        </View>

        <Text
          style={styles.footerPageNumber}
          fixed
          render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
        />

        {meta.sinDatos ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 9.5, color: PDF_COLORS.navy, fontFamily: "Helvetica-Bold" }}>
              Sin datos para el periodo solicitado
            </Text>
            <Text style={{ fontSize: 8.5, color: PDF_COLORS.ink, marginTop: 4 }}>
              No se encontraron asignaciones para {meta.monthLabel}
              {meta.supervisorFiltro ? ` del supervisor ${meta.supervisorFiltro.nombre}` : ""}. El
              reporte se emite sin indicadores para dejar constancia de la consulta (folio{" "}
              {meta.folio}).
            </Text>
          </View>
        ) : (
          <>
            {/* 1. Resumen ejecutivo */}
            <Section title="1. Resumen ejecutivo">
              <Bullets items={report.resumenEjecutivo} />
            </Section>

            {/* 2. KPIs del mes */}
            <Section title="2. Indicadores del mes">
              <View style={styles.kpiGrid}>
                {kpiCards.map((card) => (
                  <View key={card.label} style={styles.kpiCard} wrap={false}>
                    <Text style={styles.kpiLabel}>{card.label}</Text>
                    <Text style={styles.kpiValue}>{card.value}</Text>
                    {card.comparison && card.comparison.delta !== null ? (
                      <View style={styles.trendCell}>
                        <TrendGlyph
                          trend={card.comparison.trend}
                          color={deltaColor(card.comparison)}
                        />
                        <Text style={[styles.kpiCompare, { color: deltaColor(card.comparison) }]}>
                          {fmtDelta(card.comparison.delta, card.comparison.unit)} vs mes anterior
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            </Section>

            {/* 3. Comparativo vs mes anterior */}
            <Section title="3. Comparativo contra el mes anterior">
              {comparativo.length === 0 ? (
                <Text style={styles.empty}>No hay mes anterior con datos para comparar.</Text>
              ) : (
                <View style={styles.table}>
                  <TableHead
                    labels={["Indicador", "Este mes", "Mes anterior", "Variación", "Tendencia"]}
                    widths={kpiWidths}
                  />
                  {comparativo.map((c, index) => (
                    <View
                      key={`${c.key}-${index}`}
                      style={[styles.tr, index === comparativo.length - 1 ? styles.trLast : {}]}
                      wrap={false}
                    >
                      <Text style={[styles.td, { width: kpiWidths[0] }]}>{c.label}</Text>
                      <Text style={[styles.td, styles.tdNum, { width: kpiWidths[1] }]}>
                        {fmtValue(c.current, c.unit)}
                      </Text>
                      <Text style={[styles.td, styles.tdNum, { width: kpiWidths[2] }]}>
                        {fmtValue(c.previous, c.unit)}
                      </Text>
                      <Text
                        style={[
                          styles.td,
                          styles.tdNum,
                          { width: kpiWidths[3], color: deltaColor(c) },
                        ]}
                      >
                        {fmtDelta(c.delta, c.unit)}
                      </Text>
                      <View
                        style={[styles.td, styles.trendCell, { width: kpiWidths[4] }]}
                      >
                        <TrendGlyph trend={c.trend} color={deltaColor(c)} />
                        <Text style={{ fontSize: 7, color: deltaColor(c) }}>
                          {c.trend === "up"
                            ? "Sube"
                            : c.trend === "down"
                              ? "Baja"
                              : c.trend === "flat"
                                ? "Estable"
                                : "Sin base"}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </Section>

            {/* 4. Comparativo por supervisor */}
            <Section title="4. Comparativo por supervisor">
              {report.supervisores.length === 0 ? (
                <Text style={styles.empty}>No hay supervisores con asignaciones en el periodo.</Text>
              ) : (
                <>
                  <View style={styles.table}>
                    <TableHead
                      labels={[
                        "#",
                        "Supervisor",
                        "Total",
                        "Compl.",
                        "Entreg.",
                        "Pend.",
                        "Atras.",
                        "%",
                        "Var.",
                        "Semáforo",
                      ]}
                      widths={supervisorWidths}
                    />
                    {report.supervisores.map((s, index) => (
                      <View
                        key={s.email || s.nombre}
                        style={[
                          styles.tr,
                          index === report.supervisores.length - 1 ? styles.trLast : {},
                        ]}
                        wrap={false}
                      >
                        <Text style={[styles.td, { width: supervisorWidths[0] }]}>{s.rank}</Text>
                        <Text style={[styles.td, { width: supervisorWidths[1] }]}>
                          {s.nombre}
                        </Text>
                        <Text
                          style={[styles.td, styles.tdNum, { width: supervisorWidths[2] }]}
                        >
                          {fmtCount(s.total)}
                        </Text>
                        <Text
                          style={[styles.td, styles.tdNum, { width: supervisorWidths[3] }]}
                        >
                          {fmtCount(s.completadas)}
                        </Text>
                        <Text
                          style={[styles.td, styles.tdNum, { width: supervisorWidths[4] }]}
                        >
                          {fmtCount(s.entregadas)}
                        </Text>
                        <Text
                          style={[styles.td, styles.tdNum, { width: supervisorWidths[5] }]}
                        >
                          {fmtCount(s.pendientes)}
                        </Text>
                        <Text
                          style={[styles.td, styles.tdNum, { width: supervisorWidths[6] }]}
                        >
                          {fmtCount(s.atrasadas)}
                        </Text>
                        <Text
                          style={[
                            styles.td,
                            styles.tdNum,
                            { width: supervisorWidths[7], fontFamily: "Helvetica-Bold" },
                          ]}
                        >
                          {`${s.cumplimiento.toFixed(1)}%`}
                        </Text>
                        <Text style={[styles.td, styles.tdNum, { width: supervisorWidths[8] }]}>
                          {s.variacionPuntos === null
                            ? "—"
                            : `${s.variacionPuntos > 0 ? "+" : ""}${s.variacionPuntos.toFixed(1)} pts`}
                        </Text>
                        <View
                          style={[styles.td, styles.trendCell, { width: supervisorWidths[9] }]}
                        >
                          <View
                            style={[
                              styles.legendSwatch,
                              { backgroundColor: semaforoColor(s.semaforo), borderRadius: 4 },
                            ]}
                          />
                          <Text style={{ fontSize: 7, color: semaforoColor(s.semaforo) }}>
                            {SEMAFORO_LABEL[s.semaforo] ?? s.semaforo}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  <View style={styles.chart} wrap={false}>
                    <Text style={styles.chartTitle}>
                      % de cumplimiento por supervisor (semáforo: verde ≥75%, ámbar 50-74%, rojo
                      &lt;50%)
                    </Text>
                    <HBarChart
                      items={report.supervisores.map((s) => ({
                        label: s.nombre,
                        value: s.cumplimiento,
                        display: `${s.cumplimiento.toFixed(1)}%`,
                        color: semaforoColor(s.semaforo),
                      }))}
                      width={CONTENT_WIDTH - 18}
                      height={Math.max(120, report.supervisores.length * 16 + 24)}
                      labelWidth={124}
                    />
                  </View>
                </>
              )}
            </Section>

            {/* 5. Supervisores críticos y en riesgo */}
            <Section title="5. Supervisores críticos y en riesgo" breakBefore>
              {report.supervisoresEnRiesgo.length === 0 ? (
                <Text style={styles.empty}>
                  Ningún supervisor quedó por debajo del 75% de cumplimiento en el periodo.
                </Text>
              ) : (
                report.supervisoresEnRiesgo.map((r) => (
                  <View key={r.email || r.nombre} style={styles.riskCard} wrap={false}>
                    <View style={styles.riskHead}>
                      <Text style={styles.riskName}>{r.nombre}</Text>
                      <Text
                        style={[
                          styles.chip,
                          {
                            backgroundColor: semaforoColor(r.semaforo),
                            color: PDF_COLORS.blanco,
                          },
                        ]}
                      >
                        {SEMAFORO_LABEL[r.semaforo] ?? r.semaforo} · {r.cumplimiento.toFixed(1)}%
                      </Text>
                    </View>
                    <View style={styles.riskMeta}>
                      <Text style={styles.riskMetaText}>Asignadas: {fmtCount(r.total)}</Text>
                      <Text style={styles.riskMetaText}>Atrasadas: {fmtCount(r.atrasadas)}</Text>
                      <Text style={styles.riskMetaText}>
                        Tareas en revisión: {fmtCount(r.tareas.length)}
                      </Text>
                    </View>
                    {r.tareas.length > 0 ? (
                      <View style={{ marginTop: 5 }}>
                        <View style={[styles.tr, styles.trHead]}>
                          <Text style={[styles.th, { width: 222 }]}>Actividad</Text>
                          <Text style={[styles.th, { width: 68 }]}>Prioridad</Text>
                          <Text style={[styles.th, { width: 78 }]}>Límite</Text>
                          <Text style={[styles.th, { width: 84 }]}>Estado</Text>
                          <Text style={[styles.th, { width: 92 }, styles.tdNum]}>Días atraso</Text>
                        </View>
                        {r.tareas.slice(0, 8).map((t, index) => (
                          <View
                            key={`${t.actividad}-${index}`}
                            style={[
                              styles.tr,
                              index === Math.min(r.tareas.length, 8) - 1 ? styles.trLast : {},
                            ]}
                            wrap={false}
                          >
                            <Text style={[styles.td, { width: 222 }]}>{t.actividad}</Text>
                            <Text style={[styles.td, { width: 68 }]}>{t.prioridad}</Text>
                            <Text style={[styles.td, { width: 78 }]}>{t.limite ?? "—"}</Text>
                            <Text style={[styles.td, { width: 84 }]}>{t.estado}</Text>
                            <Text style={[styles.td, styles.tdNum, { width: 92 }]}>
                              {t.diasAtraso === null ? "—" : fmtCount(t.diasAtraso)}
                            </Text>
                          </View>
                        ))}
                        {r.tareas.length > 8 ? (
                          <Text style={{ fontSize: 6.8, color: PDF_COLORS.muted, marginTop: 3 }}>
                            Se listan 8 de {r.tareas.length} tareas; el detalle completo está en el
                            anexo.
                          </Text>
                        ) : null}
                      </View>
                    ) : (
                      <Text style={{ fontSize: 7.5, color: PDF_COLORS.muted, marginTop: 4 }}>
                        Sin tareas pendientes ni atrasadas: el cumplimiento se explica por entregas
                        extemporáneas.
                      </Text>
                    )}
                  </View>
                ))
              )}
            </Section>

            {/* 6. Análisis por actividad de la Matriz */}
            <Section title="6. Análisis por actividad de la Matriz">
              <Text style={styles.paragraph}>Actividades con mayor cumplimiento</Text>
              {report.actividades.topCumplidas.length === 0 ? (
                <Text style={styles.empty}>Sin actividades con cumplimiento registrado.</Text>
              ) : (
                <View style={styles.table}>
                  <View style={[styles.tr, styles.trHead]}>
                    <Text style={[styles.th, { width: 316 }]}>Actividad</Text>
                    <Text style={[styles.th, { width: 56 }, styles.tdNum]}>Total</Text>
                    <Text style={[styles.th, { width: 76 }, styles.tdNum]}>Completadas</Text>
                    <Text style={[styles.th, { width: 96 }, styles.tdNum]}>Cumplimiento</Text>
                  </View>
                  {report.actividades.topCumplidas.map((a, index) => (
                    <View
                      key={a.actividad}
                      style={[
                        styles.tr,
                        index === report.actividades.topCumplidas.length - 1 ? styles.trLast : {},
                      ]}
                      wrap={false}
                    >
                      <Text style={[styles.td, { width: 316 }]}>{a.actividad}</Text>
                      <Text style={[styles.td, styles.tdNum, { width: 56 }]}>
                        {fmtCount(a.total)}
                      </Text>
                      <Text style={[styles.td, styles.tdNum, { width: 76 }]}>
                        {fmtCount(a.completadas)}
                      </Text>
                      <Text style={[styles.td, styles.tdNum, { width: 96 }]}>
                        {`${a.cumplimiento.toFixed(1)}%`}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={[styles.paragraph, { marginTop: 8 }]}>
                Actividades con mayor atraso
              </Text>
              {report.actividades.topAtrasadas.length === 0 ? (
                <Text style={styles.empty}>Sin actividades atrasadas en el periodo.</Text>
              ) : (
                <View style={styles.table}>
                  <View style={[styles.tr, styles.trHead]}>
                    <Text style={[styles.th, { width: 316 }]}>Actividad</Text>
                    <Text style={[styles.th, { width: 56 }, styles.tdNum]}>Total</Text>
                    <Text style={[styles.th, { width: 76 }, styles.tdNum]}>Atrasadas</Text>
                    <Text style={[styles.th, { width: 96 }, styles.tdNum]}>Cumplimiento</Text>
                  </View>
                  {report.actividades.topAtrasadas.map((a, index) => (
                    <View
                      key={a.actividad}
                      style={[
                        styles.tr,
                        index === report.actividades.topAtrasadas.length - 1 ? styles.trLast : {},
                      ]}
                      wrap={false}
                    >
                      <Text style={[styles.td, { width: 316 }]}>{a.actividad}</Text>
                      <Text style={[styles.td, styles.tdNum, { width: 56 }]}>
                        {fmtCount(a.total)}
                      </Text>
                      <Text style={[styles.td, styles.tdNum, { width: 76 }]}>
                        {fmtCount(a.atrasadas)}
                      </Text>
                      <Text style={[styles.td, styles.tdNum, { width: 96 }]}>
                        {`${a.cumplimiento.toFixed(1)}%`}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={[styles.paragraph, { marginTop: 8 }]}>
                Actividades de la Matriz sin asignar en el mes (
                {report.actividades.noAsignadas.length})
              </Text>
              {report.actividades.noAsignadas.length === 0 ? (
                <Text style={styles.paragraph}>
                  Todas las actividades de la Matriz tuvieron al menos una asignación.
                </Text>
              ) : (
                <Bullets items={report.actividades.noAsignadas} />
              )}
            </Section>

            {/* 7. Puntualidad */}
            <Section title="7. Puntualidad de las entregas">
              <View style={{ flexDirection: "row", gap: 10 }}>
                <View style={[styles.chart, { flex: 1 }]} wrap={false}>
                  <Text style={styles.chartTitle}>A tiempo vs extemporáneas vs sin entregar</Text>
                  <DonutChart
                    segments={[
                      { label: "A tiempo", value: report.puntualidad.aTiempo },
                      { label: "Extemporáneas", value: report.puntualidad.extemporaneas },
                      { label: "Sin entregar", value: report.puntualidad.sinEntregar },
                    ]}
                    width={252}
                    height={112}
                    centerValue={String(
                      report.puntualidad.aTiempo +
                        report.puntualidad.extemporaneas +
                        report.puntualidad.sinEntregar
                    )}
                    centerLabel="entregas"
                  />
                </View>
                <View style={[styles.chart, { width: 250 }]} wrap={false}>
                  <Text style={styles.chartTitle}>Lectura del indicador</Text>
                  <Text style={styles.paragraph}>
                    Entregas a tiempo: {fmtCount(report.puntualidad.aTiempo)}
                  </Text>
                  <Text style={styles.paragraph}>
                    Entregas extemporáneas: {fmtCount(report.puntualidad.extemporaneas)}
                  </Text>
                  <Text style={styles.paragraph}>
                    Sin entregar al corte: {fmtCount(report.puntualidad.sinEntregar)}
                  </Text>
                  <Text style={styles.paragraph}>
                    Días promedio de atraso:{" "}
                    {report.puntualidad.diasPromedioAtraso === null
                      ? "—"
                      : `${report.puntualidad.diasPromedioAtraso.toFixed(1)} días`}
                  </Text>
                </View>
              </View>
            </Section>

            {/* 8. Prioridad */}
            <Section title="8. Cumplimiento por prioridad">
              {report.prioridad.length === 0 ? (
                <Text style={styles.empty}>Sin datos de prioridad en el periodo.</Text>
              ) : (
                <>
                  <View style={styles.table}>
                    <View style={[styles.tr, styles.trHead]}>
                      <Text style={[styles.th, { width: 244 }]}>Prioridad</Text>
                      <Text style={[styles.th, { width: 90 }, styles.tdNum]}>Total</Text>
                      <Text style={[styles.th, { width: 110 }, styles.tdNum]}>Completadas</Text>
                      <Text style={[styles.th, { width: 100 }, styles.tdNum]}>Cumplimiento</Text>
                    </View>
                    {report.prioridad.map((p, index) => (
                      <View
                        key={p.prioridad}
                        style={[
                          styles.tr,
                          index === report.prioridad.length - 1 ? styles.trLast : {},
                        ]}
                        wrap={false}
                      >
                        <Text style={[styles.td, { width: 244 }]}>{p.prioridad}</Text>
                        <Text style={[styles.td, styles.tdNum, { width: 90 }]}>
                          {fmtCount(p.total)}
                        </Text>
                        <Text style={[styles.td, styles.tdNum, { width: 110 }]}>
                          {fmtCount(p.completadas)}
                        </Text>
                        <Text style={[styles.td, styles.tdNum, { width: 100 }]}>
                          {`${p.cumplimiento.toFixed(1)}%`}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.chart} wrap={false}>
                    <Text style={styles.chartTitle}>Cumplimiento por prioridad (%)</Text>
                    <HBarChart
                      items={report.prioridad.map((p) => ({
                        label: p.prioridad,
                        value: p.cumplimiento,
                        display: `${p.cumplimiento.toFixed(1)}%`,
                      }))}
                      width={CONTENT_WIDTH - 18}
                      height={Math.max(90, report.prioridad.length * 18 + 24)}
                      labelWidth={120}
                    />
                  </View>
                </>
              )}
            </Section>

            {/* 9. Actividad diaria */}
            <Section title="9. Actividad diaria del mes" breakBefore>
              {report.actividadDiaria.length === 0 ? (
                <Text style={styles.empty}>Sin actividad registrada en el periodo.</Text>
              ) : (
                <View style={styles.chart} wrap={false}>
                  <Text style={styles.chartTitle}>
                    Creadas, entregadas y completadas por día ({meta.monthLabel})
                  </Text>
                  <LineChart
                    series={[
                      {
                        name: "Creadas",
                        color: PDF_COLORS.navy,
                        values: report.actividadDiaria.map((d) => d.creadas),
                      },
                      {
                        name: "Entregadas",
                        color: PDF_COLORS.azul,
                        values: report.actividadDiaria.map((d) => d.entregadas),
                      },
                      {
                        name: "Completadas",
                        color: PDF_COLORS.verde,
                        values: report.actividadDiaria.map((d) => d.completadas),
                      },
                    ]}
                    width={CONTENT_WIDTH - 18}
                    height={140}
                    xLabels={report.actividadDiaria.map((d) => String(d.dia))}
                  />
                  <View style={styles.legendRow}>
                    {[
                      { label: "Creadas", color: PDF_COLORS.navy },
                      { label: "Entregadas", color: PDF_COLORS.azul },
                      { label: "Completadas", color: PDF_COLORS.verde },
                    ].map((l) => (
                      <View key={l.label} style={styles.legendItem}>
                        <View style={[styles.legendSwatch, { backgroundColor: l.color }]} />
                        <Text style={styles.legendText}>{l.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </Section>

            {/* 10. Tendencia */}
            <Section title="10. Tendencia de los últimos 6 meses">
              {report.tendencia.length === 0 ? (
                <Text style={styles.empty}>Sin historial suficiente para la tendencia.</Text>
              ) : (
                <View style={styles.chart} wrap={false}>
                  <Text style={styles.chartTitle}>% de cumplimiento por mes</Text>
                  <LineChart
                    series={[
                      {
                        name: "Cumplimiento",
                        color: PDF_COLORS.azul,
                        values: report.tendencia.map((t) => t.cumplimiento),
                      },
                    ]}
                    width={CONTENT_WIDTH - 18}
                    height={140}
                    xLabels={report.tendencia.map((t) => t.label)}
                    yMax={100}
                    ySuffix="%"
                  />
                </View>
              )}
            </Section>

            {/* 11. Hallazgos */}
            <Section title="11. Hallazgos" breakBefore>
              <Bullets items={report.hallazgos} />
            </Section>

            {/* 12. Recomendaciones */}
            <Section title="12. Recomendaciones">
              <Bullets items={report.recomendaciones} />
            </Section>

            {/* 13. Anexo */}
            <Section title={`13. Anexo: detalle de tareas del mes (${report.anexo.length})`} breakBefore>
              {report.anexo.length === 0 ? (
                <Text style={styles.empty}>Sin tareas registradas en el periodo.</Text>
              ) : (
                <AnexoTable rows={report.anexo} />
              )}
            </Section>
          </>
        )}
      </Page>
    </Document>
  );
}

/* ------------------------------------------------------------------ */
/* Anexo                                                               */
/* ------------------------------------------------------------------ */

const ANEXO_WIDTHS = [106, 68, 40, 46, 46, 46, 54, 38, 24, 76];
const ANEXO_LABELS = [
  "Actividad",
  "Supervisor",
  "Prior.",
  "Publicación",
  "Límite",
  "Entrega",
  "Estado",
  "Punt.",
  "Evid.",
  "Último comentario",
];

const PUNTUALIDAD_LABEL: Record<TaskAnnexRow["puntualidad"], string> = {
  a_tiempo: "A tiempo",
  extemporanea: "Extemporánea",
  no_aplica: "—",
};

function AnexoTable({ rows }: { rows: TaskAnnexRow[] }) {
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.trHead]} wrap={false}>
        {ANEXO_LABELS.map((label, index) => (
          <Text
            key={label}
            style={[styles.th, { width: ANEXO_WIDTHS[index], fontSize: 6 }, index >= 2 ? styles.tdNum : {}]}
          >
            {label}
          </Text>
        ))}
      </View>
      {rows.map((row, index) => (
        <View
          key={row.id || `${row.actividad}-${index}`}
          style={[styles.tr, index === rows.length - 1 ? styles.trLast : {}]}
          wrap={false}
        >
          <Text style={[styles.td, { width: ANEXO_WIDTHS[0], fontSize: 6 }]}>{row.actividad}</Text>
          <Text style={[styles.td, { width: ANEXO_WIDTHS[1], fontSize: 6 }]}>{row.supervisor}</Text>
          <Text style={[styles.td, { width: ANEXO_WIDTHS[2], fontSize: 6 }]}>{row.prioridad}</Text>
          <Text style={[styles.td, { width: ANEXO_WIDTHS[3], fontSize: 6 }]}>
            {row.publicacion ?? "—"}
          </Text>
          <Text style={[styles.td, { width: ANEXO_WIDTHS[4], fontSize: 6 }]}>
            {row.limite ?? "—"}
          </Text>
          <Text style={[styles.td, { width: ANEXO_WIDTHS[5], fontSize: 6 }]}>
            {row.entrega ?? "—"}
          </Text>
          <Text style={[styles.td, { width: ANEXO_WIDTHS[6], fontSize: 6 }]}>{row.estado}</Text>
          <Text style={[styles.td, { width: ANEXO_WIDTHS[7], fontSize: 6 }]}>
            {PUNTUALIDAD_LABEL[row.puntualidad]}
          </Text>
          <Text style={[styles.td, styles.tdNum, { width: ANEXO_WIDTHS[8], fontSize: 6 }]}>
            {row.evidencia ? "Sí" : "No"}
          </Text>
          <Text style={[styles.td, { width: ANEXO_WIDTHS[9], fontSize: 6 }]}>
            {row.ultimoComentario ?? "—"}
          </Text>
        </View>
      ))}
    </View>
  );
}
