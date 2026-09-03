/**
 * Fachobjekte anlegen: Untersuchungsstelle, Probe und Sensor entstehen als
 * IfcBuildingElementProxy mit kleinem Marker-Körper (damit Viewer und Portal
 * ein 3D-Element sehen) und den Psets, die der Portal-Importer liest —
 * Portal-Pflichtfelder plus Textfelder der Katalogklassen, leer bis auf
 * ID und Bezeichnung.
 */
import { addNativeBodyElement, addNativePropertySetValues, getNativePlacement, getNextNativeEntityId, type NativeIfcDocument } from "../nativeDocument";

import { childId } from "./recipes";
import { katalogFor, type Importart } from "./schema";
import { valueTypeFor } from "./table";
import type { TreeNodeKind } from "./tree";

export interface FachobjektPset {
  /** Portal-Name des Psets; wird als `ePset_<name>` geschrieben. */
  name: string;
  /** Portal-Pflichtfelder, die auch ohne Katalog entstehen. */
  hard: string[];
  /** Katalogklasse, deren Textfelder zusätzlich angelegt werden. */
  code?: string;
}

export interface FachobjektDefinition {
  label: string;
  psets: FachobjektPset[];
  /** ID-Präfix kommt vom Projekt (Stelle, Sensor) oder von der Untersuchungsstelle (Probe). */
  parent: "projekt" | "untersuchungsstelle";
  /** Referenzfeld, das aus dem fokussierten Baumknoten vorbelegt wird. */
  context?: { kind: TreeNodeKind; pset: string; property: string };
}

export const FACHOBJEKTE: Partial<Record<TreeNodeKind, FachobjektDefinition>> = {
  untersuchungsstelle: {
    label: "Untersuchungsstelle",
    parent: "projekt",
    psets: [
      { name: "Objektinformation", hard: ["ID", "Bezeichnung", "BauteilID", "UntersuchungsbereichID"], code: "BWD - OI" },
      { name: "Untersuchungsstelle", hard: [], code: "BWD - US" },
    ],
    context: { kind: "untersuchungsbereich", pset: "Objektinformation", property: "UntersuchungsbereichID" },
  },
  probe: {
    label: "Probe",
    parent: "untersuchungsstelle",
    psets: [
      { name: "Objektinformation", hard: ["ID", "Bezeichnung"], code: "BWD - OI" },
      { name: "Probe0", hard: ["ID", "UntersuchungsstelleID", "IDProbe"], code: "BWD - PB" },
    ],
    context: { kind: "untersuchungsstelle", pset: "Probe0", property: "UntersuchungsstelleID" },
  },
  sensor: {
    label: "Sensor",
    parent: "projekt",
    psets: [
      { name: "Objektinformation", hard: ["ID", "Bezeichnung", "BauteilID", "MessanlageID"], code: "MON - OI" },
      { name: "Sensor", hard: [], code: "MON - SEN" },
      { name: "Position", hard: [], code: "MON - PO" },
    ],
    context: { kind: "messanlage", pset: "Objektinformation", property: "MessanlageID" },
  },
};

export interface AddFachobjektOptions {
  kind: TreeNodeKind;
  importart: Importart;
  bezeichnung: string;
  /** ID-Präfix: Projekt-ID (Stelle, Sensor) oder Stellen-ID (Probe). */
  parentId: string;
  /** Räumlicher Container; sonst das erste IfcBuildingStorey, sonst das IfcBuilding. */
  storeyId?: number;
  /** Entity, an deren Platzierung der Marker sitzt (Stelle für eine Probe, gewähltes Element); sonst Container-Ursprung. */
  placementRelativeToId?: number;
  /** Lokaler Versatz in Metern, damit mehrere neue Marker nicht übereinander liegen. */
  offset?: { x?: number; y?: number; z?: number };
  /** Absolute IFC-Weltkoordinate (IFC-Achsen, Modelleinheiten), z. B. der Klickpunkt aus dem Viewer — hat Vorrang vor Referenz und Versatz. */
  worldPosition?: { x: number; y: number; z: number };
  /** Vorbelegte Werte je Pset-Name und Property. */
  values?: Record<string, Record<string, string>>;
  /** Kantenlänge des Markers in Metern. */
  markerSize?: number;
}

export interface AddFachobjektResult {
  document: NativeIfcDocument;
  entityId: number;
  id: string;
}

/** Fachobjekt mit Marker-Körper und Psets anlegen; gibt dasselbe Dokument zurück, wenn die Objektart unbekannt ist. */
export function addFachobjekt(document: NativeIfcDocument, options: AddFachobjektOptions): AddFachobjektResult {
  const definition = FACHOBJEKTE[options.kind];
  const bezeichnung = options.bezeichnung.trim();
  if (!definition || !bezeichnung) return { document, entityId: -1, id: "" };
  const storey = (options.storeyId != null ? document.entityById.get(options.storeyId) : undefined) ?? document.entitiesByType.get("IFCBUILDINGSTOREY")?.[0] ?? document.entitiesByType.get("IFCBUILDING")?.[0];
  if (!storey) return { document, entityId: -1, id: "" };
  const reference = options.placementRelativeToId != null && getNativePlacement(document, options.placementRelativeToId) ? options.placementRelativeToId : undefined;
  const size = options.markerSize ?? 0.3;
  const id = childId(options.parentId, bezeichnung);
  const entityId = getNextNativeEntityId(document);
  const world = options.worldPosition;
  let next = addNativeBodyElement(document, {
    type: "IFCBUILDINGELEMENTPROXY",
    name: bezeichnung,
    parentId: storey.id,
    placementRelativeToId: reference,
    profile: "marker",
    width: size,
    depth: size,
    height: size,
    ...(world
      ? { placementMode: "world" as const, positionInModelUnits: true, x: world.x, y: world.y, z: world.z }
      : { x: options.offset?.x ?? 0, y: options.offset?.y ?? 0, z: options.offset?.z ?? 0 }),
  });
  if (next === document || !next.entityById.has(entityId)) return { document, entityId: -1, id: "" };

  const valueType = valueTypeFor(options.importart);
  const katalog = katalogFor(options.importart);
  for (const pset of definition.psets) {
    const names = new Set<string>(pset.hard);
    const klasse = pset.code ? katalog?.objektklassen.find((entry) => entry.code === pset.code) : undefined;
    for (const property of klasse?.psets[0]?.properties ?? []) {
      if (property.typ === "IFCLABEL" || property.typ === "IFCTEXT") names.add(property.kurz);
    }
    const defaults: Record<string, string> = { ID: id, Bezeichnung: bezeichnung };
    if (pset.name === "Probe0") {
      defaults.IDProbe = bezeichnung;
      defaults.UntersuchungsstelleID = options.parentId;
    }
    const given = options.values?.[pset.name] ?? {};
    const properties = [...names].map((name) => ({ name: `_${name}`, value: given[name] ?? defaults[name] ?? "", valueType }));
    next = addNativePropertySetValues(next, entityId, `ePset_${pset.name}`, properties);
  }
  return { document: next, entityId, id };
}
