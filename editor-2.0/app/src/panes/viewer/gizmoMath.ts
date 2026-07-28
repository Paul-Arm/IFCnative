/**
 * Reine Mathematik und Heuristiken des Verschiebe-Gizmos (M9) — ohne
 * WebGPU/DOM, damit alles unter vitest testbar ist.
 *
 * Der Drag ist achsgebunden: Der Mauszeiger wird als Weltstrahl
 * (Camera.unprojectToRay) gegen die Gizmo-Achse (Gerade durch das
 * Bounding-Box-Zentrum) gestellt; verschoben wird um die Differenz des
 * Geradenparameters seit Drag-Beginn. Alle Rechnungen laufen im
 * Renderer-Rahmen (Y-up, Meter); das Delta wird erst am Ende über
 * `rendererToIfcDelta` in IFC-Achsen für `cmdMoveElement` übersetzt.
 */
import type { WorldVec3 } from "./worldCoords";
import { ifcToRendererDelta, rendererToIfcDelta } from "./worldCoords";

export interface WorldRay {
  origin: WorldVec3;
  direction: WorldVec3;
}

/** Eine Gizmo-Achse: IFC-Achsname, Farbe und Richtungen in beiden Rahmen. */
export interface GizmoAxis {
  id: "x" | "y" | "z";
  label: string;
  color: string;
  /** Einheitsrichtung in IFC-Koordinaten (Z-up). */
  ifcDir: WorldVec3;
  /** Einheitsrichtung im Renderer-Rahmen (Y-up). */
  rendererDir: WorldVec3;
}

const axis = (
  id: GizmoAxis["id"],
  color: string,
  ifcDir: WorldVec3,
): GizmoAxis => ({
  id,
  label: id.toUpperCase(),
  color,
  ifcDir,
  rendererDir: ifcToRendererDelta(ifcDir),
});

/** X rot, Y grün, Z blau — IFC-Achsen (Z ist die Höhe). */
export const GIZMO_AXES: readonly GizmoAxis[] = [
  axis("x", "#e5484d", { x: 1, y: 0, z: 0 }),
  axis("y", "#46a758", { x: 0, y: 1, z: 0 }),
  axis("z", "#0090ff", { x: 0, y: 0, z: 1 }),
];

const dot = (a: WorldVec3, b: WorldVec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Parameter s des Punkts auf der Achsen-Geraden `origin + s·axisDir`, der dem
 * Maus-Strahl am nächsten liegt (Standard-Gizmo-Mathematik über die
 * Normalgleichungen der beiden Geraden). null, wenn Achse und Strahl (fast)
 * parallel sind — dort ist der Schnitt numerisch instabil.
 */
export function axisRayParam(
  ray: WorldRay,
  origin: WorldVec3,
  axisDir: WorldVec3,
): number | null {
  const d: WorldVec3 = {
    x: ray.origin.x - origin.x,
    y: ray.origin.y - origin.y,
    z: ray.origin.z - origin.z,
  };
  const ab = dot(axisDir, ray.direction);
  const denominator = 1 - ab * ab;
  if (Math.abs(denominator) < 1e-6) return null;
  // Normalgleichungen zweier Geraden, aufgelöst nach s (d = P_ray − O_achse):
  //   s = (d·a − (a·b)(d·b)) / (1 − (a·b)²)
  const s = (dot(d, axisDir) - ab * dot(d, ray.direction)) / denominator;
  return Number.isFinite(s) ? s : null;
}

/**
 * Drag-Delta in IFC-Achsen (Meter) aus der Parameterdifferenz entlang einer
 * Gizmo-Achse — exakt die (dx, dy, dz)-Parameter für `cmdMoveElement`.
 */
export function dragDeltaIfc(axisEntry: GizmoAxis, ds: number): WorldVec3 {
  return rendererToIfcDelta({
    x: axisEntry.rendererDir.x * ds,
    y: axisEntry.rendererDir.y * ds,
    z: axisEntry.rendererDir.z * ds,
  });
}

/** Unterhalb dieser Schwelle (Meter) gilt ein Drag als „nichts bewegt". */
export const MOVE_EPSILON_M = 0.0005;

export function isNoticeableDelta(delta: WorldVec3): boolean {
  return (
    Math.abs(delta.x) >= MOVE_EPSILON_M ||
    Math.abs(delta.y) >= MOVE_EPSILON_M ||
    Math.abs(delta.z) >= MOVE_EPSILON_M
  );
}

/** Räumliche Struktur, die das Gizmo nie verschiebt (Typname-Heuristik). */
const IMMOVABLE_TYPES = new Set([
  "ifcproject",
  "ifcsite",
  "ifcbuilding",
  "ifcbuildingstorey",
  "ifcspace",
  "ifcspatialzone",
  "ifcspatialstructureelement",
  "ifcexternalspatialelement",
]);

/** Darf ein Objekt dieses Typnamens per Gizmo verschoben werden? */
export function isMovableTypeName(type: string): boolean {
  return !IMMOVABLE_TYPES.has(type.trim().toLowerCase());
}

/**
 * Sichtbare Pfeillänge (Meter) aus der Bounding-Box-Diagonale: kurz genug für
 * kleine Bauteile, gedeckelt bei riesigen (z. B. Bodenplatten).
 */
export function gizmoArmLength(diagonal: number): number {
  return Math.min(4, Math.max(0.6, diagonal * 0.35));
}
