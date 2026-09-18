import {
  getNativePlacementWorldFrame,
  readNativePropertySet,
  readReferences,
  splitTopLevel,
  type NativeIfcDocument,
  type NativeIfcEntity,
  type NativeIfcPropertySet,
} from "../nativeDocument";
import { unquoteStepString } from "../stepEncoding";
import {
  canonicalArgHash,
  createHashContext,
  ifcGlobalId,
  sha256Hex,
  type HashContext,
} from "./entityHash";

/**
 * Objektzentrierte Änderungs-Records für die Versionsverwaltung.
 *
 * Das Manifest in `entityDiffByGuid.ts` vergleicht JEDE gerootete STEP-Entity
 * per Hash — also auch IfcPropertySet, IfcRelDefinesByProperties & Co. Für
 * Menschen ist das die falsche Flughöhe: "Pset 2x3$… geändert" sagt nichts,
 * "Wand W-01: FireRating F30 → F90" schon. Deshalb faltet dieses Modul alles,
 * was zu einem Objekt gehört, in EINEN Record je GlobalId:
 *
 *  - Attribute (Name, Beschreibung, ObjectType, Tag, PredefinedType, …)
 *  - Lage (Weltkoordinaten + Drehung aus der Platzierungskette)
 *  - Geometrie (versionsstabiler Struktur-Hash + lesbare Kennwerte)
 *  - Eigenschaften (alle Property-/Quantity-Sets mit Werten)
 *  - Beziehungen (Geschoss, Teil von, Typ, Material, Klassifikation, …)
 *
 * Je Facette gibt es einen eigenen Hash: Ein Diff zweier Stände braucht so nur
 * die kompakten Index-Zeilen (kein IFC-Parsing, keine Details) und weiß
 * trotzdem, WAS sich geändert hat. Die Details (`ObjectDetail`) liefern beim
 * Aufklappen die konkreten Vorher/Nachher-Werte.
 *
 * Bewusst NICHT Teil des Records: OwnerHistory (Zeitstempel ändern sich bei
 * jedem Re-Export) und Express-Ids.
 */

export type ChangeFacet =
  | "attributes"
  | "placement"
  | "geometry"
  | "properties"
  | "relations";

export const CHANGE_FACETS: ChangeFacet[] = [
  "attributes",
  "placement",
  "geometry",
  "properties",
  "relations",
];

export interface ObjectPlacementDetail {
  x: number;
  y: number;
  z: number;
  /** Drehung der lokalen X-Achse um die Welt-Z-Achse, Grad. */
  rotation: number;
  /** Neigung der lokalen Z-Achse gegen die Welt-Z-Achse, Grad. */
  tilt: number;
}

export interface ObjectGeometryDetail {
  /** Kurzform des Struktur-Hashes — ändert sich bei JEDER Geometrieänderung. */
  fingerprint: string;
  /** z. B. "Body: SweptSolid". */
  representations: string[];
  /** Geometrie-Items der Darstellungen mit Anzahl. */
  items: Record<string, number>;
  /** Explizite Stützpunkte (Polyloops, Punktlisten, Polylinien). */
  points: number;
  /** Lokale Ausdehnung der Stützpunkte in Modelleinheiten. */
  size?: [number, number, number];
  extrusions: string[];
  profiles: string[];
}

export interface ObjectDetail {
  attributes: Record<string, string>;
  placement?: ObjectPlacementDetail;
  /** Platzierungsart, wenn keine IfcLocalPlacement-Kette (z. B. linear). */
  placementKind?: string;
  geometry?: ObjectGeometryDetail;
  relations: Record<string, string>;
  psets: Record<string, Record<string, string>>;
}

export interface ObjectIndexEntry {
  globalId: string;
  type: string;
  name: string;
  /** Räumlicher Container (Geschoss/Bauwerksteil) — für Liste und Filter. */
  container: string;
  /** Hash über Klasse + alle Facetten. */
  hash: string;
  facets: Record<ChangeFacet, string>;
}

export interface ObjectRecord extends ObjectIndexEntry {
  detail: ObjectDetail;
}

// ---- Welche Entities sind "Objekte"? ---------------------------------------

/** Gerootete Hilfs-Entities, die in ihr Besitzerobjekt gefaltet werden. */
function isFoldedType(type: string): boolean {
  return (
    type.startsWith("IFCREL") ||
    type === "IFCPROPERTYSET" ||
    type === "IFCELEMENTQUANTITY" ||
    type.endsWith("TEMPLATE")
  );
}

function isTypeObject(type: string): boolean {
  return type.endsWith("TYPE") || type.endsWith("STYLE");
}

const SPATIAL_TYPES = new Set([
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
  "IFCSPACE",
  "IFCFACILITY",
  "IFCFACILITYPART",
  "IFCBRIDGE",
  "IFCBRIDGEPART",
  "IFCROAD",
  "IFCROADPART",
  "IFCRAILWAY",
  "IFCRAILWAYPART",
  "IFCMARINEFACILITY",
  "IFCMARINEPART",
]);

