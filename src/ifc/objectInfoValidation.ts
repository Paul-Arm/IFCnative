import { unquote, type NativeIfcDocument } from "./nativeDocument";

export const OBJECT_INFO_PSET_NAME = "ePset_Objektinformationen";
export const OBJECT_INFO_ID_PROPERTY_NAME = "_ID";

export type ObjectInfoValidationSeverity = "error" | "warning" | "info";

export type ObjectInfoValidationFindingKind =
  | "missing-object-info-id"
  | "empty-object-info-id"
  | "duplicate-object-info-id"
  | "empty-id-reference"
  | "missing-object-info-reference"
  | "ambiguous-object-info-reference"
  | "external-id-reference"
  | "unreferenced-object-info-id";

export interface ObjectInfoIdDefinition {
  entityId: number;
  entityName: string;
  entityType: string;
  propertyId: number;
  propertyName: string;
  psetId: number;
  psetName: string;
  rawValue: string;
  value: string;
}

export interface ObjectInfoExternalIdDefinition extends ObjectInfoIdDefinition {
  source: "external";
}

export interface ObjectInfoIdReference {
  entityId: number;
  entityName: string;
  entityType: string;
  externalDefinitions: ObjectInfoExternalIdDefinition[];
  propertyId: number;
  propertyName: string;
  psetId: number;
  psetName: string;
  rawValue: string;
  targetDefinitions: ObjectInfoIdDefinition[];
  value: string;
}

export interface ObjectInfoSetWithoutId {
  entityId: number;
  entityName: string;
  entityType: string;
  psetId: number;
  psetName: string;
}

export interface ObjectInfoIndex {
  definitions: ObjectInfoIdDefinition[];
  definitionsByEntity: Map<number, ObjectInfoIdDefinition[]>;
  definitionsByValue: Map<string, ObjectInfoIdDefinition[]>;
  externalDefinitions: ObjectInfoExternalIdDefinition[];
  externalDefinitionsByValue: Map<string, ObjectInfoExternalIdDefinition[]>;
  references: ObjectInfoIdReference[];
  referencesByEntity: Map<number, ObjectInfoIdReference[]>;
  setsWithoutId: ObjectInfoSetWithoutId[];
}

export interface ObjectInfoValidationFinding {
  definitions?: ObjectInfoIdDefinition[];
  entityId?: number;
  externalDefinitions?: ObjectInfoExternalIdDefinition[];
  id: string;
  kind: ObjectInfoValidationFindingKind;
  message: string;
  propertyId?: number;
  propertyName?: string;
  psetId?: number;
  psetName?: string;
  references?: ObjectInfoIdReference[];
  severity: ObjectInfoValidationSeverity;
  value?: string;
}

