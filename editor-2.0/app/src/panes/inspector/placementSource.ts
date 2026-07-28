/**
 * Quellzugriff für die Platzierungs-Anzeige (NUR LESEND).
 *
 * Platzierung und Extrusion stehen nicht in den Parser-Tabellen, sondern in
 * eigenen STEP-Records. Aufgelöst wird wie in `core/model/relationMembers.ts`:
 * Overlay-Entity (`view.getNewEntity`) zuerst, sonst die Quellzeile über
 * `entityIndex.byId` + `EntityExtractor`, überlagert von den positionalen
 * Mutationen des Overlays. Sitzungsänderungen sind so sofort sichtbar.
 *
 * Jeder Zahlenwert kommt als `NumericSlot` heraus — Trägerentität, positionaler
 * Attributindex und (in Koordinatenlisten) Komponentenindex. Das ist genau die
 * Adresse, die ein späteres Editierfeld für eine positionale Mutation braucht.
 */
import { EntityExtractor, type IfcDataStore } from "@ifc-lite/parser";
import type { IfcAttributeValue, MutablePropertyView } from "@ifc-lite/mutations";

/** Adresse eines editierbaren Zahlenwerts im STEP-Record. */
export interface NumericSlot {
  label: string;
  /** Trägerentität der Zahl */
  expressId: number;
  /** Positionaler Attributindex im Record */
  index: number;
  /** Komponente in einer Koordinatenliste (null = Attribut selbst) */
  component: number | null;
  /** Wert in Modelleinheiten */
  value: number;
}

export interface CoordinateSet {
  expressId: number;
  ifcClass: string;
  /** Rohwerte in Modelleinheiten */
  raw: number[];
  slots: NumericSlot[];
}

export interface ProfileInfo {
  expressId: number;
  ifcClass: string;
  /** Enum ohne Punkte, z. B. „AREA" */
  profileType: string;
  name: string;
  dimensions: NumericSlot[];
  /** true = Maßtabelle kennt diese Profilklasse nicht */
  unknownDimensions: boolean;
}

export interface RawEntity {
  expressId: number;
  ifcClass: string;
  attributes: IfcAttributeValue[];
}

export type EntityReader = (expressId: number) => RawEntity | null;

/** Positionale Attributindizes der beteiligten STEP-Klassen. */
export const SLOT = {
  objectPlacement: 5, // IfcProduct
  representation: 6, // IfcProduct
  relTo: 0, // IfcLocalPlacement
  relativePlacement: 1, // IfcLocalPlacement
  location: 0, // IfcAxis2Placement2D/3D
  axis: 1, // IfcAxis2Placement3D
  refDirection3d: 2,
  refDirection2d: 1,
  coordinates: 0, // IfcCartesianPoint / IfcDirection
  representations: 2, // IfcProductDefinitionShape
  repIdentifier: 1, // IfcShapeRepresentation
  repType: 2,
  repItems: 3,
  sweptArea: 0, // IfcExtrudedAreaSolid
  extrusionPosition: 1,
  extrusionDirection: 2,
  extrusionDepth: 3,
} as const;

/**
 * Maßattribute je Profilklasse. Bei allen aufgeführten Klassen folgen die Maße
 * lückenlos ab Index 3 (nach ProfileType, ProfileName, Position) — deshalb
 * genügt die Reihenfolge der Beschriftungen.
 */
const PROFILE_START = 3;
const PROFILE_DIMENSIONS: Readonly<Record<string, string>> = {
  IFCRECTANGLEPROFILEDEF: "XDim,YDim",
  IFCRECTANGLEHOLLOWPROFILEDEF: "XDim,YDim,WallThickness",
  IFCROUNDEDRECTANGLEPROFILEDEF: "XDim,YDim,RoundingRadius",
  IFCCIRCLEPROFILEDEF: "Radius",
  IFCCIRCLEHOLLOWPROFILEDEF: "Radius,WallThickness",
  IFCELLIPSEPROFILEDEF: "SemiAxis1,SemiAxis2",
  IFCISHAPEPROFILEDEF: "OverallWidth,OverallDepth,WebThickness,FlangeThickness",
  IFCLSHAPEPROFILEDEF: "Depth,Width,Thickness",
  IFCUSHAPEPROFILEDEF: "Depth,FlangeWidth,WebThickness,FlangeThickness",
  IFCTSHAPEPROFILEDEF: "Depth,FlangeWidth,WebThickness,FlangeThickness",
  IFCZSHAPEPROFILEDEF: "Depth,FlangeWidth,WebThickness,FlangeThickness",
  IFCCSHAPEPROFILEDEF: "Depth,Width,WallThickness,Girth",
  IFCTRAPEZIUMPROFILEDEF: "BottomXDim,TopXDim,YDim,TopXOffset",
};

