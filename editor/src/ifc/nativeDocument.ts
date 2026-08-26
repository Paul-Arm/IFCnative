import { createPositionMarkerProfile, polygonArea } from "./bodyProfiles";
import { createMinimalIfcProject } from "./builder";
import {
    decodeStepString,
    decodeStepValue,
    encodeStepString,
    quoteStepString,
    unquoteStepString,
} from "./stepEncoding";

export { decodeStepString, decodeStepValue, encodeStepString };

export interface NativeIfcEntity {
  id: number;
  type: string;
  args: string[];
  globalId: string;
  name: string;
  description: string;
}

export interface NativeIfcRelationship {
  id: number;
  type: string;
  family: string;
  sourceIds: number[];
  targetIds: number[];
}

export interface NativeIfcTreeNode {
  id: number;
  relation: string;
  children: NativeIfcTreeNode[];
}

export interface NativeIfcPropertySet {
  id: number;
  kind: string;
  name: string;
  values: { id: number; name: string; value: string; type: string }[];
}

export interface NativeIfcTypeAssignment {
  relationshipId: number;
  typeId: number;
  typeClass: string;
  typeName: string;
  objectIds: number[];
}

export type NativeBodyProfile =
  | "rectangle"
  | "cylinder"
  | "ellipse"
  | "triangle"
  | "marker";

export interface NativeBodyElementOptions {
  type: string;
  name: string;
  parentId?: number;
  /**
   * "world": x/y/z sind ABSOLUTE IFC-Weltkoordinaten; sie werden in die
   * Platzierungskette des Bezugselements (placementRelativeToId bzw. Parent)
   * projiziert und als kleine lokale Koordinaten gespeichert.
   * "parent" (Standard): x/y/z sind lokale Offsets relativ zum Bezug.
   */
  placementMode?: "parent" | "world";
  width: number | string;
  depth: number | string;
  height: number | string;
  profile?: NativeBodyProfile | string;
  x?: number | string;
  y?: number | string;
  z?: number | string;
  /**
   * true = x/y/z liegen bereits in Modell-Einheiten und IFC-Achsen vor (z. B.
   * vom Builder anhand des gepickten Elements kalibriert) und werden NICHT mehr
   * von Metern in Modell-Einheiten umgerechnet. Abmessungen bleiben immer Meter.
   */
  positionInModelUnits?: boolean;
  /**
   * Optionale Entität, relativ zu deren IFCLOCALPLACEMENT der neue Körper
   * platziert wird (statt der Platzierung des Parents). So erbt der Körper
   * eine georeferenzierte Platzierungskette statt riesiger Absolutkoordinaten,
   * die float-Präzision verlieren. Im Weltmodus werden absolute x/y/z
   * automatisch in dieses Bezugssystem projiziert, sonst sind x/y/z kleine
   * lokale Koordinaten. Die räumliche Einordnung (parentId) bleibt unberührt.
   */
  placementRelativeToId?: number;
  tag?: string;
}

export interface NativePlacementSummary {
  productId: number;
  placementId: number;
  axisPlacementId: number;
  pointId: number;
  x: number;
  y: number;
  z: number;
  relativeTo?: number;
}

export interface NativeBodyRepresentationSummary {
  productId: number;
  shapeId?: number;
  representationIds: number[];
  bodyRepresentationId?: number;
  solidId?: number;
  profileId?: number;
  profileType?: string;
  profile?: NativeBodyProfile;
  width?: number;
  depth?: number;
  height?: number;
  radius?: number;
  hasRepresentation: boolean;
  canAssign: boolean;
  canEdit: boolean;
  message?: string;
}

export interface NativeIfcGeometrySummary {
  entityCount: number;
  geometryItemCount: number;
  productDefinitionShapeCount: number;
  representedProductCount: number;
  shapeRepresentationCount: number;
}

export interface NativeBodySplitResult {
  document: NativeIfcDocument;
  partIds: number[];
}

export interface NativeCutPlane {
  /** Punkt auf der Ebene in absoluten IFC-Weltkoordinaten (Modelleinheiten). */
  point: { x: number; y: number; z: number };
  /** Einheitenlose Ebenennormale in IFC-Weltachsen. */
  normal: { x: number; y: number; z: number };
}

export interface NativeBodyCombineOptions {
  name?: string;
  removeSources?: boolean;
}

export interface NativeBodyCombineResult {
  document: NativeIfcDocument;
  productId: number;
  sourceIds: number[];
}

interface NativeMaterialRow {
  category: string;
  materialName: string;
  name: string;
  value: string;
}

interface NativeMaterialPropertyRow {
  name: string;
  value: string;
  valueType: string;
}

export interface NativeIfcDocument {
  fileName: string;
  schema: string;
  headerText: string;
  entities: NativeIfcEntity[];
  entityById: Map<number, NativeIfcEntity>;
  entitiesByType: Map<string, NativeIfcEntity[]>;
  outgoingRefs: Map<number, number[]>;
  incomingRefs: Map<number, NativeIfcEntity[]>;
  relationships: NativeIfcRelationship[];
  relationshipsByEntity: Map<number, NativeIfcRelationship[]>;
  propertySetsByEntity: Map<number, NativeIfcPropertySet[]>;
  typeAssignmentsByEntity: Map<number, NativeIfcTypeAssignment[]>;
  resourcesByEntity: Map<number, string[]>;
  units: string[];
  spatialRoots: NativeIfcTreeNode[];
  diagnostics: string[];
}

const RELATIONSHIP_FAMILIES: Record<string, string> = {
  IFCRELAGGREGATES: "aggregates",
  IFCRELNESTS: "nests",
  IFCRELCONTAINEDINSPATIALSTRUCTURE: "contains",
  IFCRELREFERENCEDINSPATIALSTRUCTURE: "references",
  IFCRELDEFINESBYPROPERTIES: "defines properties",
  IFCRELDEFINESBYTYPE: "defines type",
  IFCRELASSOCIATESMATERIAL: "material",
  IFCRELASSOCIATESCLASSIFICATION: "classification",
  IFCRELASSOCIATESDOCUMENT: "document",
  IFCRELASSOCIATESLIBRARY: "library",
  IFCRELASSOCIATESCONSTRAINT: "constraint",
  IFCRELASSOCIATESAPPROVAL: "approval",
  IFCRELASSIGNSTOGROUP: "group",
};

const HIERARCHY_RELATIONSHIP_TYPES = new Set([
  "IFCRELAGGREGATES",
  "IFCRELNESTS",
  "IFCRELCONTAINEDINSPATIALSTRUCTURE",
]);

const QUANTITY_TYPES = new Set([
  "IFCQUANTITYLENGTH",
  "IFCQUANTITYAREA",
  "IFCQUANTITYVOLUME",
  "IFCQUANTITYCOUNT",
  "IFCQUANTITYWEIGHT",
  "IFCQUANTITYTIME",
]);

const SIMPLE_PROPERTY_ENTITY_TYPES = new Set([
  "IFCPROPERTYSINGLEVALUE",
  "IFCPROPERTYLISTVALUE",
  "IFCPROPERTYENUMERATEDVALUE",
  "IFCPROPERTYBOUNDEDVALUE",
  "IFCPROPERTYTABLEVALUE",
]);

export function createNativeSampleDocument() {
  return parseNativeIfcText(
    createMinimalIfcProject(),
    "IFCnative Builder Sample.ifc",
  );
}

export function parseNativeIfcText(
  text: string,
  fileName = "Untitled.ifc",
): NativeIfcDocument {
  const diagnostics: string[] = [];
  const headerText = readHeader(text);
  const schema = readSchema(headerText) ?? "UNKNOWN";
  const entities = readEntities(text, diagnostics);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const entitiesByType = new Map<string, NativeIfcEntity[]>();
  const outgoingRefs = new Map<number, number[]>();
  const incomingRefs = new Map<number, NativeIfcEntity[]>();

  for (const entity of entities) {
    pushMapValue(entitiesByType, entity.type, entity);
    const refs = readUniqueReferencesFromArgs(entity.args);
    outgoingRefs.set(entity.id, refs);
    for (const ref of refs) {
      pushMapValue(incomingRefs, ref, entity);
    }
  }

  const relationships = readRelationships(entities);
  const relationshipsByEntity = new Map<number, NativeIfcRelationship[]>();
  for (const relationship of relationships) {
    const indexedIds = new Set<number>();
    for (const id of relationship.sourceIds) {
      if (!indexedIds.has(id)) {
        indexedIds.add(id);
        pushMapValue(relationshipsByEntity, id, relationship);
      }
    }
    for (const id of relationship.targetIds) {
      if (!indexedIds.has(id)) {
        indexedIds.add(id);
        pushMapValue(relationshipsByEntity, id, relationship);
      }
    }
  }

  const propertySetsByEntity = readPropertySets(entities, entityById);
  const typeAssignmentsByEntity = readTypeAssignments(entities, entityById);
  const resourcesByEntity = readResources(entities, entityById);
  const units = readUnits(entities, entityById);
  const spatialRoots = buildSpatialRoots(entities, entityById, relationships);

  diagnostics.push(`Loaded ${entities.length.toLocaleString()} STEP entities.`);
  diagnostics.push(`Detected schema: ${schema}.`);
  diagnostics.push(
    `Indexed ${relationships.length.toLocaleString()} relationships.`,
  );
  diagnostics.push(
    ...validateNativeDocument(
      text,
      schema,
      entities,
      entityById,
      relationships,
      units,
    ),
  );

  return {
    diagnostics,
    entities,
    entitiesByType,
    entityById,
    fileName,
    headerText,
    incomingRefs,
    outgoingRefs,
    propertySetsByEntity,
    relationships,
    relationshipsByEntity,
    resourcesByEntity,
    schema,
    spatialRoots,
    typeAssignmentsByEntity,
    units,
  };
}