export function buildObjectInfoIndex(
  document: NativeIfcDocument,
): ObjectInfoIndex {
  const definitions: ObjectInfoIdDefinition[] = [];
  const definitionsByEntity = new Map<number, ObjectInfoIdDefinition[]>();
  const definitionsByValue = new Map<string, ObjectInfoIdDefinition[]>();
  const externalDefinitions: ObjectInfoExternalIdDefinition[] = [];
  const externalDefinitionsByValue = new Map<
    string,
    ObjectInfoExternalIdDefinition[]
  >();
  const pendingReferences: Array<
    Omit<ObjectInfoIdReference, "externalDefinitions" | "targetDefinitions">
  > = [];
  const referencesByEntity = new Map<number, ObjectInfoIdReference[]>();
  const setsWithoutId: ObjectInfoSetWithoutId[] = [];

  for (const [entityId, sets] of document.propertySetsByEntity) {
    const entity = document.entityById.get(entityId);
    const entityType = entity?.type ?? "UNKNOWN";
    const entityName = entity?.name ?? "";

    for (const set of sets) {
      const objectInfoSet = isObjectInfoPset(set.name);
      const idProperty = set.values.find((property) =>
        isObjectInfoIdProperty(property.name),
      );

      if (objectInfoSet && !idProperty) {
        setsWithoutId.push({
          entityId,
          entityName,
          entityType,
          psetId: set.id,
          psetName: set.name,
        });
      }

      for (const property of set.values) {
        const value = normalizeObjectInfoIdValue(property.value);
        if (objectInfoSet && isObjectInfoIdProperty(property.name)) {
          const definition: ObjectInfoIdDefinition = {
            entityId,
            entityName,
            entityType,
            propertyId: property.id,
            propertyName: property.name,
            psetId: set.id,
            psetName: set.name,
            rawValue: property.value,
            value,
          };
          definitions.push(definition);
          pushMapValue(definitionsByEntity, entityId, definition);
          if (!isBlankObjectInfoValue(value)) {
            pushMapValue(definitionsByValue, value, definition);
          }
          continue;
        }

        if (!objectInfoSet && isObjectInfoIdProperty(property.name)) {
          const definition: ObjectInfoExternalIdDefinition = {
            entityId,
            entityName,
            entityType,
            propertyId: property.id,
            propertyName: property.name,
            psetId: set.id,
            psetName: set.name,
            rawValue: property.value,
            source: "external",
            value,
          };
          externalDefinitions.push(definition);
          if (!isBlankObjectInfoValue(value)) {
            pushMapValue(externalDefinitionsByValue, value, definition);
          }
        }

        if (isObjectInfoReferenceProperty(property.name)) {
          pendingReferences.push({
            entityId,
            entityName,
            entityType,
            propertyId: property.id,
            propertyName: property.name,
            psetId: set.id,
            psetName: set.name,
            rawValue: property.value,
            value,
          });
        }
      }
    }
  }

  const references = pendingReferences.map((reference) => ({
    ...reference,
    externalDefinitions: externalDefinitionsByValue.get(reference.value) ?? [],
    targetDefinitions: definitionsByValue.get(reference.value) ?? [],
  }));
  for (const reference of references) {
    pushMapValue(referencesByEntity, reference.entityId, reference);
  }

  return {
    definitions,
    definitionsByEntity,
    definitionsByValue,
    externalDefinitions,
    externalDefinitionsByValue,
    references,
    referencesByEntity,
    setsWithoutId,
  };
}

export function validateObjectInfoReferences(
  document: NativeIfcDocument,
): ObjectInfoValidationFinding[] {
  return validateObjectInfoIndex(buildObjectInfoIndex(document));
}

