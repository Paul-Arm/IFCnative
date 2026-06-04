import {
    catalogObjectLabel,
    groupCatalogRulesByPset,
    isRequiredCatalogRule,
    normalizeCatalogToken,
    type CatalogObjectType,
    type IfcObjectCatalog,
} from "./catalog";
import {
    applyCatalogQuickFix,
    validateEntityAgainstCatalogObject,
} from "./catalogValidation";
import {
    addNativePropertySetValues,
    addNativePropertyToSet,
    removeNativePropertyFromSet,
    unquote,
    updateNativePropertyValue,
    type NativeIfcDocument,
    type NativeIfcEntity,
    type NativeIfcPropertySet,
    type NativeIfcRelationship,
} from "./nativeDocument";
import {
    OBJECT_INFO_ID_PROPERTY_NAME,
    OBJECT_INFO_PSET_NAME,
    buildObjectInfoIndex,
    isObjectInfoPset,
    normalizeObjectInfoIdValue,
} from "./objectInfoValidation";

export type DiagnosticObjectRole = "untersuchungsstelle" | "probe";

export interface DiagnosticObjectInfoDraft {
  bemerkung: string;
  bezeichnung: string;
  id: string;
  role: DiagnosticObjectRole;
  untersuchungsstelleId?: string;
}

export interface DiagnosticProcedureSummary {
  id: number;
  name: string;
  propertyCount: number;
}

export interface DiagnosticObjectiveSummary {
  id: number;
  label: string;
  objectInfoId?: string;
  psetName: string;
}

export interface DiagnosticSelectionContext {
  ancestors: NativeIfcEntity[];
  building?: NativeIfcEntity;
  detectedRole?: DiagnosticObjectRole;
  detectedRoleReason?: string;
  existingObjectInfo?: NativeIfcPropertySet;
  existingObjectInfoId?: string;
  objectives: DiagnosticObjectiveSummary[];
  procedureSets: NativeIfcPropertySet[];
  procedures: DiagnosticProcedureSummary[];
  selected?: NativeIfcEntity;
  suggestedProbe: DiagnosticObjectInfoDraft;
  suggestedUntersuchungsstelle: DiagnosticObjectInfoDraft;
}

const HIERARCHY_RELATIONSHIP_TYPES = new Set([
  "IFCRELAGGREGATES",
  "IFCRELNESTS",
  "IFCRELCONTAINEDINSPATIALSTRUCTURE",
]);

const PROCEDURE_CODE_HINTS = [
  "CA",
  "DFK",
  "DP",
  "KB",
  "MF",
  "RPH",
  "SCD",
  "SP",
];

export const DIAGNOSTIC_OBJECTIVE_IDS_PROPERTY = "_UntersuchungszielIDs";

export function buildDiagnosticSelectionContext(
  document: NativeIfcDocument,
  entityId: number,
): DiagnosticSelectionContext {
  const selected = document.entityById.get(entityId);
  const ancestors = getDiagnosticAncestors(document, entityId);
  const building =
    ancestors.find((entity) => entity.type === "IFCBUILDING") ??
    document.entitiesByType.get("IFCBUILDING")?.[0];
  const existingObjectInfo = findObjectInfoPset(document, entityId);
  const existingObjectInfoId = existingObjectInfo
    ? readPropertyValue(existingObjectInfo, OBJECT_INFO_ID_PROPERTY_NAME)
    : undefined;
  const roleDetection = detectDiagnosticObjectRole(document, entityId);

  const procedureSets = findDiagnosticProcedurePsets(document, entityId);

  return {
    ancestors,
    building,
    detectedRole: roleDetection.role,
    detectedRoleReason: roleDetection.reason,
    existingObjectInfo,
    existingObjectInfoId,
    objectives: building ? findDiagnosticObjectives(document, building.id) : [],
    procedureSets,
    procedures: procedureSets.map((set) => ({
      id: set.id,
      name: set.name,
      propertyCount: set.values.length,
    })),
    selected,
    suggestedProbe: buildDiagnosticObjectInfoDraft(document, entityId, "probe"),
    suggestedUntersuchungsstelle: buildDiagnosticObjectInfoDraft(
      document,
      entityId,
      "untersuchungsstelle",
    ),
  };
}

