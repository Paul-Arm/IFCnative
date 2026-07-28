/**
 * Gemeinsame Emitter-Bausteine des Baukastens (M5).
 *
 * Jeder Extrusionskörper — Bauteil wie Öffnung — hat denselben Aufbau:
 *   IfcCartesianPoint → IfcAxis2Placement3D → IfcLocalPlacement
 *   Profil (Rechteck oder Kreis) → IfcExtrudedAreaSolid
 *   → IfcShapeRepresentation → IfcProductDefinitionShape
 *
 * Die Helfer hier schreiben ausschließlich über den `StoreEditor`; sie
 * spiegeln bewusst den Aufbau der In-Store-Builder aus @ifc-lite/create,
 * damit selbst emittierte und dort erzeugte Körper identisch aussehen.
 */
import { resolveSpatialAnchor, type SpatialAnchor } from "@ifc-lite/create";
import type { IfcDataStore } from "@ifc-lite/parser";
import type {
  IfcAttributeValue,
  NewEntity,
  StoreEditor,
} from "@ifc-lite/mutations";
import type { MutablePropertyView } from "@ifc-lite/mutations";
import type { PolygonPoints, ProfileKind } from "./types";

export interface BuildContext {
  store: IfcDataStore;
  view: MutablePropertyView;
  editor: StoreEditor;
}

export interface BuildResult {
  /** Das neue Bauteil bzw. die neue Öffnung */
  elementId: number;
  /** IfcRelContainedInSpatialStructure bzw. IfcRelVoidsElement */
  relId: number;
  /** Alle in diesem Aufruf erzeugten Overlay-Records, in Emit-Reihenfolge */
  created: NewEntity[];
}

/**
 * Alle Records eines Emit-Blocks einsammeln. Die In-Store-Builder geben nur
 * ihre „interessanten" expressIds zurück; fürs Undo werden aber ALLE erzeugten
 * Records gebraucht (auch Punkte und Richtungen) — die stehen nur in
 * `editor.getNewEntities()`.
 */
export function captureCreated<T>(
  editor: StoreEditor,
  emit: () => T,
): { value: T; created: NewEntity[] } {
  const before = new Set(editor.getNewEntities().map((e) => e.expressId));
  const value = emit();
  const created = editor
    .getNewEntities()
    .filter((entity) => !before.has(entity.expressId));
  return { value, created };
}

/** Räumlicher Anker (OwnerHistory, Body-Kontext, Elternplatzierung, Einheit). */
export function anchorFor(store: IfcDataStore, parentId: number): SpatialAnchor {
  try {
    return resolveSpatialAnchor(store, parentId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Räumlicher Bezug für #${parentId} nicht auflösbar: ${detail}`,
    );
  }
}

/** Meter → Modelleinheit, gerundet wie in den In-Store-Buildern. */
export function native(anchor: SpatialAnchor, metres: number): number {
  const scale = anchor.lengthUnitScale ?? 1;
  return Math.round((metres / scale) * 1e9) / 1e9;
}

/** OwnerHistory-Referenz oder `$` (ab IFC4 optional). */
export function ownerRef(anchor: SpatialAnchor): string | null {
  return anchor.ownerHistoryId === null ? null : `#${anchor.ownerHistoryId}`;
}

/** true, wenn das Schema PredefinedType an Bauteilen kennt (ab IFC4). */
export function hasPredefinedType(anchor: SpatialAnchor): boolean {
  return (anchor.schema ?? "IFC4") !== "IFC2X3";
}

type Add = (type: string, attributes: IfcAttributeValue[]) => number;

export const adder = (editor: StoreEditor): Add => (type, attributes) =>
  editor.addEntity(type, attributes).expressId;

/** Platzierungskette unterhalb einer Elternplatzierung (Meter-Eingabe). */
export function emitPlacement(
  add: Add,
  anchor: SpatialAnchor,
  parentPlacementId: number,
  position: readonly [number, number, number],
): number {
  const origin = add("IfcCartesianPoint", [
    position.map((value) => native(anchor, value)),
  ]);
  const axis = add("IfcAxis2Placement3D", [`#${origin}`, null, null]);
  return add("IfcLocalPlacement", [`#${parentPlacementId}`, `#${axis}`]);
}

export interface ProfileSpec {
  profil: ProfileKind;
  /** Rechteck: Ausdehnung in Profil-X (Meter) */
  breite: number;
  /** Rechteck: Ausdehnung in Profil-Y (Meter) */
  tiefe: number;
  /** Kreis: Radius (Meter) */
  radius: number;
  /** Polygon: Eckpunkte (Meter, Profil-Koordinaten) */
  punkte?: PolygonPoints;
}

/** Am Ursprung zentriertes Rechteck-/Kreisprofil oder freies Polygon. */
export function emitProfile(
  add: Add,
  anchor: SpatialAnchor,
  spec: ProfileSpec,
): number {
  if (spec.profil === "polygon") {
    const points = spec.punkte ?? [];
    if (points.length < 3) {
      throw new Error("Polygon-Profil braucht mindestens 3 Punkte.");
    }
    // Geschlossener Linienzug wie in `addArbitraryProfile` aus
    // @ifc-lite/create: erster Punkt wird am Ende wiederholt.
    const pointIds = points.map(([x, y]) =>
      add("IfcCartesianPoint", [[native(anchor, x), native(anchor, y)]]),
    );
    const polyline = add("IfcPolyline", [
      [...pointIds, pointIds[0]].map((id) => `#${id}`),
    ]);
    return add("IfcArbitraryClosedProfileDef", [".AREA.", null, `#${polyline}`]);
  }
  const origin = add("IfcCartesianPoint", [[0, 0]]);
  const position = add("IfcAxis2Placement2D", [`#${origin}`, null]);
  if (spec.profil === "kreis") {
    return add("IfcCircleProfileDef", [
      ".AREA.",
      null,
      `#${position}`,
      native(anchor, spec.radius),
    ]);
  }
  return add("IfcRectangleProfileDef", [
    ".AREA.",
    null,
    `#${position}`,
    native(anchor, spec.breite),
    native(anchor, spec.tiefe),
  ]);
}

/**
 * Extrusion entlang +Z samt Body-Repräsentation. Rückgabe ist die
 * IfcProductDefinitionShape für das Attribut `Representation`.
 */
export function emitBody(
  add: Add,
  anchor: SpatialAnchor,
  profileId: number,
  hoehe: number,
): number {
  const origin = add("IfcCartesianPoint", [[0, 0, 0]]);
  const axis = add("IfcAxis2Placement3D", [`#${origin}`, null, null]);
  const direction = add("IfcDirection", [[0, 0, 1]]);
  const solidId = add("IfcExtrudedAreaSolid", [
    `#${profileId}`,
    `#${axis}`,
    `#${direction}`,
    native(anchor, hoehe),
  ]);
  const shapeRepId = add("IfcShapeRepresentation", [
    `#${anchor.bodyContextId}`,
    "Body",
    "SweptSolid",
    [`#${solidId}`],
  ]);
  return add("IfcProductDefinitionShape", [null, null, [`#${shapeRepId}`]]);
}
