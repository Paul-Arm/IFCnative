import type {
    ItemData,
    ItemsDataConfig,
    SpatialTreeItem,
} from "@thatopen/fragments";

import type {
    NativeIfcDocument,
    NativeIfcEntity,
    NativeIfcPropertySet,
    NativeIfcRelationship,
    NativeIfcTreeNode,
    NativeIfcTypeAssignment,
} from "./nativeDocument";

export interface FragmentDocumentModel {
  getAttributeNames?(): Promise<string[]>;
  getCategories(): Promise<string[]>;
  getGuidsByLocalIds(localIds: number[]): Promise<(string | null)[]>;
  getItemsData(
    ids: number[],
    config?: Partial<ItemsDataConfig>,
  ): Promise<ItemData[]>;
  getItemsOfCategories(categories: RegExp[]): Promise<Record<string, number[]>>;
  getLocalIds(): Promise<number[]>;
  getMetadata<
    T extends Record<string, unknown> = Record<string, unknown>,
  >(): Promise<T>;
  getRelationNames?(): Promise<string[]>;
  getSpatialStructure(): Promise<SpatialTreeItem>;
  modelId?: string;
}

export interface BuildFragmentDocumentOptions {
  chunkSize?: number;
  fileName: string;
}

export async function buildNativeDocumentFromFragments(
  model: FragmentDocumentModel,
  options: BuildFragmentDocumentOptions,
): Promise<NativeIfcDocument> {
  const diagnostics: string[] = [];
  const chunkSize = options.chunkSize ?? 1500;
  const localIds = uniqueNumbers(await model.getLocalIds());
  const [metadata, categoryById, guids, attributeNames, relationNames] =
    await Promise.all([
      model.getMetadata().catch(() => ({})),
      readCategoriesByLocalId(model),
      readGuidsByLocalId(model, localIds, chunkSize),
      model.getAttributeNames?.().catch(() => []) ?? Promise.resolve([]),
      model.getRelationNames?.().catch(() => []) ?? Promise.resolve([]),
    ]);
  const itemData = await readItemsData(model, localIds, chunkSize, {
    attributesDefault: true,
    relations: {
      DefinesOccurrence: { attributes: true, relations: true },
      HasAssociations: { attributes: true, relations: false },
      HasProperties: { attributes: true, relations: false },
      IsDefinedBy: { attributes: true, relations: true },
      Quantities: { attributes: true, relations: false },
    },
    relationsDefault: { attributes: false, relations: false },
  });
  const dataById = new Map<number, ItemData>();
  localIds.forEach((localId, index) => dataById.set(localId, itemData[index]));

  const entities = localIds.map<NativeIfcEntity>((localId) => {
    const data = dataById.get(localId);
    const category = categoryById.get(localId) ?? readCategory(data);
    return {
      args: [],
      description: readStringAttribute(data, ["Description", "description"]),
      globalId:
        guids.get(localId) ??
        readStringAttribute(data, ["GlobalId", "GlobalID", "globalId", "guid"]),
      id: localId,
      name: readStringAttribute(data, [
        "Name",
        "name",
        "LongName",
        "ObjectType",
      ]),
      type: normalizeIfcType(
        category ?? readStringAttribute(data, ["type", "Type", "class"]),
      ),
    };
  });
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const entitiesByType = groupMap(entities, (entity) => entity.type);
  const relationships = readFragmentRelationships(
    localIds,
    dataById,
    entityById,
  );
  const relationshipsByEntity = new Map<number, NativeIfcRelationship[]>();
  for (const relationship of relationships) {
    for (const id of uniqueNumbers([
      ...relationship.sourceIds,
      ...relationship.targetIds,
    ])) {
      pushMapValue(relationshipsByEntity, id, relationship);
    }
  }
  const propertySetsByEntity = new Map<number, NativeIfcPropertySet[]>();
  const resourcesByEntity = new Map<number, string[]>();
  for (const localId of localIds) {
    const data = dataById.get(localId);
    const psets = readFragmentPropertySets(data);
    if (psets.length) {
      propertySetsByEntity.set(localId, psets);
    }
    const resources = readFragmentResources(data);
    if (resources.length) {
      resourcesByEntity.set(localId, resources);
    }
  }
  const typeAssignmentsByEntity = readTypeAssignments(
    relationships,
    entityById,
  );
  const spatialRoots = await model
    .getSpatialStructure()
    .then((root) => spatialTreeToNativeRoots(root, entityById))
    .catch(() => []);
  const roots = spatialRoots.length
    ? spatialRoots
    : entities
        .filter((entity) => entity.type === "IFCPROJECT")
        .map((entity) => ({ children: [], id: entity.id, relation: "root" }));
  const outgoingRefs = new Map<number, number[]>();
  const incomingRefs = new Map<number, NativeIfcEntity[]>();
  for (const relationship of relationships) {
    for (const source of relationship.sourceIds) {
      const targets = uniqueNumbers([
        ...(outgoingRefs.get(source) ?? []),
        ...relationship.targetIds,
      ]);
      outgoingRefs.set(source, targets);
      for (const target of relationship.targetIds) {
        const sourceEntity = entityById.get(source);
        if (sourceEntity) {
          pushMapValue(incomingRefs, target, sourceEntity);
        }
      }
    }
  }

  diagnostics.push(
    `Loaded ${entities.length.toLocaleString()} Fragments items from ${model.modelId ?? options.fileName}.`,
  );
  diagnostics.push(
    `Indexed ${relationships.length.toLocaleString()} Fragments relationships.`,
  );
  if (attributeNames.length) {
    diagnostics.push(
      `Fragments attributes: ${attributeNames.slice(0, 12).join(", ")}${attributeNames.length > 12 ? " ..." : ""}.`,
    );
  }
  if (relationNames.length) {
    diagnostics.push(
      `Fragments relations: ${relationNames.slice(0, 12).join(", ")}${relationNames.length > 12 ? " ..." : ""}.`,
    );
  }

  return {
    diagnostics,
    entities,
    entitiesByType,
    entityById,
    fileName: options.fileName,
    headerText:
      "HEADER;\nFILE_DESCRIPTION(('Fragments session'),'2;1');\nENDSEC;",
    incomingRefs,
    outgoingRefs,
    propertySetsByEntity,
    relationships,
    relationshipsByEntity,
    resourcesByEntity,
    schema: readMetadataSchema(metadata),
    spatialRoots: roots,
    typeAssignmentsByEntity,
    units: [],
  };
}

