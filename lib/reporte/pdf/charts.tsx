/**
 * Gráficas del PDF, dibujadas como vectores SVG con las primitivas de
 * `@react-pdf/renderer` (sin dependencias de navegador ni canvas).
 *
 * Todas las gráficas son deterministas: reciben los datos ya calculados y
 * sólo se encargan de dibujarlos.
 */

import { Fragment, type ReactElement, type ReactNode } from "react";
import { Circle, Line, Path, Polyline, Rect, Svg, Text as PdfText } from "@react-pdf/renderer";
import { DONUT_COLORS, PDF_COLORS } from "./theme";

/**
 * El `<Text>` de react-pdf acepta `fontSize` en tiempo de ejecución dentro de
 * un `<Svg>`, pero sus tipos no lo declaran (el tipo es la unión
 * `TextProps | SVGTextProps`, y ninguno expone `fontSize` como prop).
 * Se re-tipa el componente para nuestro uso exclusivamente SVG.
 */
type SvgTextOwnProps = {
  x?: number | string;
  y?: number | string;
  fontSize?: number | string;
  fill?: string;
  textAnchor?: "start" | "middle" | "end";
  children?: ReactNode;
};
const Text = PdfText as unknown as (props: SvgTextOwnProps) => ReactElement;

function truncate(value: string, max: number): string {
  const v = value.trim();
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const steps = [5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000, 5000];
  for (const step of steps) if (value <= step) return step;
  return Math.ceil(value / 1000) * 1000;
}

/* ------------------------------------------------------------------ */
/* Barras horizontales                                                 */
/* ------------------------------------------------------------------ */

export interface HBarItem {
  label: string;
  value: number;
  /** Valor numérico a mostrar a la derecha (por defecto `value`). */
  display?: string;
  color?: string;
}

/**
 * Barras horizontales. Pensada para el ranking de supervisores: los 18
 * supervisores caben en una sola gráfica, sin paginar.
 */
