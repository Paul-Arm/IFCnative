import { createMinimalIfcProject } from "./builder";

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
  IFCRELASSIGNSTOGROUP: "group",
};

const QUANTITY_TYPES = new Set([
  "IFCQUANTITYLENGTH",
  "IFCQUANTITYAREA",
  "IFCQUANTITYVOLUME",
  "IFCQUANTITYCOUNT",
  "IFCQUANTITYWEIGHT",
  "IFCQUANTITYTIME",
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
    ...validateNativeDocument(entities, entityById, relationships, units),
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

export function addNativeElement(
  document: NativeIfcDocument,
  parentId: number | undefined,
  type: string,
  name: string,
) {
  const next = cloneDocumentEntities(document);
  const id = nextEntityId(next);
  next.push({
    args: [quote(createIfcGuid(id)), "$", quote(name), "$", "$", "$", "$", "$"],
    description: "",
    globalId: createIfcGuid(id),
    id,
    name,
    type: normalizeType(type),
  });

  if (parentId && document.entityById.has(parentId)) {
    const relId = nextEntityId(next);
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

  const shapeId = nextEntityId(next);
  const representationId = shapeId + 1;
  const solidId = shapeId + 2;
  const solidAxisId = shapeId + 3;
  const solidPointId = shapeId + 4;
  const profileId = shapeId + 5;
  const profileAxisId = shapeId + 6;
  const profilePointId = shapeId + 7;
  const extrusionDirectionId = shapeId + 8;
  const profileDirectionId = shapeId + 9;
  const quantityId = shapeId + 10;
  const heightQuantityId = shapeId + 11;
  const areaQuantityId = shapeId + 12;
  const volumeQuantityId = shapeId + 13;
  const quantityRelId = shapeId + 14;
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
  const next = cloneDocumentEntities(document);
  const propertyId = nextEntityId(next);
  next.push({
    args: [
      quote(propertyName),
      "$",
      formatPropertyValue(propertyValueType, propertyValue),
      "$",
    ],
    description: "",
    globalId: "",
    id: propertyId,
    name: propertyName,
    type: "IFCPROPERTYSINGLEVALUE",
  });
  const psetId = nextEntityId(next);
  next.push({
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
  });
  const relId = nextEntityId(next);
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
  return parseNativeIfcText(
    serializeEntities(document, next),
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
  const next = cloneDocumentEntities(document);
  const normalizedQuantityType = normalizeQuantityType(quantityType);
  const quantityId = nextEntityId(next);
  next.push({
    args: [quote(quantityName), "$", "$", formatStepNumber(quantityValue), "$"],
    description: "",
    globalId: "",
    id: quantityId,
    name: quantityName,
    type: normalizedQuantityType,
  });
  const qtoId = nextEntityId(next);
  next.push({
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
  });
  const relId = nextEntityId(next);
  next.push({
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
  });
  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export function updateNativePropertyValue(
  document: NativeIfcDocument,
  propertyId: number,
  updates: { name?: string; value?: string; valueType?: string },
) {
  const next = cloneDocumentEntities(document);
  const property = next.find((entity) => entity.id === propertyId);
  if (
    !property ||
    (property.type !== "IFCPROPERTYSINGLEVALUE" &&
      !isQuantityType(property.type))
  ) {
    return document;
  }

  if (updates.name != null) {
    setArg(property.args, 0, quoteOrDollar(updates.name));
  }
  if (updates.value != null) {
    if (isQuantityType(property.type)) {
      property.type = normalizeQuantityType(updates.valueType ?? property.type);
      setArg(property.args, 3, formatStepNumber(updates.value));
    } else {
      setArg(
        property.args,
        2,
        formatPropertyValue(
          updates.valueType ?? readPropertyValueType(property.args[2]),
          updates.value,
        ),
      );
    }
  }

  return parseNativeIfcText(
    serializeEntities(document, next),
    document.fileName,
  );
}

export function addNativeMaterial(
  document: NativeIfcDocument,
  entityId: number,
  materialName: string,
  materialCategory = "",
) {
  const next = cloneDocumentEntities(document);
  const materialId = nextEntityId(next);
  next.push({
    args: [quote(materialName), "$", quoteOrDollar(materialCategory)],
    description: "",
    globalId: "",
    id: materialId,
    name: materialName,
    type: "IFCMATERIAL",
  });
  return addNativeAssociation(
    document,
    next,
    entityId,
    "IFCRELASSOCIATESMATERIAL",
    "Material",
    materialId,
  );
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
  if (type === "IFCSIUNIT") {
    return compactValue([args[1], args[2], args[3]].filter(Boolean).join(" "));
  }
  return unquote(args[2]) ?? "";
}

function readEntityDescription(type: string, args: string[]) {
  if (type === "IFCMATERIAL") {
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
          value: compactValue(
            value.args[2] && value.args[2] !== "$"
              ? value.args[2]
              : (value.args[3] ?? ""),
          ),
        });
      }
      return values;
    }, []),
  };
}