async function readItemsData(
  model: FragmentDocumentModel,
  localIds: number[],
  chunkSize: number,
  config: Partial<ItemsDataConfig>,
) {
  const result: ItemData[] = [];
  for (let index = 0; index < localIds.length; index += chunkSize) {
    const chunk = localIds.slice(index, index + chunkSize);
    result.push(...(await model.getItemsData(chunk, config)));
  }
  return result;
}

async function readGuidsByLocalId(
  model: FragmentDocumentModel,
  localIds: number[],
  chunkSize: number,
) {
  const result = new Map<number, string>();
  for (let index = 0; index < localIds.length; index += chunkSize) {
    const chunk = localIds.slice(index, index + chunkSize);
    const guids = await model.getGuidsByLocalIds(chunk).catch(() => []);
    chunk.forEach((localId, chunkIndex) => {
      const guid = guids[chunkIndex];
      if (guid) {
        result.set(localId, guid);
      }
    });
  }
  return result;
}

async function readCategoriesByLocalId(model: FragmentDocumentModel) {
  const result = new Map<number, string>();
  const categories = await model.getCategories().catch(() => []);
  for (const category of categories) {
    const items = await model
      .getItemsOfCategories([new RegExp(`^${escapeRegex(category)}$`, "i")])
      .catch(() => ({}));
    for (const id of Object.values(items).flat()) {
      if (Number.isFinite(id)) {
        result.set(id, category);
      }
    }
  }
  return result;
}