const AXIS_LABELS = ["X", "Y", "Z"] as const;

/** `#42` oder 42 → 42; alles andere → null. */
export function toExpressId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^#\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim().slice(1), 10);
  }
  return null;
}

/** Zahl, `{ real }` oder typisierter Wert `["IFCLENGTHMEASURE", 3]` → Zahl. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string") {
    return toNumber(value[1]);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const real = (value as { real?: unknown }).real;
    if (typeof real === "number" && Number.isFinite(real)) return real;
  }
  return null;
}

function toNumberList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const item of value) {
    const n = toNumber(item);
    if (n === null) return null;
    out.push(n);
  }
  return out.length > 0 ? out : null;
}

export function toIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const id = toExpressId(item);
    return id === null ? [] : [id];
  });
}

export const toText = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** `.AREA.` → `AREA` */
export function toEnumText(value: unknown): string {
  const text = toText(value);
  return text.length > 2 && text.startsWith(".") && text.endsWith(".")
    ? text.slice(1, -1)
    : text;
}

/** Leser mit Overlay-Vorrang; ein `EntityExtractor` je Lesevorgang. */
export function createReader(
  store: IfcDataStore,
  view: MutablePropertyView,
): EntityReader {
  const extractor = new EntityExtractor(store.source);
  return (expressId) => {
    const overlay = view.getNewEntity(expressId);
    if (overlay) {
      return {
        expressId,
        ifcClass: overlay.type.toUpperCase(),
        attributes: [...overlay.attributes],
      };
    }
    const ref = store.entityIndex.byId.get(expressId);
    const entity = ref ? extractor.extractEntity(ref) : null;
    if (!ref || !entity) return null;
    const attributes = [...entity.attributes] as IfcAttributeValue[];
    const patches = view.getPositionalMutationsForEntity(expressId);
    if (patches) for (const [index, value] of patches) attributes[index] = value;
    return { expressId, ifcClass: ref.type.toUpperCase(), attributes };
  };
}

/** IfcCartesianPoint → Koordinaten samt Editier-Slots. */
export function readCoordinates(
  read: EntityReader,
  id: number | null,
): CoordinateSet | null {
  const point = id === null ? null : read(id);
  const raw = point ? toNumberList(point.attributes[SLOT.coordinates]) : null;
  if (id === null || !point || !raw) return null;
  return {
    expressId: id,
    ifcClass: point.ifcClass,
    raw,
    slots: raw.map((value, component) => ({
      label: AXIS_LABELS[component] ?? `K${component + 1}`,
      expressId: id,
      index: SLOT.coordinates,
      component,
      value,
    })),
  };
}

/** Referenz auf IfcDirection → DirectionRatios. */
export function readRatios(read: EntityReader, value: unknown): number[] | null {
  const id = toExpressId(value);
  const direction = id === null ? null : read(id);
  return direction ? toNumberList(direction.attributes[SLOT.coordinates]) : null;
}

/** IfcProfileDef → Typ, Name und die bekannten Maße als Slots. */
export function readProfile(read: EntityReader, id: number | null): ProfileInfo | null {
  const profile = id === null ? null : read(id);
  if (id === null || !profile) return null;
  const labels = PROFILE_DIMENSIONS[profile.ifcClass];
  return {
    expressId: id,
    ifcClass: profile.ifcClass,
    profileType: toEnumText(profile.attributes[0]),
    name: toText(profile.attributes[1]),
    dimensions: (labels ? labels.split(",") : []).flatMap((label, offset) => {
      const index = PROFILE_START + offset;
      const value = toNumber(profile.attributes[index]);
      return value === null
        ? []
        : [{ label, expressId: id, index, component: null, value }];
    }),
    unknownDimensions: labels === undefined,
  };
}
