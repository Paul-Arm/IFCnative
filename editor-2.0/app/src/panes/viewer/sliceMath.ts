/**
 * Reine Mathematik für Schneiden (Slice) und Clip-Box (M9).
 *
 * Die Clip-Box des Renderers (`RenderOptions.clipBox`) ist eine achsparallele
 * Box im RENDERER-Weltraum (Y-up, Meter, RTC-verschoben). Der Store und die
 * Regler-UI arbeiten dagegen in IFC-Modellkoordinaten (Z-up, Meter) — die
 * Umrechnung ist der dokumentierte Achsentausch aus `worldCoords.ts`
 * (IFC (x,y,z) → Renderer (x,z,−y)); weil er nur Achsen permutiert und ein
 * Vorzeichen dreht, bleibt eine AABB in beiden Rahmen eine AABB (die
 * IFC-Y-Spanne entsteht aus der NEGIERTEN Renderer-Z-Spanne, min/max tauschen).
 *
 * Alles hier ist frei von WebGPU/DOM und in tests/m9-slice.test.ts abgedeckt.
 */
import type { ClipBox } from "@ifc-lite/renderer";
import {
  ifcToRendererPoint,
  rendererToIfcPoint,
  type WorldVec3,
} from "./worldCoords";

/** Achsparallele Box (min/max je Achse), Rahmen laut Kontext. */
export interface AxisBox {
  min: WorldVec3;
  max: WorldVec3;
}

/** Vereinigung mehrerer Boxen; null bei leerer Eingabe. */
export function unionBounds(boxes: readonly AxisBox[]): AxisBox | null {
  if (boxes.length === 0) return null;
  const min = { ...boxes[0].min };
  const max = { ...boxes[0].max };
  for (const b of boxes.slice(1)) {
    min.x = Math.min(min.x, b.min.x);
    min.y = Math.min(min.y, b.min.y);
    min.z = Math.min(min.z, b.min.z);
    max.x = Math.max(max.x, b.max.x);
    max.y = Math.max(max.y, b.max.y);
    max.z = Math.max(max.z, b.max.z);
  }
  return { min, max };
}

/**
 * Box je Achse um `fraction` der Achsenlänge aufweiten (Clip-Box-Rand,
 * Standard 10 %). `minMargin` fängt degenerierte Achsen ab (z. B. eine
 * einzelne Platte mit Höhe ≈ 0), damit die Box nie flach wird.
 */
export function expandBox(box: AxisBox, fraction = 0.1, minMargin = 0.05): AxisBox {
  const grow = (lo: number, hi: number): [number, number] => {
    const m = Math.max((hi - lo) * fraction, minMargin);
    return [lo - m, hi + m];
  };
  const [xLo, xHi] = grow(box.min.x, box.max.x);
  const [yLo, yHi] = grow(box.min.y, box.max.y);
  const [zLo, zHi] = grow(box.min.z, box.max.z);
  return { min: { x: xLo, y: yLo, z: zLo }, max: { x: xHi, y: yHi, z: zHi } };
}

/** Renderer-AABB (Y-up) → IFC-AABB (Z-up); min/max je Achse neu sortiert. */
export function rendererBoxToIfc(box: AxisBox, shift: WorldVec3): AxisBox {
  const a = rendererToIfcPoint(box.min, shift);
  const b = rendererToIfcPoint(box.max, shift);
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

/** IFC-AABB (Z-up) → Renderer-AABB (Y-up); min/max je Achse neu sortiert. */
export function ifcBoxToRenderer(box: AxisBox, shift: WorldVec3): AxisBox {
  const a = ifcToRendererPoint(box.min, shift);
  const b = ifcToRendererPoint(box.max, shift);
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  };
}

/** IFC-Box → `RenderOptions.clipBox` (Renderer-Rahmen, Tupel-Form). */
export function toClipBox(boxIfc: AxisBox, shift: WorldVec3): ClipBox {
  const r = ifcBoxToRenderer(boxIfc, shift);
  return {
    min: [r.min.x, r.min.y, r.min.z],
    max: [r.max.x, r.max.y, r.max.z],
    enabled: true,
  };
}

export type BoxAxis = "x" | "y" | "z";
export type BoxSide = "min" | "max";

/**
 * Einen Flächen-Regler anwenden, ohne dass min über max hinausläuft:
 * die GEZOGENE Seite gewinnt, die Gegenseite weicht höchstens bis auf 0 aus.
 */
export function patchBoxSide(
  box: AxisBox,
  axis: BoxAxis,
  side: BoxSide,
  value: number,
): AxisBox {
  const next: AxisBox = {
    min: { ...box.min },
    max: { ...box.max },
  };
  next[side][axis] = value;
  if (next.min[axis] > next.max[axis]) {
    const other: BoxSide = side === "min" ? "max" : "min";
    next[other][axis] = value;
  }
  return next;
}

/** Die 8 Eckpunkte einer AABB (für das Kanten-Overlay). */
export function boxCorners(box: AxisBox): WorldVec3[] {
  const { min, max } = box;
  return [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
  ];
}

/** Die 12 Kanten als Index-Paare in `boxCorners`-Reihenfolge. */
export const BOX_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 0], // Boden
  [4, 5], [5, 6], [6, 7], [7, 4], // Deckel
  [0, 4], [1, 5], [2, 6], [3, 7], // Vertikalen
];

/** Position (0–100) auf den gültigen Bereich klemmen. */
export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Canvas-Drag im Werkzeug „Schneiden": Mausdelta → Δ-Position in Prozent.
 * Rechts/oben ziehen erhöht die Position; ein Zug über die volle größere
 * Canvas-Kante entspricht 100 %.
 */
export function dragPositionDelta(
  dx: number,
  dy: number,
  width: number,
  height: number,
): number {
  const span = Math.max(width, height, 1);
  return ((dx - dy) / span) * 100;
}

/** Feinjustierung per Mausrad: Alt = 0,1 %-Schritte, sonst 1 %-Schritte. */
export function wheelPositionStep(deltaY: number, fine: boolean): number {
  if (deltaY === 0) return 0;
  return (deltaY > 0 ? -1 : 1) * (fine ? 0.1 : 1);
}