function readFragmentRelationships(
  localIds: number[],
  dataById: Map<number, ItemData>,
  entityById: Map<number, NativeIfcEntity>,
) {
  const relationships: NativeIfcRelationship[] = [];
  const seen = new Set<string>();
  let syntheticId = 900_000_000;
  for (const localId of localIds) {
    const data = dataById.get(localId);
    if (!data) {
      continue;
    }
    for (const [relationName, rawValue] of Object.entries(data)) {
      const relatedItems = readRelationItems(rawValue);
      if (!relatedItems.length) {
        continue;
      }
      const mapped = mapRelation(
        relationName,
        localId,
        relatedItems,
        entityById,
      );
      if (!mapped.targetIds.length || !mapped.sourceIds.length) {
        continue;
      }
      const key = `${mapped.type}:${mapped.sourceIds.join(",")}:${mapped.targetIds.join(",")}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      relationships.push({
        family: mapped.family,
        id: syntheticId++,
        sourceIds: mapped.sourceIds,
        targetIds: mapped.targetIds,
        type: mapped.type,
      });
    }
  }
  return relationships;
}

function mapRelation(
  relationName: string,
  sourceId: number,
  relatedItems: number[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const name = relationName.trim();
  const upper = name.toUpperCase();
  const reverse = REVERSE_RELATIONS.has(upper);
  const type = RELATION_NAME_TO_IFC_TYPE[upper] ?? normalizeIfcType(name);
  const sourceIds = reverse
    ? relatedItems.filter((id) => entityById.has(id))
    : [sourceId];
  const targetIds = reverse
    ? [sourceId]
    : relatedItems.filter((id) => entityById.has(id));
  return {
    family: RELATION_FAMILY[type] ?? name,
    sourceIds: uniqueNumbers(sourceIds),
    targetIds: uniqueNumbers(targetIds),
    type,
  };
}

const REVERSE_RELATIONS = new Set([
  "DECOMPOSES",
  "CONTAINEDINSTRUCTURE",
  "DEFINEDBY",
  "ASSOCIATEDTO",
]);

const RELATION_NAME_TO_IFC_TYPE: Record<string, string> = {
  ASSOCIATEDTO: "IFCRELASSOCIATES",
  CONTAINEDINSTRUCTURE: "IFCRELCONTAINEDINSPATIALSTRUCTURE",
  CONTAINSELEMENTS: "IFCRELCONTAINEDINSPATIALSTRUCTURE",
  DECOMPOSES: "IFCRELAGGREGATES",
  DEFINESOCCURRENCE: "IFCRELDEFINESBYTYPE",
  HASASSOCIATIONS: "IFCRELASSOCIATES",
  HASASSIGNMENTS: "IFCRELASSIGNSTOGROUP",
  ISDECOMPOSEDBY: "IFCRELAGGREGATES",
  ISDEFINEDBY: "IFCRELDEFINESBYPROPERTIES",
  NESTS: "IFCRELNESTS",
  REFERENCES: "IFCRELREFERENCEDINSPATIALSTRUCTURE",
};

const RELATION_FAMILY: Record<string, string> = {
  IFCRELAGGREGATES: "aggregates",
  IFCRELASSIGNSTOGROUP: "group",
  IFCRELASSOCIATES: "resource",
  IFCRELCONTAINEDINSPATIALSTRUCTURE: "contains",
  IFCRELDEFINESBYPROPERTIES: "defines properties",
  IFCRELDEFINESBYTYPE: "defines type",
  IFCRELNESTS: "nests",
  IFCRELREFERENCEDINSPATIALSTRUCTURE: "references",
};

function readFragmentPropertySets(data: ItemData | undefined) {
  const sets: NativeIfcPropertySet[] = [];
  for (const setData of readNamedRelationData(data, [
    "IsDefinedBy",
    "DefinesOccurrence",
    "HasPropertySets",
  ])) {
    const name = readStringAttribute(setData, ["Name", "name"]);
    if (!name) {
      continue;
    }
    const values = readPropertyValues(setData);
    sets.push({
      id: readLocalId(setData) ?? 0,
      kind: readCategory(setData) || "IFCPROPERTYSET",
      name,
      values,
    });
  }
  return sets;
}

function readPropertyValues(setData: ItemData) {
  const values: NativeIfcPropertySet["values"] = [];
  for (const propertyData of readNestedItemArrays(setData)) {
    const name = readStringAttribute(propertyData, ["Name", "name"]);
    if (!name) {
      continue;
    }
    const value = readStringAttribute(propertyData, [
      "NominalValue",
      "LengthValue",
      "AreaValue",
      "VolumeValue",
      "CountValue",
      "WeightValue",
      "TimeValue",
      "Value",
      "value",
    ]);
    values.push({
      id: readLocalId(propertyData) ?? 0,
      name,
      type: readStringAttribute(propertyData, [
        "valueType",
        "ValueType",
        "type",
        "Type",
      ]),
      value,
    });
  }
  return values;
}

function readFragmentResources(data: ItemData | undefined) {
  const resources: string[] = [];
  for (const resourceData of readNamedRelationData(data, [
    "HasAssociations",
    "AssociatedTo",
  ])) {
    const label = [
      readStringAttribute(resourceData, [
        "Identification",
        "ItemReference",
        "Name",
        "name",
      ]),
      readStringAttribute(resourceData, ["Location", "location"]),
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (label) {
      resources.push(label);
    }
  }
  return [...new Set(resources)];
}

function readTypeAssignments(
  relationships: NativeIfcRelationship[],
  entityById: Map<number, NativeIfcEntity>,
) {
  const result = new Map<number, NativeIfcTypeAssignment[]>();
  for (const relationship of relationships) {
    if (relationship.type !== "IFCRELDEFINESBYTYPE") {
      continue;
    }
    const typeId = relationship.sourceIds[0];
    const typeEntity = entityById.get(typeId);
    if (!typeId || !typeEntity) {
      continue;
    }
    const assignment: NativeIfcTypeAssignment = {
      objectIds: relationship.targetIds,
      relationshipId: relationship.id,
      typeClass: typeEntity.type,
      typeId,
      typeName: typeEntity.name,
    };
    for (const objectId of relationship.targetIds) {
      pushMapValue(result, objectId, assignment);
    }
  }
  return result;
}

function spatialTreeToNativeRoots(
  root: SpatialTreeItem,
  entityById: Map<number, NativeIfcEntity>,
) {
  const roots = spatialItemToNativeNodes(root, "root", entityById);
  return roots.length ? roots : [];
}

function spatialItemToNativeNodes(
  item: SpatialTreeItem,
  relation: string,
  entityById: Map<number, NativeIfcEntity>,
): NativeIfcTreeNode[] {
  const children = (item.children ?? []).flatMap((child) =>
    spatialItemToNativeNodes(child, child.category ?? relation, entityById),
  );
  if (typeof item.localId !== "number" || !entityById.has(item.localId)) {
    return children;
  }
  return [
    {
      children,
      id: item.localId,
      relation: item.category ?? relation,
    },
  ];
}

function readNamedRelationData(data: ItemData | undefined, names: string[]) {
  if (!data) {
    return [];
  }
  return names.flatMap((name) => readRelationData(data[name]));
}

function readNestedItemArrays(data: ItemData) {
  return Object.values(data).flatMap(readRelationData);
}

function readRelationItems(value: unknown) {
  return readRelationData(value)
    .map(readLocalId)
    .filter((id): id is number => typeof id === "number");
}

function readRelationData(value: unknown): ItemData[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is ItemData => isRecord(item));
}

function readLocalId(data: unknown) {
  return readNumericAttribute(data, [
    "localId",
    "_localId",
    "expressID",
    "ExpressID",
  ]);
}

function readCategory(data: unknown) {
  return readStringAttribute(data, ["category", "Category", "_category"]);
}

function readNumericAttribute(data: unknown, keys: string[]) {
  const value = readAttribute(data, keys);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStringAttribute(data: unknown, keys: string[]) {
  const value = readAttribute(data, keys);
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function readAttribute(data: unknown, keys: string[]) {
  if (!isRecord(data)) {
    return undefined;
  }
  for (const key of keys) {
    if (key in data) {
      return unwrapAttribute(data[key]);
    }
  }
  const lowerKeyMap = new Map(
    Object.keys(data).map((key) => [key.toLowerCase(), key]),
  );
  for (const key of keys) {
    const actualKey = lowerKeyMap.get(key.toLowerCase());
    if (actualKey) {
      return unwrapAttribute(data[actualKey]);
    }
  }
  return undefined;
}

function unwrapAttribute(value: unknown): unknown {
  if (isRecord(value) && "value" in value) {
    return unwrapAttribute(value.value);
  }
  if (Array.isArray(value)) {
    return value.map(unwrapAttribute).join(", ");
  }
  return value;
}

function readMetadataSchema(metadata: Record<string, unknown>) {
  const schema = metadata.schema ?? metadata.Schema ?? metadata.ifcSchema;
  return typeof schema === "string" && schema ? schema : "FRAGMENTS";
}

function normalizeIfcType(value: string | undefined) {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return "IFCENTITY";
  }
  return normalized.startsWith("IFC") ? normalized : `IFC${normalized}`;
}

function groupMap<T, K>(values: T[], key: (value: T) => K) {
  const result = new Map<K, T[]>();
  for (const value of values) {
    pushMapValue(result, key(value), value);
  }
  return result;
}

function pushMapValue<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)]
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
