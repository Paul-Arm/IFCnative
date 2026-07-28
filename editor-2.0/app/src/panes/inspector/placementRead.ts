/**
 * Lese-Schicht „Platzierung" für den Inspector (NUR LESEND).
 *
 * Die Platzierung eines Objekts liegt als Kette eigener STEP-Records vor:
 *   IfcProduct.ObjectPlacement → IfcLocalPlacement.RelativePlacement
 *   → IfcAxis2Placement3D.Location → IfcCartesianPoint.Coordinates
 * und über `IfcLocalPlacement.PlacementRelTo` weiter zur übergeordneten
 * Platzierung (Geschoss → Gebäude → Site). Die Extrusionsdaten hängen parallel
 * an `IfcProduct.Representation`.
 *
 * Der Quellzugriff (Overlay-Vorrang, positionale Mutationen, Quellzeile über
 * `EntityExtractor`) steckt in `placementSource.ts`; hier stehen die Kette,
 * die Extrusionen und der zusammengesetzte Lesestand. Alle Zahlen kommen als
 * `NumericSlot` mit ihrer Record-Adresse heraus, damit später Editierfelder
 * andocken können, ohne die Anzeige umzubauen.
 */
import type { ModelSession } from "../../core/session";
import {
  createReader,
  readCoordinates,
  readProfile,
  readRatios,
  SLOT,
  toExpressId,
  toIdList,
  toNumber,
  toText,
  type CoordinateSet,
  type EntityReader,
  type RawEntity,
} from "./placementSource";

export type {
  CoordinateSet,
  NumericSlot,
  ProfileInfo,
} from "./placementSource";
import type { NumericSlot, ProfileInfo } from "./placementSource";

export interface PlacementLink {
  /** 0 = Platzierung des Objekts selbst, 1 = deren Elternplatzierung, … */
  depth: number;
  expressId: number;
  ifcClass: string;
  relativeId: number | null;
  relativeClass: string | null;
  location: CoordinateSet | null;
  axis: number[] | null;
  refDirection: number[] | null;
}

export interface RepresentationInfo {
  expressId: number;
  identifier: string;
  representationType: string;
  itemCount: number;
}

export interface ExtrusionInfo {
  expressId: number;
  ifcClass: string;
  representation: RepresentationInfo;
  depth: NumericSlot | null;
  direction: number[] | null;
  position: CoordinateSet | null;
  profile: ProfileInfo | null;
}

export interface PlacementReading {
  expressId: number;
  /** Skalierung Modelleinheit → Meter (`store.lengthUnitScale`, Default 1) */
  lengthUnitScale: number;
  objectPlacementId: number | null;
  chain: PlacementLink[];
  /** Komponentenweise Summe der Location-Vektoren — OHNE Rotationen */
  chainSum: number[] | null;
  representations: RepresentationInfo[];
  extrusions: ExtrusionInfo[];
  /** Erklärung, wenn Kette oder Extrusion fehlen */
  note: string | null;
}

const EXTRUSION_CLASSES: ReadonlySet<string> = new Set([
  "IFCEXTRUDEDAREASOLID",
  "IFCEXTRUDEDAREASOLIDTAPERED",
]);

/** Schutz gegen fehlerhafte Modelle mit zyklischer Platzierungskette. */
const MAX_CHAIN = 32;

function readChain(read: EntityReader, placementId: number): PlacementLink[] {
  const chain: PlacementLink[] = [];
  const seen = new Set<number>();
  let current: number | null = placementId;
  while (current !== null && chain.length < MAX_CHAIN && !seen.has(current)) {
    seen.add(current);
    const entity: RawEntity | null = read(current);
    if (!entity) break;
    const base = { depth: chain.length, expressId: current, ifcClass: entity.ifcClass };
    if (entity.ifcClass !== "IFCLOCALPLACEMENT") {
      // IfcGridPlacement o. Ä.: andere Attributfolge — benennen statt raten.
      chain.push({
        ...base,
        relativeId: null,
        relativeClass: null,
        location: null,
        axis: null,
        refDirection: null,
      });
      break;
    }
    const relativeId = toExpressId(entity.attributes[SLOT.relativePlacement]);
    const relative = relativeId === null ? null : read(relativeId);
    const flat = relative?.ifcClass === "IFCAXIS2PLACEMENT2D";
    chain.push({
      ...base,
      relativeId,
      relativeClass: relative?.ifcClass ?? null,
      location: relative
        ? readCoordinates(read, toExpressId(relative.attributes[SLOT.location]))
        : null,
      axis: relative && !flat ? readRatios(read, relative.attributes[SLOT.axis]) : null,
      refDirection: relative
        ? readRatios(
            read,
            relative.attributes[flat ? SLOT.refDirection2d : SLOT.refDirection3d],
          )
        : null,
    });
    current = toExpressId(entity.attributes[SLOT.relTo]);
  }
  return chain;
}

