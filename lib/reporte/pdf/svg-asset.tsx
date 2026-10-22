/**
 * Carga de los logotipos institucionales para el PDF.
 *
 * `@react-pdf/renderer` no admite archivos SVG como imagen (sólo JPG/PNG), así
 * que se leen los SVG de `public/` y se dibujan como vectores reales usando las
 * primitivas SVG del renderer. El parser es deliberadamente mínimo: cubre los
 * elementos y atributos que usan los logotipos del proyecto.
 *
 * Sólo debe importarse desde código de servidor (usa `node:fs`).
 */

import fs from "node:fs";
import path from "node:path";
import type { ComponentProps } from "react";
import { Circle, Ellipse, G, Line, Path, Polygon, Polyline, Rect, Svg } from "@react-pdf/renderer";

type AttrValue = string | number;

export interface SvgElementSpec {
  type: "path" | "rect" | "circle" | "ellipse" | "line" | "polygon" | "polyline" | "g";
  props: Record<string, AttrValue>;
  children?: SvgElementSpec[];
}

export interface SvgAsset {
  viewBox: string;
  width: number;
  height: number;
  elements: SvgElementSpec[];
}

const ELEMENT_RE = /<(path|rect|circle|ellipse|line|polygon|polyline|g)\b([^>]*?)(\/?)>/g;
const ATTR_RE = /([\w:-]+)\s*=\s*"([^"]*)"/g;

const STYLE_KEY_MAP: Record<string, string> = {
  fill: "fill",
  stroke: "stroke",
  "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity",
  "stroke-width": "strokeWidth",
  "stroke-opacity": "strokeOpacity",
  "stroke-dasharray": "strokeDasharray",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
};

const ATTR_KEY_MAP: Record<string, string> = {
  "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity",
  "stroke-width": "strokeWidth",
  "stroke-opacity": "strokeOpacity",
  "stroke-dasharray": "strokeDasharray",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
};

const NUMERIC_KEYS = new Set([
  "x",
  "y",
  "width",
  "height",
  "rx",
  "ry",
  "cx",
  "cy",
  "r",
  "x1",
  "x2",
  "y1",
  "y2",
  "strokeWidth",
  "opacity",
  "fillOpacity",
  "strokeOpacity",
]);

function parseStyle(style: string): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  for (const chunk of style.split(";")) {
    const idx = chunk.indexOf(":");
    if (idx === -1) continue;
    const rawKey = chunk.slice(0, idx).trim().toLowerCase();
    const value = chunk.slice(idx + 1).trim();
    const key = STYLE_KEY_MAP[rawKey];
    if (!key || value === "") continue;
    out[key] = value;
  }
  return out;
}

function parseAttrs(raw: string): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  if (!raw) return out;
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const rawKey = match[1].toLowerCase();
    const value = match[2];
    if (rawKey === "style") {
      Object.assign(out, parseStyle(value));
      continue;
    }
    if (rawKey === "id" || rawKey.startsWith("serif") || rawKey.startsWith("xmlns")) continue;
    const key = ATTR_KEY_MAP[rawKey] ?? rawKey;
    out[key] = NUMERIC_KEYS.has(key) ? Number(value) : value;
  }
  return out;
}

function isInvisible(props: Record<string, AttrValue>): boolean {
  const fill = typeof props.fill === "string" ? props.fill.trim().toLowerCase() : "";
  const stroke = typeof props.stroke === "string" ? props.stroke.trim().toLowerCase() : "";
  const invisibleFill = fill === "none" || fill === "transparent";
  const invisibleStroke = stroke === "" || stroke === "none" || stroke === "transparent";
  return invisibleFill && invisibleStroke;
}

function parseLength(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Lee un SVG y devuelve los datos necesarios para dibujarlo con react-pdf.
 * El resultado se memoiza: los logotipos no cambian durante la ejecución.
 */
const cache = new Map<string, SvgAsset>();

export function loadSvgAsset(fileName: string): SvgAsset | null {
  const cached = cache.get(fileName);
  if (cached) return cached;

  try {
    const filePath = path.join(process.cwd(), "public", fileName);
    const markup = fs.readFileSync(filePath, "utf8");

    const rootMatch = /<svg\b([^>]*)>/i.exec(markup);
    if (!rootMatch) return null;
    const rootAttrs = parseAttrs(rootMatch[1]);
    const viewBox =
      typeof rootAttrs.viewBox === "string" ? rootAttrs.viewBox : "0 0 100 100";
    const [, , vbWidth, vbHeight] = viewBox.split(/\s+/).map((v) => parseFloat(v));
    const width = parseLength(typeof rootAttrs.width === "string" ? rootAttrs.width : undefined, vbWidth);
    const height = parseLength(typeof rootAttrs.height === "string" ? rootAttrs.height : undefined, vbHeight);

    const elements: SvgElementSpec[] = [];
    ELEMENT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ELEMENT_RE.exec(markup)) !== null) {
      const type = match[1] as SvgElementSpec["type"];
      const props = parseAttrs(match[2]);
      if (isInvisible(props)) continue;
      elements.push({ type, props });
    }

    const asset: SvgAsset = { viewBox, width, height, elements };
    cache.set(fileName, asset);
    return asset;
  } catch (e) {
    console.warn(
      `[reporte:pdf] No se pudo cargar ${fileName}:`,
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

/** Renderiza un `SvgAsset` con las primitivas SVG de react-pdf. */
export function AssetSvg({
  asset,
  width,
  height,
}: {
  asset: SvgAsset;
  width: number;
  height: number;
}) {
  return (
    <Svg
      viewBox={asset.viewBox}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
    >
      {asset.elements.map((el, index) => {
        const key = `${el.type}-${index}`;
        switch (el.type) {
          case "path":
            return <Path key={key} {...(el.props as unknown as ComponentProps<typeof Path>)} />;
          case "rect":
            return <Rect key={key} {...(el.props as unknown as ComponentProps<typeof Rect>)} />;
          case "circle":
            return <Circle key={key} {...(el.props as unknown as ComponentProps<typeof Circle>)} />;
          case "ellipse":
            return <Ellipse key={key} {...(el.props as unknown as ComponentProps<typeof Ellipse>)} />;
          case "line":
            return <Line key={key} {...(el.props as unknown as ComponentProps<typeof Line>)} />;
          case "polygon":
            return <Polygon key={key} {...(el.props as unknown as ComponentProps<typeof Polygon>)} />;
          case "polyline":
            return <Polyline key={key} {...(el.props as unknown as ComponentProps<typeof Polyline>)} />;
          case "g":
            return <G key={key} {...(el.props as unknown as ComponentProps<typeof G>)} />;
          default:
            return null;
        }
      })}
    </Svg>
  );
}
