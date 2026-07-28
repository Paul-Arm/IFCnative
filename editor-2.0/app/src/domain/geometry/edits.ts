/**
 * Änderungspläne für bestehende Geometrie (M5).
 *
 * Beide Operationen — Maße ändern und verschieben — sind rein positionale
 * Mutationen an Geometrie-Records. Hier wird nur GEPLANT (welcher Record,
 * welcher Index, welcher Wert in Modelleinheiten); geschrieben wird in
 * `commands/geometryCommands.ts` über `writePositional`, damit Undo/Redo und
 * `skipHistory` an einer Stelle liegen.
 */
import type { IfcAttributeValue } from "@ifc-lite/mutations";
import type { IfcDataStore } from "@ifc-lite/parser";
import type { MutablePropertyView } from "@ifc-lite/mutations";
import {
  CIRCLE_RADIUS_INDEX,
  POINT_COORDS_INDEX,
  RECT_XDIM_INDEX,
  RECT_YDIM_INDEX,
  SOLID_DEPTH_INDEX,
  findExtrusion,
  findPlacementPoint,
} from "./chain";
import {
  numberOf,
  readRecord,
  refOf,
  toNative,
  type RecordView,
} from "./records";
import type { DimensionChange } from "./types";

interface Source {
  store: IfcDataStore;
  view: MutablePropertyView;
}

/** Eine geplante positionale Änderung (Wert bereits in Modelleinheiten). */
export interface PlannedEdit {
  record: RecordView;
  index: number;
  value: IfcAttributeValue;
}

/**
 * Maßänderungen auf Profil- und Solid-Slots abbilden. Wirft, wenn das Bauteil
 * keine parametrische Extrusion trägt oder keine Änderung passt (z. B. XDim
 * an einem Kreisprofil).
 */
export function planDimensionEdits(
  source: Source,
  elementId: number,
  change: DimensionChange,
): PlannedEdit[] {
  const info = findExtrusion(source, elementId);
  if (!info) {
    throw new Error(`#${elementId} hat keinen parametrischen Extrusionskörper.`);
  }
  const edits: PlannedEdit[] = [];
  const push = (record: RecordView, index: number, metres: number): void => {
    edits.push({ record, index, value: toNative(source.store, metres) });
  };
  const rect = info.profile.type === "IFCRECTANGLEPROFILEDEF";
  const circle = info.profile.type === "IFCCIRCLEPROFILEDEF";

  if (change.xDim !== undefined && rect) {
    push(info.profile, RECT_XDIM_INDEX, change.xDim);
  }
  if (change.yDim !== undefined && rect) {
    push(info.profile, RECT_YDIM_INDEX, change.yDim);
  }
  if (change.radius !== undefined && circle) {
    push(info.profile, CIRCLE_RADIUS_INDEX, change.radius);
  }
  if (change.depth !== undefined) {
    push(info.solid, SOLID_DEPTH_INDEX, change.depth);
  }
  if (edits.length === 0) {
    throw new Error("Keine passende Maßänderung für dieses Profil.");
  }
  return edits;
}

/** IfcAxis2Placement3D: positionaler Index von RefDirection. */
export const AXIS_REFDIRECTION_INDEX = 2;

export interface RotationPlan {
  /** IfcAxis2Placement3D der Platzierung */
  axis: RecordView;
  /** aktueller Yaw aus RefDirection (rad; 0 = ungesetzt/Standard +X) */
  currentRad: number;
}

/**
 * Drehung (Yaw um die IFC-Z-Achse) auf die RefDirection des
 * IfcAxis2Placement3D der Platzierung abbilden. Gelesen wird der aktuelle
 * Winkel, damit Deltas relativ wirken.
 */
export function planRotation(
  source: Source,
  elementId: number,
): RotationPlan {
  const place = findPlacementPoint(source, elementId);
  if (!place) {
    throw new Error(
      `#${elementId} hat keine drehbare Platzierung (IfcLocalPlacement).`,
    );
  }
  const axis = readRecord(source.store, source.view, place.axisId);
  if (!axis) {
    throw new Error(`Platzierungsachse von #${elementId} nicht lesbar.`);
  }
  let currentRad = 0;
  const dirId = refOf(axis.attributes[AXIS_REFDIRECTION_INDEX]);
  if (dirId !== null) {
    const direction = readRecord(source.store, source.view, dirId);
    const ratios = direction?.attributes[0];
    if (Array.isArray(ratios)) {
      const x = numberOf(ratios[0]) ?? 1;
      const y = numberOf(ratios[1]) ?? 0;
      currentRad = Math.atan2(y, x);
    }
  }
  return { axis, currentRad };
}

/**
 * Skalierung als Maßänderung an der parametrischen Extrusion: Faktoren auf
 * XDim/YDim (Rechteck) bzw. Radius (Kreis, xy-uniform) und Depth. Wirft bei
 * nicht-parametrischen Körpern (Polygon, B-Rep, Mesh).
 */
export function planScale(
  source: Source,
  elementId: number,
  factors: { x: number; y: number; z: number },
): PlannedEdit[] {
  const info = findExtrusion(source, elementId);
  if (!info) {
    throw new Error(`#${elementId} hat keinen parametrischen Extrusionskörper.`);
  }
  const change: DimensionChange = {};
  if (info.xDim !== null && factors.x !== 1) change.xDim = info.xDim * factors.x;
  if (info.yDim !== null && factors.y !== 1) change.yDim = info.yDim * factors.y;
  if (info.radius !== null && (factors.x !== 1 || factors.y !== 1)) {
    change.radius = info.radius * Math.max(factors.x, factors.y);
  }
  if (info.depth !== null && factors.z !== 1) change.depth = info.depth * factors.z;
  return planDimensionEdits(source, elementId, change);
}

/**
 * Verschiebung auf die Location des IfcLocalPlacement abbilden. Deltas in
 * Metern; gelesen wird der aktuelle Punkt, damit ein Redo nach dem Undo
 * wieder von der Ausgangslage rechnet.
 */
export function planMove(
  source: Source,
  elementId: number,
  dx: number,
  dy: number,
  dz: number,
): PlannedEdit {
  const place = findPlacementPoint(source, elementId);
  if (!place) {
    throw new Error(
      `#${elementId} hat keine verschiebbare Platzierung (IfcLocalPlacement).`,
    );
  }
  const [x, y, z] = place.coords;
  return {
    record: place.point,
    index: POINT_COORDS_INDEX,
    value: [
      toNative(source.store, x + dx),
      toNative(source.store, y + dy),
      toNative(source.store, z + dz),
    ],
  };
}