export function serializeNativeIfcDocument(document: NativeIfcDocument) {
  return [
    "ISO-10303-21;",
    document.headerText.trim(),
    "DATA;",
    ...document.entities
      .slice()
      .sort((left, right) => left.id - right.id)
      .map(
        (entity) => `#${entity.id}= ${entity.type}(${entity.args.join(",")});`,
      ),
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

/**
 * Lightweight export guard for the STEP representation graph. This does not
 * tessellate the IFC, but it catches the important "export contains no body
 * references" case without loading a second WASM engine in the UI.
 */
export function summarizeNativeIfcGeometry(
  document: NativeIfcDocument,
): NativeIfcGeometrySummary {
  const productDefinitionShapeIds = new Set(
    (document.entitiesByType.get("IFCPRODUCTDEFINITIONSHAPE") ?? []).map(
      (entity) => entity.id,
    ),
  );
  const shapeRepresentations =
    document.entitiesByType.get("IFCSHAPEREPRESENTATION") ?? [];
  const geometryItemIds = new Set<number>();
  for (const representation of shapeRepresentations) {
    for (const itemId of readReferences(representation.args[3] ?? "")) {
      geometryItemIds.add(itemId);
    }
  }
  const representedProductCount = document.entities.filter((entity) =>
    readReferences(entity.args[6] ?? "").some((id) =>
      productDefinitionShapeIds.has(id),
    ),
  ).length;

  return {
    entityCount: document.entities.length,
    geometryItemCount: geometryItemIds.size,
    productDefinitionShapeCount: productDefinitionShapeIds.size,
    representedProductCount,
    shapeRepresentationCount: shapeRepresentations.length,
  };
}

export function getNextNativeEntityId(document: NativeIfcDocument) {
  return nextEntityId(document.entities);
}

export function updateNativeEntity(
  document: NativeIfcDocument,
  entityId: number,
  updates: {
    type?: string;
    name?: string;
    description?: string;
    args?: string[];
  },
) {
  const next = cloneDocumentEntities(document);
  const entity = next.find((item) => item.id === entityId);
  if (!entity) {
    return document;
  }

  if (updates.type) {
    entity.type = normalizeType(updates.type);
  }
  if (updates.args) {
    entity.args = updates.args;
  }
  if (updates.name != null) {
    setArg(entity.args, 2, quoteOrDollar(updates.name));
  }
  if (updates.description != null) {
    setArg(entity.args, 3, quoteOrDollar(updates.description));
  }

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export function getNativePlacement(
  document: NativeIfcDocument,
  entityId: number,
): NativePlacementSummary | undefined {
  const product = document.entityById.get(entityId);
  const placementId = readReferences(product?.args[5] ?? "")[0];
  const placement = placementId
    ? document.entityById.get(placementId)
    : undefined;
  if (!product || placement?.type !== "IFCLOCALPLACEMENT") {
    return undefined;
  }

  const axisPlacementId = readReferences(placement.args[1] ?? "")[0];
  const axisPlacement = axisPlacementId
    ? document.entityById.get(axisPlacementId)
    : undefined;
  if (axisPlacement?.type !== "IFCAXIS2PLACEMENT3D") {
    return undefined;
  }

  const pointId = readReferences(axisPlacement.args[0] ?? "")[0];
  const point = pointId ? document.entityById.get(pointId) : undefined;
  if (point?.type !== "IFCCARTESIANPOINT") {
    return undefined;
  }

  const [x, y, z] = parseCoordinateTuple(point.args[0]);
  return {
    axisPlacementId,
    placementId,
    pointId,
    productId: entityId,
    relativeTo: readReferences(placement.args[0] ?? "")[0],
    x,
    y,
    z,
  };
}

interface NativeVector3 {
  x: number;
  y: number;
  z: number;
}

interface NativePlacementFrame {
  origin: NativeVector3;
  xAxis: NativeVector3;
  yAxis: NativeVector3;
  zAxis: NativeVector3;
}

const IDENTITY_PLACEMENT_FRAME: NativePlacementFrame = {
  origin: { x: 0, y: 0, z: 0 },
  xAxis: { x: 1, y: 0, z: 0 },
  yAxis: { x: 0, y: 1, z: 0 },
  zAxis: { x: 0, y: 0, z: 1 },
};

function crossVectors(a: NativeVector3, b: NativeVector3): NativeVector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dotVectors(a: NativeVector3, b: NativeVector3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function readDirectionVector(
  document: NativeIfcDocument,
  reference: string | undefined,
  fallback: NativeVector3,
): NativeVector3 {
  const directionId = readReferences(reference ?? "")[0];
  const direction = directionId
    ? document.entityById.get(directionId)
    : undefined;
  if (direction?.type !== "IFCDIRECTION") {
    return fallback;
  }
  const [x, y, z] = parseCoordinateTuple(direction.args[0]);
  return normalizeDirection({ x, y, z }, fallback);
}

function readAxis2Placement3dFrame(
  document: NativeIfcDocument,
  axisPlacementId: number | undefined,
): NativePlacementFrame | undefined {
  const axisPlacement = axisPlacementId
    ? document.entityById.get(axisPlacementId)
    : undefined;
  if (axisPlacement?.type !== "IFCAXIS2PLACEMENT3D") {
    return undefined;
  }
  const pointId = readReferences(axisPlacement.args[0] ?? "")[0];
  const point = pointId ? document.entityById.get(pointId) : undefined;
  const [x, y, z] =
    point?.type === "IFCCARTESIANPOINT"
      ? parseCoordinateTuple(point.args[0])
      : [0, 0, 0];
  const zAxis = readDirectionVector(document, axisPlacement.args[1], {
    x: 0,
    y: 0,
    z: 1,
  });
  const refDirection = readDirectionVector(document, axisPlacement.args[2], {
    x: 1,
    y: 0,
    z: 0,
  });
  const projection = dotVectors(refDirection, zAxis);
  const orthogonalHelper =
    Math.abs(zAxis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const xAxis = normalizeDirection(
    {
      x: refDirection.x - projection * zAxis.x,
      y: refDirection.y - projection * zAxis.y,
      z: refDirection.z - projection * zAxis.z,
    },
    normalizeDirection(crossVectors(orthogonalHelper, zAxis), {
      x: 1,
      y: 0,
      z: 0,
    }),
  );
  const yAxis = crossVectors(zAxis, xAxis);
  return { origin: { x, y, z }, xAxis, yAxis, zAxis };
}

function transformFramePoint(
  frame: NativePlacementFrame,
  point: NativeVector3,
): NativeVector3 {
  return {
    x:
      frame.origin.x +
      frame.xAxis.x * point.x +
      frame.yAxis.x * point.y +
      frame.zAxis.x * point.z,
    y:
      frame.origin.y +
      frame.xAxis.y * point.x +
      frame.yAxis.y * point.y +
      frame.zAxis.y * point.z,
    z:
      frame.origin.z +
      frame.xAxis.z * point.x +
      frame.yAxis.z * point.y +
      frame.zAxis.z * point.z,
  };
}

function rotateFrameDirection(
  frame: NativePlacementFrame,
  direction: NativeVector3,
): NativeVector3 {
  return {
    x:
      frame.xAxis.x * direction.x +
      frame.yAxis.x * direction.y +
      frame.zAxis.x * direction.z,
    y:
      frame.xAxis.y * direction.x +
      frame.yAxis.y * direction.y +
      frame.zAxis.y * direction.z,
    z:
      frame.xAxis.z * direction.x +
      frame.yAxis.z * direction.y +
      frame.zAxis.z * direction.z,
  };
}

function composeFrames(
  parent: NativePlacementFrame,
  child: NativePlacementFrame,
): NativePlacementFrame {
  return {
    origin: transformFramePoint(parent, child.origin),
    xAxis: rotateFrameDirection(parent, child.xAxis),
    yAxis: rotateFrameDirection(parent, child.yAxis),
    zAxis: rotateFrameDirection(parent, child.zAxis),
  };
}

function getLocalPlacementWorldFrame(
  document: NativeIfcDocument,
  placementId: number | undefined,
): NativePlacementFrame {
  const chain: number[] = [];
  const visited = new Set<number>();
  let currentId = placementId;
  while (currentId && !visited.has(currentId) && chain.length < 64) {
    visited.add(currentId);
    const placement = document.entityById.get(currentId);
    if (placement?.type !== "IFCLOCALPLACEMENT") {
      break;
    }
    chain.unshift(currentId);
    currentId = readReferences(placement.args[0] ?? "")[0];
  }
  let frame = IDENTITY_PLACEMENT_FRAME;
  for (const id of chain) {
    const placement = document.entityById.get(id);
    const axisPlacementId = readReferences(placement?.args[1] ?? "")[0];
    const local = readAxis2Placement3dFrame(document, axisPlacementId);
    if (local) {
      frame = composeFrames(frame, local);
    }
  }
  return frame;
}

/**
 * Projiziert einen ABSOLUTEN IFC-Weltpunkt in das Koordinatensystem einer
 * IFCLOCALPLACEMENT-Kette (inklusive deren eigener Platzierung). Ergebnis =
 * lokale Koordinaten für einen Körper, dessen Placement RelativeTo auf diese
 * Kette zeigt: klein bei georeferenzierten Modellen, Weltposition bleibt exakt.
 */
function worldPointInPlacementFrame(
  document: NativeIfcDocument,
  placementId: number | undefined,
  world: NativeVector3,
): NativeVector3 {
  const frame = getLocalPlacementWorldFrame(document, placementId);
  const delta = {
    x: world.x - frame.origin.x,
    y: world.y - frame.origin.y,
    z: world.z - frame.origin.z,
  };
  return {
    x: dotVectors(delta, frame.xAxis),
    y: dotVectors(delta, frame.yAxis),
    z: dotVectors(delta, frame.zAxis),
  };
}

export interface NativeWorldPlacementSummary extends NativePlacementSummary {
  worldX: number;
  worldY: number;
  worldZ: number;
}

export function getNativePlacementWorld(
  document: NativeIfcDocument,
  entityId: number,
): NativeWorldPlacementSummary | undefined {
  const placement = getNativePlacement(document, entityId);
  if (!placement) {
    return undefined;
  }
  const parentFrame = getLocalPlacementWorldFrame(
    document,
    placement.relativeTo,
  );
  const world = transformFramePoint(parentFrame, {
    x: placement.x,
    y: placement.y,
    z: placement.z,
  });
  return {
    ...placement,
    worldX: world.x,
    worldY: world.y,
    worldZ: world.z,
  };
}

export interface NativeWorldPlacementFrame {
  origin: { x: number; y: number; z: number };
  xAxis: { x: number; y: number; z: number };
  yAxis: { x: number; y: number; z: number };
  zAxis: { x: number; y: number; z: number };
}

/**
 * Welt-Frame (Ursprung + Achsen) der EIGENEN Platzierung einer Entität —
 * inklusive aller geerbten Rotationen der Platzierungskette (relevant bei
 * georeferenzierten Modellen mit rotierter Site). IFC-Achsen (Z-up),
 * Ursprung in Modelleinheiten.
 */
export function getNativePlacementWorldFrame(
  document: NativeIfcDocument,
  entityId: number,
): NativeWorldPlacementFrame | undefined {
  const placement = getNativePlacement(document, entityId);
  if (!placement) {
    return undefined;
  }
  return getLocalPlacementWorldFrame(document, placement.placementId);
}

export function nativeWorldToLocalPlacementPoint(
  document: NativeIfcDocument,
  entityId: number,
  world: { x: number; y: number; z: number },
): { x: number; y: number; z: number } | undefined {
  const placement = getNativePlacement(document, entityId);
  if (!placement) {
    return undefined;
  }
  const frame = getLocalPlacementWorldFrame(document, placement.relativeTo);
  const delta = {
    x: world.x - frame.origin.x,
    y: world.y - frame.origin.y,
    z: world.z - frame.origin.z,
  };
  return {
    x: dotVectors(delta, frame.xAxis),
    y: dotVectors(delta, frame.yAxis),
    z: dotVectors(delta, frame.zAxis),
  };
}

/**
 * Projiziert eine IFC-Weltrichtung in das Koordinatensystem des Parent-
 * Placements einer Entität. IFCAXIS2PLACEMENT3D speichert Axis und
 * RefDirection relativ zu genau diesem Parent-Frame, nicht in Weltachsen.
 */
export function nativeWorldDirectionInPlacementParentFrame(
  document: NativeIfcDocument,
  entityId: number,
  worldDirection: { x: number; y: number; z: number },
): { x: number; y: number; z: number } | undefined {
  const placement = getNativePlacement(document, entityId);
  if (!placement) {
    return undefined;
  }
  const frame = getLocalPlacementWorldFrame(document, placement.relativeTo);
  return {
    x: dotVectors(worldDirection, frame.xAxis),
    y: dotVectors(worldDirection, frame.yAxis),
    z: dotVectors(worldDirection, frame.zAxis),
  };
}

/**
 * Projiziert einen WELT-Versatz (IFC-Achsen, Modelleinheiten) in das EIGENE
 * Platzierungs-Koordinatensystem einer Entität. Ergebnis = lokale Koordinaten
 * für einen Körper, dessen IFCLOCALPLACEMENT relativ zur Platzierung dieser
 * Entität liegt (placementRelativeToId). Damit erbt der Körper die
 * georeferenzierte Kette und bleibt bei kleinen lokalen Koordinaten.
 */
export function nativeWorldDeltaInElementFrame(
  document: NativeIfcDocument,
  entityId: number,
  worldDelta: { x: number; y: number; z: number },
): { x: number; y: number; z: number } | undefined {
  const placement = getNativePlacement(document, entityId);
  if (!placement) {
    return undefined;
  }
  const frame = getLocalPlacementWorldFrame(document, placement.placementId);
  return {
    x: dotVectors(worldDelta, frame.xAxis),
    y: dotVectors(worldDelta, frame.yAxis),
    z: dotVectors(worldDelta, frame.zAxis),
  };
}

const SI_LENGTH_PREFIX_FACTORS: Record<string, number> = {
  KILO: 1e3,
  DECI: 1e-1,
  CENTI: 1e-2,
  MILLI: 1e-3,
};

function readEnumToken(arg?: string) {
  const match = (arg ?? "").trim().match(/^\.(.+)\.$/);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Meter pro Modell-Längeneinheit (Millimeter-Modell → 0.001, Meter → 1,
 * Fuß → 0.3048). Der Fragments-Viewer skaliert Modelle mit demselben Faktor
 * auf Meter; alle Schreibpfade, die Viewer-Koordinaten oder Meter-Eingaben in
 * IFC-Placements/Geometrie übertragen, müssen damit zurückrechnen.
 */
export function getNativeLengthUnitScale(document: NativeIfcDocument): number {
  const assignmentUnitIds = document.entities
    .filter((entity) => entity.type === "IFCUNITASSIGNMENT")
    .flatMap((entity) => readReferences(entity.args[0] ?? ""));
  const fallbackUnitIds = document.entities
    .filter(
      (entity) =>
        entity.type === "IFCSIUNIT" || entity.type === "IFCCONVERSIONBASEDUNIT",
    )
    .map((entity) => entity.id);
  const candidateIds = assignmentUnitIds.length
    ? assignmentUnitIds
    : fallbackUnitIds;
  for (const id of candidateIds) {
    const scale = lengthUnitScaleFromEntity(
      document,
      document.entityById.get(id),
      0,
    );
    if (scale !== undefined) {
      return scale;
    }
  }
  return 1;
}

function lengthUnitScaleFromEntity(
  document: NativeIfcDocument,
  entity: NativeIfcEntity | undefined,
  depth: number,
): number | undefined {
  if (!entity || depth > 4) {
    return undefined;
  }
  if (entity.type === "IFCSIUNIT") {
    // args: Dimensions(*), UnitType, Prefix, Name
    if (readEnumToken(entity.args[1]) !== "LENGTHUNIT") {
      return undefined;
    }
    if (readEnumToken(entity.args[3]) !== "METRE") {
      return undefined;
    }
    const prefix = readEnumToken(entity.args[2]);
    return prefix ? (SI_LENGTH_PREFIX_FACTORS[prefix] ?? 1) : 1;
  }
  if (entity.type === "IFCCONVERSIONBASEDUNIT") {
    // args: Dimensions, UnitType, Name, ConversionFactor(#IFCMEASUREWITHUNIT)
    if (readEnumToken(entity.args[1]) !== "LENGTHUNIT") {
      return undefined;
    }
    const measure = document.entityById.get(
      readReferences(entity.args[3] ?? "")[0],
    );
    if (measure?.type === "IFCMEASUREWITHUNIT") {
      const numeric = Number(
        (measure.args[0] ?? "").match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/)?.[0],
      );
      const innerScale =
        lengthUnitScaleFromEntity(
          document,
          document.entityById.get(readReferences(measure.args[1] ?? "")[0]),
          depth + 1,
        ) ?? 1;
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric * innerScale;
      }
    }
    const name = (unquote(entity.args[2] ?? "") ?? "").toUpperCase();
    if (name.includes("FOOT") || name.includes("FEET")) {
      return 0.3048;
    }
    if (name.includes("INCH")) {
      return 0.0254;
    }
    return undefined;
  }
  return undefined;
}

export function getNativeBodyRepresentation(
  document: NativeIfcDocument,
  entityId: number,
): NativeBodyRepresentationSummary {
  const product = document.entityById.get(entityId);
  const canAssign = product
    ? isRepresentationAssignableProduct(product)
    : false;
  const shapeId = readReferences(product?.args[6] ?? "")[0];
  const shape = shapeId ? document.entityById.get(shapeId) : undefined;

  if (!product) {
    return {
      canAssign: false,
      canEdit: false,
      hasRepresentation: false,
      productId: entityId,
      representationIds: [],
      message: "No product entity selected.",
    };
  }

  if (!shapeId) {
    return {
      canAssign,
      canEdit: false,
      hasRepresentation: false,
      productId: entityId,
      representationIds: [],
      message: "No product representation assigned.",
    };
  }

  if (shape?.type !== "IFCPRODUCTDEFINITIONSHAPE") {
    return {
      canAssign,
      canEdit: false,
      hasRepresentation: true,
      productId: entityId,
      shapeId,
      representationIds: [],
      message: `Representation points to #${shapeId} ${shape?.type ?? "UNKNOWN"}.`,
    };
  }

  const representationIds = unique(readReferences(shape.args[2] ?? ""));
  const representations = representationIds
    .map((id) => document.entityById.get(id))
    .filter(
      (entity): entity is NativeIfcEntity =>
        entity !== undefined && entity.type === "IFCSHAPEREPRESENTATION",
    );
  const bodyRepresentation =
    representations.find(
      (entity) => unquote(entity.args[1] ?? "")?.toLowerCase() === "body",
    ) ?? representations[0];

  if (!bodyRepresentation) {
    return {
      canAssign,
      canEdit: false,
      hasRepresentation: true,
      productId: entityId,
      representationIds,
      shapeId,
      message: "No shape representation found.",
    };
  }

  const solidId = readReferences(bodyRepresentation.args[3] ?? "")
    .map((id) => document.entityById.get(id))
    .find((entity) => entity?.type === "IFCEXTRUDEDAREASOLID")?.id;
  const solid = solidId ? document.entityById.get(solidId) : undefined;
  if (!solid) {
    return {
      bodyRepresentationId: bodyRepresentation.id,
      canAssign,
      canEdit: false,
      hasRepresentation: true,
      productId: entityId,
      representationIds,
      shapeId,
      message: "Body representation has no editable swept solid.",
    };
  }

  const profileId = readReferences(solid.args[0] ?? "")[0];
  const profile = profileId ? document.entityById.get(profileId) : undefined;
  const height = readStepNumber(solid.args[3]);
  if (profile?.type === "IFCRECTANGLEPROFILEDEF") {
    const width = readStepNumber(profile.args[3]);
    const depth = readStepNumber(profile.args[4]);
    return {
      bodyRepresentationId: bodyRepresentation.id,
      canAssign,
      canEdit:
        width !== undefined && depth !== undefined && height !== undefined,
      depth,
      hasRepresentation: true,
      height,
      productId: entityId,
      profile: "rectangle",
      profileId,
      profileType: profile.type,
      representationIds,
      shapeId,
      solidId,
      width,
    };
  }

  if (profile?.type === "IFCCIRCLEPROFILEDEF") {
    const radius = readStepNumber(profile.args[3]);
    const diameter =
      radius === undefined
        ? undefined
        : Math.round(radius * 2 * 1_000_000) / 1_000_000;
    return {
      bodyRepresentationId: bodyRepresentation.id,
      canAssign,
      canEdit: radius !== undefined && height !== undefined,
      depth: diameter,
      hasRepresentation: true,
      height,
      productId: entityId,
      profile: "cylinder",
      profileId,
      profileType: profile.type,
      radius,
      representationIds,
      shapeId,
      solidId,
      width: diameter,
    };
  }

  return {
    bodyRepresentationId: bodyRepresentation.id,
    canAssign,
    canEdit: false,
    hasRepresentation: true,
    height,
    productId: entityId,
    profileId,
    profileType: profile?.type,
    representationIds,
    shapeId,
    solidId,
    message: profile
      ? `Profile #${profile.id} ${profile.type} is not editable here.`
      : "Swept solid has no profile.",
  };
}

export function resolveNativeMovableProductId(
  document: NativeIfcDocument,
  entityId: number,
  globalId?: string,
) {
  const globalEntity = globalId
    ? document.entities.find((entity) => entity.globalId === globalId)
    : undefined;
  if (globalEntity && getNativePlacement(document, globalEntity.id)) {
    return globalEntity.id;
  }
  if (getNativePlacement(document, entityId)) {
    return entityId;
  }

  const queue = [{ depth: 0, id: entityId }];
  const visited = new Set<number>([entityId]);
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth >= 6) {
      continue;
    }
    for (const incoming of document.incomingRefs.get(current.id) ?? []) {
      if (visited.has(incoming.id)) {
        continue;
      }
      if (getNativePlacement(document, incoming.id)) {
        return incoming.id;
      }
      visited.add(incoming.id);
      queue.push({ depth: current.depth + 1, id: incoming.id });
    }
  }
  return undefined;
}

export function updateNativePlacement(
  document: NativeIfcDocument,
  entityId: number,
  coordinates: {
    x?: number | string;
    y?: number | string;
    z?: number | string;
  },
) {
  const placement = getNativePlacement(document, entityId);
  if (!placement) {
    return document;
  }

  const point = document.entityById.get(placement.pointId);
  if (point?.type !== "IFCCARTESIANPOINT") {
    return document;
  }

  const x = numericStepNumber(coordinates.x, placement.x);
  const y = numericStepNumber(coordinates.y, placement.y);
  const z = numericStepNumber(coordinates.z, placement.z);
  const nextPoint: NativeIfcEntity = {
    ...point,
    args: [`(${x},${y},${z})`],
  };

  const pointIsShared = (document.incomingRefs.get(placement.pointId)?.length ?? 0) > 1;
  const axisIsShared =
    (document.incomingRefs.get(placement.axisPlacementId)?.length ?? 0) > 1;
  if (!pointIsShared && !axisIsShared) {
    // Placement-Bewegungen ändern keine Referenzen. Für den häufigsten
    // Gizmo-Pfad reicht daher ein strukturelles Update der zwei Entity-Indizes;
    // ein vollständiges STEP-Serialize+Parse des ganzen IFC entfällt.
    const entities = document.entities.map((entity) =>
      entity.id === nextPoint.id ? nextPoint : entity,
    );
    const entityById = new Map(document.entityById);
    entityById.set(nextPoint.id, nextPoint);
    const entitiesByType = new Map(document.entitiesByType);
    entitiesByType.set(
      nextPoint.type,
      (entitiesByType.get(nextPoint.type) ?? []).map((entity) =>
        entity.id === nextPoint.id ? nextPoint : entity,
      ),
    );
    return { ...document, entities, entityById, entitiesByType };
  }

  // Copy-on-write für ungewöhnliche IFCs, die Punkt oder Axis-Placement
  // zwischen mehreren Produkten teilen. Sonst würde das Gizmo alle Nutzer der
  // gemeinsamen Ressource gleichzeitig verschieben.
  const next = cloneDocumentEntities(document);
  const nextPlacement = next.find(
    (entity) =>
      entity.id === placement.placementId && entity.type === "IFCLOCALPLACEMENT",
  );
  const nextAxis = next.find(
    (entity) =>
      entity.id === placement.axisPlacementId &&
      entity.type === "IFCAXIS2PLACEMENT3D",
  );
  if (!nextPlacement || !nextAxis) {
    return document;
  }
  let nextId = nextEntityId(next);
  const copiedPoint = { ...nextPoint, id: nextId++ };
  next.push(copiedPoint);
  if (axisIsShared) {
    const copiedAxis = {
      ...nextAxis,
      args: [...nextAxis.args],
      id: nextId,
    };
    setArg(copiedAxis.args, 0, `#${copiedPoint.id}`);
    setArg(nextPlacement.args, 1, `#${copiedAxis.id}`);
    next.push(copiedAxis);
  } else {
    setArg(nextAxis.args, 0, `#${copiedPoint.id}`);
  }

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

/** Schreibt einen absoluten IFC-Weltpunkt korrekt als lokales Placement. */
export function updateNativePlacementWorld(
  document: NativeIfcDocument,
  entityId: number,
  world: { x: number; y: number; z: number },
) {
  const local = nativeWorldToLocalPlacementPoint(document, entityId, world);
  return local
    ? updateNativePlacement(document, entityId, local)
    : document;
}

export function updateNativePlacementRotation(
  document: NativeIfcDocument,
  entityId: number,
  axes: {
    axis: { x: number; y: number; z: number };
    refDirection: { x: number; y: number; z: number };
  },
) {
  const placement = getNativePlacement(document, entityId);
  if (!placement) {
    return document;
  }

  const next = cloneDocumentEntities(document);
  let axisPlacement = next.find(
    (entity) =>
      entity.id === placement.axisPlacementId &&
      entity.type === "IFCAXIS2PLACEMENT3D",
  );
  if (!axisPlacement) {
    return document;
  }

  const axis = normalizeDirection(axes.axis, { x: 0, y: 0, z: 1 });
  const refDirection = normalizeDirection(axes.refDirection, {
    x: 1,
    y: 0,
    z: 0,
  });
  let nextId = nextEntityId(next);

  // Axis placements and directions are frequently shared in authored IFCs,
  // including with extrusion geometry. Mutating those resources in place can
  // rotate or invalidate the body itself. Clone the placement only when it is
  // shared, and always allocate private direction entities for this product.
  const axisPlacementIsShared =
    (document.incomingRefs.get(placement.axisPlacementId)?.length ?? 0) > 1;
  if (axisPlacementIsShared) {
    const localPlacement = next.find(
      (entity) =>
        entity.id === placement.placementId &&
        entity.type === "IFCLOCALPLACEMENT",
    );
    if (!localPlacement) {
      return document;
    }
    axisPlacement = {
      ...axisPlacement,
      args: [...axisPlacement.args],
      id: nextId++,
    };
    next.push(axisPlacement);
    setArg(localPlacement.args, 1, `#${axisPlacement.id}`);
  }
  const axisDirection: NativeIfcEntity = {
    args: [formatDirectionTuple(axis)],
    description: "",
    globalId: "",
    id: nextId++,
    name: "",
    type: "IFCDIRECTION",
  };
  const refDirectionEntity: NativeIfcEntity = {
    args: [formatDirectionTuple(refDirection)],
    description: "",
    globalId: "",
    id: nextId++,
    name: "",
    type: "IFCDIRECTION",
  };
  next.push(axisDirection, refDirectionEntity);
  setArg(axisPlacement.args, 1, `#${axisDirection.id}`);
  setArg(axisPlacement.args, 2, `#${refDirectionEntity.id}`);

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export function addNativeElement(
  document: NativeIfcDocument,
  parentId: number | undefined,
  type: string,
  name: string,
) {
  const next = cloneDocumentEntities(document);
  const productType = normalizeType(type);
  const id = nextEntityId(next);
  let nextId = id + 1;
  const parent = parentId ? document.entityById.get(parentId) : undefined;
  const parentPlacementRef = parent?.args[5]?.startsWith("#")
    ? parent.args[5]
    : "$";
  const placementId = isPhysicalProduct(productType) ? nextId++ : undefined;
  const placementAxisId = placementId ? nextId++ : undefined;
  const placementPointId = placementId ? nextId++ : undefined;

  next.push({
    args: [
      quote(createIfcGuid(id)),
      "$",
      quote(name),
      "$",
      "$",
      placementId ? `#${placementId}` : "$",
      "$",
      "$",
    ],
    description: "",
    globalId: createIfcGuid(id),
    id,
    name,
    type: productType,
  });

  if (placementId && placementAxisId && placementPointId) {
    next.push(
      {
        args: [parentPlacementRef, `#${placementAxisId}`],
        description: "",
        globalId: "",
        id: placementId,
        name: "",
        type: "IFCLOCALPLACEMENT",
      },
      {
        args: [`#${placementPointId}`, "$", "$"],
        description: "",
        globalId: "",
        id: placementAxisId,
        name: "",
        type: "IFCAXIS2PLACEMENT3D",
      },
      {
        args: ["(0.,0.,0.)"],
        description: "",
        globalId: "",
        id: placementPointId,
        name: "",
        type: "IFCCARTESIANPOINT",
      },
    );
  }

  if (parentId && document.entityById.has(parentId)) {
    const relId = nextId;
    const useContainment = Boolean(
      parent && isSpatial(parent.type) && !isSpatial(productType),
    );
    next.push({
      args: useContainment
        ? [
            quote(createIfcGuid(relId)),
            "$",
            "$",
            "$",
            `(#${id})`,
            `#${parentId}`,
          ]
        : [
            quote(createIfcGuid(relId)),
            "$",
            "$",
            "$",
            `#${parentId}`,
            `(#${id})`,
          ],
      description: "",
      globalId: createIfcGuid(relId),
      id: relId,
      name: "",
      type: useContainment
        ? "IFCRELCONTAINEDINSPATIALSTRUCTURE"
        : "IFCRELAGGREGATES",
    });
  }

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

/**
 * Erzeugt die Profil-Entitäten für einen extrudierten Körper.
 *
 * Parametrische Profile (Rechteck/Kreis/Ellipse) nutzen die vorab vergebenen
 * profileAxis/profilePoint/profileDirection-Ids; Polylinien-Profile (Dreieck,
 * Positionsmarker) erzeugen ihre Punkte/Polylinie über `allocateId` und lassen
 * die Axis-Ids ungenutzt (STEP-Ids müssen nicht lückenlos sein).
 */
function buildBodyProfileEntities(options: {
  allocateId(): number;
  depth: string;
  height: string;
  profile: NativeBodyProfile;
  profileAxisId: number;
  profileDirectionId: number;
  profileId: number;
  profilePointId: number;
  width: string;
}): { entities: NativeIfcEntity[]; footprintArea: string } {
  const { profile, profileId, width, depth } = options;
  const w = Number(width);
  const d = Number(depth);

  const parametricProfile = (
    type: string,
    name: string,
    dimensionArgs: string[],
  ): { entities: NativeIfcEntity[]; footprintArea: string } => ({
    entities: [
      {
        args: [
          ".AREA.",
          quote(name),
          `#${options.profileAxisId}`,
          ...dimensionArgs,
        ],
        description: "",
        globalId: "",
        id: profileId,
        name,
        type,
      },
      {
        args: [`#${options.profilePointId}`, `#${options.profileDirectionId}`],
        description: "",
        globalId: "",
        id: options.profileAxisId,
        name: "",
        type: "IFCAXIS2PLACEMENT2D",
      },
      {
        args: ["(0.,0.)"],
        description: "",
        globalId: "",
        id: options.profilePointId,
        name: "",
        type: "IFCCARTESIANPOINT",
      },
      {
        args: ["(1.,0.)"],
        description: "",
        globalId: "",
        id: options.profileDirectionId,
        name: "",
        type: "IFCDIRECTION",
      },
    ],
    footprintArea: "0.",
  });

  const polylineProfile = (
    name: string,
    coordinates: ReadonlyArray<readonly [number, number]>,
    footprintArea: string,
  ): { entities: NativeIfcEntity[]; footprintArea: string } => {
    const pointIds = coordinates.map(() => options.allocateId());
    const polylineId = options.allocateId();
    return {
      entities: [
        {
          args: [".AREA.", quote(name), `#${polylineId}`],
          description: "",
          globalId: "",
          id: profileId,
          name,
          type: "IFCARBITRARYCLOSEDPROFILEDEF",
        },
        {
          // Geschlossene Polylinie: erster Punkt am Ende wiederholt.
          args: [
            `(${[...pointIds, pointIds[0]].map((id) => `#${id}`).join(",")})`,
          ],
          description: "",
          globalId: "",
          id: polylineId,
          name: "",
          type: "IFCPOLYLINE",
        },
        ...coordinates.map(([x, y], index) => ({
          args: [`(${formatDecimal(x)},${formatDecimal(y)})`],
          description: "",
          globalId: "",
          id: pointIds[index],
          name: "",
          type: "IFCCARTESIANPOINT",
        })),
      ],
      footprintArea,
    };
  };

  if (profile === "cylinder") {
    const radius = formatDecimal(Math.max(w, d) / 2);
    const result = parametricProfile(
      "IFCCIRCLEPROFILEDEF",
      "Cylindrical Body",
      [radius],
    );
    return { ...result, footprintArea: circleAreaStepNumber(radius) };
  }
  if (profile === "ellipse") {
    const semiX = Math.max(w / 2, 0.0001);
    const semiY = Math.max(d / 2, 0.0001);
    const result = parametricProfile(
      "IFCELLIPSEPROFILEDEF",
      "Elliptical Body",
      [formatDecimal(semiX), formatDecimal(semiY)],
    );
    return { ...result, footprintArea: formatDecimal(Math.PI * semiX * semiY) };
  }
  if (profile === "triangle") {
    const hw = w / 2;
    const hd = d / 2;
    return polylineProfile(
      "Triangular Body",
      [
        [-hw, -hd],
        [hw, -hd],
        [0, hd],
      ],
      formatDecimal((w * d) / 2),
    );
  }
  if (profile === "marker") {
    // Aufrechter Karten-Pin: Silhouette in Breite × Höhe (Profil-X/Y wird
    // über die gedrehte Solid-Platzierung vertikal gestellt); die Tiefe ist
    // die dünne Extrusionsdicke.
    const markerPoints = createPositionMarkerProfile(w, Number(options.height));
    return polylineProfile(
      "Position Marker Body",
      markerPoints,
      formatDecimal(polygonArea(markerPoints)),
    );
  }
  const result = parametricProfile(
    "IFCRECTANGLEPROFILEDEF",
    "Rectangular Body",
    [width, depth],
  );
  return { ...result, footprintArea: multiplyStepNumbers(width, depth) };
}

export function addNativeBodyElement(
  document: NativeIfcDocument,
  options: NativeBodyElementOptions,
) {
  const next = cloneDocumentEntities(document);
  const productId = nextEntityId(next);
  const placementId = productId + 1;
  const placementAxisId = productId + 2;
  const placementPointId = productId + 3;
  const shapeId = productId + 4;
  const representationId = productId + 5;
  const solidId = productId + 6;
  const solidAxisId = productId + 7;
  const solidPointId = productId + 8;
  const profileId = productId + 9;
  const profileAxisId = productId + 10;
  const profilePointId = productId + 11;
  const extrusionDirectionId = productId + 12;
  const profileDirectionId = productId + 13;
  const relId = productId + 14;
  const quantityId = productId + 15;
  const heightQuantityId = productId + 16;
  const areaQuantityId = productId + 17;
  const volumeQuantityId = productId + 18;
  const quantityRelId = productId + 19;
  const parent = options.parentId
    ? document.entityById.get(options.parentId)
    : undefined;
  // Platzierungsbezug (RelativeTo der IFCLOCALPLACEMENT): immer die Kette
  // eines Bezugselements erben (explizit gewähltes Element, sonst der Parent),
  // damit georeferenzierte Modelle kleine lokale Koordinaten behalten — auch
  // im Weltmodus. Nur ohne Bezugsplatzierung wird absolut ($) geschrieben.
  const placementRelativeToEntity =
    options.placementRelativeToId != null
      ? document.entityById.get(options.placementRelativeToId)
      : undefined;
  const referencePlacementRef = placementRelativeToEntity?.args[5]?.startsWith(
    "#",
  )
    ? placementRelativeToEntity.args[5]
    : parent?.args[5]?.startsWith("#")
      ? parent.args[5]
      : undefined;
  const parentPlacementRef = referencePlacementRef ?? "$";
  const contextRef = `#${document.entities.find((entity) => entity.type === "IFCGEOMETRICREPRESENTATIONCONTEXT")?.id ?? 10}`;
  // Eingaben (Abmessungen und X/Y/Z) sind METER — die Einheit des Viewers und
  // der UI. Reale Modelle stehen oft in Millimetern; ohne Umrechnung landet
  // der Körper 1000-fach zu klein nahe dem Ursprung.
  const metersPerUnit = getNativeLengthUnitScale(document);
  const toModelUnits = (meters: string) =>
    formatDecimal(Number(meters) / metersPerUnit);
  const width = toModelUnits(positiveStepNumber(options.width, 1));
  const depth = toModelUnits(positiveStepNumber(options.depth, 1));
  const height = toModelUnits(positiveStepNumber(options.height, 1));
  const profile = normalizeBodyProfile(options.profile);
  // Marker: aufrechter, flacher Karten-Pin. Das Profil (Breite × Höhe) steht
  // vertikal (gedrehte Solid-Platzierung), extrudiert wird dünn um die Tiefe.
  const isMarker = profile === "marker";
  const extrusionLength = isMarker ? depth : height;
  // Polylinien-Profile (Dreieck/Marker) vergeben zusätzliche Ids hinter dem
  // festen Block productId+0..+19.
  let extraEntityId = quantityRelId + 1;
  const profileBuild = buildBodyProfileEntities({
    allocateId: () => extraEntityId++,
    depth,
    height,
    profile,
    profileAxisId,
    profileDirectionId,
    profileId,
    profilePointId,
    width,
  });
  const markerAxisDirectionId = isMarker ? extraEntityId++ : undefined;
  const markerRefDirectionId = isMarker ? extraEntityId++ : undefined;
  const footprintArea = profileBuild.footprintArea;
  const netVolume = multiplyStepNumbers(footprintArea, extrusionLength);
  // Position: entweder bereits Modell-Einheiten (IFC-Achsen) oder Meter → skalieren.
  const toPositionUnits = options.positionInModelUnits
    ? (value: string) => value
    : toModelUnits;
  const inputPoint = {
    x: Number(toPositionUnits(numericStepNumber(options.x, 0))),
    y: Number(toPositionUnits(numericStepNumber(options.y, 0))),
    z: Number(toPositionUnits(numericStepNumber(options.z, 0))),
  };
  // Weltmodus: x/y/z sind ABSOLUTE IFC-Weltkoordinaten und werden in das
  // Bezugssystem der referenzierten Platzierungskette projiziert. Ohne
  // Bezugsplatzierung (RelativeTo = $) ist lokal == Welt.
  const localPoint =
    options.placementMode === "world" && referencePlacementRef
      ? worldPointInPlacementFrame(
          document,
          readReferences(referencePlacementRef)[0],
          inputPoint,
        )
      : inputPoint;
  const x = formatDecimal(localPoint.x);
  const y = formatDecimal(localPoint.y);
  const z = formatDecimal(localPoint.z);
  const productType = normalizeProductTypeForSchema(
    document.schema,
    normalizeType(options.type || "IFCBUILTELEMENT"),
  );
  const name = options.name.trim() || "New Body Element";
  const tag = options.tag?.trim() || `IFCNATIVE-BODY-${productId}`;

  next.push(
    {
      args: [
        quote(createIfcGuid(productId)),
        "$",
        quote(name),
        "$",
        "$",
        `#${placementId}`,
        `#${shapeId}`,
        quote(tag),
      ],
      description: "",
      globalId: createIfcGuid(productId),
      id: productId,
      name,
      type: productType,
    },
    {
      args: [parentPlacementRef, `#${placementAxisId}`],
      description: "",
      globalId: "",
      id: placementId,
      name: "",
      type: "IFCLOCALPLACEMENT",
    },
    {
      args: [`#${placementPointId}`, "$", "$"],
      description: "",
      globalId: "",
      id: placementAxisId,
      name: "",
      type: "IFCAXIS2PLACEMENT3D",
    },
    {
      args: [`(${x},${y},${z})`],
      description: "",
      globalId: "",
      id: placementPointId,
      name: "",
      type: "IFCCARTESIANPOINT",
    },
    {
      args: ["$", "$", `(#${representationId})`],
      description: "",
      globalId: "",
      id: shapeId,
      name: "",
      type: "IFCPRODUCTDEFINITIONSHAPE",
    },
    {
      args: [contextRef, quote("Body"), quote("SweptSolid"), `(#${solidId})`],
      description: "",
      globalId: "",
      id: representationId,
      name: "Body",
      type: "IFCSHAPEREPRESENTATION",
    },
    {
      args: [
        `#${profileId}`,
        `#${solidAxisId}`,
        `#${extrusionDirectionId}`,
        extrusionLength,
      ],
      description: "",
      globalId: "",
      id: solidId,
      name: "",
      type: "IFCEXTRUDEDAREASOLID",
    },
    {
      // Marker: Profil-Ebene vertikal stellen (Achse -Y, RefDirection +X)
      // => Profil-X bleibt Welt-X, Profil-Y zeigt nach Welt-Z (oben); die
      // Extrusion läuft entlang -Y und wird über den Startpunkt zentriert.
      args:
        isMarker && markerAxisDirectionId && markerRefDirectionId
          ? [
              `#${solidPointId}`,
              `#${markerAxisDirectionId}`,
              `#${markerRefDirectionId}`,
            ]
          : [`#${solidPointId}`, "$", "$"],
      description: "",
      globalId: "",
      id: solidAxisId,
      name: "",
      type: "IFCAXIS2PLACEMENT3D",
    },
    {
      args: [
        isMarker ? `(0.,${formatDecimal(Number(depth) / 2)},0.)` : "(0.,0.,0.)",
      ],
      description: "",
      globalId: "",
      id: solidPointId,
      name: "",
      type: "IFCCARTESIANPOINT",
    },
    {
      args: ["(0.,0.,1.)"],
      description: "",
      globalId: "",
      id: extrusionDirectionId,
      name: "",
      type: "IFCDIRECTION",
    },
    ...(isMarker && markerAxisDirectionId && markerRefDirectionId
      ? [
          {
            args: ["(0.,-1.,0.)"],
            description: "",
            globalId: "",
            id: markerAxisDirectionId,
            name: "",
            type: "IFCDIRECTION",
          },
          {
            args: ["(1.,0.,0.)"],
            description: "",
            globalId: "",
            id: markerRefDirectionId,
            name: "",
            type: "IFCDIRECTION",
          },
        ]
      : []),
    ...profileBuild.entities,
  );

  if (parent) {
    next.push({
      args: isSpatial(parent.type)
        ? [
            quote(createIfcGuid(relId)),
            "$",
            "$",
            "$",
            `(#${productId})`,
            `#${parent.id}`,
          ]
        : [
            quote(createIfcGuid(relId)),
            "$",
            "$",
            "$",
            `#${parent.id}`,
            `(#${productId})`,
          ],
      description: "",
      globalId: createIfcGuid(relId),
      id: relId,
      name: "",
      type: isSpatial(parent.type)
        ? "IFCRELCONTAINEDINSPATIALSTRUCTURE"
        : "IFCRELAGGREGATES",
    });
  }

  next.push(
    {
      args: [
        quote(createIfcGuid(quantityId)),
        "$",
        quote("IFCnative_BaseQuantities"),
        "$",
        quote("BaseQuantities"),
        `(#${heightQuantityId},#${areaQuantityId},#${volumeQuantityId})`,
      ],
      description: "",
      globalId: createIfcGuid(quantityId),
      id: quantityId,
      name: "IFCnative_BaseQuantities",
      type: "IFCELEMENTQUANTITY",
    },
    {
      args: [quote("Height"), "$", "$", height, "$"],
      description: "",
      globalId: "",
      id: heightQuantityId,
      name: "Height",
      type: "IFCQUANTITYLENGTH",
    },
    {
      args: [quote("FootprintArea"), "$", "$", footprintArea, "$"],
      description: "",
      globalId: "",
      id: areaQuantityId,
      name: "FootprintArea",
      type: "IFCQUANTITYAREA",
    },
    {
      args: [quote("NetVolume"), "$", "$", netVolume, "$"],
      description: "",
      globalId: "",
      id: volumeQuantityId,
      name: "NetVolume",
      type: "IFCQUANTITYVOLUME",
    },
    {
      args: [
        quote(createIfcGuid(quantityRelId)),
        "$",
        "$",
        "$",
        `(#${productId})`,
        `#${quantityId}`,
      ],
      description: "",
      globalId: createIfcGuid(quantityRelId),
      id: quantityRelId,
      name: "",
      type: "IFCRELDEFINESBYPROPERTIES",
    },
  );

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export function assignNativeBodyRepresentation(
  document: NativeIfcDocument,
  entityId: number,
  options: Pick<
    NativeBodyElementOptions,
    "width" | "depth" | "height" | "profile"
  >,
) {
  const product = document.entityById.get(entityId);
  if (!product || !isRepresentationAssignableProduct(product)) {
    return document;
  }

  const next = cloneDocumentEntities(document);
  const nextProduct = next.find((entity) => entity.id === entityId);
  if (!nextProduct || !isRepresentationAssignableProduct(nextProduct)) {
    return document;
  }

  let nextId = nextEntityId(next);
  const shouldAddPlacement =
    !nextProduct.args[5]?.startsWith("#") ||
    document.entityById.get(readReferences(nextProduct.args[5] ?? "")[0])
      ?.type !== "IFCLOCALPLACEMENT";
  const placementId = shouldAddPlacement ? nextId++ : undefined;
  const placementAxisId = shouldAddPlacement ? nextId++ : undefined;
  const placementPointId = shouldAddPlacement ? nextId++ : undefined;
  const shapeId = nextId++;
  const representationId = nextId++;
  const solidId = nextId++;
  const solidAxisId = nextId++;
  const solidPointId = nextId++;
  const profileId = nextId++;
  const profileAxisId = nextId++;
  const profilePointId = nextId++;
  const extrusionDirectionId = nextId++;
  const profileDirectionId = nextId++;
  const quantityId = nextId++;
  const heightQuantityId = nextId++;
  const areaQuantityId = nextId++;
  const volumeQuantityId = nextId++;
  const quantityRelId = nextId++;
  const contextRef = `#${document.entities.find((entity) => entity.type === "IFCGEOMETRICREPRESENTATIONCONTEXT")?.id ?? 10}`;
  const width = positiveStepNumber(options.width, 1);
  const depth = positiveStepNumber(options.depth, 1);
  const height = positiveStepNumber(options.height, 1);
  const profile = normalizeBodyProfile(options.profile);
  const radius = formatDecimal(Math.max(Number(width), Number(depth)) / 2);
  const footprintArea =
    profile === "cylinder"
      ? circleAreaStepNumber(radius)
      : multiplyStepNumbers(width, depth);
  const netVolume = multiplyStepNumbers(footprintArea, height);
  const existingBody = getNativeBodyRepresentation(document, entityId);

  if (
    existingBody.canEdit &&
    existingBody.shapeId &&
    existingBody.solidId &&
    existingBody.profileId
  ) {
    if (placementId && placementAxisId && placementPointId) {
      setArg(nextProduct.args, 5, `#${placementId}`);
      next.push(
        {
          args: ["$", `#${placementAxisId}`],
          description: "",
          globalId: "",
          id: placementId,
          name: "",
          type: "IFCLOCALPLACEMENT",
        },
        {
          args: [`#${placementPointId}`, "$", "$"],
          description: "",
          globalId: "",
          id: placementAxisId,
          name: "",
          type: "IFCAXIS2PLACEMENT3D",
        },
        {
          args: ["(0.,0.,0.)"],
          description: "",
          globalId: "",
          id: placementPointId,
          name: "",
          type: "IFCCARTESIANPOINT",
        },
      );
    }

    setArg(nextProduct.args, 6, `#${existingBody.shapeId}`);
    const solid = next.find((entity) => entity.id === existingBody.solidId);
    const profileEntity = next.find(
      (entity) => entity.id === existingBody.profileId,
    );
    if (solid && profileEntity) {
      setArg(solid.args, 0, `#${profileEntity.id}`);
      setArg(solid.args, 3, height);
      const profileAxisRef = profileEntity.args[2] ?? "$";
      profileEntity.type =
        profile === "cylinder"
          ? "IFCCIRCLEPROFILEDEF"
          : "IFCRECTANGLEPROFILEDEF";
      profileEntity.name =
        profile === "cylinder"
          ? "Assigned Cylindrical Body"
          : "Assigned Rectangular Body";
      profileEntity.args =
        profile === "cylinder"
          ? [
              ".AREA.",
              quote("Assigned Cylindrical Body"),
              profileAxisRef,
              radius,
            ]
          : [
              ".AREA.",
              quote("Assigned Rectangular Body"),
              profileAxisRef,
              width,
              depth,
            ];
      updateNativeBodyQuantities(next, document, entityId, {
        area: footprintArea,
        height,
        volume: netVolume,
      });

      return parseNativeIfcText(
        serializeEntities(document, next),
        document.fileName,
      );
    }
  }

  if (placementId && placementAxisId && placementPointId) {
    setArg(nextProduct.args, 5, `#${placementId}`);
    next.push(
      {
        args: ["$", `#${placementAxisId}`],
        description: "",
        globalId: "",
        id: placementId,
        name: "",
        type: "IFCLOCALPLACEMENT",
      },
      {
        args: [`#${placementPointId}`, "$", "$"],
        description: "",
        globalId: "",
        id: placementAxisId,
        name: "",
        type: "IFCAXIS2PLACEMENT3D",
      },
      {
        args: ["(0.,0.,0.)"],
        description: "",
        globalId: "",
        id: placementPointId,
        name: "",
        type: "IFCCARTESIANPOINT",
      },
    );
  }
  setArg(nextProduct.args, 6, `#${shapeId}`);

  next.push(
    {
      args: ["$", "$", `(#${representationId})`],
      description: "",
      globalId: "",
      id: shapeId,
      name: "",
      type: "IFCPRODUCTDEFINITIONSHAPE",
    },
    {
      args: [contextRef, quote("Body"), quote("SweptSolid"), `(#${solidId})`],
      description: "",
      globalId: "",
      id: representationId,
      name: "Body",
      type: "IFCSHAPEREPRESENTATION",
    },
    {
      args: [
        `#${profileId}`,
        `#${solidAxisId}`,
        `#${extrusionDirectionId}`,
        height,
      ],
      description: "",
      globalId: "",
      id: solidId,
      name: "",
      type: "IFCEXTRUDEDAREASOLID",
    },
    {
      args: [`#${solidPointId}`, "$", "$"],
      description: "",
      globalId: "",
      id: solidAxisId,
      name: "",
      type: "IFCAXIS2PLACEMENT3D",
    },
    {
      args: ["(0.,0.,0.)"],
      description: "",
      globalId: "",
      id: solidPointId,
      name: "",
      type: "IFCCARTESIANPOINT",
    },
    {
      args:
        profile === "cylinder"
          ? [
              ".AREA.",
              quote("Assigned Cylindrical Body"),
              `#${profileAxisId}`,
              radius,
            ]
          : [
              ".AREA.",
              quote("Assigned Rectangular Body"),
              `#${profileAxisId}`,
              width,
              depth,
            ],
      description: "",
      globalId: "",
      id: profileId,
      name:
        profile === "cylinder"
          ? "Assigned Cylindrical Body"
          : "Assigned Rectangular Body",
      type:
        profile === "cylinder"
          ? "IFCCIRCLEPROFILEDEF"
          : "IFCRECTANGLEPROFILEDEF",
    },
    {
      args: [`#${profilePointId}`, `#${profileDirectionId}`],
      description: "",
      globalId: "",
      id: profileAxisId,
      name: "",
      type: "IFCAXIS2PLACEMENT2D",
    },
    {
      args: ["(0.,0.)"],
      description: "",
      globalId: "",
      id: profilePointId,
      name: "",
      type: "IFCCARTESIANPOINT",
    },
    {
      args: ["(0.,0.,1.)"],
      description: "",
      globalId: "",
      id: extrusionDirectionId,
      name: "",
      type: "IFCDIRECTION",
    },
    {
      args: ["(1.,0.)"],
      description: "",
      globalId: "",
      id: profileDirectionId,
      name: "",
      type: "IFCDIRECTION",
    },
    {
      args: [
        quote(createIfcGuid(quantityId)),
        "$",
        quote("IFCnative_BaseQuantities"),
        "$",
        quote("AssignedBodyQuantities"),
        `(#${heightQuantityId},#${areaQuantityId},#${volumeQuantityId})`,
      ],
      description: "",
      globalId: createIfcGuid(quantityId),
      id: quantityId,
      name: "IFCnative_BaseQuantities",
      type: "IFCELEMENTQUANTITY",
    },
    {
      args: [quote("Height"), "$", "$", height, "$"],
      description: "",
      globalId: "",
      id: heightQuantityId,
      name: "Height",
      type: "IFCQUANTITYLENGTH",
    },
    {
      args: [quote("FootprintArea"), "$", "$", footprintArea, "$"],
      description: "",
      globalId: "",
      id: areaQuantityId,
      name: "FootprintArea",
      type: "IFCQUANTITYAREA",
    },
    {
      args: [quote("NetVolume"), "$", "$", netVolume, "$"],
      description: "",
      globalId: "",
      id: volumeQuantityId,
      name: "NetVolume",
      type: "IFCQUANTITYVOLUME",
    },
    {
      args: [
        quote(createIfcGuid(quantityRelId)),
        "$",
        "$",
        "$",
        `(#${entityId})`,
        `#${quantityId}`,
      ],
      description: "",
      globalId: createIfcGuid(quantityRelId),
      id: quantityRelId,
      name: "",
      type: "IFCRELDEFINESBYPROPERTIES",
    },
  );

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

function updateNativeBodyQuantities(
  entities: NativeIfcEntity[],
  document: NativeIfcDocument,
  entityId: number,
  values: { area: string; height: string; volume: string },
) {
  const baseQuantities = document.propertySetsByEntity
    .get(entityId)
    ?.find(
      (set) => set.kind === "Qto" && set.name === "IFCnative_BaseQuantities",
    );
  if (!baseQuantities) {
    return;
  }

  for (const quantity of baseQuantities.values) {
    const entity = entities.find((item) => item.id === quantity.id);
    if (!entity) {
      continue;
    }
    if (quantity.name === "Height") {
      setArg(entity.args, 3, values.height);
    } else if (quantity.name === "FootprintArea") {
      setArg(entity.args, 3, values.area);
    } else if (quantity.name === "NetVolume") {
      setArg(entity.args, 3, values.volume);
    }
  }
}

/**
 * Teilt einen einfachen extrudierten Körper entlang seiner Extrusionsachse in
 * gleich lange, eigenständige IFC-Produkte. Metadaten-Zuordnungen (Psets,
 * Typen, Material, Gruppen und räumliche Einordnung) werden für die neuen
 * Teile übernommen; Mengen werden je Teil separat geführt.
 */
export function splitNativeBodyElement(
  document: NativeIfcDocument,
  entityId: number,
  requestedPartCount = 2,
): NativeBodySplitResult | undefined {
  const product = document.entityById.get(entityId);
  const placement = getNativePlacement(document, entityId);
  const body = getNativeBodyRepresentation(document, entityId);
  const shape = body.shapeId
    ? document.entityById.get(body.shapeId)
    : undefined;
  const bodyRepresentation = body.bodyRepresentationId
    ? document.entityById.get(body.bodyRepresentationId)
    : undefined;
  const solid = body.solidId
    ? document.entityById.get(body.solidId)
    : undefined;
  const placementEntity = placement
    ? document.entityById.get(placement.placementId)
    : undefined;
  const placementAxis = placement
    ? document.entityById.get(placement.axisPlacementId)
    : undefined;
  const bodyItems = readReferences(bodyRepresentation?.args[3] ?? "");

  if (
    !product ||
    !placement ||
    placementEntity?.type !== "IFCLOCALPLACEMENT" ||
    placementAxis?.type !== "IFCAXIS2PLACEMENT3D" ||
    shape?.type !== "IFCPRODUCTDEFINITIONSHAPE" ||
    bodyRepresentation?.type !== "IFCSHAPEREPRESENTATION" ||
    solid?.type !== "IFCEXTRUDEDAREASOLID" ||
    !body.canEdit ||
    !body.height ||
    body.height <= 0 ||
    bodyItems.length !== 1 ||
    bodyItems[0] !== solid.id
  ) {
    return undefined;
  }

  const partCount = Math.min(
    20,
    Math.max(2, Math.round(Number(requestedPartCount) || 2)),
  );
  const partLength = body.height / partCount;
  if (!Number.isFinite(partLength) || partLength <= 0) {
    return undefined;
  }

  const solidAxisId = readReferences(solid.args[1] ?? "")[0];
  const solidFrame =
    readAxis2Placement3dFrame(document, solidAxisId) ??
    IDENTITY_PLACEMENT_FRAME;
  const solidDirection = readDirectionVector(document, solid.args[2], {
    x: 0,
    y: 0,
    z: 1,
  });
  const productLocalExtrusion = normalizeDirection(
    rotateFrameDirection(solidFrame, solidDirection),
    { x: 0, y: 0, z: 1 },
  );
  const productPlacementFrame =
    readAxis2Placement3dFrame(document, placement.axisPlacementId) ??
    IDENTITY_PLACEMENT_FRAME;
  const parentLocalExtrusion = normalizeDirection(
    rotateFrameDirection(productPlacementFrame, productLocalExtrusion),
    { x: 0, y: 0, z: 1 },
  );

  const next = cloneDocumentEntities(document);
  let nextId = nextEntityId(next);
  const allocateId = () => nextId++;
  const partLengthStep = formatDecimal(partLength);
  const footprintArea = nativeBodyFootprintArea(body);
  const baseName = product.name.trim() || `#${entityId}`;
  const partIds = [entityId];
  const nextOriginal = next.find((entity) => entity.id === entityId);
  const nextOriginalSolid = next.find((entity) => entity.id === solid.id);
  if (!nextOriginal || !nextOriginalSolid) {
    return undefined;
  }
  setArg(nextOriginal.args, 2, quote(`${baseName} – Teil 1/${partCount}`));
  nextOriginal.name = `${baseName} – Teil 1/${partCount}`;
  setArg(nextOriginalSolid.args, 3, partLengthStep);
  updateNativeBodyQuantities(next, document, entityId, {
    area: footprintArea,
    height: partLengthStep,
    volume: multiplyStepNumbers(footprintArea, partLengthStep),
  });
  if (!hasNativeBodyQuantities(document, entityId)) {
    appendNativeBodyQuantities(
      next,
      allocateId,
      entityId,
      footprintArea,
      partLengthStep,
    );
  }

  for (let partIndex = 1; partIndex < partCount; partIndex += 1) {
    const partId = allocateId();
    const partPlacementId = allocateId();
    const partPlacementAxisId = allocateId();
    const partPlacementPointId = allocateId();
    const partShapeId = allocateId();
    const partRepresentationId = allocateId();
    const partSolidId = allocateId();
    const partName = `${baseName} – Teil ${partIndex + 1}/${partCount}`;
    const offset = partLength * partIndex;
    const partPoint = {
      x: placement.x + parentLocalExtrusion.x * offset,
      y: placement.y + parentLocalExtrusion.y * offset,
      z: placement.z + parentLocalExtrusion.z * offset,
    };
    const partProduct: NativeIfcEntity = {
      ...product,
      args: [...product.args],
      globalId: createIfcGuid(partId),
      id: partId,
      name: partName,
    };
    setArg(partProduct.args, 0, quote(partProduct.globalId));
    setArg(partProduct.args, 2, quote(partName));
    setArg(partProduct.args, 5, `#${partPlacementId}`);
    setArg(partProduct.args, 6, `#${partShapeId}`);
    if (partProduct.args.length > 7) {
      setArg(
        partProduct.args,
        7,
        quote(`IFCNATIVE-SPLIT-${entityId}-${partIndex + 1}`),
      );
    }

    const partRepresentations = readReferences(shape.args[2] ?? "").map(
      (representationId) =>
        representationId === bodyRepresentation.id
          ? partRepresentationId
          : representationId,
    );
    next.push(
      partProduct,
      {
        ...placementEntity,
        args: [...placementEntity.args],
        id: partPlacementId,
      },
      {
        ...placementAxis,
        args: [...placementAxis.args],
        id: partPlacementAxisId,
      },
      {
        args: [
          `(${formatDecimal(partPoint.x)},${formatDecimal(partPoint.y)},${formatDecimal(partPoint.z)})`,
        ],
        description: "",
        globalId: "",
        id: partPlacementPointId,
        name: "",
        type: "IFCCARTESIANPOINT",
      },
      {
        ...shape,
        args: [...shape.args],
        id: partShapeId,
      },
      {
        ...bodyRepresentation,
        args: [...bodyRepresentation.args],
        id: partRepresentationId,
      },
      {
        ...solid,
        args: [...solid.args],
        id: partSolidId,
      },
    );
    const nextPlacement = next.find(
      (entity) => entity.id === partPlacementId,
    );
    const nextPlacementAxis = next.find(
      (entity) => entity.id === partPlacementAxisId,
    );
    const nextShape = next.find((entity) => entity.id === partShapeId);
    const nextRepresentation = next.find(
      (entity) => entity.id === partRepresentationId,
    );
    const nextSolid = next.find((entity) => entity.id === partSolidId);
    if (
      !nextPlacement ||
      !nextPlacementAxis ||
      !nextShape ||
      !nextRepresentation ||
      !nextSolid
    ) {
      return undefined;
    }
    setArg(nextPlacement.args, 1, `#${partPlacementAxisId}`);
    setArg(nextPlacementAxis.args, 0, `#${partPlacementPointId}`);
    setArg(
      nextShape.args,
      2,
      `(${partRepresentations.map((id) => `#${id}`).join(",")})`,
    );
    setArg(nextRepresentation.args, 3, `(#${partSolidId})`);
    setArg(nextSolid.args, 3, partLengthStep);

    copyNativeProductMemberships(document, next, entityId, partId, {
      includeQuantities: false,
    });
    appendNativeBodyQuantities(
      next,
      allocateId,
      partId,
      footprintArea,
      partLengthStep,
    );
    partIds.push(partId);
  }

  return {
    document: parseNativeIfcText(
      serializeEntities(document, next),
      document.fileName,
    ),
    partIds,
  };
}

interface NativeAffineFrame {
  origin: NativeVector3;
  scale: number;
  xAxis: NativeVector3;
  yAxis: NativeVector3;
  zAxis: NativeVector3;
}

interface NativeCutLeaf {
  contextRef: string;
  itemId: number;
  transform: NativeAffineFrame;
}

const IDENTITY_AFFINE_FRAME: NativeAffineFrame = {
  ...IDENTITY_PLACEMENT_FRAME,
  scale: 1,
};

const IFC_BOOLEAN_OPERAND_TYPES = new Set([
  "IFCADVANCEDBREP",
  "IFCADVANCEDBREPWITHVOIDS",
  "IFCBLOCK",
  "IFCBOOLEANCLIPPINGRESULT",
  "IFCBOOLEANRESULT",
  "IFCCSGSOLID",
  "IFCEXTRUDEDAREASOLID",
  "IFCEXTRUDEDAREASOLIDTAPERED",
  "IFCFACETEDBREP",
  "IFCFACETEDBREPWITHVOIDS",
  "IFCFIXEDREFERENCESWEPTAREASOLID",
  "IFCMANIFOLDSOLIDBREP",
  "IFCREVOLVEDAREASOLID",
  "IFCREVOLVEDAREASOLIDTAPERED",
  "IFCSECTIONEDSOLID",
  "IFCSECTIONEDSOLIDHORIZONTAL",
  "IFCSPHERE",
  "IFCSWEPTAREASOLID",
  "IFCSWEPTDISKSOLID",
  "IFCSWEPTDISKSOLIDPOLYGONAL",
]);

/**
 * Schneidet ein Produkt mit einer frei orientierten Welt-Ebene in zwei neue
 * IFC-Produkte. Auch verschachtelte IFCMAPPEDITEM-Mehrkörper werden bis zu
 * ihren boolesch schneidbaren Solid-Operanden aufgelöst. Die Geometrie bleibt
 * parametrisch/referenzierbar; es findet keine verlustbehaftete Tessellierung
 * statt.
 */
export function splitNativeBodyByPlane(
  document: NativeIfcDocument,
  entityId: number,
  plane: NativeCutPlane,
): NativeBodySplitResult | undefined {
  const product = document.entityById.get(entityId);
  const placement = getNativePlacement(document, entityId);
  const productFrame = getNativePlacementWorldFrame(document, entityId);
  const body = getNativeBodyRepresentation(document, entityId);
  const bodyRepresentation = body.bodyRepresentationId
    ? document.entityById.get(body.bodyRepresentationId)
    : undefined;
  if (
    !product ||
    !placement ||
    !productFrame ||
    !isPhysicalProduct(product.type) ||
    bodyRepresentation?.type !== "IFCSHAPEREPRESENTATION"
  ) {
    return undefined;
  }

  const normal = normalizeDirection(plane.normal, { x: 0, y: 0, z: 1 });
  if (
    ![plane.point.x, plane.point.y, plane.point.z].every(Number.isFinite) ||
    ![normal.x, normal.y, normal.z].every(Number.isFinite)
  ) {
    return undefined;
  }
  const leaves = resolveNativeCutLeaves(
    document,
    bodyRepresentation.id,
    IDENTITY_AFFINE_FRAME,
    new Set(),
    0,
  );
  if (!leaves?.length) {
    return undefined;
  }

  const productPlanePoint = pointInPlacementFrame(productFrame, plane.point);
  const productPlaneNormal = directionInPlacementFrame(productFrame, normal);
  const placementEntity = document.entityById.get(placement.placementId);
  const placementAxis = document.entityById.get(placement.axisPlacementId);
  const placementPoint = document.entityById.get(placement.pointId);
  if (
    placementEntity?.type !== "IFCLOCALPLACEMENT" ||
    placementAxis?.type !== "IFCAXIS2PLACEMENT3D" ||
    placementPoint?.type !== "IFCCARTESIANPOINT"
  ) {
    return undefined;
  }

  const next = cloneDocumentEntities(document);
  let nextId = nextEntityId(next);
  const allocateId = () => nextId++;
  const baseName = product.name.trim() || `#${entityId}`;
  const partIds: number[] = [];

  for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
    const partId = allocateId();
    const partPlacementId = allocateId();
    const partPlacementAxisId = allocateId();
    const partPlacementPointId = allocateId();
    const partShapeId = allocateId();
    const partRepresentationId = allocateId();
    const partName = `${baseName} – Schnitt ${sideIndex === 0 ? "A" : "B"}`;
    const mappedItemIds: number[] = [];
    const partGeometryEntities: NativeIfcEntity[] = [];

    for (const leaf of leaves) {
      const inverseTransform = invertNativeAffineFrame(leaf.transform);
      const localPoint = transformNativeAffinePoint(
        inverseTransform,
        productPlanePoint,
      );
      const localNormal = normalizeDirection(
        transformNativeAffineDirection(inverseTransform, productPlaneNormal),
        { x: 0, y: 0, z: 1 },
      );
      const refDirection = perpendicularDirection(localNormal);
      const planePointId = allocateId();
      const planeNormalId = allocateId();
      const planeRefDirectionId = allocateId();
      const planeAxisId = allocateId();
      const planeId = allocateId();
      const halfSpaceId = allocateId();
      const clippingResultId = allocateId();
      const clippingRepresentationId = allocateId();
      const mapOriginPointId = allocateId();
      const mapOriginId = allocateId();
      const representationMapId = allocateId();
      const targetOriginId = allocateId();
      const targetAxis1Id = allocateId();
      const targetAxis2Id = allocateId();
      const targetAxis3Id = allocateId();
      const targetOperatorId = allocateId();
      const mappedItemId = allocateId();
      mappedItemIds.push(mappedItemId);
      partGeometryEntities.push(
        {
          args: [
            `(${formatDecimal(localPoint.x)},${formatDecimal(localPoint.y)},${formatDecimal(localPoint.z)})`,
          ],
          description: "",
          globalId: "",
          id: planePointId,
          name: "",
          type: "IFCCARTESIANPOINT",
        },
        createDirectionEntity(planeNormalId, localNormal),
        createDirectionEntity(planeRefDirectionId, refDirection),
        {
          args: [
            `#${planePointId}`,
            `#${planeNormalId}`,
            `#${planeRefDirectionId}`,
          ],
          description: "",
          globalId: "",
          id: planeAxisId,
          name: "",
          type: "IFCAXIS2PLACEMENT3D",
        },
        {
          args: [`#${planeAxisId}`],
          description: "",
          globalId: "",
          id: planeId,
          name: "",
          type: "IFCPLANE",
        },
        {
          args: [`#${planeId}`, sideIndex === 0 ? ".T." : ".F."],
          description: "",
          globalId: "",
          id: halfSpaceId,
          name: "",
          type: "IFCHALFSPACESOLID",
        },
        {
          args: [
            ".DIFFERENCE.",
            `#${leaf.itemId}`,
            `#${halfSpaceId}`,
          ],
          description: "",
          globalId: "",
          id: clippingResultId,
          name: "",
          type: "IFCBOOLEANCLIPPINGRESULT",
        },
        {
          args: [
            leaf.contextRef,
            quote("Body"),
            quote("Clipping"),
            `(#${clippingResultId})`,
          ],
          description: "",
          globalId: "",
          id: clippingRepresentationId,
          name: "Body",
          type: "IFCSHAPEREPRESENTATION",
        },
        {
          args: ["(0.,0.,0.)"],
          description: "",
          globalId: "",
          id: mapOriginPointId,
          name: "",
          type: "IFCCARTESIANPOINT",
        },
        {
          args: [`#${mapOriginPointId}`, "$", "$"],
          description: "",
          globalId: "",
          id: mapOriginId,
          name: "",
          type: "IFCAXIS2PLACEMENT3D",
        },
        {
          args: [`#${mapOriginId}`, `#${clippingRepresentationId}`],
          description: "",
          globalId: "",
          id: representationMapId,
          name: "",
          type: "IFCREPRESENTATIONMAP",
        },
        {
          args: [
            `(${formatDecimal(leaf.transform.origin.x)},${formatDecimal(leaf.transform.origin.y)},${formatDecimal(leaf.transform.origin.z)})`,
          ],
          description: "",
          globalId: "",
          id: targetOriginId,
          name: "",
          type: "IFCCARTESIANPOINT",
        },
        createDirectionEntity(targetAxis1Id, leaf.transform.xAxis),
        createDirectionEntity(targetAxis2Id, leaf.transform.yAxis),
        createDirectionEntity(targetAxis3Id, leaf.transform.zAxis),
        {
          args: [
            `#${targetAxis1Id}`,
            `#${targetAxis2Id}`,
            `#${targetOriginId}`,
            formatDecimal(leaf.transform.scale),
            `#${targetAxis3Id}`,
          ],
          description: "",
          globalId: "",
          id: targetOperatorId,
          name: "",
          type: "IFCCARTESIANTRANSFORMATIONOPERATOR3D",
        },
        {
          args: [`#${representationMapId}`, `#${targetOperatorId}`],
          description: "",
          globalId: "",
          id: mappedItemId,
          name: "",
          type: "IFCMAPPEDITEM",
        },
      );
    }

    const partProduct: NativeIfcEntity = {
      ...product,
      args: [...product.args],
      globalId: createIfcGuid(partId),
      id: partId,
      name: partName,
    };
    setArg(partProduct.args, 0, quote(partProduct.globalId));
    setArg(partProduct.args, 2, quote(partName));
    setArg(partProduct.args, 5, `#${partPlacementId}`);
    setArg(partProduct.args, 6, `#${partShapeId}`);
    if (partProduct.args.length > 7) {
      setArg(partProduct.args, 7, quote(`IFCNATIVE-CUT-${entityId}-${sideIndex + 1}`));
    }
    next.push(
      partProduct,
      {
        ...placementEntity,
        args: placementEntity.args.map((arg, index) =>
          index === 1 ? `#${partPlacementAxisId}` : arg,
        ),
        id: partPlacementId,
      },
      {
        ...placementAxis,
        args: placementAxis.args.map((arg, index) =>
          index === 0 ? `#${partPlacementPointId}` : arg,
        ),
        id: partPlacementAxisId,
      },
      {
        ...placementPoint,
        args: [...placementPoint.args],
        id: partPlacementPointId,
      },
      {
        args: ["$", "$", `(#${partRepresentationId})`],
        description: "",
        globalId: "",
        id: partShapeId,
        name: "",
        type: "IFCPRODUCTDEFINITIONSHAPE",
      },
      {
        args: [
          bodyRepresentation.args[0],
          quote("Body"),
          quote("MappedRepresentation"),
          `(${mappedItemIds.map((id) => `#${id}`).join(",")})`,
        ],
        description: "",
        globalId: "",
        id: partRepresentationId,
        name: "Body",
        type: "IFCSHAPEREPRESENTATION",
      },
      ...partGeometryEntities,
    );
    copyNativeProductMemberships(document, next, entityId, partId, {
      includeQuantities: false,
    });
    partIds.push(partId);
  }

  let splitDocument = parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
  splitDocument = removeSpecificNativeProducts(splitDocument, [entityId]);
  return { document: splitDocument, partIds };
}

function resolveNativeCutLeaves(
  document: NativeIfcDocument,
  representationId: number,
  parentTransform: NativeAffineFrame,
  visited: Set<number>,
  depth: number,
): NativeCutLeaf[] | undefined {
  if (depth > 12 || visited.has(representationId)) {
    return undefined;
  }
  const representation = document.entityById.get(representationId);
  if (representation?.type !== "IFCSHAPEREPRESENTATION") {
    return undefined;
  }
  const nextVisited = new Set(visited);
  nextVisited.add(representationId);
  const result: NativeCutLeaf[] = [];
  for (const itemId of readReferences(representation.args[3] ?? "")) {
    const item = document.entityById.get(itemId);
    if (!item) {
      return undefined;
    }
    if (item.type === "IFCMAPPEDITEM") {
      const representationMap = document.entityById.get(
        readReferences(item.args[0] ?? "")[0],
      );
      const targetOperator = document.entityById.get(
        readReferences(item.args[1] ?? "")[0],
      );
      if (
        representationMap?.type !== "IFCREPRESENTATIONMAP" ||
        targetOperator?.type !== "IFCCARTESIANTRANSFORMATIONOPERATOR3D"
      ) {
        return undefined;
      }
      const mappedRepresentationId = readReferences(
        representationMap.args[1] ?? "",
      )[0];
      const mappingOrigin = readAxis2Placement3dFrame(
        document,
        readReferences(representationMap.args[0] ?? "")[0],
      );
      const target = readNativeTransformationOperator(
        document,
        targetOperator,
      );
      if (!mappedRepresentationId || !mappingOrigin || !target) {
        return undefined;
      }
      const mappingOriginFrame: NativeAffineFrame = {
        ...mappingOrigin,
        scale: 1,
      };
      const mappedTransform = composeNativeAffineFrames(
        parentTransform,
        composeNativeAffineFrames(
          target,
          invertNativeAffineFrame(mappingOriginFrame),
        ),
      );
      const nested = resolveNativeCutLeaves(
        document,
        mappedRepresentationId,
        mappedTransform,
        nextVisited,
        depth + 1,
      );
      if (!nested) {
        return undefined;
      }
      result.push(...nested);
      continue;
    }
    if (!IFC_BOOLEAN_OPERAND_TYPES.has(item.type)) {
      return undefined;
    }
    result.push({
      contextRef: representation.args[0],
      itemId,
      transform: parentTransform,
    });
  }
  return result.length ? result : undefined;
}

function readNativeTransformationOperator(
  document: NativeIfcDocument,
  operator: NativeIfcEntity,
): NativeAffineFrame | undefined {
  const point = document.entityById.get(readReferences(operator.args[2] ?? "")[0]);
  if (point?.type !== "IFCCARTESIANPOINT") {
    return undefined;
  }
  const [x, y, z] = parseCoordinateTuple(point.args[0]);
  const xAxis = readDirectionVector(document, operator.args[0], {
    x: 1,
    y: 0,
    z: 0,
  });
  const yAxis = readDirectionVector(document, operator.args[1], {
    x: 0,
    y: 1,
    z: 0,
  });
  const zAxis = readDirectionVector(document, operator.args[4],
    normalizeDirection(crossVectors(xAxis, yAxis), { x: 0, y: 0, z: 1 }),
  );
  const scale = readStepNumber(operator.args[3]) ?? 1;
  if (!Number.isFinite(scale) || Math.abs(scale) < 0.000001) {
    return undefined;
  }
  return { origin: { x, y, z }, scale, xAxis, yAxis, zAxis };
}

function transformNativeAffinePoint(
  frame: NativeAffineFrame,
  point: NativeVector3,
): NativeVector3 {
  const rotated = transformFramePoint(frame, point);
  return {
    x: frame.origin.x + (rotated.x - frame.origin.x) * frame.scale,
    y: frame.origin.y + (rotated.y - frame.origin.y) * frame.scale,
    z: frame.origin.z + (rotated.z - frame.origin.z) * frame.scale,
  };
}

function transformNativeAffineDirection(
  frame: NativeAffineFrame,
  direction: NativeVector3,
): NativeVector3 {
  const rotated = rotateFrameDirection(frame, direction);
  return {
    x: rotated.x * frame.scale,
    y: rotated.y * frame.scale,
    z: rotated.z * frame.scale,
  };
}

function composeNativeAffineFrames(
  parent: NativeAffineFrame,
  child: NativeAffineFrame,
): NativeAffineFrame {
  return {
    origin: transformNativeAffinePoint(parent, child.origin),
    scale: parent.scale * child.scale,
    xAxis: normalizeDirection(
      transformNativeAffineDirection(parent, child.xAxis),
      { x: 1, y: 0, z: 0 },
    ),
    yAxis: normalizeDirection(
      transformNativeAffineDirection(parent, child.yAxis),
      { x: 0, y: 1, z: 0 },
    ),
    zAxis: normalizeDirection(
      transformNativeAffineDirection(parent, child.zAxis),
      { x: 0, y: 0, z: 1 },
    ),
  };
}

function invertNativeAffineFrame(frame: NativeAffineFrame): NativeAffineFrame {
  const inverseScale = 1 / frame.scale;
  const xAxis = {
    x: frame.xAxis.x,
    y: frame.yAxis.x,
    z: frame.zAxis.x,
  };
  const yAxis = {
    x: frame.xAxis.y,
    y: frame.yAxis.y,
    z: frame.zAxis.y,
  };
  const zAxis = {
    x: frame.xAxis.z,
    y: frame.yAxis.z,
    z: frame.zAxis.z,
  };
  const inverseRotation: NativePlacementFrame = {
    origin: { x: 0, y: 0, z: 0 },
    xAxis,
    yAxis,
    zAxis,
  };
  const rotatedOrigin = rotateFrameDirection(inverseRotation, frame.origin);
  return {
    origin: {
      x: -rotatedOrigin.x * inverseScale,
      y: -rotatedOrigin.y * inverseScale,
      z: -rotatedOrigin.z * inverseScale,
    },
    scale: inverseScale,
    xAxis,
    yAxis,
    zAxis,
  };
}

function perpendicularDirection(normal: NativeVector3): NativeVector3 {
  const helper =
    Math.abs(normal.z) < 0.9
      ? { x: 0, y: 0, z: 1 }
      : { x: 0, y: 1, z: 0 };
  return normalizeDirection(crossVectors(helper, normal), {
    x: 1,
    y: 0,
    z: 0,
  });
}

/**
 * Führt die Body-Repräsentationen mehrerer Produkte in einem neuen IFC-
 * Produkt zusammen. IFCMAPPEDITEM bewahrt dabei für jedes Teil seine eigene
 * Welttransformation und funktioniert auch mit voneinander getrennten Körpern.
 */
export function combineNativeBodyElements(
  document: NativeIfcDocument,
  requestedEntityIds: Iterable<number>,
  options: NativeBodyCombineOptions = {},
): NativeBodyCombineResult | undefined {
  const sourceIds = unique([...requestedEntityIds]);
  if (sourceIds.length < 2) {
    return undefined;
  }

  const sources = sourceIds.map((id) => {
    const product = document.entityById.get(id);
    const placement = getNativePlacement(document, id);
    const frame = getNativePlacementWorldFrame(document, id);
    const body = getNativeBodyRepresentation(document, id);
    const representation = body.bodyRepresentationId
      ? document.entityById.get(body.bodyRepresentationId)
      : undefined;
    return { body, frame, placement, product, representation };
  });
  if (
    sources.some(
      ({ body, frame, placement, product, representation }) =>
        !product ||
        !isPhysicalProduct(product.type) ||
        !placement ||
        !frame ||
        !body.hasRepresentation ||
        representation?.type !== "IFCSHAPEREPRESENTATION",
    )
  ) {
    return undefined;
  }

  const primary = sources[0];
  const primaryProduct = primary.product as NativeIfcEntity;
  const primaryPlacement = primary.placement as NativePlacementSummary;
  const primaryFrame = primary.frame as NativeWorldPlacementFrame;
  const primaryPlacementEntity = document.entityById.get(
    primaryPlacement.placementId,
  );
  const primaryAxis = document.entityById.get(
    primaryPlacement.axisPlacementId,
  );
  const primaryPoint = document.entityById.get(primaryPlacement.pointId);
  if (
    primaryPlacementEntity?.type !== "IFCLOCALPLACEMENT" ||
    primaryAxis?.type !== "IFCAXIS2PLACEMENT3D" ||
    primaryPoint?.type !== "IFCCARTESIANPOINT"
  ) {
    return undefined;
  }

  const next = cloneDocumentEntities(document);
  let nextId = nextEntityId(next);
  const allocateId = () => nextId++;
  const productId = allocateId();
  const placementId = allocateId();
  const placementAxisId = allocateId();
  const placementPointId = allocateId();
  const mapOriginId = allocateId();
  const mapOriginPointId = allocateId();
  const shapeId = allocateId();
  const representationId = allocateId();
  const mappedItemIds: number[] = [];
  const mappedEntities: NativeIfcEntity[] = [];

  for (const source of sources) {
    const sourceFrame = source.frame as NativeWorldPlacementFrame;
    const sourceRepresentation = source.representation as NativeIfcEntity;
    const axis1 = directionInPlacementFrame(primaryFrame, sourceFrame.xAxis);
    const axis2 = directionInPlacementFrame(primaryFrame, sourceFrame.yAxis);
    const axis3 = directionInPlacementFrame(primaryFrame, sourceFrame.zAxis);
    const translation = pointInPlacementFrame(
      primaryFrame,
      sourceFrame.origin,
    );
    const axis1Id = allocateId();
    const axis2Id = allocateId();
    const axis3Id = allocateId();
    const originId = allocateId();
    const operatorId = allocateId();
    const mapId = allocateId();
    const mappedItemId = allocateId();
    mappedItemIds.push(mappedItemId);
    mappedEntities.push(
      createDirectionEntity(axis1Id, axis1),
      createDirectionEntity(axis2Id, axis2),
      createDirectionEntity(axis3Id, axis3),
      {
        args: [
          `(${formatDecimal(translation.x)},${formatDecimal(translation.y)},${formatDecimal(translation.z)})`,
        ],
        description: "",
        globalId: "",
        id: originId,
        name: "",
        type: "IFCCARTESIANPOINT",
      },
      {
        args: [
          `#${axis1Id}`,
          `#${axis2Id}`,
          `#${originId}`,
          "1.",
          `#${axis3Id}`,
        ],
        description: "",
        globalId: "",
        id: operatorId,
        name: "",
        type: "IFCCARTESIANTRANSFORMATIONOPERATOR3D",
      },
      {
        args: [`#${mapOriginId}`, `#${sourceRepresentation.id}`],
        description: "",
        globalId: "",
        id: mapId,
        name: "",
        type: "IFCREPRESENTATIONMAP",
      },
      {
        args: [`#${mapId}`, `#${operatorId}`],
        description: "",
        globalId: "",
        id: mappedItemId,
        name: "",
        type: "IFCMAPPEDITEM",
      },
    );
  }

  const combinedName =
    options.name?.trim() || `${primaryProduct.name || "Objekt"} – kombiniert`;
  const combinedProduct: NativeIfcEntity = {
    ...primaryProduct,
    args: [...primaryProduct.args],
    globalId: createIfcGuid(productId),
    id: productId,
    name: combinedName,
  };
  setArg(combinedProduct.args, 0, quote(combinedProduct.globalId));
  setArg(combinedProduct.args, 2, quote(combinedName));
  setArg(combinedProduct.args, 5, `#${placementId}`);
  setArg(combinedProduct.args, 6, `#${shapeId}`);
  if (combinedProduct.args.length > 7) {
    setArg(combinedProduct.args, 7, quote(`IFCNATIVE-COMBINE-${productId}`));
  }
  const contextRef = (primary.representation as NativeIfcEntity).args[0];

  next.push(
    combinedProduct,
    {
      ...primaryPlacementEntity,
      args: [...primaryPlacementEntity.args],
      id: placementId,
    },
    {
      ...primaryAxis,
      args: [...primaryAxis.args],
      id: placementAxisId,
    },
    {
      ...primaryPoint,
      args: [...primaryPoint.args],
      id: placementPointId,
    },
    {
      args: [`#${mapOriginPointId}`, "$", "$"],
      description: "",
      globalId: "",
      id: mapOriginId,
      name: "",
      type: "IFCAXIS2PLACEMENT3D",
    },
    {
      args: ["(0.,0.,0.)"],
      description: "",
      globalId: "",
      id: mapOriginPointId,
      name: "",
      type: "IFCCARTESIANPOINT",
    },
    {
      args: ["$", "$", `(#${representationId})`],
      description: "",
      globalId: "",
      id: shapeId,
      name: "",
      type: "IFCPRODUCTDEFINITIONSHAPE",
    },
    {
      args: [
        contextRef,
        quote("Body"),
        quote("MappedRepresentation"),
        `(${mappedItemIds.map((id) => `#${id}`).join(",")})`,
      ],
      description: "",
      globalId: "",
      id: representationId,
      name: "Body",
      type: "IFCSHAPEREPRESENTATION",
    },
    ...mappedEntities,
  );
  const nextPlacement = next.find((entity) => entity.id === placementId);
  const nextAxis = next.find((entity) => entity.id === placementAxisId);
  if (!nextPlacement || !nextAxis) {
    return undefined;
  }
  setArg(nextPlacement.args, 1, `#${placementAxisId}`);
  setArg(nextAxis.args, 0, `#${placementPointId}`);

  // Der primäre Datensatz bestimmt Klassifikation/Metadaten des neuen Teils.
  // Mengen werden nicht blind übernommen, da sie bei beliebigen Freiform-
  // Geometrien nicht zuverlässig addiert werden können.
  copyNativeProductMemberships(document, next, sourceIds[0], productId, {
    includeQuantities: false,
  });

  let combinedDocument = parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
  if (options.removeSources !== false) {
    combinedDocument = removeSpecificNativeProducts(
      combinedDocument,
      sourceIds,
    );
  }
  return { document: combinedDocument, productId, sourceIds };
}

function nativeBodyFootprintArea(body: NativeBodyRepresentationSummary) {
  if (body.profile === "cylinder" && body.radius !== undefined) {
    return circleAreaStepNumber(formatDecimal(body.radius));
  }
  return multiplyStepNumbers(
    formatDecimal(body.width ?? 0),
    formatDecimal(body.depth ?? 0),
  );
}

function hasNativeBodyQuantities(
  document: NativeIfcDocument,
  entityId: number,
) {
  return Boolean(
    document.propertySetsByEntity
      .get(entityId)
      ?.some(
        (set) =>
          set.kind === "Qto" && set.name === "IFCnative_BaseQuantities",
      ),
  );
}

function appendNativeBodyQuantities(
  entities: NativeIfcEntity[],
  allocateId: () => number,
  productId: number,
  footprintArea: string,
  height: string,
) {
  const quantityId = allocateId();
  const heightQuantityId = allocateId();
  const areaQuantityId = allocateId();
  const volumeQuantityId = allocateId();
  const relationshipId = allocateId();
  entities.push(
    {
      args: [
        quote(createIfcGuid(quantityId)),
        "$",
        quote("IFCnative_BaseQuantities"),
        "$",
        quote("SplitBodyQuantities"),
        `(#${heightQuantityId},#${areaQuantityId},#${volumeQuantityId})`,
      ],
      description: "",
      globalId: createIfcGuid(quantityId),
      id: quantityId,
      name: "IFCnative_BaseQuantities",
      type: "IFCELEMENTQUANTITY",
    },
    {
      args: [quote("Height"), "$", "$", height, "$"],
      description: "",
      globalId: "",
      id: heightQuantityId,
      name: "Height",
      type: "IFCQUANTITYLENGTH",
    },
    {
      args: [quote("FootprintArea"), "$", "$", footprintArea, "$"],
      description: "",
      globalId: "",
      id: areaQuantityId,
      name: "FootprintArea",
      type: "IFCQUANTITYAREA",
    },
    {
      args: [
        quote("NetVolume"),
        "$",
        "$",
        multiplyStepNumbers(footprintArea, height),
        "$",
      ],
      description: "",
      globalId: "",
      id: volumeQuantityId,
      name: "NetVolume",
      type: "IFCQUANTITYVOLUME",
    },
    {
      args: [
        quote(createIfcGuid(relationshipId)),
        "$",
        "$",
        "$",
        `(#${productId})`,
        `#${quantityId}`,
      ],
      description: "",
      globalId: createIfcGuid(relationshipId),
      id: relationshipId,
      name: "",
      type: "IFCRELDEFINESBYPROPERTIES",
    },
  );
}

function copyNativeProductMemberships(
  document: NativeIfcDocument,
  entities: NativeIfcEntity[],
  sourceId: number,
  targetId: number,
  options: { includeQuantities: boolean },
) {
  for (const relationship of document.relationshipsByEntity.get(sourceId) ??
    []) {
    const relationshipEntity = entities.find(
      (entity) => entity.id === relationship.id,
    );
    if (!relationshipEntity) {
      continue;
    }
    if (
      (relationship.type === "IFCRELAGGREGATES" ||
        relationship.type === "IFCRELNESTS") &&
      relationship.targetIds.includes(sourceId)
    ) {
      relationshipEntity.args[5] = appendStepReference(
        relationshipEntity.args[5],
        targetId,
      );
      continue;
    }
    if (
      (relationship.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE" ||
        relationship.type === "IFCRELREFERENCEDINSPATIALSTRUCTURE") &&
      relationship.targetIds.includes(sourceId)
    ) {
      relationshipEntity.args[4] = appendStepReference(
        relationshipEntity.args[4],
        targetId,
      );
      continue;
    }
    if (
      !relationship.sourceIds.includes(sourceId) ||
      !(
        relationship.type.startsWith("IFCRELDEFINES") ||
        relationship.type.startsWith("IFCRELASSOCIATES") ||
        relationship.type.startsWith("IFCRELASSIGNS")
      )
    ) {
      continue;
    }
    if (!options.includeQuantities) {
      const relatedDefinition = relationship.targetIds
        .map((id) => document.entityById.get(id))
        .find((entity) => entity?.type === "IFCELEMENTQUANTITY");
      if (relatedDefinition) {
        continue;
      }
    }
    relationshipEntity.args[4] = appendStepReference(
      relationshipEntity.args[4],
      targetId,
    );
  }
}

function appendStepReference(value: string | undefined, id: number) {
  const ids = unique([...readReferences(value ?? ""), id]);
  return `(${ids.map((item) => `#${item}`).join(",")})`;
}

function directionInPlacementFrame(
  frame: NativeWorldPlacementFrame,
  direction: NativeVector3,
): NativeVector3 {
  return normalizeDirection(
    {
      x: dotVectors(direction, frame.xAxis),
      y: dotVectors(direction, frame.yAxis),
      z: dotVectors(direction, frame.zAxis),
    },
    { x: 1, y: 0, z: 0 },
  );
}

function pointInPlacementFrame(
  frame: NativeWorldPlacementFrame,
  point: NativeVector3,
): NativeVector3 {
  const delta = {
    x: point.x - frame.origin.x,
    y: point.y - frame.origin.y,
    z: point.z - frame.origin.z,
  };
  return {
    x: dotVectors(delta, frame.xAxis),
    y: dotVectors(delta, frame.yAxis),
    z: dotVectors(delta, frame.zAxis),
  };
}

function createDirectionEntity(
  id: number,
  value: NativeVector3,
): NativeIfcEntity {
  return {
    args: [formatDirectionTuple(value)],
    description: "",
    globalId: "",
    id,
    name: "",
    type: "IFCDIRECTION",
  };
}

/** Entfernt nur die verbrauchten Produkte, nicht deren Hierarchie-Kinder. */
function removeSpecificNativeProducts(
  document: NativeIfcDocument,
  productIds: Iterable<number>,
) {
  const removedIds = new Set(
    [...productIds].filter((id) => document.entityById.has(id)),
  );
  const survivors: NativeIfcEntity[] = [];
  for (const current of cloneDocumentEntities(document)) {
    if (removedIds.has(current.id)) {
      continue;
    }
    if (
      current.type.startsWith("IFCREL") &&
      pruneRelationshipMembers(current, removedIds) === "drop"
    ) {
      removedIds.add(current.id);
      continue;
    }
    survivors.push(current);
  }
  collectOrphanedResources(document, survivors, removedIds);
  return parseNativeIfcText(
    serializeEntities(
      document,
      survivors.filter((entity) => !removedIds.has(entity.id)),
    ),
    document.fileName,
  );
}

export function addNativeRelationship(
  document: NativeIfcDocument,
  type: string,
  sourceId: number,
  targetId: number,
) {
  const relationshipType = normalizeType(type);
  const next = cloneDocumentEntities(document);
  const id = nextEntityId(next);
  const source = `#${sourceId}`;
  const target = `(#${targetId})`;
  const args =
    relationshipType === "IFCRELCONTAINEDINSPATIALSTRUCTURE"
      ? [quote(createIfcGuid(id)), "$", "$", "$", target, source]
      : relationshipType === "IFCRELASSIGNSTOGROUP"
        ? [
            quote(createIfcGuid(id)),
            "$",
            "$",
            "$",
            `(#${sourceId})`,
            "$",
            `#${targetId}`,
          ]
        : relationshipType === "IFCRELASSOCIATESCONSTRAINT"
          ? [
              quote(createIfcGuid(id)),
              "$",
              "$",
              "$",
              `(#${sourceId})`,
              "$",
              `#${targetId}`,
            ]
          : relationshipType.startsWith("IFCRELASSOCIATES") ||
              relationshipType.startsWith("IFCRELASSIGNS")
            ? [
                quote(createIfcGuid(id)),
                "$",
                "$",
                "$",
                `(#${sourceId})`,
                `#${targetId}`,
              ]
            : [quote(createIfcGuid(id)), "$", "$", "$", source, target];
  next.push({
    args,
    description: "",
    globalId: createIfcGuid(id),
    id,
    name: "",
    type: relationshipType,
  });
  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export function addNativePropertySet(
  document: NativeIfcDocument,
  entityId: number,
  psetName: string,
  propertyName: string,
  propertyValue: string,
  propertyValueType = "IFCLABEL",
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const propertyId = getNextNativeEntityId(document);
  const property = createNativePropertyEntity(
    propertyId,
    propertyName,
    propertyValue,
    propertyValueType,
  );
  const psetId = propertyId + 1;
  const pset: NativeIfcEntity = {
    args: [
      quote(createIfcGuid(psetId)),
      "$",
      quote(psetName),
      "$",
      `(#${propertyId})`,
    ],
    description: "",
    globalId: createIfcGuid(psetId),
    id: psetId,
    name: psetName,
    type: "IFCPROPERTYSET",
  };
  const relId = psetId + 1;
  const relationship: NativeIfcEntity = {
    args: [
      quote(createIfcGuid(relId)),
      "$",
      "$",
      "$",
      `(#${entityId})`,
      `#${psetId}`,
    ],
    description: "",
    globalId: createIfcGuid(relId),
    id: relId,
    name: "",
    type: "IFCRELDEFINESBYPROPERTIES",
  };
  return appendNativeEntities(document, [property, pset, relationship]);
}

export function addNativePropertySetValues(
  document: NativeIfcDocument,
  entityId: number,
  psetName: string,
  properties: Array<{ name: string; value: string; valueType?: string }>,
) {
  if (!document.entityById.has(entityId) || properties.length === 0) {
    return document;
  }
  const next: NativeIfcEntity[] = [];
  const propertyIds: number[] = [];
  let nextId = getNextNativeEntityId(document);
  for (const property of properties) {
    const propertyId = nextId++;
    propertyIds.push(propertyId);
    next.push(
      createNativePropertyEntity(
        propertyId,
        property.name,
        property.value,
        property.valueType ?? "IFCLABEL",
      ),
    );
  }
  const psetId = nextId++;
  next.push({
    args: [
      quote(createIfcGuid(psetId)),
      "$",
      quote(psetName),
      "$",
      `(${propertyIds.map((id) => `#${id}`).join(",")})`,
    ],
    description: "",
    globalId: createIfcGuid(psetId),
    id: psetId,
    name: psetName,
    type: "IFCPROPERTYSET",
  });
  const relId = nextId++;
  next.push({
    args: [
      quote(createIfcGuid(relId)),
      "$",
      "$",
      "$",
      `(#${entityId})`,
      `#${psetId}`,
    ],
    description: "",
    globalId: createIfcGuid(relId),
    id: relId,
    name: "",
    type: "IFCRELDEFINESBYPROPERTIES",
  });
  return appendNativeEntities(document, next);
}

export function mergeNativePropertySetValues(
  document: NativeIfcDocument,
  entityId: number,
  psetName: string,
  properties: Array<{ name: string; value: string; valueType?: string }>,
) {
  if (!document.entityById.has(entityId) || properties.length === 0) {
    return document;
  }
  const normalizeName = (value: string) => value.trim().toLocaleLowerCase();
  const psetToken = normalizeName(psetName);
  const existingSet = (document.propertySetsByEntity.get(entityId) ?? []).find(
    (set) => normalizeName(set.name) === psetToken,
  );
  const uniqueProperties = properties.filter((property, index, all) => {
    const token = normalizeName(property.name);
    return (
      token !== "" &&
      all.findIndex((candidate) => normalizeName(candidate.name) === token) ===
        index
    );
  });
  if (!existingSet) {
    return addNativePropertySetValues(
      document,
      entityId,
      psetName,
      uniqueProperties,
    );
  }

  const existingNames = new Set(
    existingSet.values.map((property) => normalizeName(property.name)),
  );
  let next = document;
  for (const property of uniqueProperties) {
    const token = normalizeName(property.name);
    if (existingNames.has(token)) {
      continue;
    }
    next = addNativePropertyToSet(
      next,
      existingSet.id,
      property.name,
      property.value,
      property.valueType ?? "IFCLABEL",
    );
    existingNames.add(token);
  }
  return next;
}

export function addNativeEmptyPropertySet(
  document: NativeIfcDocument,
  entityId: number,
  psetName: string,
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const psetId = getNextNativeEntityId(document);
  const pset: NativeIfcEntity = {
    args: [quote(createIfcGuid(psetId)), "$", quote(psetName), "$", "()"],
    description: "",
    globalId: createIfcGuid(psetId),
    id: psetId,
    name: psetName,
    type: "IFCPROPERTYSET",
  };
  const relId = psetId + 1;
  const relationship: NativeIfcEntity = {
    args: [
      quote(createIfcGuid(relId)),
      "$",
      "$",
      "$",
      `(#${entityId})`,
      `#${psetId}`,
    ],
    description: "",
    globalId: createIfcGuid(relId),
    id: relId,
    name: "",
    type: "IFCRELDEFINESBYPROPERTIES",
  };
  return appendNativeEntities(document, [pset, relationship]);
}

export function addNativePropertyToSet(
  document: NativeIfcDocument,
  setId: number,
  propertyName: string,
  propertyValue: string,
  propertyValueType = "IFCLABEL",
) {
  const set = document.entityById.get(setId);
  if (
    !set ||
    (set.type !== "IFCPROPERTYSET" && set.type !== "IFCELEMENTQUANTITY")
  ) {
    return document;
  }
  const propertyId = getNextNativeEntityId(document);
  const updatedSet: NativeIfcEntity = { ...set, args: [...set.args] };
  let property: NativeIfcEntity;
  if (set.type === "IFCELEMENTQUANTITY") {
    const quantityType = normalizeQuantityType(propertyValueType);
    property = {
      args: [
        quote(propertyName),
        "$",
        "$",
        formatStepNumber(propertyValue),
        "$",
      ],
      description: "",
      globalId: "",
      id: propertyId,
      name: propertyName,
      type: quantityType,
    };
    appendReference(updatedSet.args, 5, propertyId);
  } else {
    property = createNativePropertyEntity(
      propertyId,
      propertyName,
      propertyValue,
      propertyValueType,
    );
    appendReference(updatedSet.args, 4, propertyId);
  }
  return updatePropertySetSummaries(
    appendNativeEntities(replaceNativeEntities(document, [updatedSet]), [
      property,
    ]),
    setId,
  );
}

export function removeNativePropertyFromSet(
  document: NativeIfcDocument,
  setId: number,
  propertyId: number,
) {
  const set = document.entityById.get(setId);
  if (
    !set ||
    (set.type !== "IFCPROPERTYSET" && set.type !== "IFCELEMENTQUANTITY")
  ) {
    return document;
  }

  const refIndex = set.type === "IFCELEMENTQUANTITY" ? 5 : 4;
  const currentRefs = readReferences(set.args[refIndex]);
  if (!currentRefs.includes(propertyId)) {
    return document;
  }

  const next = cloneDocumentEntities(document);
  const updatedSet = next.find((entity) => entity.id === setId);
  if (!updatedSet) {
    return document;
  }

  setArg(
    updatedSet.args,
    refIndex,
    formatReferenceList(currentRefs.filter((id) => id !== propertyId)),
  );

  const removeProperty = !hasIncomingReferenceExcept(
    document,
    propertyId,
    setId,
  );
  const nextEntities = removeProperty
    ? next.filter((entity) => entity.id !== propertyId)
    : next;

  return parseNativeIfcText(
    serializeEntities(document, nextEntities),
    document.fileName,
  );
}

export function updateNativePropertySetName(
  document: NativeIfcDocument,
  setId: number,
  name: string,
) {
  const set = document.entityById.get(setId);
  if (
    !set ||
    (set.type !== "IFCPROPERTYSET" && set.type !== "IFCELEMENTQUANTITY")
  ) {
    return document;
  }

  const updatedSet: NativeIfcEntity = { ...set, args: [...set.args] };
  updatedSet.name = name.trim();
  setArg(updatedSet.args, 2, quoteOrDollar(name));

  return updatePropertySetSummaries(
    replaceNativeEntities(document, [updatedSet]),
    setId,
  );
}

export function duplicateNativePropertySet(
  document: NativeIfcDocument,
  entityId: number,
  setId: number,
  name?: string,
) {
  const set = document.entityById.get(setId);
  if (
    !document.entityById.has(entityId) ||
    !set ||
    (set.type !== "IFCPROPERTYSET" && set.type !== "IFCELEMENTQUANTITY")
  ) {
    return document;
  }

  const refIndex = set.type === "IFCELEMENTQUANTITY" ? 5 : 4;
  let nextId = getNextNativeEntityId(document);
  const copiedValueIds: number[] = [];
  const copiedEntities: NativeIfcEntity[] = [];
  for (const valueId of readReferences(set.args[refIndex])) {
    const value = document.entityById.get(valueId);
    if (!value) {
      continue;
    }
    const copiedId = nextId++;
    copiedValueIds.push(copiedId);
    copiedEntities.push({
      ...value,
      args: [...value.args],
      globalId: "",
      id: copiedId,
    });
  }

  const copiedSetId = nextId++;
  const copiedName = name?.trim() || `${set.name || `#${set.id}`} Copy`;
  const copiedSet: NativeIfcEntity = {
    ...set,
    args: [...set.args],
    globalId: createIfcGuid(copiedSetId),
    id: copiedSetId,
    name: copiedName,
  };
  setArg(copiedSet.args, 0, quote(createIfcGuid(copiedSetId)));
  setArg(copiedSet.args, 2, quoteOrDollar(copiedName));
  setArg(copiedSet.args, refIndex, formatReferenceList(copiedValueIds));

  const relationshipId = nextId++;
  const relationship: NativeIfcEntity = {
    args: [
      quote(createIfcGuid(relationshipId)),
      "$",
      "$",
      "$",
      `(#${entityId})`,
      `#${copiedSetId}`,
    ],
    description: "",
    globalId: createIfcGuid(relationshipId),
    id: relationshipId,
    name: "",
    type: "IFCRELDEFINESBYPROPERTIES",
  };

  return appendNativeEntities(document, [
    ...copiedEntities,
    copiedSet,
    relationship,
  ]);
}

export function removeNativePropertySet(
  document: NativeIfcDocument,
  entityId: number,
  setId: number,
) {
  const set = document.entityById.get(setId);
  if (
    !document.entityById.has(entityId) ||
    !set ||
    (set.type !== "IFCPROPERTYSET" && set.type !== "IFCELEMENTQUANTITY")
  ) {
    return document;
  }

  const next = cloneDocumentEntities(document);
  const removedIds = new Set<number>();
  let changed = false;

  for (const relationship of next) {
    if (relationship.type !== "IFCRELDEFINESBYPROPERTIES") {
      continue;
    }
    if (!readReferences(relationship.args[5]).includes(setId)) {
      continue;
    }
    const objectIds = readReferences(relationship.args[4]);
    if (!objectIds.includes(entityId)) {
      continue;
    }
    const remainingObjectIds = objectIds.filter((id) => id !== entityId);
    if (remainingObjectIds.length > 0) {
      setArg(relationship.args, 4, formatReferenceList(remainingObjectIds));
    } else {
      removedIds.add(relationship.id);
    }
    changed = true;
  }

  if (!changed) {
    return document;
  }

  const setStillReferenced = next.some(
    (entity) =>
      !removedIds.has(entity.id) &&
      entity.type === "IFCRELDEFINESBYPROPERTIES" &&
      readReferences(entity.args[5]).includes(setId),
  );
  if (!setStillReferenced) {
    removedIds.add(setId);
    const refIndex = set.type === "IFCELEMENTQUANTITY" ? 5 : 4;
    for (const propertyId of readReferences(set.args[refIndex])) {
      if (!hasIncomingReferenceExcept(document, propertyId, setId)) {
        removedIds.add(propertyId);
      }
    }
  }

  return parseNativeIfcText(
    serializeEntities(
      document,
      next.filter((entity) => !removedIds.has(entity.id)),
    ),
    document.fileName,
  );
}

export function addNativeQuantitySet(
  document: NativeIfcDocument,
  entityId: number,
  qtoName: string,
  quantityName: string,
  quantityValue: string,
  quantityType = "IFCQUANTITYLENGTH",
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const normalizedQuantityType = normalizeQuantityType(quantityType);
  const quantityId = getNextNativeEntityId(document);
  const quantity: NativeIfcEntity = {
    args: [quote(quantityName), "$", "$", formatStepNumber(quantityValue), "$"],
    description: "",
    globalId: "",
    id: quantityId,
    name: quantityName,
    type: normalizedQuantityType,
  };
  const qtoId = quantityId + 1;
  const quantitySet: NativeIfcEntity = {
    args: [
      quote(createIfcGuid(qtoId)),
      "$",
      quote(qtoName),
      "$",
      "IFCnative",
      `(#${quantityId})`,
    ],
    description: "",
    globalId: createIfcGuid(qtoId),
    id: qtoId,
    name: qtoName,
    type: "IFCELEMENTQUANTITY",
  };
  const relId = qtoId + 1;
  const relationship: NativeIfcEntity = {
    args: [
      quote(createIfcGuid(relId)),
      "$",
      "$",
      "$",
      `(#${entityId})`,
      `#${qtoId}`,
    ],
    description: "",
    globalId: createIfcGuid(relId),
    id: relId,
    name: "",
    type: "IFCRELDEFINESBYPROPERTIES",
  };
  return appendNativeEntities(document, [quantity, quantitySet, relationship]);
}

export function updateNativePropertyValue(
  document: NativeIfcDocument,
  propertyId: number,
  updates: { name?: string; value?: string; valueType?: string },
) {
  const property = document.entityById.get(propertyId);
  if (
    !property ||
    (!SIMPLE_PROPERTY_ENTITY_TYPES.has(property.type) &&
      !isQuantityType(property.type))
  ) {
    return document;
  }

  const updatedProperty: NativeIfcEntity = {
    ...property,
    args: [...property.args],
  };

  if (updates.name != null) {
    setArg(updatedProperty.args, 0, quoteOrDollar(updates.name));
    updatedProperty.name = updates.name;
  }
  if (updates.value != null) {
    if (isQuantityType(updatedProperty.type)) {
      updatedProperty.type = normalizeQuantityType(
        updates.valueType ?? updatedProperty.type,
      );
      setArg(updatedProperty.args, 3, formatStepNumber(updates.value));
    } else {
      const propertyValueType =
        updates.valueType ?? readPropertyValueTypeSpec(updatedProperty);
      const nextProperty = createNativePropertyEntity(
        updatedProperty.id,
        updatedProperty.name,
        updates.value,
        propertyValueType,
      );
      updatedProperty.type = nextProperty.type;
      updatedProperty.args = nextProperty.args;
    }
  }

  return updatePropertySetSummariesContainingValue(
    replaceNativeEntities(document, [updatedProperty]),
    propertyId,
  );
}

function createNativePropertyEntity(
  id: number,
  propertyName: string,
  propertyValue: string,
  propertyValueType = "IFCLABEL",
): NativeIfcEntity {
  const spec = parsePropertyValueTypeSpec(propertyValueType);
  const name = propertyName.trim();
  return {
    args: formatPropertyEntityArgs(name, propertyValue, spec),
    description: "",
    globalId: "",
    id,
    name,
    type: spec.entityType,
  };
}

export function addNativeMaterial(
  document: NativeIfcDocument,
  entityId: number,
  materialName: string,
  materialCategory = "",
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const materialId = getNextNativeEntityId(document);
  const relationshipId = materialId + 1;
  return appendNativeEntities(document, [
    createMaterialEntity(materialId, materialName, materialCategory),
    createAssociationEntity(
      relationshipId,
      entityId,
      materialId,
      "IFCRELASSOCIATESMATERIAL",
      "Material",
    ),
  ]);
}

export function addNativeMaterialWithProperties(
  document: NativeIfcDocument,
  entityId: number,
  materialName: string,
  materialCategory: string,
  propertySetName: string,
  propertyRows: string,
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const rows = parseMaterialPropertyRows(propertyRows, [
    { name: "MassDensity", value: "2400", valueType: "IFCREAL" },
    { name: "ThermalConductivity", value: "1.7", valueType: "IFCREAL" },
  ]);
  let nextId = getNextNativeEntityId(document);
  const added: NativeIfcEntity[] = [];
  const propertyIds: number[] = [];
  for (const row of rows) {
    const propertyId = nextId++;
    propertyIds.push(propertyId);
    added.push(
      createNativePropertyEntity(
        propertyId,
        row.name,
        row.value,
        row.valueType,
      ),
    );
  }
  const materialId = nextId++;
  const materialPropertiesId = nextId++;
  const relationshipId = nextId;
  const cleanPropertySetName = propertySetName.trim() || "Pset_MaterialCommon";
  added.push(createMaterialEntity(materialId, materialName, materialCategory));
  added.push({
    args: [
      quote(cleanPropertySetName),
      "$",
      formatReferenceList(propertyIds),
      `#${materialId}`,
    ],
    description: "",
    globalId: "",
    id: materialPropertiesId,
    name: cleanPropertySetName,
    type: "IFCMATERIALPROPERTIES",
  });
  added.push(
    createAssociationEntity(
      relationshipId,
      entityId,
      materialId,
      "IFCRELASSOCIATESMATERIAL",
      "Material",
    ),
  );
  return appendNativeEntities(document, added);
}

export function addNativeMaterialStyle(
  document: NativeIfcDocument,
  entityId: number,
  materialName: string,
  materialCategory: string,
  styleName: string,
  color: string,
  transparency = "0",
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  let nextId = getNextNativeEntityId(document);
  const materialId = nextId++;
  const colourId = nextId++;
  const renderingId = nextId++;
  const surfaceStyleId = nextId++;
  const styledItemId = nextId++;
  const styledRepresentationId = nextId++;
  const materialRepresentationId = nextId++;
  const relationshipId = nextId;
  const cleanMaterialName = materialName.trim() || "Styled Material";
  const cleanStyleName =
    styleName.trim() || `${cleanMaterialName} Surface Style`;
  const colorComponents = colorStepNumbers(color);
  const contextRef = `#${document.entities.find((entity) => entity.type === "IFCGEOMETRICREPRESENTATIONCONTEXT")?.id ?? 10}`;
  const added: NativeIfcEntity[] = [
    createMaterialEntity(materialId, cleanMaterialName, materialCategory),
    {
      args: [quote(`${cleanStyleName} Colour`), ...colorComponents],
      description: "",
      globalId: "",
      id: colourId,
      name: `${cleanStyleName} Colour`,
      type: "IFCCOLOURRGB",
    },
    {
      args: [
        `#${colourId}`,
        optionalRatioStepNumber(transparency),
        "$",
        "$",
        "$",
        "$",
        "$",
        "$",
        ".PHONG.",
      ],
      description: "",
      globalId: "",
      id: renderingId,
      name: `${cleanStyleName} Rendering`,
      type: "IFCSURFACESTYLERENDERING",
    },
    {
      args: [quote(cleanStyleName), ".BOTH.", `(#${renderingId})`],
      description: "",
      globalId: "",
      id: surfaceStyleId,
      name: cleanStyleName,
      type: "IFCSURFACESTYLE",
    },
    {
      args: ["$", `(#${surfaceStyleId})`, quote(cleanStyleName)],
      description: "",
      globalId: "",
      id: styledItemId,
      name: cleanStyleName,
      type: "IFCSTYLEDITEM",
    },
    {
      args: [
        contextRef,
        quote("Style"),
        quote("Material"),
        `(#${styledItemId})`,
      ],
      description: "",
      globalId: "",
      id: styledRepresentationId,
      name: cleanStyleName,
      type: "IFCSTYLEDREPRESENTATION",
    },
    {
      args: [
        quote(cleanStyleName),
        "$",
        `(#${styledRepresentationId})`,
        `#${materialId}`,
      ],
      description: "",
      globalId: "",
      id: materialRepresentationId,
      name: cleanStyleName,
      type: "IFCMATERIALDEFINITIONREPRESENTATION",
    },
    createAssociationEntity(
      relationshipId,
      entityId,
      materialId,
      "IFCRELASSOCIATESMATERIAL",
      "Material Style",
    ),
  ];
  return appendNativeEntities(document, added);
}

export function addNativeMaterialLayerSet(
  document: NativeIfcDocument,
  entityId: number,
  setName: string,
  layerRows: string,
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const rows = parseMaterialRows(layerRows, [
    {
      category: "LoadBearing",
      materialName: "Concrete",
      name: "Core",
      value: "0.2",
    },
    {
      category: "Insulation",
      materialName: "Insulation",
      name: "Insulation",
      value: "0.08",
    },
  ]);
  let nextId = getNextNativeEntityId(document);
  const added: NativeIfcEntity[] = [];
  const layerIds: number[] = [];
  for (const row of rows) {
    const materialId = nextId++;
    const layerId = nextId++;
    added.push(
      createMaterialEntity(materialId, row.materialName, row.category),
    );
    added.push({
      args: [
        `#${materialId}`,
        nonNegativeStepNumber(row.value, 0.05),
        "$",
        quoteOrDollar(row.name),
        "$",
        quoteOrDollar(row.category),
        "$",
      ],
      description: "",
      globalId: "",
      id: layerId,
      name: row.name,
      type: "IFCMATERIALLAYER",
    });
    layerIds.push(layerId);
  }
  const setId = nextId++;
  const cleanSetName = setName.trim() || "Layered Material Set";
  added.push({
    args: [formatReferenceList(layerIds), quote(cleanSetName), "$"],
    description: "",
    globalId: "",
    id: setId,
    name: cleanSetName,
    type: "IFCMATERIALLAYERSET",
  });
  added.push(
    createAssociationEntity(
      nextId,
      entityId,
      setId,
      "IFCRELASSOCIATESMATERIAL",
      "Material Layer Set",
    ),
  );
  return appendNativeEntities(document, added);
}

export function addNativeMaterialLayerSetUsage(
  document: NativeIfcDocument,
  entityId: number,
  setName: string,
  layerRows: string,
  direction: string,
  directionSense: string,
  offset: string,
  referenceExtent = "",
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const rows = parseMaterialRows(layerRows, [
    {
      category: "LoadBearing",
      materialName: "Concrete",
      name: "Core",
      value: "0.2",
    },
    {
      category: "Insulation",
      materialName: "Insulation",
      name: "Insulation",
      value: "0.08",
    },
  ]);
  let nextId = getNextNativeEntityId(document);
  const added: NativeIfcEntity[] = [];
  const layerIds: number[] = [];
  for (const row of rows) {
    const materialId = nextId++;
    const layerId = nextId++;
    added.push(
      createMaterialEntity(materialId, row.materialName, row.category),
    );
    added.push({
      args: [
        `#${materialId}`,
        nonNegativeStepNumber(row.value, 0.05),
        "$",
        quoteOrDollar(row.name),
        "$",
        quoteOrDollar(row.category),
        "$",
      ],
      description: "",
      globalId: "",
      id: layerId,
      name: row.name,
      type: "IFCMATERIALLAYER",
    });
    layerIds.push(layerId);
  }
  const setId = nextId++;
  const usageId = nextId++;
  const cleanSetName = setName.trim() || "Layered Material Usage";
  added.push({
    args: [formatReferenceList(layerIds), quote(cleanSetName), "$"],
    description: "",
    globalId: "",
    id: setId,
    name: cleanSetName,
    type: "IFCMATERIALLAYERSET",
  });
  added.push({
    args: [
      `#${setId}`,
      enumValue(direction || "AXIS2"),
      enumValue(directionSense || "POSITIVE"),
      numericStepNumber(offset, 0),
      optionalPositiveStepNumber(referenceExtent),
    ],
    description: "",
    globalId: "",
    id: usageId,
    name: `${cleanSetName} Usage`,
    type: "IFCMATERIALLAYERSETUSAGE",
  });
  added.push(
    createAssociationEntity(
      nextId,
      entityId,
      usageId,
      "IFCRELASSOCIATESMATERIAL",
      "Material Layer Set Usage",
    ),
  );
  return appendNativeEntities(document, added);
}

export function addNativeMaterialProfileSet(
  document: NativeIfcDocument,
  entityId: number,
  setName: string,
  profileName: string,
  materialName: string,
  category: string,
  width: string,
  depth: string,
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  let nextId = getNextNativeEntityId(document);
  const materialId = nextId++;
  const profileDefId = nextId++;
  const materialProfileId = nextId++;
  const setId = nextId++;
  const cleanSetName = setName.trim() || "Profile Material Set";
  const cleanProfileName = profileName.trim() || "Profile";
  const cleanMaterialName = materialName.trim() || "Profile Material";
  const cleanCategory = category.trim() || "LoadBearing";
  const added: NativeIfcEntity[] = [
    createMaterialEntity(materialId, cleanMaterialName, cleanCategory),
    {
      args: [
        ".AREA.",
        quote(cleanProfileName),
        "$",
        positiveStepNumber(width, 0.2),
        positiveStepNumber(depth, 0.2),
      ],
      description: "",
      globalId: "",
      id: profileDefId,
      name: cleanProfileName,
      type: "IFCRECTANGLEPROFILEDEF",
    },
    {
      args: [
        quote(cleanProfileName),
        "$",
        `#${materialId}`,
        `#${profileDefId}`,
        "$",
        quoteOrDollar(cleanCategory),
      ],
      description: "",
      globalId: "",
      id: materialProfileId,
      name: cleanProfileName,
      type: "IFCMATERIALPROFILE",
    },
    {
      args: [quote(cleanSetName), "$", `(#${materialProfileId})`, "$"],
      description: "",
      globalId: "",
      id: setId,
      name: cleanSetName,
      type: "IFCMATERIALPROFILESET",
    },
    createAssociationEntity(
      nextId,
      entityId,
      setId,
      "IFCRELASSOCIATESMATERIAL",
      "Material Profile Set",
    ),
  ];
  return appendNativeEntities(document, added);
}

export function addNativeMaterialProfileSetUsage(
  document: NativeIfcDocument,
  entityId: number,
  setName: string,
  profileName: string,
  materialName: string,
  category: string,
  width: string,
  depth: string,
  cardinalPoint: string,
  referenceExtent = "",
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  let nextId = getNextNativeEntityId(document);
  const materialId = nextId++;
  const profileDefId = nextId++;
  const materialProfileId = nextId++;
  const setId = nextId++;
  const usageId = nextId++;
  const cleanSetName = setName.trim() || "Profile Material Usage";
  const cleanProfileName = profileName.trim() || "Profile";
  const cleanMaterialName = materialName.trim() || "Profile Material";
  const cleanCategory = category.trim() || "LoadBearing";
  const added: NativeIfcEntity[] = [
    createMaterialEntity(materialId, cleanMaterialName, cleanCategory),
    {
      args: [
        ".AREA.",
        quote(cleanProfileName),
        "$",
        positiveStepNumber(width, 0.2),
        positiveStepNumber(depth, 0.2),
      ],
      description: "",
      globalId: "",
      id: profileDefId,
      name: cleanProfileName,
      type: "IFCRECTANGLEPROFILEDEF",
    },
    {
      args: [
        quote(cleanProfileName),
        "$",
        `#${materialId}`,
        `#${profileDefId}`,
        "$",
        quoteOrDollar(cleanCategory),
      ],
      description: "",
      globalId: "",
      id: materialProfileId,
      name: cleanProfileName,
      type: "IFCMATERIALPROFILE",
    },
    {
      args: [quote(cleanSetName), "$", `(#${materialProfileId})`, "$"],
      description: "",
      globalId: "",
      id: setId,
      name: cleanSetName,
      type: "IFCMATERIALPROFILESET",
    },
    {
      args: [
        `#${setId}`,
        optionalIntegerStepNumber(cardinalPoint),
        optionalPositiveStepNumber(referenceExtent),
      ],
      description: "",
      globalId: "",
      id: usageId,
      name: `${cleanSetName} Usage`,
      type: "IFCMATERIALPROFILESETUSAGE",
    },
    createAssociationEntity(
      nextId,
      entityId,
      usageId,
      "IFCRELASSOCIATESMATERIAL",
      "Material Profile Set Usage",
    ),
  ];
  return appendNativeEntities(document, added);
}

export function addNativeMaterialConstituentSet(
  document: NativeIfcDocument,
  entityId: number,
  setName: string,
  constituentRows: string,
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const rows = parseMaterialRows(constituentRows, [
    {
      category: "Frame",
      materialName: "Aluminium",
      name: "Frame",
      value: "0.6",
    },
    {
      category: "Glazing",
      materialName: "Glass",
      name: "Glazing",
      value: "0.4",
    },
  ]);
  let nextId = getNextNativeEntityId(document);
  const added: NativeIfcEntity[] = [];
  const constituentIds: number[] = [];
  for (const row of rows) {
    const materialId = nextId++;
    const constituentId = nextId++;
    added.push(
      createMaterialEntity(materialId, row.materialName, row.category),
    );
    added.push({
      args: [
        quoteOrDollar(row.name),
        "$",
        `#${materialId}`,
        optionalRatioStepNumber(row.value),
        quoteOrDollar(row.category),
      ],
      description: "",
      globalId: "",
      id: constituentId,
      name: row.name,
      type: "IFCMATERIALCONSTITUENT",
    });
    constituentIds.push(constituentId);
  }
  const setId = nextId++;
  const cleanSetName = setName.trim() || "Constituent Material Set";
  added.push({
    args: [quote(cleanSetName), "$", formatReferenceList(constituentIds)],
    description: "",
    globalId: "",
    id: setId,
    name: cleanSetName,
    type: "IFCMATERIALCONSTITUENTSET",
  });
  added.push(
    createAssociationEntity(
      nextId,
      entityId,
      setId,
      "IFCRELASSOCIATESMATERIAL",
      "Material Constituent Set",
    ),
  );
  return appendNativeEntities(document, added);
}

export function addNativeGroupAssignment(
  document: NativeIfcDocument,
  entityId: number,
  groupType: string,
  groupName: string,
  objectType = "",
  longName = "",
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const cleanGroupType = normalizeGroupType(groupType);
  const groupId = getNextNativeEntityId(document);
  const relationshipId = groupId + 1;
  const group = createGroupEntity(
    groupId,
    cleanGroupType,
    groupName,
    objectType,
    longName,
  );
  return appendNativeEntities(document, [
    group,
    createGroupAssignmentEntity(
      relationshipId,
      entityId,
      groupId,
      `${group.name || cleanGroupType} Assignment`,
    ),
  ]);
}

export function addNativeClassification(
  document: NativeIfcDocument,
  entityId: number,
  identification: string,
  name: string,
  location: string,
) {
  const next = cloneDocumentEntities(document);
  const classificationId = nextEntityId(next);
  next.push({
    args: [
      quoteOrDollar(location),
      quoteOrDollar(identification),
      quoteOrDollar(name),
      "$",
      "$",
      "$",
    ],
    description: "",
    globalId: "",
    id: classificationId,
    name,
    type: "IFCCLASSIFICATIONREFERENCE",
  });
  return addNativeAssociation(
    document,
    next,
    entityId,
    "IFCRELASSOCIATESCLASSIFICATION",
    "Classification",
    classificationId,
  );
}

export function addNativeDocumentReference(
  document: NativeIfcDocument,
  entityId: number,
  identification: string,
  name: string,
  location: string,
) {
  const next = cloneDocumentEntities(document);
  const documentId = nextEntityId(next);
  next.push({
    args: [
      quoteOrDollar(location),
      quoteOrDollar(identification),
      quoteOrDollar(name),
      "$",
      "$",
    ],
    description: "",
    globalId: "",
    id: documentId,
    name,
    type: "IFCDOCUMENTREFERENCE",
  });
  return addNativeAssociation(
    document,
    next,
    entityId,
    "IFCRELASSOCIATESDOCUMENT",
    "Document",
    documentId,
  );
}

export function addNativeLibraryReference(
  document: NativeIfcDocument,
  entityId: number,
  identification: string,
  name: string,
  location: string,
) {
  const next = cloneDocumentEntities(document);
  const libraryId = nextEntityId(next);
  next.push({
    args: [
      quoteOrDollar(location),
      quoteOrDollar(identification),
      quoteOrDollar(name),
      "$",
      "$",
      "$",
    ],
    description: "",
    globalId: "",
    id: libraryId,
    name,
    type: "IFCLIBRARYREFERENCE",
  });
  return addNativeAssociation(
    document,
    next,
    entityId,
    "IFCRELASSOCIATESLIBRARY",
    "Library",
    libraryId,
  );
}

export function addNativeApproval(
  document: NativeIfcDocument,
  entityId: number,
  identifier: string,
  name: string,
  status: string,
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const next = cloneDocumentEntities(document);
  const approvalId = nextEntityId(next);
  next.push({
    args: [
      quoteOrDollar(identifier),
      quoteOrDollar(name),
      "$",
      "$",
      quoteOrDollar(status),
      "$",
      "$",
      "$",
      "$",
    ],
    description: "",
    globalId: "",
    id: approvalId,
    name,
    type: "IFCAPPROVAL",
  });
  return addNativeAssociation(
    document,
    next,
    entityId,
    "IFCRELASSOCIATESAPPROVAL",
    "Approval",
    approvalId,
  );
}

export function addNativeConstraintObjective(
  document: NativeIfcDocument,
  entityId: number,
  name: string,
  grade: string,
  source: string,
  qualifier: string,
  intent: string,
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const next = cloneDocumentEntities(document);
  const constraintId = nextEntityId(next);
  const relationshipId = constraintId + 1;
  const cleanName = name.trim() || `Constraint for #${entityId}`;
  const constraintGrade = enumValue(grade || "NOTDEFINED");
  next.push({
    args: [
      quote(cleanName),
      "$",
      constraintGrade,
      quoteOrDollar(source),
      "$",
      "$",
      constraintGrade === ".USERDEFINED." ? quote("User defined") : "$",
      "$",
      "$",
      enumValue(qualifier || "REQUIREMENT"),
      "$",
    ],
    description: "",
    globalId: "",
    id: constraintId,
    name: cleanName,
    type: "IFCOBJECTIVE",
  });
  next.push({
    args: [
      quote(createIfcGuid(relationshipId)),
      "$",
      quote("Constraint"),
      "$",
      `(#${entityId})`,
      quoteOrDollar(intent),
      `#${constraintId}`,
    ],
    description: "",
    globalId: createIfcGuid(relationshipId),
    id: relationshipId,
    name: "Constraint",
    type: "IFCRELASSOCIATESCONSTRAINT",
  });
  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export function addNativeTypeAssignment(
  document: NativeIfcDocument,
  entityId: number,
  typeName: string,
  typeClass = "IFCTYPEOBJECT",
  tag = "",
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const next = cloneDocumentEntities(document);
  const normalizedTypeClass = normalizeTypeClass(typeClass);
  const typeId = nextEntityId(next);
  const relationshipId = typeId + 1;
  const cleanName = typeName.trim() || `Type for #${entityId}`;
  const cleanTag = tag.trim() || cleanName;
  next.push({
    args: [
      quote(createIfcGuid(typeId)),
      "$",
      quote(cleanName),
      "$",
      "$",
      "$",
      "$",
      quote(cleanTag),
    ],
    description: "",
    globalId: createIfcGuid(typeId),
    id: typeId,
    name: cleanName,
    type: normalizedTypeClass,
  });
  next.push({
    args: [
      quote(createIfcGuid(relationshipId)),
      "$",
      quote("Type"),
      "$",
      `(#${entityId})`,
      `#${typeId}`,
    ],
    description: "",
    globalId: createIfcGuid(relationshipId),
    id: relationshipId,
    name: "Type",
    type: "IFCRELDEFINESBYTYPE",
  });
  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export function removeNativeRelationship(
  document: NativeIfcDocument,
  relationshipId: number,
) {
  const relationship = document.entityById.get(relationshipId);
  if (!relationship || !relationship.type.startsWith("IFCREL")) {
    return document;
  }

  const next = cloneDocumentEntities(document).filter(
    (entity) => entity.id !== relationshipId,
  );
  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

/**
 * Weist ein Objekt einer BESTEHENDEN Gruppe zu: hängt es an die vorhandene
 * IFCRELASSIGNSTOGROUP-Zuweisung der Gruppe an oder legt eine neue Zuweisung
 * an, falls die Gruppe noch keine hat. Bereits bestehende Mitgliedschaft und
 * Selbst-Zuweisung sind No-ops.
 */
export function addNativeEntityToGroup(
  document: NativeIfcDocument,
  entityId: number,
  groupId: number,
) {
  const entity = document.entityById.get(entityId);
  const group = document.entityById.get(groupId);
  if (!entity || !group || entityId === groupId) {
    return document;
  }
  const next = cloneDocumentEntities(document);
  const existing = next.find((candidate) => {
    if (!candidate.type.startsWith("IFCRELASSIGNSTOGROUP")) {
      return false;
    }
    const [, targetIds] = relationshipEnds(candidate);
    return targetIds.includes(groupId);
  });
  if (existing) {
    const [sourceIds] = relationshipEnds(existing);
    if (sourceIds.includes(entityId)) {
      return document;
    }
    appendReference(existing.args, 4, entityId);
  } else {
    next.push(
      createGroupAssignmentEntity(
        nextEntityId(next),
        entityId,
        groupId,
        `${group.name || group.type} Assignment`,
      ),
    );
  }
  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

/**
 * Löst die Mitgliedschaft eines Objekts in einer Gruppe: das Objekt wird aus
 * den RelatedObjects aller IFCRELASSIGNSTOGROUP(-BYFACTOR)-Zuweisungen dieser
 * Gruppe ausgetragen. Eine dadurch leere Zuweisung wird komplett entfernt;
 * Objekt und Gruppe selbst bleiben bestehen.
 */
export function removeNativeGroupMembership(
  document: NativeIfcDocument,
  memberId: number,
  groupId: number,
) {
  let changed = false;
  const next = cloneDocumentEntities(document).filter((entity) => {
    if (!entity.type.startsWith("IFCRELASSIGNSTOGROUP")) {
      return true;
    }
    const [sourceIds, targetIds] = relationshipEnds(entity);
    if (!targetIds.includes(groupId) || !sourceIds.includes(memberId)) {
      return true;
    }
    changed = true;
    const remaining = sourceIds.filter((id) => id !== memberId);
    if (remaining.length === 0) {
      return false;
    }
    entity.args[4] = formatReferenceList(remaining);
    return true;
  });
  if (!changed) {
    return document;
  }
  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export interface NativeEntityRemovalPlan {
  document: NativeIfcDocument;
  entityId: number;
  relationshipCount: number;
  removedEntityIds: number[];
}

/**
 * Berechnet Löschwirkung und Ergebnis in einem Durchlauf. Die UI kann damit
 * die Kaskade vor dem Commit anzeigen, ohne das große IFC beim Bestätigen ein
 * zweites Mal serialisieren und parsen zu müssen.
 */
export function planNativeEntityRemoval(
  document: NativeIfcDocument,
  entityId: number,
): NativeEntityRemovalPlan | undefined {
  const entity = document.entityById.get(entityId);
  if (!entity || entity.type === "IFCPROJECT") {
    return undefined;
  }

  const removedIds = collectCascadeRemovalIds(document, entityId);
  if (removedIds.size === 0 || removedIds.size >= document.entities.length) {
    return undefined;
  }

  const survivors: NativeIfcEntity[] = [];
  for (const current of cloneDocumentEntities(document)) {
    if (removedIds.has(current.id)) {
      continue;
    }
    // A relationship that merely references a deleted entity (spatial
    // containment, aggregation, material/type/property assignment, …) is
    // usually SHARED across many siblings. Drop only the deleted member(s)
    // from such a relationship; remove the relationship itself only when one
    // of its required ends becomes empty. Removing the whole relationship
    // would orphan every sibling and make them disappear from the tree.
    if (
      current.type.startsWith("IFCREL") &&
      pruneRelationshipMembers(current, removedIds) === "drop"
    ) {
      removedIds.add(current.id);
      continue;
    }
    survivors.push(current);
  }

  // Garbage-collect resources that ONLY hung off the removed entities — their
  // own property sets, quantities, property values, geometric representation
  // and placements. Anything still referenced by a surviving entity (shared
  // psets/materials, the storey, …) is kept automatically by reference count.
  collectOrphanedResources(document, survivors, removedIds);

  const next = survivors.filter((current) => !removedIds.has(current.id));
  const removedEntityIds = [...removedIds].filter((id) =>
    document.entityById.has(id),
  );
  return {
    document: parseNativeIfcText(
      serializeEntities(document, next),
      document.fileName,
    ),
    entityId,
    relationshipCount: removedEntityIds.filter((id) =>
      document.entityById.get(id)?.type.startsWith("IFCREL"),
    ).length,
    removedEntityIds,
  };
}

export function removeNativeEntity(
  document: NativeIfcDocument,
  entityId: number,
) {
  return planNativeEntityRemoval(document, entityId)?.document ?? document;
}

/**
 * Entfernt die Körper-Geometrie eines Produkts: löst die Referenz auf das
 * IFCPRODUCTDEFINITIONSHAPE und räumt die dadurch verwaiste Repräsentations-
 * Kette (Shape → Representations → Solids → Placements/Punkte/Richtungen) per
 * Referenzzählung ab. Von anderen Produkten geteilte Shapes/Profile bleiben
 * erhalten; Platzierung, Psets und Beziehungen des Produkts bleiben unberührt.
 */
export function removeNativeBodyRepresentation(
  document: NativeIfcDocument,
  entityId: number,
) {
  const entity = document.entityById.get(entityId);
  if (!entity) {
    return document;
  }
  const shapeArgIndex = entity.args.findIndex((arg) => {
    const trimmed = arg.trim();
    if (!/^#\d+$/.test(trimmed)) {
      return false;
    }
    return (
      document.entityById.get(Number(trimmed.slice(1)))?.type ===
      "IFCPRODUCTDEFINITIONSHAPE"
    );
  });
  if (shapeArgIndex < 0) {
    return document;
  }
  const shapeId = Number(entity.args[shapeArgIndex].trim().slice(1));

  const survivors = cloneDocumentEntities(document);
  const product = survivors.find((item) => item.id === entityId);
  if (!product) {
    return document;
  }
  setArg(product.args, shapeArgIndex, "$");

  const removedIds = new Set<number>();
  collectOrphanedResources(document, survivors, removedIds, [shapeId]);

  const next = survivors.filter((item) => !removedIds.has(item.id));
  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

/**
 * Structural / catalog anchors that must never be auto-deleted just because the
 * element that referenced them is gone, even when they end up unreferenced.
 */
const ORPHAN_PROTECTED_TYPES = new Set([
  "IFCPROJECT",
  "IFCPROJECTLIBRARY",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
  "IFCSPACE",
  "IFCSPATIALZONE",
  "IFCSPATIALELEMENT",
  "IFCSPATIALSTRUCTUREELEMENT",
  "IFCEXTERNALSPATIALELEMENT",
  // Group/system containers behave like parents: keep them when their last
  // assigned member is deleted instead of dissolving the container.
  "IFCGROUP",
  "IFCSYSTEM",
  "IFCZONE",
  "IFCASSET",
  "IFCINVENTORY",
  "IFCBUILDINGSYSTEM",
  "IFCBUILTSYSTEM",
  "IFCDISTRIBUTIONSYSTEM",
  "IFCDISTRIBUTIONCIRCUIT",
  "IFCSTRUCTURALANALYSISMODEL",
  "IFCSTRUCTURALLOADGROUP",
  "IFCSTRUCTURALLOADCASE",
  "IFCSTRUCTURALRESULTGROUP",
]);

function isOrphanProtected(type: string): boolean {
  return (
    // Relationships are roots (nothing references them) — they are only ever
    // removed by the degenerate-end check above, never as "orphans".
    type.startsWith("IFCREL") ||
    ORPHAN_PROTECTED_TYPES.has(type) ||
    // Catalog/library resources are shared definitions; keep them even when the
    // last element using them is deleted (a material/type stays in the catalog).
    isTypeObject(type) ||
    type.startsWith("IFCMATERIAL") ||
    type.endsWith("STYLE") ||
    type.endsWith("PROFILEDEF")
  );
}

/**
 * Reference-counted cleanup of entities that became unreachable after a delete.
 * Seeds from everything the removed entities pointed at and removes any reached
 * entity that no surviving entity still references (transitively), so an
 * element's exclusive psets/quantities/geometry/placement go away with it while
 * shared resources and structural anchors are preserved. Adds collected ids to
 * `removedIds` in place.
 */
function collectOrphanedResources(
  document: NativeIfcDocument,
  survivors: NativeIfcEntity[],
  removedIds: Set<number>,
  extraSeedIds?: Iterable<number>,
) {
  const survivorById = new Map(survivors.map((entity) => [entity.id, entity]));

  // Parents/containers in the decomposition & spatial hierarchy must never be
  // collected as a side effect of deleting a child — even when the only thing
  // connecting them was that single (now-removed) aggregation/nesting/
  // containment relationship. Deleting a part must not delete its assembly,
  // deleting the last element of a storey must not delete the storey.
  const hierarchyParentIds = new Set<number>();
  for (const relationship of document.relationships) {
    if (HIERARCHY_RELATIONSHIP_TYPES.has(relationship.type)) {
      for (const parentId of relationship.sourceIds) {
        hierarchyParentIds.add(parentId);
      }
    }
  }

  // Live incoming-reference counts among the surviving entities (their args
  // were already pruned of deleted members above).
  const incomingCount = new Map<number, number>();
  for (const entity of survivors) {
    for (const ref of readUniqueReferencesFromArgs(entity.args)) {
      incomingCount.set(ref, (incomingCount.get(ref) ?? 0) + 1);
    }
  }

  // Seed candidates from everything the removed entities referenced, plus
  // explicitly detached resources (e.g. a geometry subtree whose product
  // reference was just cleared).
  const queue: number[] = [...(extraSeedIds ?? [])];
  for (const entity of document.entities) {
    if (removedIds.has(entity.id)) {
      queue.push(...readUniqueReferencesFromArgs(entity.args));
    }
  }

  while (queue.length > 0) {
    const candidateId = queue.shift();
    if (candidateId === undefined || removedIds.has(candidateId)) {
      continue;
    }
    const candidate = survivorById.get(candidateId);
    if (
      !candidate ||
      (incomingCount.get(candidateId) ?? 0) > 0 ||
      hierarchyParentIds.has(candidateId) ||
      isOrphanProtected(candidate.type)
    ) {
      continue;
    }
    // Unreferenced, non-protected resource → collect it and re-check whatever
    // it pointed at, which may now be orphaned in turn.
    removedIds.add(candidateId);
    for (const ref of readUniqueReferencesFromArgs(candidate.args)) {
      incomingCount.set(ref, (incomingCount.get(ref) ?? 0) - 1);
      queue.push(ref);
    }
  }
}

/**
 * Removes references to deleted entities from a relationship's member lists.
 * Mutates `entity.args` in place and returns whether the relationship should
 * be kept (`"keep"`) or dropped because it lost every member on a required
 * end (`"drop"`).
 */
function pruneRelationshipMembers(
  entity: NativeIfcEntity,
  removedIds: Set<number>,
): "keep" | "drop" {
  const [sourceIds, targetIds] = relationshipEnds(entity);
  const touchesRemoved =
    sourceIds.some((id) => removedIds.has(id)) ||
    targetIds.some((id) => removedIds.has(id));
  if (!touchesRemoved) {
    return "keep";
  }

  const remainingSources = sourceIds.filter((id) => !removedIds.has(id));
  const remainingTargets = targetIds.filter((id) => !removedIds.has(id));
  if (
    (sourceIds.length > 0 && remainingSources.length === 0) ||
    (targetIds.length > 0 && remainingTargets.length === 0)
  ) {
    return "drop";
  }

  entity.args = entity.args.map((arg) => pruneRefArg(arg, removedIds));
  return "keep";
}

/**
 * Strips references to deleted entities from a single STEP argument when it is
 * a bare reference (`#42`) or a flat reference list (`(#1,#2,#3)`). Other
 * argument shapes are left untouched so positional / nested data is preserved.
 */
function pruneRefArg(arg: string, removedIds: Set<number>): string {
  const trimmed = arg.trim();
  if (/^#\d+$/.test(trimmed)) {
    return removedIds.has(Number(trimmed.slice(1))) ? "$" : arg;
  }
  if (/^\(\s*#\d+(\s*,\s*#\d+)*\s*\)$/.test(trimmed)) {
    const kept = readReferences(trimmed).filter((id) => !removedIds.has(id));
    return `(${kept.map((id) => `#${id}`).join(",")})`;
  }
  return arg;
}

export function updateNativeRelationship(
  document: NativeIfcDocument,
  relationshipId: number,
  updates: { type?: string; sourceId?: number; targetId?: number },
) {
  const next = cloneDocumentEntities(document);
  const relationship = next.find((entity) => entity.id === relationshipId);
  if (!relationship || !relationship.type.startsWith("IFCREL")) {
    return document;
  }

  const currentEnds = relationshipEnds(relationship);
  const relationshipType = normalizeType(updates.type ?? relationship.type);
  const sourceId =
    updates.sourceId && document.entityById.has(updates.sourceId)
      ? updates.sourceId
      : currentEnds[0][0];
  const targetId =
    updates.targetId && document.entityById.has(updates.targetId)
      ? updates.targetId
      : currentEnds[1][0];

  if (!sourceId || !targetId) {
    return document;
  }

  relationship.type = relationshipType;
  setRelationshipArgs(relationship, relationshipType, sourceId, targetId);

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export function addNativeSiUnit(
  document: NativeIfcDocument,
  unitType: string,
  prefix: string,
  name: string,
) {
  const next = cloneDocumentEntities(document);
  const unitId = nextEntityId(next);
  next.push({
    args: [
      "*",
      enumValue(unitType),
      prefix === "$" ? "$" : enumValue(prefix),
      enumValue(name),
    ],
    description: "",
    globalId: "",
    id: unitId,
    name,
    type: "IFCSIUNIT",
  });
  const assignment = next.find((entity) => entity.type === "IFCUNITASSIGNMENT");
  if (assignment) {
    const refs = readReferences(assignment.args[0]);
    refs.push(unitId);
    assignment.args[0] = `(${unique(refs)
      .map((id) => `#${id}`)
      .join(",")})`;
  }
  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

function addNativeAssociation(
  document: NativeIfcDocument,
  entities: NativeIfcEntity[],
  entityId: number,
  relationshipType: string,
  relationshipName: string,
  resourceId: number,
) {
  const relId = nextEntityId(entities);
  entities.push({
    args: [
      quote(createIfcGuid(relId)),
      "$",
      quote(relationshipName),
      "$",
      `(#${entityId})`,
      `#${resourceId}`,
    ],
    description: "",
    globalId: createIfcGuid(relId),
    id: relId,
    name: relationshipName,
    type: relationshipType,
  });
  return parseNativeIfcText(
    serializeEntities(document, entities),
    document.fileName,
  );
}

function readHeader(text: string) {
  const match = text.match(/HEADER;([\s\S]*?)ENDSEC;/i);
  return match
    ? `HEADER;${match[1]}ENDSEC;`
    : "HEADER;\nFILE_SCHEMA(('UNKNOWN'));\nENDSEC;";
}

function readSchema(headerText: string) {
  return headerText.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1];
}

function readEntities(text: string, diagnostics: string[]) {
  const entities: NativeIfcEntity[] = [];
  const regex = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const id = Number(match[1]);
    const type = match[2].toUpperCase();
    const args = splitTopLevel(match[3]);
    entities.push({
      args,
      description: readEntityDescription(type, args),
      globalId: unquote(args[0]) ?? "",
      id,
      name: readEntityName(type, args),
      type,
    });
  }
  if (entities.length === 0) {
    diagnostics.push("No STEP entity lines found.");
  }
  return entities.sort((left, right) => left.id - right.id);
}

function readEntityName(type: string, args: string[]) {
  if (type === "IFCMATERIAL") {
    return unquote(args[0]) ?? "";
  }
  if (type === "IFCMATERIALPROPERTIES") {
    return unquote(args[0]) ?? "";
  }
  if (type === "IFCMATERIALDEFINITIONREPRESENTATION") {
    return unquote(args[0]) ?? "";
  }
  if (type === "IFCCOLOURRGB") {
    return unquote(args[0]) ?? "";
  }
  if (type === "IFCSURFACESTYLE") {
    return unquote(args[0]) ?? "";
  }
  if (type === "IFCSURFACESTYLERENDERING") {
    return "Surface Style Rendering";
  }
  if (type === "IFCSTYLEDITEM") {
    return unquote(args[2]) ?? "";
  }
  if (type === "IFCSTYLEDREPRESENTATION") {
    return unquote(args[1]) ?? unquote(args[2]) ?? "";
  }
  if (
    type === "IFCMATERIALLAYERSET" ||
    type === "IFCMATERIALPROFILESET" ||
    type === "IFCMATERIALCONSTITUENTSET"
  ) {
    return unquote(args[type === "IFCMATERIALLAYERSET" ? 1 : 0]) ?? "";
  }
  if (type === "IFCMATERIALLAYERSETUSAGE") {
    return "Material Layer Set Usage";
  }
  if (type === "IFCMATERIALPROFILESETUSAGE") {
    return "Material Profile Set Usage";
  }
  if (type === "IFCMATERIALLAYER") {
    return unquote(args[3]) ?? "";
  }
  if (type === "IFCMATERIALPROFILE" || type === "IFCMATERIALCONSTITUENT") {
    return unquote(args[0]) ?? "";
  }
  if (type === "IFCAPPROVAL") {
    return unquote(args[1]) ?? unquote(args[0]) ?? "";
  }
  if (type === "IFCOBJECTIVE" || type === "IFCMETRIC") {
    return unquote(args[0]) ?? "";
  }
  if (type === "IFCSIUNIT") {
    return compactValue([args[1], args[2], args[3]].filter(Boolean).join(" "));
  }
  return unquote(args[2]) ?? "";
}

function readEntityDescription(type: string, args: string[]) {
  if (type === "IFCMATERIAL") {
    return unquote(args[1]) ?? "";
  }
  if (type === "IFCMATERIALPROPERTIES") {
    return unquote(args[1]) ?? "";
  }
  if (type === "IFCAPPROVAL") {
    return unquote(args[2]) ?? "";
  }
  if (type === "IFCOBJECTIVE" || type === "IFCMETRIC") {
    return unquote(args[1]) ?? "";
  }
  return unquote(args[3]) ?? "";
}

function readRelationships(entities: NativeIfcEntity[]) {
  const relationships: NativeIfcRelationship[] = [];
  for (const entity of entities) {
    if (!entity.type.startsWith("IFCREL")) {
      continue;
    }
    const [sourceIds, targetIds] = relationshipEnds(entity);
    relationships.push({
      family: RELATIONSHIP_FAMILIES[entity.type] ?? "relationship",
      id: entity.id,
      sourceIds,
      targetIds,
      type: entity.type,
    });
  }
  return relationships;
}

function relationshipEnds(entity: NativeIfcEntity): [number[], number[]] {
  if (entity.type === "IFCRELAGGREGATES" || entity.type === "IFCRELNESTS") {
    return [readReferences(entity.args[4]), readReferences(entity.args[5])];
  }
  if (
    entity.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE" ||
    entity.type === "IFCRELREFERENCEDINSPATIALSTRUCTURE"
  ) {
    return [readReferences(entity.args[5]), readReferences(entity.args[4])];
  }
  if (entity.type.startsWith("IFCRELDEFINES")) {
    return [readReferences(entity.args[4]), readReferences(entity.args[5])];
  }
  if (
    entity.type.startsWith("IFCRELASSOCIATES") ||
    entity.type.startsWith("IFCRELASSIGNS")
  ) {
    return [
      readReferences(entity.args[4]),
      readReferencesFromArgs(entity.args, 5),
    ];
  }
  const refs = readUniqueReferencesFromArgs(entity.args);
  return refs.length <= 1 ? [refs, []] : [[refs[0]], refs.slice(1)];
}

function collectCascadeRemovalIds(document: NativeIfcDocument, rootId: number) {
  const removedIds = new Set<number>();
  const queue = [rootId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (
      !currentId ||
      removedIds.has(currentId) ||
      !document.entityById.has(currentId)
    ) {
      continue;
    }

    removedIds.add(currentId);

    // Cascade ONLY downward through the decomposition/spatial hierarchy:
    // deleting a storey removes the elements it contains, deleting an assembly
    // removes its parts. We deliberately do NOT follow arbitrary incoming
    // references here. A single grouping relationship (e.g. one
    // IfcRelContainedInSpatialStructure listing every wall on a storey, or a
    // shared IfcRelAssociatesMaterial) references many siblings at once;
    // pulling those relationships into the removal set would drag every
    // sibling along and make them vanish. Such relationships are instead
    // pruned member-by-member in removeNativeEntity.
    for (const relationship of document.relationshipsByEntity.get(currentId) ??
      []) {
      if (
        HIERARCHY_RELATIONSHIP_TYPES.has(relationship.type) &&
        relationship.sourceIds.includes(currentId)
      ) {
        for (const childId of relationship.targetIds) {
          if (!removedIds.has(childId)) {
            queue.push(childId);
          }
        }
      }
    }
  }

  return removedIds;
}

function readPropertySets(
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const result = new Map<number, NativeIfcPropertySet[]>();
  for (const rel of entities) {
    if (rel.type !== "IFCRELDEFINESBYPROPERTIES") {
      continue;
    }
    const objectIds = readReferences(rel.args[4]);
    const definitionId = readReferences(rel.args[5])[0];
    const definition = entityById.get(definitionId);
    const set = definition
      ? buildPropertySet(definition, entityById)
      : undefined;
    if (!set) {
      continue;
    }
    for (const objectId of objectIds) {
      pushMapValue(result, objectId, set);
    }
  }
  return result;
}

function readTypeAssignments(
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const result = new Map<number, NativeIfcTypeAssignment[]>();
  for (const rel of entities) {
    if (rel.type !== "IFCRELDEFINESBYTYPE") {
      continue;
    }
    const objectIds = readReferences(rel.args[4]);
    const typeId = readReferences(rel.args[5])[0];
    const typeEntity = entityById.get(typeId);
    if (!typeEntity) {
      continue;
    }
    const assignment: NativeIfcTypeAssignment = {
      objectIds,
      relationshipId: rel.id,
      typeClass: typeEntity.type,
      typeId,
      typeName: typeEntity.name || `#${typeId}`,
    };
    for (const objectId of objectIds) {
      pushMapValue(result, objectId, assignment);
    }
  }
  return result;
}

function buildPropertySet(
  entity: NativeIfcEntity,
  entityById: Map<number, NativeIfcEntity>,
): NativeIfcPropertySet | undefined {
  if (
    entity.type !== "IFCPROPERTYSET" &&
    entity.type !== "IFCELEMENTQUANTITY"
  ) {
    return undefined;
  }
  const refIndex = entity.type === "IFCELEMENTQUANTITY" ? 5 : 4;
  return {
    id: entity.id,
    kind: entity.type === "IFCELEMENTQUANTITY" ? "Qto" : "Pset",
    name: entity.name || `#${entity.id}`,
    values: readReferences(entity.args[refIndex]).reduce<
      NativeIfcPropertySet["values"]
    >((values, id) => {
      const value = entityById.get(id);
      if (value) {
        values.push({
          id,
          name: unquote(value.args[0]) ?? `#${id}`,
          type: value.type,
          value: readPropertySummaryValue(value),
        });
      }
      return values;
    }, []),
  };
}

function readPropertySummaryValue(entity: NativeIfcEntity) {
  if (entity.type === "IFCPROPERTYLISTVALUE") {
    return readIfcValueList(entity.args[2]).map(compactValue).join("; ");
  }
  if (entity.type === "IFCPROPERTYENUMERATEDVALUE") {
    return readIfcValueList(entity.args[2]).map(compactValue).join("; ");
  }
  if (entity.type === "IFCPROPERTYBOUNDEDVALUE") {
    const lower =
      entity.args[3] && entity.args[3] !== "$"
        ? compactValue(entity.args[3])
        : "";
    const upper =
      entity.args[2] && entity.args[2] !== "$"
        ? compactValue(entity.args[2])
        : "";
    const setPoint =
      entity.args[5] && entity.args[5] !== "$"
        ? compactValue(entity.args[5])
        : "";
    return `${lower}..${upper}${setPoint ? `; ${setPoint}` : ""}`;
  }
  if (entity.type === "IFCPROPERTYTABLEVALUE") {
    const defining = readIfcValueList(entity.args[2]).map(compactValue);
    const defined = readIfcValueList(entity.args[3]).map(compactValue);
    return defining
      .map((value, index) => `${value}=>${defined[index] ?? ""}`)
      .join("; ");
  }
  return compactValue(
    entity.args[2] && entity.args[2] !== "$"
      ? entity.args[2]
      : (entity.args[3] ?? ""),
  );
}

function readResources(
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const result = new Map<number, string[]>();
  const materialPropertiesByMaterial =
    readMaterialPropertiesByMaterial(entities);
  const materialRepresentationsByMaterial =
    readMaterialRepresentationsByMaterial(entities, entityById);
  for (const rel of entities) {
    if (
      !rel.type.startsWith("IFCRELASSOCIATES") &&
      rel.type !== "IFCRELASSIGNSTOGROUP"
    ) {
      continue;
    }
    const objectIds = readReferences(rel.args[4]);
    const resources = readRelationshipResourceIds(rel).map((id) => {
      const resource = entityById.get(id);
      return resource
        ? resourceSummary(
            resource,
            entityById,
            materialPropertiesByMaterial,
            materialRepresentationsByMaterial,
          )
        : `#${id}`;
    });
    for (const objectId of objectIds) {
      pushMapValues(result, objectId, resources);
    }
  }
  return result;
}

function readMaterialPropertiesByMaterial(entities: NativeIfcEntity[]) {
  const result = new Map<number, string[]>();
  for (const entity of entities) {
    if (entity.type !== "IFCMATERIALPROPERTIES") {
      continue;
    }
    const materialId = readReferences(entity.args[3])[0];
    if (materialId) {
      pushMapValue(result, materialId, entity.name || `#${entity.id}`);
    }
  }
  return result;
}

function readMaterialPropertiesFromIncoming(
  materialIds: number[],
  incomingRefs: Map<number, NativeIfcEntity[]>,
) {
  const result = new Map<number, string[]>();
  for (const materialId of materialIds) {
    for (const incoming of incomingRefs.get(materialId) ?? []) {
      if (incoming.type === "IFCMATERIALPROPERTIES") {
        pushMapValue(result, materialId, incoming.name || `#${incoming.id}`);
      }
    }
  }
  return result;
}

function readMaterialRepresentationsByMaterial(
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const result = new Map<number, string[]>();
  for (const entity of entities) {
    if (entity.type !== "IFCMATERIALDEFINITIONREPRESENTATION") {
      continue;
    }
    const materialId = readReferences(entity.args[3])[0];
    if (materialId) {
      pushMapValue(
        result,
        materialId,
        materialRepresentationSummary(entity, entityById),
      );
    }
  }
  return result;
}

function readMaterialRepresentationsFromIncoming(
  materialIds: number[],
  incomingRefs: Map<number, NativeIfcEntity[]>,
  entityById: Map<number, NativeIfcEntity>,
) {
  const result = new Map<number, string[]>();
  for (const materialId of materialIds) {
    for (const incoming of incomingRefs.get(materialId) ?? []) {
      if (incoming.type === "IFCMATERIALDEFINITIONREPRESENTATION") {
        pushMapValue(
          result,
          materialId,
          materialRepresentationSummary(incoming, entityById),
        );
      }
    }
  }
  return result;
}

function materialRepresentationSummary(
  representation: NativeIfcEntity,
  entityById: Map<number, NativeIfcEntity>,
) {
  const labels = new Set<string>();
  if (representation.name) {
    labels.add(representation.name);
  }
  for (const representationId of readReferences(representation.args[2])) {
    const styledRepresentation = entityById.get(representationId);
    if (!styledRepresentation) {
      continue;
    }
    for (const itemId of readReferences(styledRepresentation.args[3])) {
      const styledItem = entityById.get(itemId);
      if (!styledItem) {
        continue;
      }
      if (styledItem.name) {
        labels.add(styledItem.name);
      }
      for (const styleId of readReferences(styledItem.args[1])) {
        const style = entityById.get(styleId);
        if (style?.name) {
          labels.add(style.name);
        }
      }
    }
  }
  return labels.size ? [...labels].join(", ") : `#${representation.id}`;
}

function resourceSummary(
  resource: NativeIfcEntity,
  entityById?: Map<number, NativeIfcEntity>,
  materialPropertiesByMaterial?: Map<number, string[]>,
  materialRepresentationsByMaterial?: Map<number, string[]>,
) {
  if (
    entityById &&
    (resource.type === "IFCMATERIALLAYERSETUSAGE" ||
      resource.type === "IFCMATERIALPROFILESETUSAGE")
  ) {
    const setId = readReferences(resource.args[0])[0];
    const set = entityById.get(setId);
    if (set) {
      return `${resource.type} #${resource.id} ${set.name || `#${setId}`}`;
    }
  }
  const label = resource.name || compactValue(resource.args.join(","));
  const materialProperties = materialPropertiesByMaterial?.get(resource.id);
  const materialRepresentations = materialRepresentationsByMaterial?.get(
    resource.id,
  );
  const details = [
    ...(materialProperties ?? []),
    ...(materialRepresentations ?? []),
  ];
  return details.length
    ? `${resource.type} #${resource.id} ${label} [${details.join(", ")}]`
    : `${resource.type} #${resource.id} ${label}`;
}

function readUnits(
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const units: string[] = [];
  for (const assignment of entities) {
    if (assignment.type !== "IFCUNITASSIGNMENT") {
      continue;
    }
    for (const id of readReferencesFromArgs(assignment.args)) {
      const unit = entityById.get(id);
      if (unit) {
        units.push(
          `#${unit.id} ${unit.type}: ${unit.args.map(compactValue).join(" ")}`,
        );
      }
    }
  }
  return units;
}

function validateNativeDocument(
  sourceText: string,
  schema: string,
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
  relationships: NativeIfcRelationship[],
  units: string[],
) {
  const diagnostics: string[] = [];
  const globalIdOwners = new Map<string, number[]>();

  if (!/^\s*ISO-10303-21;/i.test(sourceText)) {
    diagnostics.push(
      "Warning: STEP file is missing ISO-10303-21 start marker.",
    );
  }
  if (!/END-ISO-10303-21;\s*$/i.test(sourceText)) {
    diagnostics.push(
      "Warning: STEP file is missing END-ISO-10303-21 end marker.",
    );
  }
  if (schema === "UNKNOWN") {
    diagnostics.push("Warning: FILE_SCHEMA is missing or could not be read.");
  }
  for (const entity of entities) {
    if (entity.globalId && entity.globalId !== "$") {
      pushMapValue(globalIdOwners, entity.globalId, entity.id);
    }
    const missingRefs = readUniqueReferencesFromArgs(entity.args).filter(
      (id) => !entityById.has(id),
    );
    if (missingRefs.length > 0) {
      diagnostics.push(
        `Warning: #${entity.id} ${entity.type} references missing ${missingRefs.map((id) => `#${id}`).join(", ")}.`,
      );
    }
  }

  for (const [globalId, ids] of globalIdOwners) {
    if (ids.length > 1) {
      diagnostics.push(
        `Warning: duplicate GlobalId ${globalId} on ${ids.map((id) => `#${id}`).join(", ")}.`,
      );
    }
  }

  const unitAssignments = entities.filter(
    (entity) => entity.type === "IFCUNITASSIGNMENT",
  );
  if (units.length === 0) {
    diagnostics.push("Warning: no IFCUNITASSIGNMENT units are indexed.");
  }
  if (unitAssignments.length > 1) {
    diagnostics.push(
      `Warning: multiple IFCUNITASSIGNMENT entities found: ${unitAssignments.map((entity) => `#${entity.id}`).join(", ")}.`,
    );
  }
  const projectUnitRefs = entities
    .filter((entity) => entity.type === "IFCPROJECT")
    .flatMap((entity) => readReferences(entity.args[8] ?? ""));
  if (unitAssignments.length > 0 && projectUnitRefs.length === 0) {
    diagnostics.push(
      "Warning: IFCPROJECT does not reference an IFCUNITASSIGNMENT in UnitsInContext.",
    );
  } else if (
    projectUnitRefs.some(
      (id) => entityById.get(id)?.type !== "IFCUNITASSIGNMENT",
    )
  ) {
    diagnostics.push(
      "Warning: IFCPROJECT UnitsInContext does not point to an IFCUNITASSIGNMENT.",
    );
  }
  diagnostics.push(...validateUnitAssignments(unitAssignments, entityById));
  diagnostics.push(...validatePhysicalProducts(entities, entityById));

  const containmentParents = new Map<number, number[]>();
  for (const relationship of relationships) {
    const sourceTypes = relationship.sourceIds.map(
      (id) => entityById.get(id)?.type ?? "UNKNOWN",
    );
    const targetTypes = relationship.targetIds.map(
      (id) => entityById.get(id)?.type ?? "UNKNOWN",
    );
    const warning = validateRelationshipCompatibility(
      relationship,
      sourceTypes,
      targetTypes,
    );
    if (warning) {
      diagnostics.push(
        `Warning: #${relationship.id} ${relationship.type} ${warning}.`,
      );
    }
    if (relationship.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
      for (const productId of relationship.targetIds) {
        pushMapValues(containmentParents, productId, relationship.sourceIds);
      }
    }
  }

  for (const [productId, parents] of containmentParents) {
    const uniqueParents = unique(parents);
    if (uniqueParents.length > 1) {
      diagnostics.push(
        `Warning: #${productId} has multiple primary spatial containers: ${uniqueParents.map((id) => `#${id}`).join(", ")}.`,
      );
    }
  }

  return diagnostics.length > 0
    ? diagnostics
    : ["Validation: no relationship or reference warnings."];
}

function validateUnitAssignments(
  unitAssignments: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const diagnostics: string[] = [];
  for (const assignment of unitAssignments) {
    const unitRefs = readReferences(assignment.args[0] ?? "");
    if (unitRefs.length === 0) {
      diagnostics.push(
        `Warning: #${assignment.id} IFCUNITASSIGNMENT contains no unit references.`,
      );
      continue;
    }
    const seenUnitTypes = new Map<string, number[]>();
    for (const unitId of unitRefs) {
      const unit = entityById.get(unitId);
      if (!unit) {
        continue;
      }
      const unitKind = compactValue(unit.args[1] ?? unit.type);
      seenUnitTypes.set(unitKind, [
        ...(seenUnitTypes.get(unitKind) ?? []),
        unitId,
      ]);
    }
    for (const [unitKind, ids] of seenUnitTypes) {
      if (unitKind && ids.length > 1) {
        diagnostics.push(
          `Warning: #${assignment.id} IFCUNITASSIGNMENT has duplicate ${unitKind} units: ${ids.map((id) => `#${id}`).join(", ")}.`,
        );
      }
    }
  }
  return diagnostics;
}

function validatePhysicalProducts(
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const diagnostics: string[] = [];
  for (const product of entities.filter((entity) =>
    isPhysicalProduct(entity.type),
  )) {
    const placementId = readReferences(product.args[5] ?? "")[0];
    if (!placementId) {
      diagnostics.push(
        `Warning: #${product.id} ${product.type} has no ObjectPlacement.`,
      );
    } else if (entityById.get(placementId)?.type !== "IFCLOCALPLACEMENT") {
      diagnostics.push(
        `Warning: #${product.id} ${product.type} ObjectPlacement points to #${placementId}, not IFCLOCALPLACEMENT.`,
      );
    }

    const representationId = readReferences(product.args[6] ?? "")[0];
    if (!representationId) {
      diagnostics.push(
        `Warning: #${product.id} ${product.type} has no Representation.`,
      );
    } else if (
      entityById.get(representationId)?.type !== "IFCPRODUCTDEFINITIONSHAPE"
    ) {
      diagnostics.push(
        `Warning: #${product.id} ${product.type} Representation points to #${representationId}, not IFCPRODUCTDEFINITIONSHAPE.`,
      );
    }
  }
  return diagnostics;
}

function validateRelationshipCompatibility(
  relationship: NativeIfcRelationship,
  sourceTypes: string[],
  targetTypes: string[],
) {
  if (
    relationship.sourceIds.length === 0 ||
    relationship.targetIds.length === 0
  ) {
    return "has an incomplete relationship endpoint";
  }
  if (sourceTypes.includes("UNKNOWN") || targetTypes.includes("UNKNOWN")) {
    return "points at a missing relationship endpoint";
  }
  if (
    relationship.type === "IFCRELAGGREGATES" ||
    relationship.type === "IFCRELNESTS"
  ) {
    const invalidTargets = targetTypes.filter((type) =>
      type.startsWith("IFCREL"),
    );
    return invalidTargets.length > 0
      ? "uses relationship entities as children"
      : undefined;
  }
  if (relationship.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
    if (!sourceTypes.every(isSpatial)) {
      return `expects a spatial container source, got ${sourceTypes.join(", ")}`;
    }
    const invalidTargets = targetTypes.filter(
      (type) => isSpatial(type) || type.startsWith("IFCREL"),
    );
    return invalidTargets.length > 0
      ? `expects physical/product targets, got ${invalidTargets.join(", ")}`
      : undefined;
  }
  if (relationship.type === "IFCRELDEFINESBYPROPERTIES") {
    return targetTypes.every(
      (type) => type === "IFCPROPERTYSET" || type === "IFCELEMENTQUANTITY",
    )
      ? undefined
      : `expects property or quantity definitions, got ${targetTypes.join(", ")}`;
  }
  if (relationship.type === "IFCRELDEFINESBYTYPE") {
    return targetTypes.every(isTypeObject)
      ? undefined
      : `expects type object definitions, got ${targetTypes.join(", ")}`;
  }
  if (relationship.type === "IFCRELASSOCIATESMATERIAL") {
    if (
      targetTypes.some(isMaterialUsageType) &&
      sourceTypes.some(isTypeObject)
    ) {
      return `expects occurrence sources for material usage definitions, got ${sourceTypes.join(", ")}`;
    }
    return targetTypes.every((type) => type.startsWith("IFCMATERIAL"))
      ? undefined
      : `expects material resources, got ${targetTypes.join(", ")}`;
  }
  if (relationship.type === "IFCRELASSOCIATESCLASSIFICATION") {
    return targetTypes.every(
      (type) =>
        type === "IFCCLASSIFICATION" || type === "IFCCLASSIFICATIONREFERENCE",
    )
      ? undefined
      : `expects classification resources, got ${targetTypes.join(", ")}`;
  }
  if (relationship.type === "IFCRELASSOCIATESDOCUMENT") {
    return targetTypes.every(
      (type) =>
        type === "IFCDOCUMENTINFORMATION" || type === "IFCDOCUMENTREFERENCE",
    )
      ? undefined
      : `expects document resources, got ${targetTypes.join(", ")}`;
  }
  if (relationship.type === "IFCRELASSOCIATESLIBRARY") {
    return targetTypes.every(
      (type) =>
        type === "IFCLIBRARYINFORMATION" || type === "IFCLIBRARYREFERENCE",
    )
      ? undefined
      : `expects library resources, got ${targetTypes.join(", ")}`;
  }
  if (relationship.type === "IFCRELASSOCIATESCONSTRAINT") {
    return targetTypes.every(
      (type) => type === "IFCOBJECTIVE" || type === "IFCMETRIC",
    )
      ? undefined
      : `expects constraint resources, got ${targetTypes.join(", ")}`;
  }
  if (relationship.type === "IFCRELASSOCIATESAPPROVAL") {
    return targetTypes.every((type) => type === "IFCAPPROVAL")
      ? undefined
      : `expects approval resources, got ${targetTypes.join(", ")}`;
  }
  if (relationship.type === "IFCRELASSIGNSTOGROUP") {
    if (!targetTypes.every(isGroupObject)) {
      return `expects group, system or zone targets, got ${targetTypes.join(", ")}`;
    }
    if (
      relationship.sourceIds.some((id) => relationship.targetIds.includes(id))
    ) {
      return "contains a group self-reference";
    }
    return sourceTypes.some((type) => type.startsWith("IFCREL"))
      ? `expects object definition sources, got ${sourceTypes.join(", ")}`
      : undefined;
  }
  return undefined;
}

function buildSpatialRoots(
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
  relationships: NativeIfcRelationship[],
) {
  const childrenByParent = new Map<
    number,
    { id: number; relation: string }[]
  >();
  for (const rel of relationships) {
    if (
      rel.type !== "IFCRELAGGREGATES" &&
      rel.type !== "IFCRELCONTAINEDINSPATIALSTRUCTURE"
    ) {
      continue;
    }
    for (const source of rel.sourceIds) {
      for (const target of rel.targetIds) {
        pushMapValue(childrenByParent, source, {
          id: target,
          relation: rel.family,
        });
      }
    }
  }
  const childIds = new Set<number>();
  for (const children of childrenByParent.values()) {
    for (const child of children) {
      childIds.add(child.id);
    }
  }
  const roots = entities.filter(
    (entity) =>
      entity.type === "IFCPROJECT" ||
      (!childIds.has(entity.id) && isSpatial(entity.type)),
  );
  return roots
    .slice(0, 8)
    .map((entity) =>
      buildTreeNode(entity.id, entityById, childrenByParent, "root"),
    );
}

function buildTreeNode(
  id: number,
  entityById: Map<number, NativeIfcEntity>,
  childrenByParent: Map<number, { id: number; relation: string }[]>,
  relation: string,
): NativeIfcTreeNode {
  const root: NativeIfcTreeNode = { children: [], id, relation };
  const stack: Array<{ node: NativeIfcTreeNode; path: Set<number> }> = [
    { node: root, path: new Set([id]) },
  ];

  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const child of childrenByParent.get(current.node.id) ?? []) {
      if (!entityById.has(child.id) || current.path.has(child.id)) {
        continue;
      }
      const childNode: NativeIfcTreeNode = {
        children: [],
        id: child.id,
        relation: child.relation,
      };
      current.node.children.push(childNode);
      const childPath = new Set(current.path);
      childPath.add(child.id);
      stack.push({ node: childNode, path: childPath });
    }
  }

  return root;
}

export function splitTopLevel(value: string) {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    current += char;
    if (char === "'") {
      if (value[index + 1] === "'") {
        current += value[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === "(") {
      depth += 1;
    } else if (!quoted && char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (!quoted && depth === 0 && char === ",") {
      parts.push(current.slice(0, -1).trim());
      current = "";
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

export function readReferences(value = "") {
  const refs: number[] = [];
  const regex = /#(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value))) {
    refs.push(Number(match[1]));
  }
  return refs;
}

function readRelationshipResourceIds(entity: NativeIfcEntity) {
  return entity.type === "IFCRELASSIGNSTOGROUP"
    ? readReferences(entity.args[6])
    : readReferencesFromArgs(entity.args, 5);
}

function readReferencesFromArgs(args: string[], startIndex = 0) {
  const refs: number[] = [];
  for (let index = startIndex; index < args.length; index += 1) {
    refs.push(...readReferences(args[index]));
  }
  return refs;
}

function readUniqueReferencesFromArgs(args: string[]) {
  const seen = new Set<number>();
  const refs: number[] = [];
  for (const ref of readReferencesFromArgs(args)) {
    if (!seen.has(ref)) {
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}

function pushMapValue<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function pushMapValues<K, V>(map: Map<K, V[]>, key: K, values: V[]) {
  if (values.length === 0) {
    return;
  }
  const current = map.get(key);
  if (current) {
    current.push(...values);
  } else {
    map.set(key, [...values]);
  }
}

function parseCoordinateTuple(value = ""): [number, number, number] {
  const inner = value.trim().replace(/^\(/, "").replace(/\)$/, "");
  const coordinates = splitTopLevel(inner).map((item) =>
    Number(item.replace(",", ".")),
  );
  return [
    Number.isFinite(coordinates[0]) ? coordinates[0] : 0,
    Number.isFinite(coordinates[1]) ? coordinates[1] : 0,
    Number.isFinite(coordinates[2]) ? coordinates[2] : 0,
  ];
}

function normalizeDirection(
  value: { x: number; y: number; z: number },
  fallback: { x: number; y: number; z: number },
) {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(length) || length < 0.000001) {
    return fallback;
  }
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
  };
}

function formatDirectionTuple(value: { x: number; y: number; z: number }) {
  return `(${formatDecimal(value.x)},${formatDecimal(value.y)},${formatDecimal(value.z)})`;
}

function readStepNumber(value = "") {
  const text = decodeStepValue(value).trim().replace(",", ".");
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const match = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function unquote(value = "") {
  return unquoteStepString(value);
}

export function quote(value: string) {
  return quoteStepString(value);
}

function quoteOrDollar(value: string) {
  return value.trim() ? quote(value.trim()) : "$";
}

function createMaterialEntity(
  id: number,
  materialName: string,
  category = "",
): NativeIfcEntity {
  const cleanName = materialName.trim() || "Material";
  return {
    args: [quote(cleanName), "$", quoteOrDollar(category)],
    description: "",
    globalId: "",
    id,
    name: cleanName,
    type: "IFCMATERIAL",
  };
}

function createGroupEntity(
  id: number,
  groupType: string,
  groupName: string,
  objectType = "",
  longName = "",
): NativeIfcEntity {
  const cleanType = normalizeGroupType(groupType);
  const cleanName = groupName.trim() || shortGroupName(cleanType);
  const args = [
    quote(createIfcGuid(id)),
    "$",
    quote(cleanName),
    "$",
    quoteOrDollar(objectType),
  ];
  if (cleanType === "IFCZONE") {
    args.push(quoteOrDollar(longName || cleanName));
  }
  return {
    args,
    description: "",
    globalId: createIfcGuid(id),
    id,
    name: cleanName,
    type: cleanType,
  };
}

function createAssociationEntity(
  id: number,
  entityId: number,
  resourceId: number,
  relationshipType: string,
  relationshipName: string,
): NativeIfcEntity {
  return {
    args: [
      quote(createIfcGuid(id)),
      "$",
      quote(relationshipName),
      "$",
      `(#${entityId})`,
      `#${resourceId}`,
    ],
    description: "",
    globalId: createIfcGuid(id),
    id,
    name: relationshipName,
    type: relationshipType,
  };
}

function createGroupAssignmentEntity(
  id: number,
  entityId: number,
  groupId: number,
  relationshipName: string,
): NativeIfcEntity {
  return {
    args: [
      quote(createIfcGuid(id)),
      "$",
      quote(relationshipName),
      "$",
      `(#${entityId})`,
      "$",
      `#${groupId}`,
    ],
    description: "",
    globalId: createIfcGuid(id),
    id,
    name: relationshipName,
    type: "IFCRELASSIGNSTOGROUP",
  };
}

function setArg(args: string[], index: number, value: string) {
  while (args.length <= index) {
    args.push("$");
  }
  args[index] = value;
}

function appendReference(args: string[], index: number, id: number) {
  const refs = readReferences(args[index]);
  setArg(args, index, formatReferenceList([...refs, id]));
}

function formatReferenceList(refs: number[]) {
  return `(${refs.map((ref) => `#${ref}`).join(",")})`;
}

function hasIncomingReferenceExcept(
  document: NativeIfcDocument,
  entityId: number,
  sourceId: number,
) {
  return (document.incomingRefs.get(entityId) ?? []).some(
    (incoming) => incoming.id !== sourceId,
  );
}

function appendNativeEntities(
  document: NativeIfcDocument,
  addedEntities: NativeIfcEntity[],
): NativeIfcDocument {
  if (addedEntities.length === 0) {
    return document;
  }

  const entities = [...document.entities, ...addedEntities];
  const entityById = new Map(document.entityById);
  const entitiesByType = new Map(document.entitiesByType);
  const outgoingRefs = new Map(document.outgoingRefs);
  const incomingRefs = new Map(document.incomingRefs);
  let relationships = document.relationships;
  let relationshipsByEntity = document.relationshipsByEntity;
  let propertySetsByEntity = document.propertySetsByEntity;
  let resourcesByEntity = document.resourcesByEntity;

  for (const entity of addedEntities) {
    entityById.set(entity.id, entity);
    addMapValueCopy(entitiesByType, entity.type, entity);

    const refs = readUniqueReferencesFromArgs(entity.args);
    outgoingRefs.set(entity.id, refs);
    for (const ref of refs) {
      addMapValueCopy(incomingRefs, ref, entity);
    }

    if (!entity.type.startsWith("IFCREL")) {
      continue;
    }

    const [sourceIds, targetIds] = relationshipEnds(entity);
    const relationship: NativeIfcRelationship = {
      family: RELATIONSHIP_FAMILIES[entity.type] ?? "relationship",
      id: entity.id,
      sourceIds,
      targetIds,
      type: entity.type,
    };
    relationships = [...relationships, relationship];
    relationshipsByEntity = new Map(relationshipsByEntity);
    for (const id of new Set([...sourceIds, ...targetIds])) {
      addMapValueCopy(relationshipsByEntity, id, relationship);
    }

    if (
      entity.type.startsWith("IFCRELASSOCIATES") ||
      entity.type === "IFCRELASSIGNSTOGROUP"
    ) {
      const materialPropertiesByMaterial = readMaterialPropertiesFromIncoming(
        targetIds,
        incomingRefs,
      );
      const materialRepresentationsByMaterial =
        readMaterialRepresentationsFromIncoming(
          targetIds,
          incomingRefs,
          entityById,
        );
      const resources = targetIds.map((id) => {
        const resource = entityById.get(id);
        return resource
          ? resourceSummary(
              resource,
              entityById,
              materialPropertiesByMaterial,
              materialRepresentationsByMaterial,
            )
          : `#${id}`;
      });
      if (resources.length) {
        resourcesByEntity = new Map(resourcesByEntity);
        for (const objectId of sourceIds) {
          for (const resource of resources) {
            addMapValueCopy(resourcesByEntity, objectId, resource);
          }
        }
      }
    }

    if (entity.type !== "IFCRELDEFINESBYPROPERTIES") {
      continue;
    }
    const definitionId = targetIds[0];
    const definition = entityById.get(definitionId);
    const propertySet = definition
      ? buildPropertySet(definition, entityById)
      : undefined;
    if (!propertySet) {
      continue;
    }
    propertySetsByEntity = new Map(propertySetsByEntity);
    for (const objectId of sourceIds) {
      addMapValueCopy(propertySetsByEntity, objectId, propertySet);
    }
  }

  return {
    ...document,
    entities,
    entityById,
    entitiesByType,
    incomingRefs,
    outgoingRefs,
    propertySetsByEntity,
    relationships,
    relationshipsByEntity,
    resourcesByEntity,
  };
}

function replaceNativeEntities(
  document: NativeIfcDocument,
  updatedEntities: NativeIfcEntity[],
): NativeIfcDocument {
  if (updatedEntities.length === 0) {
    return document;
  }

  const updates = new Map(updatedEntities.map((entity) => [entity.id, entity]));
  let entityById = document.entityById;
  let entitiesByType = document.entitiesByType;
  let outgoingRefs = document.outgoingRefs;
  let incomingRefs = document.incomingRefs;

  const entities = document.entities.map(
    (entity) => updates.get(entity.id) ?? entity,
  );

  for (const updatedEntity of updatedEntities) {
    const previousEntity = document.entityById.get(updatedEntity.id);
    if (!previousEntity) {
      continue;
    }

    if (entityById === document.entityById) {
      entityById = new Map(document.entityById);
    }
    entityById.set(updatedEntity.id, updatedEntity);

    if (entitiesByType === document.entitiesByType) {
      entitiesByType = new Map(document.entitiesByType);
    }
    replaceEntityByType(entitiesByType, previousEntity, updatedEntity);

    const previousRefs = document.outgoingRefs.get(updatedEntity.id) ?? [];
    const nextRefs = readUniqueReferencesFromArgs(updatedEntity.args);
    if (!sameNumberSet(previousRefs, nextRefs)) {
      if (outgoingRefs === document.outgoingRefs) {
        outgoingRefs = new Map(document.outgoingRefs);
      }
      if (incomingRefs === document.incomingRefs) {
        incomingRefs = new Map(document.incomingRefs);
      }
      outgoingRefs.set(updatedEntity.id, nextRefs);
      for (const ref of previousRefs) {
        removeIncomingEntity(incomingRefs, ref, updatedEntity.id);
      }
      for (const ref of nextRefs) {
        addMapValueCopy(incomingRefs, ref, updatedEntity);
      }
    }
  }

  return {
    ...document,
    entities,
    entityById,
    entitiesByType,
    incomingRefs,
    outgoingRefs,
  };
}

function updatePropertySetSummaries(
  document: NativeIfcDocument,
  setId: number,
): NativeIfcDocument {
  const setEntity = document.entityById.get(setId);
  const propertySet = setEntity
    ? buildPropertySet(setEntity, document.entityById)
    : undefined;
  if (!propertySet) {
    return document;
  }

  let changed = false;
  const propertySetsByEntity = new Map(document.propertySetsByEntity);
  for (const [entityId, sets] of document.propertySetsByEntity) {
    if (!sets.some((set) => set.id === setId)) {
      continue;
    }
    changed = true;
    propertySetsByEntity.set(
      entityId,
      sets.map((set) => (set.id === setId ? propertySet : set)),
    );
  }

  return changed ? { ...document, propertySetsByEntity } : document;
}

function updatePropertySetSummariesContainingValue(
  document: NativeIfcDocument,
  propertyId: number,
): NativeIfcDocument {
  const rebuiltSets = new Map<number, NativeIfcPropertySet>();
  let changed = false;
  const propertySetsByEntity = new Map(document.propertySetsByEntity);

  for (const [entityId, sets] of document.propertySetsByEntity) {
    let entryChanged = false;
    const nextSets = sets.map((set) => {
      if (!set.values.some((value) => value.id === propertyId)) {
        return set;
      }
      let rebuilt = rebuiltSets.get(set.id);
      if (!rebuilt) {
        const setEntity = document.entityById.get(set.id);
        rebuilt = setEntity
          ? buildPropertySet(setEntity, document.entityById)
          : undefined;
        if (rebuilt) {
          rebuiltSets.set(set.id, rebuilt);
        }
      }
      if (!rebuilt) {
        return set;
      }
      entryChanged = true;
      return rebuilt;
    });
    if (entryChanged) {
      changed = true;
      propertySetsByEntity.set(entityId, nextSets);
    }
  }

  return changed ? { ...document, propertySetsByEntity } : document;
}

function addMapValueCopy<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const current = map.get(key);
  map.set(key, current ? [...current, value] : [value]);
}

function replaceEntityByType(
  entitiesByType: Map<string, NativeIfcEntity[]>,
  previousEntity: NativeIfcEntity,
  updatedEntity: NativeIfcEntity,
) {
  const previousGroup = entitiesByType.get(previousEntity.type) ?? [];
  if (previousEntity.type === updatedEntity.type) {
    entitiesByType.set(
      updatedEntity.type,
      previousGroup.map((entity) =>
        entity.id === updatedEntity.id ? updatedEntity : entity,
      ),
    );
    return;
  }

  entitiesByType.set(
    previousEntity.type,
    previousGroup.filter((entity) => entity.id !== updatedEntity.id),
  );
  addMapValueCopy(entitiesByType, updatedEntity.type, updatedEntity);
}

function removeIncomingEntity(
  incomingRefs: Map<number, NativeIfcEntity[]>,
  ref: number,
  entityId: number,
) {
  const current = incomingRefs.get(ref);
  if (!current) {
    return;
  }
  const next = current.filter((entity) => entity.id !== entityId);
  if (next.length > 0) {
    incomingRefs.set(ref, next);
  } else {
    incomingRefs.delete(ref);
  }
}

function sameNumberSet(left: number[], right: number[]) {
  if (left.length !== right.length) {
    return false;
  }
  const values = new Set(left);
  return right.every((value) => values.has(value));
}

function cloneDocumentEntities(document: NativeIfcDocument) {
  return document.entities.map((entity) => ({
    ...entity,
    args: [...entity.args],
  }));
}

function normalizeTypeClass(typeClass: string) {
  const normalized = normalizeType(typeClass || "IFCTYPEOBJECT");
  return isTypeObject(normalized) ? normalized : "IFCTYPEOBJECT";
}

function isTypeObject(type: string) {
  return (
    type === "IFCTYPEOBJECT" ||
    type === "IFCELEMENTTYPE" ||
    type.endsWith("TYPE")
  );
}

function isPhysicalProduct(type: string) {
  return (
    type === "IFCBUILTELEMENT" ||
    type === "IFCBUILDINGELEMENTPROXY" ||
    type === "IFCPROXY" ||
    type === "IFCANNOTATION" ||
    type.startsWith("IFCWALL") ||
    type.startsWith("IFCSLAB") ||
    type === "IFCROOF" ||
    type === "IFCBEAM" ||
    type === "IFCCOLUMN" ||
    type === "IFCMEMBER" ||
    type === "IFCPLATE" ||
    type === "IFCDOOR" ||
    type === "IFCWINDOW" ||
    type === "IFCCURTAINWALL" ||
    type === "IFCSTAIR" ||
    type === "IFCRAMP" ||
    type === "IFCRAILING" ||
    type === "IFCFURNISHINGELEMENT" ||
    type === "IFCFLOWTERMINAL" ||
    type === "IFCDISTRIBUTIONELEMENT" ||
    type === "IFCOPENINGELEMENT" ||
    type === "IFCVOIDINGFEATURE" ||
    type === "IFCPROJECTIONELEMENT" ||
    type === "IFCELEMENTASSEMBLY" ||
    type === "IFCTRANSPORTELEMENT"
  );
}

function serializeEntities(
  document: NativeIfcDocument,
  entities: NativeIfcEntity[],
) {
  return [
    "ISO-10303-21;",
    document.headerText.trim(),
    "DATA;",
    ...entities
      .slice()
      .sort((left, right) => left.id - right.id)
      .map(
        (entity) => `#${entity.id}= ${entity.type}(${entity.args.join(",")});`,
      ),
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

function nextEntityId(entities: NativeIfcEntity[]) {
  let maxId = 0;
  for (const entity of entities) {
    if (entity.id > maxId) {
      maxId = entity.id;
    }
  }
  return maxId + 1;
}

function normalizeType(type: string) {
  const normalized = type
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
  return normalized.startsWith("IFC")
    ? normalized
    : `IFC${normalized || "BUILDINGELEMENTPROXY"}`;
}

function enumValue(value: string) {
  const trimmed = value
    .trim()
    .replace(/^\./, "")
    .replace(/\.$/, "")
    .toUpperCase();
  return `.${trimmed}.`;
}

function formatPropertyEntityArgs(
  propertyName: string,
  propertyValue: string,
  spec: { definedValueType?: string; entityType: string; valueType: string },
) {
  const name = quoteOrDollar(propertyName);
  if (spec.entityType === "IFCPROPERTYLISTVALUE") {
    return [
      name,
      "$",
      formatIfcValueList(spec.valueType, splitPropertyValueList(propertyValue)),
      "$",
    ];
  }
  if (spec.entityType === "IFCPROPERTYENUMERATEDVALUE") {
    return [
      name,
      "$",
      formatIfcValueList(spec.valueType, splitPropertyValueList(propertyValue)),
      "$",
    ];
  }
  if (spec.entityType === "IFCPROPERTYBOUNDEDVALUE") {
    const bounded = parseBoundedPropertyText(propertyValue);
    return [
      name,
      "$",
      formatOptionalIfcValue(spec.valueType, bounded.upper),
      formatOptionalIfcValue(spec.valueType, bounded.lower),
      "$",
      formatOptionalIfcValue(spec.valueType, bounded.setPoint),
    ];
  }
  if (spec.entityType === "IFCPROPERTYTABLEVALUE") {
    const table = parseTablePropertyText(propertyValue);
    return [
      name,
      "$",
      formatIfcValueList(spec.valueType, table.definingValues),
      formatIfcValueList(
        spec.definedValueType ?? spec.valueType,
        table.definedValues,
      ),
      "$",
      "$",
      "$",
      "$",
    ];
  }
  return [name, "$", formatIfcValue(spec.valueType, propertyValue), "$"];
}

function formatIfcValue(type: string, value: string) {
  const normalized = normalizeType(type || "IFCLABEL");
  const trimmed = value.trim();
  if (normalized === "IFCBOOLEAN") {
    return `IFCBOOLEAN(.${trimmed.toUpperCase() === "FALSE" ? "F" : "T"}.)`;
  }
  if (normalized === "IFCREAL" || normalized === "IFCINTEGER") {
    return `${normalized}(${Number(trimmed.replace(",", ".")) || 0})`;
  }
  return `${normalized}(${quote(trimmed)})`;
}

function readPropertyValueType(value = "") {
  return readIfcValueType(value);
}

function readPropertyValueTypeSpec(entity: NativeIfcEntity) {
  if (entity.type === "IFCPROPERTYLISTVALUE") {
    return `IFCPROPERTYLISTVALUE:${readIfcValueListType(entity.args[2])}`;
  }
  if (entity.type === "IFCPROPERTYENUMERATEDVALUE") {
    return `IFCPROPERTYENUMERATEDVALUE:${readIfcValueListType(entity.args[2])}`;
  }
  if (entity.type === "IFCPROPERTYBOUNDEDVALUE") {
    return `IFCPROPERTYBOUNDEDVALUE:${readFirstIfcValueType([
      entity.args[2],
      entity.args[3],
      entity.args[5],
    ])}`;
  }
  if (entity.type === "IFCPROPERTYTABLEVALUE") {
    return `IFCPROPERTYTABLEVALUE:${readIfcValueListType(entity.args[2])}:${readIfcValueListType(entity.args[3])}`;
  }
  return readPropertyValueType(entity.args[2]);
}

function readIfcValueType(value = "") {
  return (
    value
      .trim()
      .match(/^([A-Z0-9_]+)\(/i)?.[1]
      ?.toUpperCase() ?? "IFCLABEL"
  );
}

function readIfcValueListType(value = "") {
  const values = readIfcValueList(value);
  return values.length ? readIfcValueType(values[0]) : "IFCLABEL";
}

function readFirstIfcValueType(values: Array<string | undefined>) {
  const value = values.find((item) => item && item !== "$");
  return value ? readIfcValueType(value) : "IFCLABEL";
}

function parsePropertyValueTypeSpec(type: string) {
  const parts = String(type || "IFCLABEL")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .split(":")
    .filter(Boolean);
  const head = parts[0] ?? "IFCLABEL";
  if (SIMPLE_PROPERTY_ENTITY_TYPES.has(head)) {
    return {
      definedValueType: parts[2] ? normalizeType(parts[2]) : undefined,
      entityType: head,
      valueType: normalizeType(parts[1] ?? "IFCLABEL"),
    };
  }
  return {
    entityType: "IFCPROPERTYSINGLEVALUE",
    valueType: normalizeType(head),
  };
}

function formatOptionalIfcValue(type: string, value?: string) {
  return value?.trim() ? formatIfcValue(type, value) : "$";
}

function formatIfcValueList(type: string, values: string[]) {
  return values.length
    ? `(${values.map((value) => formatIfcValue(type, value)).join(",")})`
    : "$";
}

function readIfcValueList(value = "") {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "$") {
    return [];
  }
  return splitTopLevel(trimmed.replace(/^\(/, "").replace(/\)$/, ""));
}

function splitPropertyValueList(value: string) {
  return value
    .split(/\r?\n|;|\|/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoundedPropertyText(value: string) {
  const [rangeText, setPointText] = value.split(";");
  if (rangeText?.includes("..")) {
    const [lower = "", upper = ""] = rangeText.split("..");
    return {
      lower: lower.trim(),
      setPoint: setPointText?.trim(),
      upper: upper.trim(),
    };
  }
  return {
    lower: "",
    setPoint: value.trim(),
    upper: "",
  };
}

function parseTablePropertyText(value: string) {
  const definingValues: string[] = [];
  const definedValues: string[] = [];
  for (const row of splitPropertyValueList(value)) {
    const [defining, defined] = row.includes("=>")
      ? row.split("=>")
      : row.split("=");
    if (!defining?.trim() || !defined?.trim()) {
      continue;
    }
    definingValues.push(defining.trim());
    definedValues.push(defined.trim());
  }
  return { definedValues, definingValues };
}

function parseMaterialRows(
  value: string,
  fallback: NativeMaterialRow[],
): NativeMaterialRow[] {
  const rows = value
    .split(/\r?\n|;/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const separator = row.includes("|") ? "|" : ":";
      const [name = "", materialName = "", amount = "", category = ""] = row
        .split(separator)
        .map((part) => part.trim());
      const cleanName = name || materialName;
      const cleanMaterialName = materialName || name;
      if (!cleanName && !cleanMaterialName) {
        return undefined;
      }
      return {
        category,
        materialName: cleanMaterialName || "Material",
        name: cleanName || "Material Part",
        value: amount,
      };
    })
    .filter((row): row is NativeMaterialRow => Boolean(row));

  return rows.length ? rows : fallback;
}

function parseMaterialPropertyRows(
  value: string,
  fallback: NativeMaterialPropertyRow[],
): NativeMaterialPropertyRow[] {
  const rows = value
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const separator = row.includes("|") ? "|" : ":";
      const [name = "", propertyValue = "", valueType = "IFCLABEL"] = row
        .split(separator)
        .map((part) => part.trim());
      if (!name) {
        return undefined;
      }
      return {
        name,
        value: propertyValue,
        valueType: valueType || "IFCLABEL",
      };
    })
    .filter((row): row is NativeMaterialPropertyRow => Boolean(row));

  return rows.length ? rows : fallback;
}

const BODY_PROFILES: ReadonlySet<string> = new Set([
  "rectangle",
  "cylinder",
  "ellipse",
  "triangle",
  "marker",
]);

/**
 * IFCBUILTELEMENT existiert erst ab IFC4X3 — in IFC4/IFC2X3-Dateien fällt die
 * Klasse auf den überall gültigen IFCBUILDINGELEMENTPROXY zurück, damit die
 * Datei schema-konform bleibt und Fremd-Viewer das Element nicht verwerfen.
 */
function normalizeProductTypeForSchema(schema: string, type: string) {
  if (
    type === "IFCBUILTELEMENT" &&
    !schema.toUpperCase().startsWith("IFC4X3")
  ) {
    return "IFCBUILDINGELEMENTPROXY";
  }
  return type;
}

function normalizeBodyProfile(profile: string | undefined): NativeBodyProfile {
  const token = String(profile ?? "rectangle").toLowerCase();
  return BODY_PROFILES.has(token) ? (token as NativeBodyProfile) : "rectangle";
}

function normalizeGroupType(type: string) {
  const normalized = normalizeType(type || "IFCGROUP");
  return isGroupObject(normalized) ? normalized : "IFCGROUP";
}

function shortGroupName(type: string) {
  if (type === "IFCZONE") {
    return "Zone";
  }
  if (type === "IFCSYSTEM") {
    return "System";
  }
  if (type === "IFCASSET") {
    return "Asset";
  }
  return "Group";
}

function normalizeQuantityType(type: string) {
  const normalized = normalizeType(type || "IFCQUANTITYLENGTH");
  return QUANTITY_TYPES.has(normalized) ? normalized : "IFCQUANTITYLENGTH";
}

function isQuantityType(type: string) {
  return QUANTITY_TYPES.has(type);
}

function isMaterialUsageType(type: string) {
  return (
    type === "IFCMATERIALLAYERSETUSAGE" || type === "IFCMATERIALPROFILESETUSAGE"
  );
}

function formatStepNumber(value: string) {
  const numeric = Number(value.trim().replace(",", "."));
  return Number.isFinite(numeric) ? String(numeric) : "0";
}

function numericStepNumber(
  value: number | string | undefined,
  fallback: number,
) {
  const numeric =
    typeof value === "number"
      ? value
      : Number(
          String(value ?? "")
            .trim()
            .replace(",", "."),
        );
  return formatDecimal(Number.isFinite(numeric) ? numeric : fallback);
}

function positiveStepNumber(
  value: number | string | undefined,
  fallback: number,
) {
  const numeric =
    typeof value === "number"
      ? value
      : Number(
          String(value ?? "")
            .trim()
            .replace(",", "."),
        );
  return formatDecimal(
    Math.max(Number.isFinite(numeric) ? numeric : fallback, 0.05),
  );
}

function nonNegativeStepNumber(
  value: number | string | undefined,
  fallback: number,
) {
  const numeric =
    typeof value === "number"
      ? value
      : Number(
          String(value ?? "")
            .trim()
            .replace(",", "."),
        );
  return formatDecimal(
    Math.max(Number.isFinite(numeric) ? numeric : fallback, 0),
  );
}

function optionalPositiveStepNumber(value: number | string | undefined) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "$";
  }
  const numeric =
    typeof value === "number" ? value : Number(text.replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "$";
  }
  return formatDecimal(numeric);
}

function optionalIntegerStepNumber(
  value: number | string | undefined,
  fallback?: number,
) {
  const text = String(value ?? "").trim();
  if (!text && fallback == null) {
    return "$";
  }
  const numeric =
    typeof value === "number"
      ? value
      : Number((text || String(fallback ?? "")).replace(",", "."));
  if (!Number.isFinite(numeric)) {
    return "$";
  }
  return String(Math.max(Math.round(numeric), 1));
}

function optionalRatioStepNumber(value: number | string | undefined) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "$";
  }
  const numeric =
    typeof value === "number" ? value : Number(text.replace(",", "."));
  if (!Number.isFinite(numeric)) {
    return "$";
  }
  return formatDecimal(Math.min(Math.max(numeric, 0), 1));
}

function colorStepNumbers(value: string) {
  const text = value.trim();
  const hex = text.match(/^#?([0-9a-fA-F]{6})$/)?.[1];
  if (hex) {
    return [0, 2, 4].map((offset) =>
      formatDecimal(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255),
    );
  }

  const parts = text
    .split(/[\s,;|]+/)
    .map((part) => Number(part.trim().replace(",", ".")))
    .filter((part) => Number.isFinite(part));
  if (parts.length >= 3) {
    const scale = parts.some((part) => part > 1) ? 255 : 1;
    return parts
      .slice(0, 3)
      .map((part) => formatDecimal(Math.min(Math.max(part / scale, 0), 1)));
  }

  return ["0.5569", "0.6549", "0.7608"];
}

function multiplyStepNumbers(...values: string[]) {
  return formatDecimal(
    values.reduce((product, value) => product * Number(value), 1),
  );
}

function circleAreaStepNumber(radius: string) {
  return formatDecimal(Math.PI * Number(radius) * Number(radius));
}

function formatDecimal(value: number) {
  const fixed = value.toFixed(4).replace(/0+$/g, "").replace(/\.$/g, "");
  return fixed.includes(".") ? fixed : `${fixed}.`;
}

function setRelationshipArgs(
  entity: NativeIfcEntity,
  type: string,
  sourceId: number,
  targetId: number,
) {
  setArg(entity.args, 0, entity.args[0] || quote(createIfcGuid(entity.id)));
  setArg(entity.args, 1, entity.args[1] || "$");
  setArg(entity.args, 2, entity.args[2] || "$");
  setArg(entity.args, 3, entity.args[3] || "$");

  if (
    type === "IFCRELCONTAINEDINSPATIALSTRUCTURE" ||
    type === "IFCRELREFERENCEDINSPATIALSTRUCTURE"
  ) {
    setArg(entity.args, 4, `(#${targetId})`);
    setArg(entity.args, 5, `#${sourceId}`);
    return;
  }

  if (type === "IFCRELASSOCIATESCONSTRAINT") {
    setArg(entity.args, 4, `(#${sourceId})`);
    setArg(
      entity.args,
      5,
      readReferences(entity.args[5]).length ? "$" : entity.args[5] || "$",
    );
    setArg(entity.args, 6, `#${targetId}`);
    return;
  }

  if (type === "IFCRELASSIGNSTOGROUP") {
    setArg(entity.args, 4, `(#${sourceId})`);
    setArg(entity.args, 5, "$");
    setArg(entity.args, 6, `#${targetId}`);
    return;
  }

  setArg(
    entity.args,
    4,
    type.startsWith("IFCRELASSOCIATES") ||
      type.startsWith("IFCRELASSIGNS") ||
      type.startsWith("IFCRELDEFINES")
      ? `(#${sourceId})`
      : `#${sourceId}`,
  );
  setArg(
    entity.args,
    5,
    type.startsWith("IFCRELASSOCIATES") || type.startsWith("IFCRELASSIGNS")
      ? `#${targetId}`
      : `(#${targetId})`,
  );
}

function createIfcGuid(seed: number) {
  return `0IFCnative${String(seed).padStart(12, "0")}`.slice(0, 22);
}

function unique(values: number[]) {
  return [
    ...new Set(values.filter((value) => Number.isFinite(value) && value > 0)),
  ];
}

function isSpatial(type: string) {
  return [
    "IFCSITE",
    "IFCBUILDING",
    "IFCBUILDINGSTOREY",
    "IFCSPACE",
    "IFCFACILITY",
  ].includes(type);
}

function isGroupObject(type: string) {
  return (
    type === "IFCGROUP" ||
    type === "IFCSYSTEM" ||
    type === "IFCZONE" ||
    type === "IFCASSET" ||
    type === "IFCBUILDINGSYSTEM" ||
    type === "IFCBUILTSYSTEM" ||
    type === "IFCDISTRIBUTIONSYSTEM" ||
    type === "IFCDISTRIBUTIONCIRCUIT" ||
    type === "IFCSTRUCTURALANALYSISMODEL" ||
    type === "IFCSTRUCTURALLOADGROUP" ||
    type === "IFCSTRUCTURALLOADCASE" ||
    type === "IFCSTRUCTURALRESULTGROUP" ||
    type === "IFCINVENTORY"
  );
}

function isRepresentationAssignableProduct(entity: NativeIfcEntity) {
  return (
    !entity.type.startsWith("IFCREL") &&
    !entity.type.startsWith("IFCPROPERTY") &&
    !entity.type.startsWith("IFCQUANTITY") &&
    ![
      "IFCPROJECT",
      "IFCOWNERHISTORY",
      "IFCAPPLICATION",
      "IFCUNITASSIGNMENT",
      "IFCSIUNIT",
    ].includes(entity.type) &&
    entity.args.length >= 7
  );
}

function compactValue(value: string) {
  return decodeStepValue(value).replace(/\s+/g, " ").slice(0, 160) || "-";
}