export function buildDiagnosticObjectInfoDraft(
  document: NativeIfcDocument,
  entityId: number,
  role: DiagnosticObjectRole,
): DiagnosticObjectInfoDraft {
  const entity = document.entityById.get(entityId);
  const existingObjectInfo = findObjectInfoPset(document, entityId);
  const existingId = existingObjectInfo
    ? readPropertyValue(existingObjectInfo, OBJECT_INFO_ID_PROPERTY_NAME)
    : undefined;
  const bezeichnung =
    existingObjectInfo && readPropertyValue(existingObjectInfo, "_Bezeichnung")
      ? readPropertyValue(existingObjectInfo, "_Bezeichnung")
      : entity?.name || `#${entityId}`;
  const bemerkung = existingObjectInfo
    ? (readPropertyValue(existingObjectInfo, "_Bemerkung") ?? "")
    : "";
  const prefix = deriveDiagnosticIdPrefix(document, entityId);
  const parentUntersuchungsstelleId =
    role === "probe"
      ? deriveUntersuchungsstelleId(document, entityId)
      : undefined;
  const id =
    existingId || deriveDiagnosticObjectId(document, entityId, role, prefix);

  return {
    bemerkung,
    bezeichnung: bezeichnung ?? entity?.name ?? `#${entityId}`,
    id,
    role,
    untersuchungsstelleId: parentUntersuchungsstelleId,
  };
}

export function applyDiagnosticObjectInfo(
  document: NativeIfcDocument,
  entityId: number,
  draft: DiagnosticObjectInfoDraft,
) {
  if (!document.entityById.has(entityId)) {
    return document;
  }
  const properties = diagnosticObjectInfoProperties(draft);
  const existing = findObjectInfoPset(document, entityId);
  if (!existing) {
    return addNativePropertySetValues(
      document,
      entityId,
      OBJECT_INFO_PSET_NAME,
      properties,
    );
  }

  return properties.reduce((currentDocument, property) => {
    const currentSet = findObjectInfoPset(currentDocument, entityId);
    if (!currentSet) {
      return currentDocument;
    }
    const existingProperty = findProperty(currentSet, property.name);
    if (existingProperty) {
      return updateNativePropertyValue(currentDocument, existingProperty.id, {
        name: property.name,
        value: property.value,
        valueType: property.valueType,
      });
    }
    return addNativePropertyToSet(
      currentDocument,
      currentSet.id,
      property.name,
      property.value,
      property.valueType,
    );
  }, document);
}

export function addDiagnosticObjectiveReference(
  document: NativeIfcDocument,
  entityId: number,
  setId: number,
  objectiveId: string,
) {
  const procedureSet = (document.propertySetsByEntity.get(entityId) ?? []).find(
    (set) => set.id === setId,
  );
  const nextObjectiveId = objectiveId.trim();
  if (!procedureSet || !nextObjectiveId) {
    return document;
  }

  const objectiveProperties = procedureSet.values.filter((value) =>
    isInvestigationObjectiveIdProperty(value.name),
  );
  const objectiveIds = uniqueStrings([
    ...objectiveProperties.flatMap((value) =>
      parseObjectiveIdList(value.value),
    ),
    nextObjectiveId,
  ]);
  const objectiveValue = objectiveIds.join("; ");
  const primaryProperty =
    objectiveProperties.find(
      (value) => value.name === DIAGNOSTIC_OBJECTIVE_IDS_PROPERTY,
    ) ?? objectiveProperties[0];

  let next = primaryProperty
    ? updateNativePropertyValue(document, primaryProperty.id, {
        name: DIAGNOSTIC_OBJECTIVE_IDS_PROPERTY,
        value: objectiveValue,
        valueType: "IFCLABEL",
      })
    : addNativePropertyToSet(
        document,
        setId,
        DIAGNOSTIC_OBJECTIVE_IDS_PROPERTY,
        objectiveValue,
        "IFCLABEL",
      );

  for (const duplicateProperty of objectiveProperties) {
    if (duplicateProperty.id !== primaryProperty?.id) {
      next = removeNativePropertyFromSet(next, setId, duplicateProperty.id);
    }
  }

  return next;
}

