/**
 * Ableitung und Aufbereitung der 2D-Zeichnung über @ifc-lite/drawing-2d.
 *
 * API-Befund (README + dist/*.d.ts, Version 1.19.0):
 *   - Eingabe sind IMMER `MeshData[]` aus @ifc-lite/geometry, kein Store.
 *   - `generateFloorPlan(meshes, elevation, options)` schneidet waagerecht
 *     (Achse „y" der Renderer-Welt), `generateSection(meshes, 'x'|'z', pos)`
 *     senkrecht. Beide liefern ein `Drawing2D`.
 *   - `Drawing2D` ist KEIN SVG, sondern Vektordaten: `lines` (2D-Segment,
 *     Kategorie, Sichtbarkeit, **entityId**, ifcType, Tiefe), `cutPolygons`
 *     (Schnittflächen je Entity) und `bounds`. Die expressId je Linie ist die
 *     Grundlage der Auswahl-Synchronisation.
 *   - `exportToSVG(drawing, options)` erzeugt eine papierbezogene SVG-Datei
 *     (Blattgröße, Maßstab, Schraffur) — dafür der Export-Button. Für die
 *     Pane-Anzeige wird stattdessen aus denselben Daten direkt gezeichnet,
 *     weil nur so Zoom/Pan über die viewBox und Klick-Auswahl je Entity
 *     möglich sind.
 *   - Linienbilder (Farbe, Gewicht in mm, Strichelung) kommen aus
 *     `getLineStyle(category, ifcType)` des Pakets, damit Anzeige und Export
 *     dieselbe Konvention nutzen.
 */
import {
  generateFloorPlan,
  generateSection,
  getLineStyle,
  type Drawing2D,
  type DrawingLine,
  type LineCategory,
  type Point2D,
} from "@ifc-lite/drawing-2d";
import type { MeshData } from "@ifc-lite/geometry";

export type DrawingMode = "plan" | "section-x" | "section-z";

export interface DrawingSettings {
  mode: DrawingMode;
  /** Geschoss der Grundrissableitung. */
  storeyId: number | null;
  /** Schnitthöhe über Geschossbezug in Metern. */
  offset: number;
  /** Lage des senkrechten Schnitts (Meter, Mesh-Koordinaten). */
  position: number;
  /** Verdeckte Kanten mitrechnen (teuer). */
  hiddenLines: boolean;
}

export const DEFAULT_SETTINGS: DrawingSettings = {
  mode: "plan",
  storeyId: null,
  offset: 1,
  position: 0,
  hiddenLines: false,
};

/** Ein zeichenbarer Pfad — je Entity und Kategorie einer, damit Klicks treffen. */
export interface DrawingPath {
  key: string;
  entityId: number;
  ifcType: string;
  category: LineCategory;
  d: string;
  color: string;
  /** Strichstärke in Pixeln (non-scaling-stroke). */
  width: number;
  dash: string | undefined;
}

/** Gefüllte Schnittfläche einer Entity. */
export interface DrawingFill {
  key: string;
  entityId: number;
  ifcType: string;
  d: string;
}

export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawingResult {
  drawing: Drawing2D;
  paths: DrawingPath[];
  fills: DrawingFill[];
  viewBox: ViewBox;
  /** Tatsächliche Schnittlage in Mesh-Koordinaten (Meter). */
  cutAt: number;
  /** Dokument-Revision und Einstellungen, aus denen die Zeichnung stammt. */
  revision: number;
  key: string;
}

/** Millimeter-Gewichte des Pakets in Bildschirm-Pixel. */
const PX_PER_MM = 2.5;

/** Malreihenfolge: verdeckt zuerst, Schnittkanten zuletzt. */
const CATEGORY_ORDER: Record<LineCategory, number> = {
  hidden: 0,
  projection: 1,
  crease: 2,
  boundary: 3,
  silhouette: 4,
  annotation: 5,
  cut: 6,
};