const ATTRIBUTE_LABELS: Record<string, Record<number, string>> = {
  IFCPROJECT: {
    5: "LongName",
    6: "Phase",
    7: "RepresentationContexts",
    8: "UnitsInContext",
  },
  IFCSITE: {
    9: "RefLatitude",
    10: "RefLongitude",
    11: "RefElevation",
    12: "LandTitleNumber",
    13: "SiteAddress",
  },
  IFCBUILDING: {
    9: "ElevationOfRefHeight",
    10: "ElevationOfTerrain",
    11: "BuildingAddress",
  },
  IFCBUILDINGSTOREY: { 9: "Elevation" },
  IFCSPACE: { 9: "PredefinedType", 10: "ElevationWithFlooring" },
  IFCDOOR: {
    8: "OverallHeight",
    9: "OverallWidth",
    10: "PredefinedType",
    11: "OperationType",
    12: "UserDefinedOperationType",
  },
  IFCWINDOW: {
    8: "OverallHeight",
    9: "OverallWidth",
    10: "PredefinedType",
    11: "PartitioningType",
    12: "UserDefinedPartitioningType",
  },
};

function attributeLabel(type: string, index: number): string {
  if (index === 2) return "Name";
  if (index === 3) return "Description";
  const own = ATTRIBUTE_LABELS[type]?.[index];
  if (own) return own;
  if (isTypeObject(type)) {
    if (index === 4) return "ApplicableOccurrence";
    if (index === 7) return "Tag";
    if (index === 8) return "ElementType";
    if (index === 9) return "PredefinedType";
  } else {
    if (index === 4) return "ObjectType";
    if (SPATIAL_TYPES.has(type)) {
      if (index === 7) return "LongName";
      if (index === 8) return "CompositionType";
    } else {
      if (index === 7) return "Tag";
      if (index === 8) return "PredefinedType";
    }
  }
  return `Attribut ${index + 1}`;
}

// ---- Werte lesbar machen ---------------------------------------------------

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

const NUMBER_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const TYPED_VALUE = /^IFC[A-Z0-9]+\((.*)\)$/s;

/**
 * STEP-Literal -> Anzeige-Text: `IFCLABEL('F30')` -> `F30`, `3000.` -> `3000`,
 * `.T.` -> `TRUE`, `.NOTDEFINED.` -> `NOTDEFINED`. Zahlen werden normalisiert,
 * damit `3.0` und `3.` nicht als Änderung gelten.
 */
