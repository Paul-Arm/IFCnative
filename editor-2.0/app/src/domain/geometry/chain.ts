/**
 * Referenzketten der Extrusionsgeometrie (M5).
 *
 * Ein Bauteil mit Extrusionskörper hängt an zwei Ketten, die für „Maße ändern"
 * und „verschieben" aufgelöst werden müssen:
 *
 *   Element → Representation → IfcProductDefinitionShape → IfcShapeRepresentation
 *           → IfcExtrudedAreaSolid → SweptArea (Profil) / Depth
 *
 *   Element → ObjectPlacement → IfcLocalPlacement → RelativePlacement
 *           → IfcAxis2Placement3D → Location → IfcCartesianPoint
 *
 * Gelesen wird über `readRecord`, also Overlay-Records und Quellzeilen
 * gleichermaßen. Alle nach außen gegebenen Längen sind METER.
 */
import { getAttributeNames, type IfcDataStore } from "@ifc-lite/parser";
import type { MutablePropertyView } from "@ifc-lite/mutations";
import {
  firstRefOf,
  numberOf,
  readRecord,
  refOf,
  toMetres,
  type RecordView,
} from "./records";

/** Positionaler Index von `Depth` an IfcExtrudedAreaSolid. */
export const SOLID_DEPTH_INDEX = 3;
/** Positionale Indizes von XDim/YDim an IfcRectangleProfileDef. */
export const RECT_XDIM_INDEX = 3;
export const RECT_YDIM_INDEX = 4;
/** Positionaler Index von Radius an IfcCircleProfileDef. */
export const CIRCLE_RADIUS_INDEX = 3;
/** Positionaler Index von Coordinates an IfcCartesianPoint. */
export const POINT_COORDS_INDEX = 0;

export interface ExtrusionInfo {
  elementId: number;
  solid: RecordView;
  profile: RecordView;
  /** Extrusionslänge in Metern */
  depth: number | null;
  /** Rechteckprofil: Breite in Metern */
  xDim: number | null;
  /** Rechteckprofil: Tiefe in Metern */
  yDim: number | null;
  /** Kreisprofil: Radius in Metern */
  radius: number | null;
}

/** Index eines benannten Attributs, mit positionalem Rückfallwert. */
function attributeIndex(type: string, name: string, fallback: number): number {
  try {
    const index = getAttributeNames(type).indexOf(name);
    return index >= 0 ? index : fallback;
  } catch {
    return fallback;
  }
}

interface Source {
  store: IfcDataStore;
  view: MutablePropertyView;
}

/** ObjectPlacement eines Produkts (Overlay-Records eingeschlossen). */
export function objectPlacementOf(
  source: Source,
  elementId: number,
): number | null {
  const element = readRecord(source.store, source.view, elementId);
  if (!element) return null;
  const index = attributeIndex(element.type, "ObjectPlacement", 5);
  return refOf(element.attributes[index]);
}

/** Representation (IfcProductDefinitionShape) eines Produkts. */
function representationOf(source: Source, elementId: number): number | null {
  const element = readRecord(source.store, source.view, elementId);
  if (!element) return null;
  const index = attributeIndex(element.type, "Representation", 6);
  return refOf(element.attributes[index]);
}

/**
 * Extrusionskörper eines Bauteils samt Profil. `null`, wenn das Bauteil keine
 * Body-Repräsentation aus genau einem IfcExtrudedAreaSolid trägt (Meshes,
 * Mapped Items, B-Reps — die kann der Baukasten nicht parametrisch ändern).
 */
export function findExtrusion(
  source: Source,
  elementId: number,
): ExtrusionInfo | null {
  const shapeId = representationOf(source, elementId);
  if (shapeId === null) return null;
  const productShape = readRecord(source.store, source.view, shapeId);
  if (!productShape) return null;

  // IfcProductDefinitionShape.Representations (Index 2)
  const representations = productShape.attributes[2];
  const repIds = Array.isArray(representations)
    ? representations.map((item) => refOf(item)).filter((id) => id !== null)
    : [refOf(representations)].filter((id) => id !== null);

  for (const repId of repIds as number[]) {
    const rep = readRecord(source.store, source.view, repId);
    if (!rep || rep.type !== "IFCSHAPEREPRESENTATION") continue;
    // IfcShapeRepresentation.Items (Index 3)
    const solidId = firstRefOf(rep.attributes[3]);
    if (solidId === null) continue;
    const solid = readRecord(source.store, source.view, solidId);
    if (!solid || solid.type !== "IFCEXTRUDEDAREASOLID") continue;
    const profileId = refOf(solid.attributes[0]);
    if (profileId === null) continue;
    const profile = readRecord(source.store, source.view, profileId);
    if (!profile) continue;
    return describe(source.store, elementId, solid, profile);
  }
  return null;
}

function describe(
  store: IfcDataStore,
  elementId: number,
  solid: RecordView,
  profile: RecordView,
): ExtrusionInfo {
  const native = (value: unknown): number | null => {
    const raw = numberOf(value);
    return raw === null ? null : toMetres(store, raw);
  };
  const rect = profile.type === "IFCRECTANGLEPROFILEDEF";
  const circle = profile.type === "IFCCIRCLEPROFILEDEF";
  return {
    elementId,
    solid,
    profile,
    depth: native(solid.attributes[SOLID_DEPTH_INDEX]),
    xDim: rect ? native(profile.attributes[RECT_XDIM_INDEX]) : null,
    yDim: rect ? native(profile.attributes[RECT_YDIM_INDEX]) : null,
    radius: circle ? native(profile.attributes[CIRCLE_RADIUS_INDEX]) : null,
  };
}

export interface PlacementPoint {
  placementId: number;
  axisId: number;
  /** IfcCartesianPoint der Location */
  point: RecordView;
  /** Koordinaten in Metern */
  coords: [number, number, number];
}

/**
 * IfcCartesianPoint der Verortung eines Bauteils. `null`, wenn die Kette
 * nicht aus IfcLocalPlacement → IfcAxis2Placement3D → IfcCartesianPoint
 * besteht (z. B. IfcGridPlacement).
 */
export function findPlacementPoint(
  source: Source,
  elementId: number,
): PlacementPoint | null {
  const placementId = objectPlacementOf(source, elementId);
  if (placementId === null) return null;
  const placement = readRecord(source.store, source.view, placementId);
  if (!placement || placement.type !== "IFCLOCALPLACEMENT") return null;
  const axisId = refOf(placement.attributes[1]);
  if (axisId === null) return null;
  const axis = readRecord(source.store, source.view, axisId);
  if (!axis || axis.type !== "IFCAXIS2PLACEMENT3D") return null;
  const pointId = refOf(axis.attributes[0]);
  if (pointId === null) return null;
  const point = readRecord(source.store, source.view, pointId);
  if (!point || point.type !== "IFCCARTESIANPOINT") return null;
  const raw = point.attributes[POINT_COORDS_INDEX];
  if (!Array.isArray(raw)) return null;
  const coords: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const value = numberOf(raw[i]);
    coords[i] = value === null ? 0 : toMetres(source.store, value);
  }
  return { placementId, axisId, point, coords };
}