export function validateObjectInfoIndex(
  index: ObjectInfoIndex,
): ObjectInfoValidationFinding[] {
  const findings: ObjectInfoValidationFinding[] = [];

  for (const set of index.setsWithoutId) {
    findings.push({
      entityId: set.entityId,
      id: findingId("missing-object-info-id", set.entityId, set.psetId),
      kind: "missing-object-info-id",
      message: `${set.psetName} on #${set.entityId} has no ${OBJECT_INFO_ID_PROPERTY_NAME} property.`,
      psetId: set.psetId,
      psetName: set.psetName,
      severity: "warning",
    });
  }

  for (const definition of index.definitions) {
    if (isBlankObjectInfoValue(definition.value)) {
      findings.push({
        definitions: [definition],
        entityId: definition.entityId,
        id: findingId(
          "empty-object-info-id",
          definition.entityId,
          definition.propertyId,
        ),
        kind: "empty-object-info-id",
        message: `${definition.psetName}.${definition.propertyName} is empty on #${definition.entityId}.`,
        propertyId: definition.propertyId,
        propertyName: definition.propertyName,
        psetId: definition.psetId,
        psetName: definition.psetName,
        severity: "warning",
        value: definition.value,
      });
    }
  }

  for (const [value, definitions] of index.definitionsByValue) {
    if (definitions.length > 1) {
      findings.push({
        definitions,
        entityId: definitions[0]?.entityId,
        id: findingId("duplicate-object-info-id", value),
        kind: "duplicate-object-info-id",
        message: `Object info ID ${value} is defined ${definitions.length.toLocaleString()} times.`,
        severity: "error",
        value,
      });
    }
  }

  const referencedObjectInfoValues = new Set<string>();
  for (const reference of index.references) {
    if (isBlankObjectInfoValue(reference.value)) {
      findings.push({
        entityId: reference.entityId,
        id: findingId(
          "empty-id-reference",
          reference.entityId,
          reference.propertyId,
        ),
        kind: "empty-id-reference",
        message: `${reference.psetName}.${reference.propertyName} is empty on #${reference.entityId}.`,
        propertyId: reference.propertyId,
        propertyName: reference.propertyName,
        psetId: reference.psetId,
        psetName: reference.psetName,
        references: [reference],
        severity: "info",
        value: reference.value,
      });
      continue;
    }

    if (reference.targetDefinitions.length === 1) {
      referencedObjectInfoValues.add(reference.value);
      continue;
    }

    if (reference.targetDefinitions.length > 1) {
      referencedObjectInfoValues.add(reference.value);
      findings.push({
        definitions: reference.targetDefinitions,
        entityId: reference.entityId,
        id: findingId(
          "ambiguous-object-info-reference",
          reference.entityId,
          reference.propertyId,
        ),
        kind: "ambiguous-object-info-reference",
        message: `${reference.psetName}.${reference.propertyName} on #${reference.entityId} points to duplicate object info ID ${reference.value}.`,
        propertyId: reference.propertyId,
        propertyName: reference.propertyName,
        psetId: reference.psetId,
        psetName: reference.psetName,
        references: [reference],
        severity: "error",
        value: reference.value,
      });
      continue;
    }

    if (reference.externalDefinitions.length > 0) {
      findings.push({
        entityId: reference.entityId,
        externalDefinitions: reference.externalDefinitions,
        id: findingId(
          "external-id-reference",
          reference.entityId,
          reference.propertyId,
        ),
        kind: "external-id-reference",
        message: `${reference.psetName}.${reference.propertyName} on #${reference.entityId} points to ${reference.value}, which is an _ID in another PSet family.`,
        propertyId: reference.propertyId,
        propertyName: reference.propertyName,
        psetId: reference.psetId,
        psetName: reference.psetName,
        references: [reference],
        severity: "info",
        value: reference.value,
      });
      continue;
    }

    findings.push({
      entityId: reference.entityId,
      id: findingId(
        "missing-object-info-reference",
        reference.entityId,
        reference.propertyId,
      ),
      kind: "missing-object-info-reference",
      message: `${reference.psetName}.${reference.propertyName} on #${reference.entityId} points to unknown object info ID ${reference.value}.`,
      propertyId: reference.propertyId,
      propertyName: reference.propertyName,
      psetId: reference.psetId,
      psetName: reference.psetName,
      references: [reference],
      severity: "warning",
      value: reference.value,
    });
  }

  for (const definition of index.definitions) {
    if (
      !isBlankObjectInfoValue(definition.value) &&
      !referencedObjectInfoValues.has(definition.value)
    ) {
      findings.push({
        definitions: [definition],
        entityId: definition.entityId,
        id: findingId(
          "unreferenced-object-info-id",
          definition.entityId,
          definition.propertyId,
        ),
        kind: "unreferenced-object-info-id",
        message: `Object info ID ${definition.value} on #${definition.entityId} has no incoming *ID reference.`,
        propertyId: definition.propertyId,
        propertyName: definition.propertyName,
        psetId: definition.psetId,
        psetName: definition.psetName,
        severity: "info",
        value: definition.value,
      });
    }
  }

  return findings;
}

export function isObjectInfoPset(name: string) {
  return (
    normalizeObjectInfoName(name) ===
    normalizeObjectInfoName(OBJECT_INFO_PSET_NAME)
  );
}

export function isObjectInfoIdProperty(name: string) {
  return (
    normalizeObjectInfoName(name) ===
    normalizeObjectInfoName(OBJECT_INFO_ID_PROPERTY_NAME)
  );
}

export function isObjectInfoReferenceProperty(name: string) {
  const normalized = normalizeObjectInfoName(name);
  return normalized.endsWith("id") && normalized !== "_id";
}

export function normalizeObjectInfoIdValue(value = "") {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "$") {
    return "";
  }
  const typedValue = unwrapTypedIfcValue(trimmed);
  const scalar = typedValue ?? trimmed;
  return (unquote(scalar) ?? scalar).trim();
}

function isBlankObjectInfoValue(value = "") {
  const normalized = normalizeObjectInfoIdValue(value);
  return !normalized || normalized === "$" || normalized === "-";
}

function unwrapTypedIfcValue(value: string) {
  const match = /^IFC[A-Z0-9_]*\((.*)\)$/i.exec(value);
  return match?.[1]?.trim();
}

function normalizeObjectInfoName(value = "") {
  return value.trim().toLowerCase();
}

function pushMapValue<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function findingId(
  kind: ObjectInfoValidationFindingKind,
  ...parts: Array<number | string | undefined>
) {
  return ["object-info", kind, ...parts.filter((part) => part != null)].join(
    ":",
  );
}