export function prettyIfcValue(raw: string): string {
  let value = raw.trim();
  const typed = TYPED_VALUE.exec(value);
  if (typed) {
    value = typed[1]!.trim();
  }
  if (value === "$" || value === "*" || value === "-" || value === "") {
    return "";
  }
  const unquoted = unquoteStepString(value);
  if (unquoted !== undefined) {
    return unquoted;
  }
  if (value.startsWith("'")) {
    // Bereits dekodierter (evtl. gekürzter) String aus der Pset-Zusammenfassung.
    return value.replace(/^'/, "").replace(/'$/, "");
  }
  if (value === ".T.") return "TRUE";
  if (value === ".F.") return "FALSE";
  if (value === ".U.") return "UNKNOWN";
  if (/^\.[A-Za-z0-9_]+\.$/.test(value)) {
    return value.slice(1, -1);
  }
  if (NUMBER_LITERAL.test(value)) {
    return formatNumber(Number(value));
  }
  if (value.startsWith("(") && value.endsWith(")")) {
    return splitTopLevel(value.slice(1, -1))
      .map((item) => prettyIfcValue(item))
      .filter((item) => item.length > 0)
      .join("; ");
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function facetHash(value: unknown): string {
  return sha256Hex(stableJson(value)).slice(0, 16);
}

function entityLabel(entity: NativeIfcEntity | undefined): string {
  if (!entity) return "";
  return entity.name || entity.type;
}

// ---- Beziehungen -------------------------------------------------------------

interface RelationIndex {
  container: Map<number, number>;
  parent: Map<number, number>;
  materials: Map<number, string[]>;
  classifications: Map<number, string[]>;
  groups: Map<number, string[]>;
  openings: Map<number, number>;
  voids: Map<number, number>;
}

function pushTo(map: Map<number, string[]>, id: number, value: string): void {
  if (!value) return;
  const list = map.get(id);
  if (list) {
    list.push(value);
  } else {
    map.set(id, [value]);
  }
}

function materialLabel(doc: NativeIfcDocument, rootId: number): string {
  const labels: string[] = [];
  const visited = new Set<number>();
  const visit = (id: number, depth: number, suffix: string): void => {
    if (visited.has(id) || depth > 6 || labels.length >= 12) return;
    visited.add(id);
    const entity = doc.entityById.get(id);
    if (!entity) return;
    if (entity.type === "IFCMATERIAL") {
      const name = prettyIfcValue(entity.args[0] ?? "") || "Material";
      labels.push(suffix ? `${name} (${suffix})` : name);
      return;
    }
    if (entity.type === "IFCMATERIALLAYER") {
      const thickness = prettyIfcValue(entity.args[1] ?? "");
      for (const ref of readReferences(entity.args[0] ?? "")) {
        visit(ref, depth + 1, thickness);
      }
      return;
    }
    for (const arg of entity.args) {
      for (const ref of readReferences(arg)) {
        visit(ref, depth + 1, suffix);
      }
    }
  };
  visit(rootId, 0, "");
  return labels.join(" / ");
}

function classificationLabel(entity: NativeIfcEntity | undefined): string {
  if (!entity) return "";
  if (entity.type === "IFCCLASSIFICATIONREFERENCE") {
    const identification = prettyIfcValue(entity.args[1] ?? "");
    const name = prettyIfcValue(entity.args[2] ?? "");
    return [identification, name].filter(Boolean).join(" ");
  }
  return entityLabel(entity);
}

function buildRelationIndex(doc: NativeIfcDocument): RelationIndex {
  const index: RelationIndex = {
    container: new Map(),
    parent: new Map(),
    materials: new Map(),
    classifications: new Map(),
    groups: new Map(),
    openings: new Map(),
    voids: new Map(),
  };
  const ofType = (type: string) => doc.entitiesByType.get(type) ?? [];

  for (const rel of ofType("IFCRELCONTAINEDINSPATIALSTRUCTURE")) {
    const structure = readReferences(rel.args[5] ?? "")[0];
    if (!structure) continue;
    for (const id of readReferences(rel.args[4] ?? "")) {
      index.container.set(id, structure);
    }
  }
  for (const type of ["IFCRELAGGREGATES", "IFCRELNESTS"]) {
    for (const rel of ofType(type)) {
      const relating = readReferences(rel.args[4] ?? "")[0];
      if (!relating) continue;
      for (const id of readReferences(rel.args[5] ?? "")) {
        index.parent.set(id, relating);
      }
    }
  }
  for (const rel of ofType("IFCRELASSOCIATESMATERIAL")) {
    const material = readReferences(rel.args[5] ?? "")[0];
    if (!material) continue;
    const label = materialLabel(doc, material);
    for (const id of readReferences(rel.args[4] ?? "")) {
      pushTo(index.materials, id, label);
    }
  }
  for (const rel of ofType("IFCRELASSOCIATESCLASSIFICATION")) {
    const reference = readReferences(rel.args[5] ?? "")[0];
    const label = classificationLabel(
      reference ? doc.entityById.get(reference) : undefined,
    );
    for (const id of readReferences(rel.args[4] ?? "")) {
      pushTo(index.classifications, id, label);
    }
  }
  for (const rel of ofType("IFCRELASSIGNSTOGROUP")) {
    const group = readReferences(rel.args[6] ?? "")[0];
    const label = entityLabel(group ? doc.entityById.get(group) : undefined);
    for (const id of readReferences(rel.args[4] ?? "")) {
      pushTo(index.groups, id, label);
    }
  }
  for (const rel of ofType("IFCRELVOIDSELEMENT")) {
    const element = readReferences(rel.args[4] ?? "")[0];
    const opening = readReferences(rel.args[5] ?? "")[0];
    if (!element || !opening) continue;
    index.openings.set(element, (index.openings.get(element) ?? 0) + 1);
    index.voids.set(opening, element);
  }
  return index;
}

function containerLabel(
  doc: NativeIfcDocument,
  relations: RelationIndex,
  entityId: number,
): string {
  let current = entityId;
  for (let depth = 0; depth < 8; depth += 1) {
    const container = relations.container.get(current);
    if (container) {
      return entityLabel(doc.entityById.get(container));
    }
    const next = relations.parent.get(current) ?? relations.voids.get(current);
    if (!next) {
      return "";
    }
    const parent = doc.entityById.get(next);
    if (parent && SPATIAL_TYPES.has(parent.type)) {
      return entityLabel(parent);
    }
    current = next;
  }
  return "";
}

// ---- Geometrie -----------------------------------------------------------------

interface GeometryStats {
  items: Map<string, number>;
  points: number;
  min: [number, number, number] | null;
  max: [number, number, number] | null;
  extrusions: string[];
  profiles: string[];
}

/** Nicht in die Punktwolke einbeziehen: Kontexte und lokale Achsensysteme. */
const GEOMETRY_SKIP_TYPES = new Set([
  "IFCGEOMETRICREPRESENTATIONCONTEXT",
  "IFCGEOMETRICREPRESENTATIONSUBCONTEXT",
  "IFCAXIS2PLACEMENT2D",
  "IFCAXIS2PLACEMENT3D",
  "IFCAXIS1PLACEMENT",
  "IFCDIRECTION",
  "IFCCARTESIANTRANSFORMATIONOPERATOR2D",
  "IFCCARTESIANTRANSFORMATIONOPERATOR3D",
  "IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM",
]);

const PARAMS_LIMIT = 4;
const NUMBERS = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function emptyStats(): GeometryStats {
  return {
    items: new Map(),
    points: 0,
    min: null,
    max: null,
    extrusions: [],
    profiles: [],
  };
}

function addPoint(stats: GeometryStats, x: number, y: number, z: number): void {
  stats.points += 1;
  if (!stats.min || !stats.max) {
    stats.min = [x, y, z];
    stats.max = [x, y, z];
    return;
  }
  if (x < stats.min[0]) stats.min[0] = x;
  if (y < stats.min[1]) stats.min[1] = y;
  if (z < stats.min[2]) stats.min[2] = z;
  if (x > stats.max[0]) stats.max[0] = x;
  if (y > stats.max[1]) stats.max[1] = y;
  if (z > stats.max[2]) stats.max[2] = z;
}

function pushLimited(list: string[], value: string): void {
  if (value && list.length < PARAMS_LIMIT && !list.includes(value)) {
    list.push(value);
  }
}

function mergeStats(target: GeometryStats, source: GeometryStats): void {
  target.points += source.points;
  if (source.min && source.max) {
    const points = target.points;
    addPoint(target, source.min[0], source.min[1], source.min[2]);
    addPoint(target, source.max[0], source.max[1], source.max[2]);
    target.points = points;
  }
  for (const value of source.extrusions) pushLimited(target.extrusions, value);
  for (const value of source.profiles) pushLimited(target.profiles, value);
}

function profileLabel(entity: NativeIfcEntity): string {
  const num = (index: number) => prettyIfcValue(entity.args[index] ?? "");
  const name = prettyIfcValue(entity.args[1] ?? "");
  let label: string;
  switch (entity.type) {
    case "IFCRECTANGLEPROFILEDEF":
    case "IFCROUNDEDRECTANGLEPROFILEDEF":
      label = `Rechteck ${num(3)} × ${num(4)}`;
      break;
    case "IFCRECTANGLEHOLLOWPROFILEDEF":
      label = `Hohlrechteck ${num(3)} × ${num(4)}, t=${num(5)}`;
      break;
    case "IFCCIRCLEPROFILEDEF":
      label = `Kreis r=${num(3)}`;
      break;
    case "IFCCIRCLEHOLLOWPROFILEDEF":
      label = `Rohr r=${num(3)}, t=${num(4)}`;
      break;
    case "IFCELLIPSEPROFILEDEF":
      label = `Ellipse ${num(3)} × ${num(4)}`;
      break;
    case "IFCISHAPEPROFILEDEF":
      label = `I-Profil ${num(3)} × ${num(4)}`;
      break;
    default:
      label = entity.type.replace(/^IFC/, "").replace(/PROFILEDEF$/, "-Profil");
  }
  return name ? `${label} (${name})` : label;
}

class GeometryReader {
  private readonly byRepresentation = new Map<number, GeometryStats>();
  private readonly active = new Set<number>();

  constructor(private readonly doc: NativeIfcDocument) {}

  /** Kennwerte einer IfcShapeRepresentation (memoisiert — Mapped Items!). */
  representationStats(representationId: number): GeometryStats {
    const cached = this.byRepresentation.get(representationId);
    if (cached) return cached;
    const stats = emptyStats();
    if (this.active.has(representationId)) return stats;
    this.active.add(representationId);
    const representation = this.doc.entityById.get(representationId);
    const visited = new Set<number>();
    for (const itemId of readReferences(representation?.args[3] ?? "")) {
      const item = this.doc.entityById.get(itemId);
      if (item) {
        stats.items.set(item.type, (stats.items.get(item.type) ?? 0) + 1);
      }
      this.visit(itemId, stats, visited, 0);
    }
    this.active.delete(representationId);
    this.byRepresentation.set(representationId, stats);
    return stats;
  }

  private visit(
    id: number,
    stats: GeometryStats,
    visited: Set<number>,
    depth: number,
  ): void {
    if (visited.has(id) || depth > 64) return;
    visited.add(id);
    const entity = this.doc.entityById.get(id);
    if (!entity || GEOMETRY_SKIP_TYPES.has(entity.type)) return;

    switch (entity.type) {
      case "IFCCARTESIANPOINT": {
        const numbers = (entity.args[0] ?? "").match(NUMBERS) ?? [];
        addPoint(
          stats,
          Number(numbers[0] ?? 0),
          Number(numbers[1] ?? 0),
          Number(numbers[2] ?? 0),
        );
        return;
      }
      case "IFCCARTESIANPOINTLIST3D":
      case "IFCCARTESIANPOINTLIST2D": {
        const stride = entity.type.endsWith("3D") ? 3 : 2;
        const numbers = (entity.args[0] ?? "").match(NUMBERS) ?? [];
        for (let i = 0; i + stride <= numbers.length; i += stride) {
          addPoint(
            stats,
            Number(numbers[i]),
            Number(numbers[i + 1]),
            stride === 3 ? Number(numbers[i + 2]) : 0,
          );
        }
        return;
      }
      case "IFCMAPPEDITEM": {
        const mapId = readReferences(entity.args[0] ?? "")[0];
        const map = mapId ? this.doc.entityById.get(mapId) : undefined;
        const mappedId = readReferences(map?.args[1] ?? "")[0];
        if (mappedId) {
          const mapped = this.representationStats(mappedId);
          mergeStats(stats, mapped);
          for (const [type, count] of mapped.items) {
            stats.items.set(
              `${type} (gemappt)`,
              (stats.items.get(`${type} (gemappt)`) ?? 0) + count,
            );
          }
        }
        return;
      }
      case "IFCEXTRUDEDAREASOLID":
      case "IFCEXTRUDEDAREASOLIDTAPERED":
        pushLimited(stats.extrusions, prettyIfcValue(entity.args[3] ?? ""));
        break;
      default:
        if (entity.type.endsWith("PROFILEDEF")) {
          pushLimited(stats.profiles, profileLabel(entity));
        }
    }

    for (const ref of this.doc.outgoingRefs.get(id) ?? []) {
      this.visit(ref, stats, visited, depth + 1);
    }
  }
}

function geometryDetail(
  doc: NativeIfcDocument,
  reader: GeometryReader,
  representationArg: string,
  fingerprint: string,
): ObjectGeometryDetail {
  const total = emptyStats();
  const representations: string[] = [];
  const collect = (representationId: number): void => {
    const representation = doc.entityById.get(representationId);
    if (!representation) return;
    if (representation.type === "IFCREPRESENTATIONMAP") {
      const mapped = readReferences(representation.args[1] ?? "")[0];
      if (mapped) collect(mapped);
      return;
    }
    if (representation.type === "IFCPRODUCTDEFINITIONSHAPE") {
      for (const id of readReferences(representation.args[2] ?? "")) {
        collect(id);
      }
      return;
    }
    const identifier = prettyIfcValue(representation.args[1] ?? "");
    const kind = prettyIfcValue(representation.args[2] ?? "");
    const label = [identifier, kind].filter(Boolean).join(": ");
    if (label && !representations.includes(label)) {
      representations.push(label);
    }
    const stats = reader.representationStats(representationId);
    mergeStats(total, stats);
    for (const [type, count] of stats.items) {
      total.items.set(type, (total.items.get(type) ?? 0) + count);
    }
  };
  for (const id of readReferences(representationArg)) {
    collect(id);
  }

  const detail: ObjectGeometryDetail = {
    fingerprint,
    representations,
    items: Object.fromEntries(
      [...total.items.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    points: total.points,
    extrusions: total.extrusions,
    profiles: total.profiles,
  };
  if (total.min && total.max && total.points > 1) {
    detail.size = [
      Math.round((total.max[0] - total.min[0]) * 1e6) / 1e6,
      Math.round((total.max[1] - total.min[1]) * 1e6) / 1e6,
      Math.round((total.max[2] - total.min[2]) * 1e6) / 1e6,
    ];
  }
  return detail;
}

// ---- Record-Aufbau -------------------------------------------------------------

const PLACEMENT_TYPES = new Set([
  "IFCLOCALPLACEMENT",
  "IFCGRIDPLACEMENT",
  "IFCLINEARPLACEMENT",
]);

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function propertySetsOf(
  doc: NativeIfcDocument,
  entity: NativeIfcEntity,
): NativeIfcPropertySet[] {
  const sets = [...(doc.propertySetsByEntity.get(entity.id) ?? [])];
  if (isTypeObject(entity.type)) {
    // HasPropertySets hängt direkt am Typobjekt, ohne Relationship.
    const known = new Set(sets.map((set) => set.id));
    for (const id of readReferences(entity.args[5] ?? "")) {
      if (known.has(id)) continue;
      const set = readNativePropertySet(doc, id);
      if (set) sets.push(set);
    }
  }
  return sets;
}

function buildRecord(
  doc: NativeIfcDocument,
  entity: NativeIfcEntity,
  globalId: string,
  ctx: HashContext,
  relations: RelationIndex,
  geometry: GeometryReader,
): ObjectRecord {
  const typeObject = isTypeObject(entity.type);
  const placementRef = typeObject
    ? undefined
    : readReferences(entity.args[5] ?? "")[0];
  const placementEntity = placementRef
    ? doc.entityById.get(placementRef)
    : undefined;
  const hasPlacement =
    placementEntity !== undefined && PLACEMENT_TYPES.has(placementEntity.type);
  // Produkte: [5] Placement, [6] Representation. Typobjekte: [5] Psets,
  // [6] RepresentationMaps. Alles andere (Projekt, Gruppen …) hat beides nicht.
  const representationIndex =
    typeObject || hasPlacement || /^#\d+$/.test((entity.args[6] ?? "").trim())
      ? 6
      : -1;
  const representationArg =
    representationIndex >= 0 ? (entity.args[representationIndex] ?? "") : "";
  const representationRefs = readReferences(representationArg).filter((id) => {
    const type = doc.entityById.get(id)?.type;
    return type === "IFCPRODUCTDEFINITIONSHAPE" || type === "IFCREPRESENTATIONMAP";
  });
  const hasGeometry = representationRefs.length > 0;

  // -- Attribute: alle Literal-Argumente ab Name; Referenzen als Kurz-Hash.
  const attributes: Record<string, string> = { Klasse: entity.type };
  for (let index = 2; index < entity.args.length; index += 1) {
    if (hasPlacement && index === 5) continue;
    if (hasGeometry && index === representationIndex) continue;
    if (typeObject && index === 5) continue;
    const raw = entity.args[index] ?? "";
    if (raw === "$" || raw === "*" || raw === "") continue;
    const label = attributeLabel(entity.type, index);
    if (raw.includes("#") && readReferences(raw).length) {
      const target = doc.entityById.get(readReferences(raw)[0]!);
      attributes[label] =
        `${target?.type ?? "Referenz"} ·${canonicalArgHash(raw, ctx).slice(0, 8)}`;
      continue;
    }
    const value = prettyIfcValue(raw);
    if (value) attributes[label] = value;
  }

  // -- Lage
  let placement: ObjectPlacementDetail | undefined;
  let placementKind: string | undefined;
  let placementHash = "";
  if (hasPlacement && placementEntity) {
    const frame =
      placementEntity.type === "IFCLOCALPLACEMENT"
        ? getNativePlacementWorldFrame(doc, entity.id)
        : undefined;
    if (frame) {
      placement = {
        x: round(frame.origin.x, 6),
        y: round(frame.origin.y, 6),
        z: round(frame.origin.z, 6),
        rotation: round(
          (Math.atan2(frame.xAxis.y, frame.xAxis.x) * 180) / Math.PI,
          4,
        ),
        tilt: round(
          (Math.acos(Math.max(-1, Math.min(1, frame.zAxis.z))) * 180) / Math.PI,
          4,
        ),
      };
      placementHash = facetHash(placement);
    } else {
      placementKind = placementEntity.type;
      placementHash = canonicalArgHash(entity.args[5] ?? "", ctx).slice(0, 16);
    }
  }

  // -- Geometrie
  let geometryInfo: ObjectGeometryDetail | undefined;
  let geometryHash = "";
  if (hasGeometry) {
    geometryHash = canonicalArgHash(representationArg, ctx).slice(0, 16);
    geometryInfo = geometryDetail(
      doc,
      geometry,
      representationArg,
      geometryHash.slice(0, 8),
    );
  }

  // -- Eigenschaften
  const psets: Record<string, Record<string, string>> = {};
  for (const set of propertySetsOf(doc, entity)) {
    const values = (psets[set.name] ??= {});
    for (const value of set.values) {
      values[value.name] = prettyIfcValue(value.value);
    }
  }

  // -- Beziehungen
  const relationFields: Record<string, string> = {};
  const container = containerLabel(doc, relations, entity.id);
  const ownContainer = relations.container.get(entity.id);
  if (ownContainer) {
    relationFields["Räumliche Zuordnung"] = entityLabel(
      doc.entityById.get(ownContainer),
    );
  }
  const parentId = relations.parent.get(entity.id);
  if (parentId) {
    relationFields["Teil von"] = entityLabel(doc.entityById.get(parentId));
  }
  const voided = relations.voids.get(entity.id);
  if (voided) {
    relationFields["Öffnung in"] = entityLabel(doc.entityById.get(voided));
  }
  const openings = relations.openings.get(entity.id);
  if (openings) {
    relationFields["Öffnungen"] = String(openings);
  }
  const types = doc.typeAssignmentsByEntity.get(entity.id);
  if (types?.length) {
    relationFields["Typ"] = types
      .map((assignment) => assignment.typeName.replace(/^#\d+$/, assignment.typeClass))
      .sort()
      .join("; ");
  }
  const joined = (values: string[] | undefined) =>
    values?.length ? [...new Set(values)].sort().join("; ") : "";
  const material = joined(relations.materials.get(entity.id));
  if (material) relationFields["Material"] = material;
  const classification = joined(relations.classifications.get(entity.id));
  if (classification) relationFields["Klassifikation"] = classification;
  const groups = joined(relations.groups.get(entity.id));
  if (groups) relationFields["Gruppe/System"] = groups;

  const facets: Record<ChangeFacet, string> = {
    attributes: facetHash(attributes),
    placement: placementHash,
    geometry: geometryHash,
    properties: facetHash(psets),
    relations: facetHash(relationFields),
  };

  const detail: ObjectDetail = {
    attributes,
    relations: relationFields,
    psets,
  };
  if (placement) detail.placement = placement;
  if (placementKind) detail.placementKind = placementKind;
  if (geometryInfo) detail.geometry = geometryInfo;

  return {
    globalId,
    type: entity.type,
    name: entity.name,
    container,
    hash: sha256Hex(stableJson(facets)),
    facets,
    detail,
  };
}

/**
 * Baut die Objekt-Records eines geparsten Dokuments. `ctx` kann mit
 * `buildVersionManifest` geteilt werden — die Struktur-Hashes der Geometrie
 * sind dann schon berechnet.
 */
export function buildObjectRecords(
  doc: NativeIfcDocument,
  ctx: HashContext = createHashContext(doc),
): ObjectRecord[] {
  const relations = buildRelationIndex(doc);
  const geometry = new GeometryReader(doc);
  const records = new Map<string, ObjectRecord>();
  for (const entity of doc.entities) {
    const globalId = ifcGlobalId(entity);
    if (!globalId || isFoldedType(entity.type)) {
      continue;
    }
    // Doppelte GlobalIds (ungültiges IFC): der letzte gewinnt — wie im Manifest.
    records.set(
      globalId,
      buildRecord(doc, entity, globalId, ctx, relations, geometry),
    );
  }
  return [...records.values()];
}

// ---- Diff zweier Stände (nur Index-Zeilen) ------------------------------------

export type ObjectChangeStatus = "added" | "removed" | "modified";

export interface ObjectChangeEntry {
  globalId: string;
  type: string;
  name: string;
  container: string;
  status: ObjectChangeStatus;
  /** Bei "modified": welche Facetten sich geändert haben. */
  facets: ChangeFacet[];
  beforeHash?: string;
  afterHash?: string;
}

export interface ObjectDiffSummary {
  added: ObjectChangeEntry[];
  removed: ObjectChangeEntry[];
  modified: ObjectChangeEntry[];
  unchanged: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareChanges(a: ObjectChangeEntry, b: ObjectChangeEntry): number {
  return (
    compareText(a.type, b.type) ||
    compareText(a.name, b.name) ||
    compareText(a.globalId, b.globalId)
  );
}

export function diffObjectIndexes(
  before: ObjectIndexEntry[],
  after: ObjectIndexEntry[],
): ObjectDiffSummary {
  const beforeById = new Map(before.map((entry) => [entry.globalId, entry]));
  const afterIds = new Set<string>();
  const added: ObjectChangeEntry[] = [];
  const removed: ObjectChangeEntry[] = [];
  const modified: ObjectChangeEntry[] = [];
  let unchanged = 0;

  for (const entry of after) {
    afterIds.add(entry.globalId);
    const previous = beforeById.get(entry.globalId);
    if (!previous) {
      added.push({
        globalId: entry.globalId,
        type: entry.type,
        name: entry.name,
        container: entry.container,
        status: "added",
        facets: [],
        afterHash: entry.hash,
      });
    } else if (previous.hash !== entry.hash) {
      modified.push({
        globalId: entry.globalId,
        type: entry.type,
        name: entry.name,
        container: entry.container,
        status: "modified",
        facets: CHANGE_FACETS.filter(
          (facet) => previous.facets[facet] !== entry.facets[facet],
        ),
        beforeHash: previous.hash,
        afterHash: entry.hash,
      });
    } else {
      unchanged += 1;
    }
  }
  for (const entry of before) {
    if (!afterIds.has(entry.globalId)) {
      removed.push({
        globalId: entry.globalId,
        type: entry.type,
        name: entry.name,
        container: entry.container,
        status: "removed",
        facets: [],
        beforeHash: entry.hash,
      });
    }
  }

  added.sort(compareChanges);
  removed.sort(compareChanges);
  modified.sort(compareChanges);
  return { added, removed, modified, unchanged };
}

// ---- Feld-Diff zweier Details ----------------------------------------------------

export interface ObjectFieldChange {
  facet: ChangeFacet;
  /** "Attribute", "Lage", "Geometrie", "Beziehungen" oder der Pset-Name. */
  group: string;
  field: string;
  before: string | null;
  after: string | null;
  status: ObjectChangeStatus;
}

interface FlatField {
  facet: ChangeFacet;
  group: string;
  field: string;
  value: string;
}

function flattenDetail(detail: ObjectDetail): FlatField[] {
  const fields: FlatField[] = [];
  const put = (facet: ChangeFacet, group: string, field: string, value: string) => {
    if (value !== "") fields.push({ facet, group, field, value });
  };
  for (const [field, value] of Object.entries(detail.attributes)) {
    put("attributes", "Attribute", field, value);
  }
  if (detail.placement) {
    put("placement", "Lage", "X", formatNumber(detail.placement.x));
    put("placement", "Lage", "Y", formatNumber(detail.placement.y));
    put("placement", "Lage", "Z", formatNumber(detail.placement.z));
    put("placement", "Lage", "Drehung (°)", formatNumber(detail.placement.rotation));
    put("placement", "Lage", "Neigung (°)", formatNumber(detail.placement.tilt));
  }
  if (detail.placementKind) {
    put("placement", "Lage", "Platzierung", detail.placementKind);
  }
  if (detail.geometry) {
    const geometry = detail.geometry;
    put("geometry", "Geometrie", "Darstellung", geometry.representations.join(", "));
    put(
      "geometry",
      "Geometrie",
      "Bestandteile",
      Object.entries(geometry.items)
        .map(([type, count]) => `${count}× ${type}`)
        .join(", "),
    );
    put("geometry", "Geometrie", "Profil", geometry.profiles.join(", "));
    put("geometry", "Geometrie", "Extrusion", geometry.extrusions.join(", "));
    if (geometry.size) {
      put(
        "geometry",
        "Geometrie",
        "Ausdehnung (lokal)",
        geometry.size.map(formatNumber).join(" × "),
      );
    }
    if (geometry.points) {
      put("geometry", "Geometrie", "Stützpunkte", String(geometry.points));
    }
    put("geometry", "Geometrie", "Fingerabdruck", geometry.fingerprint);
  }
  for (const [field, value] of Object.entries(detail.relations)) {
    put("relations", "Beziehungen", field, value);
  }
  for (const [setName, values] of Object.entries(detail.psets)) {
    for (const [field, value] of Object.entries(values)) {
      put("properties", setName, field, value);
    }
  }
  return fields;
}

const FACET_ORDER = new Map(CHANGE_FACETS.map((facet, index) => [facet, index]));
// Eigenschaften vor Beziehungen zeigen — sie sind meist der Grund des Commits.
FACET_ORDER.set("properties", 3);
FACET_ORDER.set("relations", 4);

function fieldKey(field: { group: string; field: string }): string {
  return `${field.group} ${field.field}`;
}

/**
 * Vorher/Nachher-Werte eines Objekts. `before`/`after` = null für neue bzw.
 * entfernte Objekte (dann kommen alle Felder als added/removed zurück). Der
 * Geometrie-Fingerabdruck erscheint nur, wenn sonst kein Geometrie-Kennwert
 * die Änderung erklärt.
 */
export function diffObjectDetails(
  before: ObjectDetail | null,
  after: ObjectDetail | null,
): ObjectFieldChange[] {
  const beforeFields = new Map(
    (before ? flattenDetail(before) : []).map((field) => [fieldKey(field), field]),
  );
  const afterFields = new Map(
    (after ? flattenDetail(after) : []).map((field) => [fieldKey(field), field]),
  );
  const changes: ObjectFieldChange[] = [];
  for (const [key, field] of afterFields) {
    const previous = beforeFields.get(key);
    if (!previous) {
      changes.push({
        facet: field.facet,
        group: field.group,
        field: field.field,
        before: null,
        after: field.value,
        status: "added",
      });
    } else if (previous.value !== field.value) {
      changes.push({
        facet: field.facet,
        group: field.group,
        field: field.field,
        before: previous.value,
        after: field.value,
        status: "modified",
      });
    }
  }
  for (const [key, field] of beforeFields) {
    if (!afterFields.has(key)) {
      changes.push({
        facet: field.facet,
        group: field.group,
        field: field.field,
        before: field.value,
        after: null,
        status: "removed",
      });
    }
  }

  let result = changes;
  if (before && after) {
    const geometryChanges = changes.filter((change) => change.facet === "geometry");
    if (geometryChanges.length > 1) {
      result = changes.filter((change) => change.field !== "Fingerabdruck" || change.facet !== "geometry");
    }
    if (before.placement && after.placement) {
      const dx = after.placement.x - before.placement.x;
      const dy = after.placement.y - before.placement.y;
      const dz = after.placement.z - before.placement.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > 1e-6) {
        result.push({
          facet: "placement",
          group: "Lage",
          field: "Verschiebung",
          before: null,
          after: `${formatNumber(distance)} (Δx ${formatNumber(dx)}, Δy ${formatNumber(dy)}, Δz ${formatNumber(dz)})`,
          status: "modified",
        });
      }
    }
  } else {
    // Neu/Entfernt: der Fingerabdruck ist für Menschen ohne Aussage.
    result = changes.filter((change) => change.field !== "Fingerabdruck");
  }

  const fieldRank = (change: ObjectFieldChange) =>
    change.field === "Verschiebung" ? 0 : 1;
  return result.sort(
    (a, b) =>
      (FACET_ORDER.get(a.facet) ?? 9) - (FACET_ORDER.get(b.facet) ?? 9) ||
      compareText(a.group, b.group) ||
      fieldRank(a) - fieldRank(b) ||
      0,
  );
}