export function findDiagnosticObjectives(
  document: NativeIfcDocument,
  buildingId: number,
): DiagnosticObjectiveSummary[] {
  return (document.propertySetsByEntity.get(buildingId) ?? [])
    .filter((set) =>
      normalizeDiagnosticToken(set.name).startsWith("epset untersuchungsziel"),
    )
    .map((set) => ({
      id: set.id,
      label:
        readPropertyValue(set, "_Bezeichnung") ??
        readPropertyValue(set, "_Name") ??
        set.name,
      objectInfoId: readPropertyValue(set, OBJECT_INFO_ID_PROPERTY_NAME),
      psetName: set.name,
    }));
}

export function findDiagnosticProcedurePsets(
  document: NativeIfcDocument,
  entityId: number,
): NativeIfcPropertySet[] {
  return (document.propertySetsByEntity.get(entityId) ?? []).filter((set) =>
    isDiagnosticProcedurePsetName(set.name),
  );
}

export function suggestDiagnosticProcedureCatalogObjects(
  catalog: IfcObjectCatalog | null,
) {
  const objectTypes = catalog?.objectTypes ?? [];
  return objectTypes
    .filter((objectType) => isLikelyDiagnosticProcedureObject(objectType))
    .sort((left, right) =>
      catalogObjectLabel(left).localeCompare(catalogObjectLabel(right), "de"),
    );
}

export function applyDiagnosticProcedureFromCatalog(
  document: NativeIfcDocument,
  entityId: number,
  objectType: CatalogObjectType,
) {
  const findings = validateEntityAgainstCatalogObject(
    document,
    entityId,
    objectType,
  ).filter((finding) => finding.quickFix);
  return findings.reduce(
    (currentDocument, finding) =>
      applyCatalogQuickFix(currentDocument, entityId, finding),
    document,
  );
}

export function detectDiagnosticObjectRole(
  document: NativeIfcDocument,
  entityId: number,
): { reason?: string; role?: DiagnosticObjectRole } {
  const sets = document.propertySetsByEntity.get(entityId) ?? [];
  const siteSet = sets.find((set) =>
    isDiagnosticRolePsetName(set.name, "untersuchungsstelle"),
  );
  if (siteSet) {
    return { reason: siteSet.name, role: "untersuchungsstelle" };
  }
  const probeSet = sets.find((set) =>
    isDiagnosticRolePsetName(set.name, "probe"),
  );
  if (probeSet) {
    return { reason: probeSet.name, role: "probe" };
  }

  const objectInfo = findObjectInfoPset(document, entityId);
  const objectInfoId = objectInfo
    ? readPropertyValue(objectInfo, OBJECT_INFO_ID_PROPERTY_NAME)
    : undefined;
  if (objectInfoId && /\.US\.\d+$/i.test(objectInfoId)) {
    return { reason: objectInfoId, role: "untersuchungsstelle" };
  }
  if (objectInfoId && /\.Probe\d+\.\d+$/i.test(objectInfoId)) {
    return { reason: objectInfoId, role: "probe" };
  }
  if (objectInfo && readPropertyValue(objectInfo, "_UntersuchungsstelleID")) {
    return { reason: "_UntersuchungsstelleID", role: "probe" };
  }

  const entity = document.entityById.get(entityId);
  if (entity?.name && normalizeProbeCode(entity.name)) {
    return { reason: entity.name, role: "probe" };
  }
  if (entity?.name && normalizeUntersuchungsstelleCode(entity.name)) {
    return { reason: entity.name, role: "untersuchungsstelle" };
  }
  return {};
}

function diagnosticObjectInfoProperties(draft: DiagnosticObjectInfoDraft) {
  const properties = [
    {
      name: OBJECT_INFO_ID_PROPERTY_NAME,
      value: draft.id,
      valueType: "IFCLABEL",
    },
    { name: "_Bezeichnung", value: draft.bezeichnung, valueType: "IFCLABEL" },
    { name: "_Bemerkung", value: draft.bemerkung, valueType: "IFCTEXT" },
  ];
  if (draft.role === "probe") {
    properties.splice(1, 0, {
      name: "_UntersuchungsstelleID",
      value: draft.untersuchungsstelleId ?? "",
      valueType: "IFCLABEL",
    });
  }
  return properties;
}