function sumChain(chain: readonly PlacementLink[]): number[] | null {
  const total = [0, 0, 0];
  let seen = false;
  for (const link of chain) {
    if (!link.location) continue;
    seen = true;
    link.location.raw.forEach((value, i) => {
      if (i < total.length) total[i] += value;
    });
  }
  return seen ? total : null;
}

/** Location des IfcAxis2Placement3D, auf dem ein Solid sitzt. */
function readSolidPosition(read: EntityReader, value: unknown): CoordinateSet | null {
  const positionId = toExpressId(value);
  const position = positionId === null ? null : read(positionId);
  return position
    ? readCoordinates(read, toExpressId(position.attributes[SLOT.location]))
    : null;
}

function readExtrusion(
  read: EntityReader,
  item: RawEntity,
  representation: RepresentationInfo,
): ExtrusionInfo {
  const depth = toNumber(item.attributes[SLOT.extrusionDepth]);
  return {
    expressId: item.expressId,
    ifcClass: item.ifcClass,
    representation,
    depth:
      depth === null
        ? null
        : {
            label: "Tiefe",
            expressId: item.expressId,
            index: SLOT.extrusionDepth,
            component: null,
            value: depth,
          },
    direction: readRatios(read, item.attributes[SLOT.extrusionDirection]),
    position: readSolidPosition(read, item.attributes[SLOT.extrusionPosition]),
    profile: readProfile(read, toExpressId(item.attributes[SLOT.sweptArea])),
  };
}

function readShapes(
  read: EntityReader,
  representationId: number,
): { representations: RepresentationInfo[]; extrusions: ExtrusionInfo[] } {
  const root = read(representationId);
  const representations: RepresentationInfo[] = [];
  const extrusions: ExtrusionInfo[] = [];
  if (!root) return { representations, extrusions };
  const repIds =
    root.ifcClass === "IFCPRODUCTDEFINITIONSHAPE"
      ? toIdList(root.attributes[SLOT.representations])
      : [representationId];

  for (const repId of repIds) {
    const rep = read(repId);
    if (!rep || rep.ifcClass !== "IFCSHAPEREPRESENTATION") continue;
    const items = toIdList(rep.attributes[SLOT.repItems]);
    const info: RepresentationInfo = {
      expressId: repId,
      identifier: toText(rep.attributes[SLOT.repIdentifier]),
      representationType: toText(rep.attributes[SLOT.repType]),
      itemCount: items.length,
    };
    representations.push(info);
    for (const itemId of items) {
      const item = read(itemId);
      if (item && EXTRUSION_CLASSES.has(item.ifcClass)) {
        extrusions.push(readExtrusion(read, item, info));
      }
    }
  }
  return { representations, extrusions };
}

/** Platzierungskette und Extrusionsdaten eines Objekts lesen. */
export function readPlacement(
  session: ModelSession,
  expressId: number,
): PlacementReading {
  const base: PlacementReading = {
    expressId,
    lengthUnitScale: session.store.lengthUnitScale ?? 1,
    objectPlacementId: null,
    chain: [],
    chainSum: null,
    representations: [],
    extrusions: [],
    note: null,
  };
  const read = createReader(session.store, session.view);
  const product = read(expressId);
  if (!product) return { ...base, note: "Quellzeile des Objekts ist nicht auflösbar." };

  const objectPlacementId = toExpressId(product.attributes[SLOT.objectPlacement]);
  const chain = objectPlacementId === null ? [] : readChain(read, objectPlacementId);
  const representationId = toExpressId(product.attributes[SLOT.representation]);
  const shapes =
    representationId === null
      ? { representations: [], extrusions: [] }
      : readShapes(read, representationId);

  const notes: string[] = [];
  if (objectPlacementId === null) notes.push("Kein ObjectPlacement hinterlegt.");
  if (representationId === null) notes.push("Keine Repräsentation hinterlegt.");
  else if (shapes.extrusions.length === 0)
    notes.push("Keine Extrusion in der Repräsentation.");

  return {
    ...base,
    objectPlacementId,
    chain,
    chainSum: sumChain(chain),
    representations: shapes.representations,
    extrusions: shapes.extrusions,
    note: notes.length > 0 ? notes.join(" ") : null,
  };
}

/** Modelleinheit → Meter. */
export function toMeters(value: number, lengthUnitScale: number): number {
  return value * lengthUnitScale;
}