export function HBarChart({
  items,
  width,
  height,
  maxValue = 100,
  labelWidth = 118,
  suffix = "%",
}: {
  items: HBarItem[];
  width: number;
  height: number;
  maxValue?: number;
  labelWidth?: number;
  suffix?: string;
}) {
  if (items.length === 0) {
    return (
      <Svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
        <Text x={0} y={12} fontSize={8} fill={PDF_COLORS.muted}>
          Sin datos para graficar.
        </Text>
      </Svg>
    );
  }

  const valueWidth = 34;
  const barLeft = labelWidth;
  const barWidth = Math.max(40, width - labelWidth - valueWidth);
  const rowHeight = Math.min(16, height / items.length);
  const barHeight = Math.max(5, rowHeight - 5);
  const gridValues = [0, 0.25, 0.5, 0.75, 1];

  return (
    <Svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {gridValues.map((f) => {
        const x = barLeft + barWidth * f;
        return (
          <Line
            key={`grid-${f}`}
            x1={x}
            x2={x}
            y1={6}
            y2={height - 12}
            stroke={PDF_COLORS.grid}
            strokeWidth={0.5}
          />
        );
      })}
      {gridValues.map((f) => (
        <Text
          key={`gridlabel-${f}`}
          x={barLeft + barWidth * f}
          y={height - 2}
          fontSize={6}
          fill={PDF_COLORS.muted}
          textAnchor="middle"
        >
          {`${Math.round(maxValue * f)}${suffix}`}
        </Text>
      ))}

      {items.map((item, index) => {
        const y = index * rowHeight + 8;
        const ratio = maxValue > 0 ? Math.min(1, Math.max(0, item.value / maxValue)) : 0;
        const w = Math.max(1, barWidth * ratio);
        return (
          <Fragment key={`${item.label}-${index}`}>
            <Text
              x={labelWidth - 6}
              y={y + barHeight - 1}
              fontSize={8}
              fill={PDF_COLORS.ink}
              textAnchor="end"
            >
              {truncate(item.label, 26)}
            </Text>
            <Rect
              x={barLeft}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={PDF_COLORS.track}
            />
            <Rect
              x={barLeft}
              y={y}
              width={w}
              height={barHeight}
              fill={item.color ?? PDF_COLORS.azul}
            />
            <Text
              x={barLeft + barWidth + valueWidth - 2}
              y={y + barHeight - 1}
              fontSize={8}
              fill={PDF_COLORS.ink}
              textAnchor="end"
            >
              {item.display ?? `${item.value}${suffix}`}
            </Text>
          </Fragment>
        );
      })}
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Líneas                                                              */
/* ------------------------------------------------------------------ */

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
}

/**
 * Gráfica de líneas con eje Y auto-escalado. Sirve tanto para la actividad
 * diaria (creadas/entregadas/completadas) como para la tendencia de 6 meses.
 */
export function LineChart({
  series,
  width,
  height,
  xLabels,
  yMax,
  ySuffix = "",
}: {
  series: LineSeries[];
  width: number;
  height: number;
  xLabels: string[];
  yMax?: number;
  ySuffix?: string;
}) {
  const axisWidth = 30;
  const plotHeight = height - 26;
  const plotWidth = Math.max(40, width - axisWidth - 6);
  const allValues = series.flatMap((s) => s.values);
  const autoMax = niceMax(allValues.length > 0 ? Math.max(...allValues) : 1);
  const max = yMax ?? autoMax;
  const count = Math.max(1, xLabels.length);
  const stepX = count > 1 ? plotWidth / (count - 1) : 0;
  const yFor = (value: number) => plotHeight - (max > 0 ? (value / max) * (plotHeight - 10) : 0) + 4;
  const xFor = (index: number) => axisWidth + index * stepX;

  const ticks = [0, 0.5, 1];

  return (
    <Svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {ticks.map((f) => (
        <Line
          key={`t-${f}`}
          x1={axisWidth}
          x2={axisWidth + plotWidth}
          y1={yFor(max * f)}
          y2={yFor(max * f)}
          stroke={PDF_COLORS.grid}
          strokeWidth={0.5}
        />
      ))}
      {ticks.map((f) => (
        <Text
          key={`tl-${f}`}
          x={axisWidth - 4}
          y={yFor(max * f) + 2.5}
          fontSize={6}
          fill={PDF_COLORS.muted}
          textAnchor="end"
        >
          {`${Math.round(max * f)}${ySuffix}`}
        </Text>
      ))}

      {series.map((s) => {
        const points = s.values
          .slice(0, count)
          .map((value, index) => `${xFor(index)},${yFor(value)}`)
          .join(" ");
        return (
          <Polyline
            key={s.name}
            points={points}
            fill="none"
            stroke={s.color}
            strokeWidth={1.4}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}

      {xLabels.map((label, index) =>
        shouldLabelX(index, count) ? (
          <Text
            key={`x-${label}-${index}`}
            x={xFor(index)}
            y={height - 4}
            fontSize={6}
            fill={PDF_COLORS.muted}
            textAnchor="middle"
          >
            {label}
          </Text>
        ) : null
      )}
    </Svg>
  );
}

/** Muestra máximo ~12 etiquetas en el eje X para que no se encimen. */
function shouldLabelX(index: number, count: number): boolean {
  if (count <= 12) return true;
  const every = Math.ceil(count / 12);
  return index % every === 0 || index === count - 1;
}

/* ------------------------------------------------------------------ */
/* Dona                                                                */
/* ------------------------------------------------------------------ */

export interface DonutSegment {
  label: string;
  value: number;
  color?: string;
}

function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function donutSegmentPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startAngle: number,
  endAngle: number
): string {
  const [x0, y0] = polar(cx, cy, outer, startAngle);
  const [x1, y1] = polar(cx, cy, outer, endAngle);
  const [x2, y2] = polar(cx, cy, inner, endAngle);
  const [x3, y3] = polar(cx, cy, inner, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${round(x0)} ${round(y0)}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${round(x1)} ${round(y1)}`,
    `L ${round(x2)} ${round(y2)}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${round(x3)} ${round(y3)}`,
    "Z",
  ].join(" ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Gráfica de dona con leyenda. Se usa para puntualidad
 * (a tiempo vs extemporáneas vs sin entregar).
 */
export function DonutChart({
  segments,
  width,
  height,
  centerValue,
  centerLabel,
}: {
  segments: DonutSegment[];
  width: number;
  height: number;
  centerValue: string;
  centerLabel: string;
}) {
  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((a, s) => a + s.value, 0);
  const radius = Math.min(width, height) / 2 - 4;
  const cx = radius + 4;
  const cy = height / 2;
  const inner = radius * 0.6;

  let angle = -Math.PI / 2;
  const paths: { d: string; color: string }[] = [];
  if (total > 0) {
    visible.forEach((segment, index) => {
      const sweep = (segment.value / total) * Math.PI * 2;
      const end = angle + sweep;
      paths.push({
        d: donutSegmentPath(cx, cy, radius, inner, angle, Math.min(end, angle + Math.PI * 2 - 0.0001)),
        color: segment.color ?? DONUT_COLORS[index % DONUT_COLORS.length],
      });
      angle = end;
    });
  }

  const legendX = radius * 2 + 16;

  return (
    <Svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {total === 0 ? (
        <Circle cx={cx} cy={cy} r={radius} fill={PDF_COLORS.track} />
      ) : (
        paths.map((p, index) => <Path key={`seg-${index}`} d={p.d} fill={p.color} />)
      )}
      <Text x={cx} y={cy} fontSize={13} fill={PDF_COLORS.navy} textAnchor="middle">
        {centerValue}
      </Text>
      <Text x={cx} y={cy + 12} fontSize={6.5} fill={PDF_COLORS.muted} textAnchor="middle">
        {centerLabel}
      </Text>

      {visible.map((segment, index) => {
        const y = 12 + index * 14;
        const color = segment.color ?? DONUT_COLORS[index % DONUT_COLORS.length];
        const share = total > 0 ? Math.round((segment.value / total) * 100) : 0;
        return (
          <Fragment key={`legend-${segment.label}`}>
            <Rect x={legendX} y={y - 6} width={7} height={7} fill={color} />
            <Text x={legendX + 12} y={y} fontSize={7.5} fill={PDF_COLORS.ink}>
              {`${truncate(segment.label, 22)}: ${segment.value} (${share}%)`}
            </Text>
          </Fragment>
        );
      })}
    </Svg>
  );
}
