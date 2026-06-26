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

export type NativeBodyProfile = "rectangle" | "cylinder";

export interface NativeBodyElementOptions {
  type: string;
  name: string;
  parentId?: number;
  placementMode?: "parent" | "world";
  width: number | string;
  depth: number | string;
  height: number | string;
  profile?: NativeBodyProfile | string;
  x?: number | string;
  y?: number | string;
  z?: number | string;
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
        Boolean(entity) && entity.type === "IFCSHAPEREPRESENTATION",
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

  const next = cloneDocumentEntities(document);
  const point = next.find(
    (entity) =>
      entity.id === placement.pointId && entity.type === "IFCCARTESIANPOINT",
  );
  if (!point) {
    return document;
  }

  const x = numericStepNumber(coordinates.x, placement.x);
  const y = numericStepNumber(coordinates.y, placement.y);
  const z = numericStepNumber(coordinates.z, placement.z);
  setArg(point.args, 0, `(${x},${y},${z})`);

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
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
  const axisPlacement = next.find(
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
  const axisDirection = ensureDirectionEntity(
    next,
    axisPlacement.args[1],
    nextId,
  );
  nextId = Math.max(nextId, axisDirection.id + 1);
  const refDirectionEntity = ensureDirectionEntity(
    next,
    axisPlacement.args[2],
    nextId,
  );
  setArg(axisPlacement.args, 1, `#${axisDirection.id}`);
  setArg(axisPlacement.args, 2, `#${refDirectionEntity.id}`);
  setArg(axisDirection.args, 0, formatDirectionTuple(axis));
  setArg(refDirectionEntity.args, 0, formatDirectionTuple(refDirection));

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
    next.push({
      args: [
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
      type: "IFCRELAGGREGATES",
    });
  }

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
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
  const parentPlacementRef =
    options.placementMode === "world"
      ? "$"
      : parent?.args[5]?.startsWith("#")
        ? parent.args[5]
        : "$";
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
  const x = numericStepNumber(options.x, 0);
  const y = numericStepNumber(options.y, 0);
  const z = numericStepNumber(options.z, 0);
  const productType = normalizeType(options.type || "IFCBUILTELEMENT");
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
          ? [".AREA.", quote("Cylindrical Body"), `#${profileAxisId}`, radius]
          : [
              ".AREA.",
              quote("Rectangular Body"),
              `#${profileAxisId}`,
              width,
              depth,
            ],
      description: "",
      globalId: "",
      id: profileId,
      name: profile === "cylinder" ? "Cylindrical Body" : "Rectangular Body",
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

export function removeNativeEntity(
  document: NativeIfcDocument,
  entityId: number,
) {
  const entity = document.entityById.get(entityId);
  if (!entity || entity.type === "IFCPROJECT") {
    return document;
  }

  const removedIds = collectCascadeRemovalIds(document, entityId);
  if (removedIds.size === 0 || removedIds.size >= document.entities.length) {
    return document;
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
  "IFCBUILDINGSYSTEM",
  "IFCDISTRIBUTIONSYSTEM",
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

  // Seed candidates from everything the removed entities referenced.
  const queue: number[] = [];
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

function ensureDirectionEntity(
  entities: NativeIfcEntity[],
  reference: string | undefined,
  fallbackId: number,
) {
  const directionId = readReferences(reference ?? "")[0];
  const existing = directionId
    ? entities.find(
        (entity) => entity.id === directionId && entity.type === "IFCDIRECTION",
      )
    : undefined;
  if (existing) {
    return existing;
  }
  const created: NativeIfcEntity = {
    args: ["(0.,0.,1.)"],
    description: "",
    globalId: "",
    id: fallbackId,
    name: "",
    type: "IFCDIRECTION",
  };
  entities.push(created);
  return created;
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

function normalizeBodyProfile(profile: string | undefined) {
  return String(profile ?? "rectangle").toLowerCase() === "cylinder"
    ? "cylinder"
    : "rectangle";
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
    type === "IFCSTRUCTURALANALYSISMODEL" ||
    type === "IFCSTRUCTURALLOADGROUP" ||
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