function deriveDiagnosticObjectId(
  document: NativeIfcDocument,
  entityId: number,
  role: DiagnosticObjectRole,
  prefix: string,
) {
  const entity = document.entityById.get(entityId);
  if (role === "probe") {
    const probeCode =
      normalizeProbeCode(entity?.name) ?? nextProbeCode(document);
    return joinDiagnosticId(prefix, probeCode);
  }
  const untersuchungsstelleCode =
    normalizeUntersuchungsstelleCode(entity?.name) ??
    nextUntersuchungsstelleCode(document);
  return joinDiagnosticId(prefix, untersuchungsstelleCode);
}

function deriveDiagnosticIdPrefix(
  document: NativeIfcDocument,
  entityId: number,
) {
  const values = buildObjectInfoIndex(document)
    .definitions.map((definition) => definition.value)
    .filter(Boolean);
  const ancestorIds = getDiagnosticAncestors(document, entityId)
    .map((entity) => findObjectInfoPset(document, entity.id))
    .map((set) =>
      set ? readPropertyValue(set, OBJECT_INFO_ID_PROPERTY_NAME) : undefined,
    )
    .filter((value): value is string => !!value);
  for (const value of [...ancestorIds, ...values]) {
    const prefix = prefixFromDiagnosticId(value);
    if (prefix) {
      return prefix;
    }
  }
  const building = document.entitiesByType.get("IFCBUILDING")?.[0];
  const projectId = building
    ? findAnyPropertyValue(document, building.id, "_ID")
    : undefined;
  return projectId || document.fileName.replace(/\.ifc$/i, "");
}

function deriveUntersuchungsstelleId(
  document: NativeIfcDocument,
  entityId: number,
) {
  for (const ancestor of getDiagnosticAncestors(document, entityId)) {
    const objectInfo = findObjectInfoPset(document, ancestor.id);
    const id = objectInfo
      ? readPropertyValue(objectInfo, OBJECT_INFO_ID_PROPERTY_NAME)
      : undefined;
    if (id && /\.US\.\d+$/i.test(id)) {
      return id;
    }
  }
  const prefix = deriveDiagnosticIdPrefix(document, entityId);
  const entity = document.entityById.get(entityId);
  const probeCode = normalizeProbeCode(entity?.name);
  if (probeCode) {
    const number = /Probe(\d+)\./i.exec(probeCode)?.[1];
    if (number) {
      return joinDiagnosticId(prefix, `US.${number}`);
    }
  }
  return (
    findFirstObjectInfoId(document, /\.US\.\d+$/i) ??
    joinDiagnosticId(prefix, "US.01")
  );
}

function getDiagnosticAncestors(document: NativeIfcDocument, entityId: number) {
  const ancestors: NativeIfcEntity[] = [];
  const visited = new Set<number>([entityId]);
  let currentId: number | undefined = entityId;
  while (currentId != null) {
    const relationship: NativeIfcRelationship | undefined = (
      document.relationshipsByEntity.get(currentId) ?? []
    ).find(
      (candidate) =>
        HIERARCHY_RELATIONSHIP_TYPES.has(candidate.type) &&
        candidate.targetIds.includes(currentId as number) &&
        candidate.sourceIds.length > 0,
    );
    const parentId: number | undefined = relationship?.sourceIds[0];
    if (!parentId || visited.has(parentId)) {
      break;
    }
    const parent = document.entityById.get(parentId);
    if (!parent) {
      break;
    }
    ancestors.push(parent);
    visited.add(parentId);
    currentId = parentId;
  }
  return ancestors;
}

function findObjectInfoPset(document: NativeIfcDocument, entityId: number) {
  return (document.propertySetsByEntity.get(entityId) ?? []).find((set) =>
    isObjectInfoPset(set.name),
  );
}

function findProperty(set: NativeIfcPropertySet, propertyName: string) {
  return set.values.find(
    (value) =>
      normalizePropertyName(value.name) === normalizePropertyName(propertyName),
  );
}

function readPropertyValue(set: NativeIfcPropertySet, propertyName: string) {
  const property = findProperty(set, propertyName);
  return property ? normalizeObjectInfoIdValue(property.value) : undefined;
}