function readResources(
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const result = new Map<number, string[]>();
  for (const rel of entities) {
    if (!rel.type.startsWith("IFCRELASSOCIATES")) {
      continue;
    }
    const objectIds = readReferences(rel.args[4]);
    const resources = readReferencesFromArgs(rel.args, 5).map((id) => {
      const resource = entityById.get(id);
      return resource
        ? `${resource.type} #${id} ${resource.name || compactValue(resource.args.join(","))}`
        : `#${id}`;
    });
    for (const objectId of objectIds) {
      pushMapValues(result, objectId, resources);
    }
  }
  return result;
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
  entities: NativeIfcEntity[],
  entityById: Map<number, NativeIfcEntity>,
  relationships: NativeIfcRelationship[],
  units: string[],
) {
  const diagnostics: string[] = [];
  const globalIdOwners = new Map<string, number[]>();
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

  if (units.length === 0) {
    diagnostics.push("Warning: no IFCUNITASSIGNMENT units are indexed.");
  }

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
  visited = new Set<number>(),
): NativeIfcTreeNode {
  visited.add(id);
  const children: NativeIfcTreeNode[] = [];
  for (const child of childrenByParent.get(id) ?? []) {
    if (entityById.has(child.id) && !visited.has(child.id)) {
      children.push(
        buildTreeNode(
          child.id,
          entityById,
          childrenByParent,
          child.relation,
          visited,
        ),
      );
    }
  }
  visited.delete(id);
  return {
    children,
    id,
    relation,
  };
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

export function unquote(value = "") {
  const trimmed = value.trim();
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) {
    return undefined;
  }
  return trimmed.slice(1, -1).replace(/''/g, "'");
}

export function quote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteOrDollar(value: string) {
  return value.trim() ? quote(value.trim()) : "$";
}

function setArg(args: string[], index: number, value: string) {
  while (args.length <= index) {
    args.push("$");
  }
  args[index] = value;
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
  return Math.max(0, ...entities.map((entity) => entity.id)) + 1;
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

function formatPropertyValue(type: string, value: string) {
  const normalized = normalizeType(type || "IFCLABEL");
  const trimmed = value.trim();
  if (normalized === "IFCBOOLEAN") {
    return `IFCBOOLEAN(.${trimmed.toUpperCase() === "FALSE" ? "F" : "T"}.)`;
  }
  if (normalized === "IFCREAL" || normalized === "IFCINTEGER") {
    return `${normalized}(${Number(trimmed) || 0})`;
  }
  return `${normalized}(${quote(trimmed)})`;
}

function readPropertyValueType(value = "") {
  return value.trim().match(/^([A-Z0-9_]+)\(/i)?.[1] ?? "IFCLABEL";
}

function normalizeBodyProfile(profile: string | undefined) {
  return String(profile ?? "rectangle").toLowerCase() === "cylinder"
    ? "cylinder"
    : "rectangle";
}

function normalizeQuantityType(type: string) {
  const normalized = normalizeType(type || "IFCQUANTITYLENGTH");
  return QUANTITY_TYPES.has(normalized) ? normalized : "IFCQUANTITYLENGTH";
}

function isQuantityType(type: string) {
  return QUANTITY_TYPES.has(type);
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
  return value.replace(/\s+/g, " ").slice(0, 160) || "-";
}