/** SVG-Y zeigt nach unten, die Zeichenebene nach oben. */
function point(p: Point2D): string {
  return `${p.x.toFixed(4)} ${(-p.y).toFixed(4)}`;
}

function pathKey(line: DrawingLine): string {
  return `${line.modelIndex}:${line.entityId}:${line.category}`;
}

/** Linien zu einem Pfad je Entity und Kategorie zusammenfassen. */
export function buildPaths(drawing: Drawing2D): DrawingPath[] {
  const groups = new Map<string, { line: DrawingLine; parts: string[] }>();
  for (const line of drawing.lines) {
    const key = pathKey(line);
    const group = groups.get(key) ?? { line, parts: [] };
    group.parts.push(`M${point(line.line.start)}L${point(line.line.end)}`);
    groups.set(key, group);
  }
  const paths: DrawingPath[] = [];
  for (const [key, group] of groups) {
    const style = getLineStyle(group.line.category, group.line.ifcType);
    paths.push({
      key,
      entityId: group.line.entityId,
      ifcType: group.line.ifcType,
      category: group.line.category,
      d: group.parts.join(""),
      color: style.color,
      width: Math.max(0.5, style.weight * PX_PER_MM),
      dash:
        style.dashPattern.length > 0
          ? style.dashPattern.map((v) => v * PX_PER_MM).join(" ")
          : undefined,
    });
  }
  return paths.sort(
    (a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category],
  );
}

/** Schnittflächen als gefüllte Pfade (Löcher über fill-rule evenodd). */
export function buildFills(drawing: Drawing2D): DrawingFill[] {
  const fills: DrawingFill[] = [];
  drawing.cutPolygons.forEach((polygon, index) => {
    const rings = [polygon.polygon.outer, ...polygon.polygon.holes];
    const parts: string[] = [];
    for (const ring of rings) {
      if (ring.length < 3) continue;
      parts.push(`M${ring.map(point).join("L")}Z`);
    }
    if (parts.length === 0) return;
    fills.push({
      key: `${polygon.modelIndex}:${polygon.entityId}:${index}`,
      entityId: polygon.entityId,
      ifcType: polygon.ifcType,
      d: parts.join(""),
    });
  });
  return fills;
}

/** Sichtfenster aus den Zeichnungsgrenzen, mit 4 % Rand. */
export function viewBoxOf(drawing: Drawing2D): ViewBox {
  const { min, max } = drawing.bounds;
  const width = max.x - min.x;
  const height = max.y - min.y;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { x: -1, y: -1, width: 2, height: 2 };
  }
  const pad = Math.max(width, height) * 0.04;
  return {
    x: min.x - pad,
    y: -max.y - pad,
    width: width + pad * 2,
    height: height + pad * 2,
  };
}

/** Stabiler Schlüssel der Einstellungen — Grundlage des Veraltet-Hinweises. */
export function settingsKey(settings: DrawingSettings): string {
  return [
    settings.mode,
    settings.storeyId ?? "-",
    settings.offset.toFixed(2),
    settings.position.toFixed(2),
    settings.hiddenLines ? "h1" : "h0",
  ].join("|");
}

/** Zeichnung erzeugen (der teure Schnitt-Pass über alle Dreiecke). */
export async function generateDrawing(
  meshes: MeshData[],
  settings: DrawingSettings,
  cutAt: number,
  revision: number,
): Promise<DrawingResult> {
  const options = {
    useGPU: false,
    includeHiddenLines: settings.hiddenLines,
    includeProjection: true,
    includeEdges: true,
    mergeLines: true,
  };
  const drawing =
    settings.mode === "plan"
      ? await generateFloorPlan(meshes, cutAt, options)
      : await generateSection(
          meshes,
          settings.mode === "section-x" ? "x" : "z",
          cutAt,
          options,
        );
  return {
    drawing,
    paths: buildPaths(drawing),
    fills: buildFills(drawing),
    viewBox: viewBoxOf(drawing),
    cutAt,
    revision,
    key: settingsKey(settings),
  };
}