function findAnyPropertyValue(
  document: NativeIfcDocument,
  entityId: number,
  propertyName: string,
) {
  for (const set of document.propertySetsByEntity.get(entityId) ?? []) {
    const value = readPropertyValue(set, propertyName);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function findFirstObjectInfoId(document: NativeIfcDocument, pattern: RegExp) {
  return buildObjectInfoIndex(document).definitions.find((definition) =>
    pattern.test(definition.value),
  )?.value;
}

function prefixFromDiagnosticId(value: string) {
  const match = /^(.*)\.(?:US\.\d+|UB\.\d+|Probe\d+\.\d+|Messfeld\d+)$/i.exec(
    value,
  );
  return match?.[1];
}

function normalizeUntersuchungsstelleCode(value = "") {
  const match = /\bUS[.\-_\s]?(\d+)\b/i.exec(value);
  return match ? `US.${match[1].padStart(2, "0")}` : undefined;
}

function normalizeProbeCode(value = "") {
  const match = /\bProbe\s*(\d+)[.\-_\s]?(\d+)\b/i.exec(value);
  return match
    ? `Probe${match[1].padStart(2, "0")}.${match[2].padStart(2, "0")}`
    : undefined;
}

function nextUntersuchungsstelleCode(document: NativeIfcDocument) {
  const max = maxDiagnosticNumber(document, /\.US\.(\d+)$/i);
  return `US.${String(max + 1).padStart(2, "0")}`;
}

function nextProbeCode(document: NativeIfcDocument) {
  const max = maxDiagnosticNumber(document, /\.Probe\d+\.(\d+)$/i);
  return `Probe01.${String(max + 1).padStart(2, "0")}`;
}

function maxDiagnosticNumber(document: NativeIfcDocument, pattern: RegExp) {
  return buildObjectInfoIndex(document).definitions.reduce(
    (max, definition) => {
      const match = pattern.exec(definition.value);
      return match ? Math.max(max, Number(match[1])) : max;
    },
    0,
  );
}

function joinDiagnosticId(prefix: string, code: string) {
  return prefix ? `${prefix}.${code}` : code;
}

function isDiagnosticProcedurePsetName(name: string) {
  const token = normalizeDiagnosticToken(name);
  if (!token.startsWith("epset ") || token.includes("objektinformation")) {
    return false;
  }
  return ![
    "epset bauwerk",
    "epset modellinformation",
    "epset probe",
    "epset projekt",
    "epset untersuchungsstelle",
    "epset untersuchungsbereich",
    "epset untersuchungsziel",
  ].some((prefix) => token.startsWith(prefix));
}

function isDiagnosticRolePsetName(name: string, role: DiagnosticObjectRole) {
  const token = normalizeDiagnosticToken(name);
  return role === "probe"
    ? token.startsWith("epset probe")
    : token.startsWith("epset untersuchungsstelle");
}

function isLikelyDiagnosticProcedureObject(objectType: CatalogObjectType) {
  const token = normalizeCatalogToken(
    [objectType.name, objectType.code, objectType.sheetName].join(" "),
  );
  if (/\buntersuchungsverfahren\b/.test(token)) {
    return true;
  }
  const code = normalizeCatalogToken(objectType.code).toUpperCase();
  if (
    PROCEDURE_CODE_HINTS.some(
      (hint) => code.includes(` ${hint}`) || code.endsWith(`-${hint}`),
    )
  ) {
    return true;
  }
  const requiredPsets = groupCatalogRulesByPset(
    objectType.propertyRules.filter(isRequiredCatalogRule),
  );
  return [...requiredPsets.keys()].some((psetName) =>
    isDiagnosticProcedurePsetName(psetName),
  );
}

function normalizePropertyName(value = "") {
  return value.trim().toLowerCase();
}

function normalizeDiagnosticToken(value = "") {
  return normalizeCatalogToken(value.replace(/[_-]+/g, " "));
}

function isInvestigationObjectiveIdProperty(name: string) {
  return normalizePropertyName(name).startsWith("_untersuchungszielid");
}

function parseObjectiveIdList(value: string) {
  const typedValue = unwrapIfcTypedValue(value);
  return typedValue
    .split(";")
    .map((entry) => unquote(entry.trim()).trim())
    .filter(Boolean);
}

function unwrapIfcTypedValue(value: string) {
  const match = /^IFC[A-Z0-9_]*\((.*)\)$/i.exec(value.trim());
  return match?.[1]?.trim() ?? value;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
