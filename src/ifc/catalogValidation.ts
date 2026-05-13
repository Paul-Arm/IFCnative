import {
    catalogObjectLabel,
    groupCatalogRulesByPset,
    isRequiredCatalogRule,
    normalizeCatalogToken,
    normalizeIfcClass,
    normalizeIfcValueType,
    type CatalogObjectType,
    type CatalogPropertyRule,
    type CatalogValidationFinding,
} from "./catalog";
import {
    addNativeClassification,
    addNativePropertySetValues,
    type NativeIfcDocument,
    type NativeIfcPropertySet,
} from "./nativeDocument";

const CLASSIFICATION_LOCATION = "openSIM BIM Objektkatalog";

export function validateEntityAgainstCatalogObject(
  document: NativeIfcDocument,
  entityId: number,
  objectType: CatalogObjectType,
): CatalogValidationFinding[] {
  const entity = document.entityById.get(entityId);
  if (!entity) {
    return [];
  }

  const findings: CatalogValidationFinding[] = [];
  const objectLabel = catalogObjectLabel(objectType);
  if (
    normalizeIfcClass(entity.type) !== normalizeIfcClass(objectType.ifcClass)
  ) {
    findings.push({
      catalogObjectId: objectType.id,
      entityId,
      expectedType: objectType.ifcClass,
      actualType: entity.type,
      id: findingId(entityId, objectType.id, "class-mismatch", entity.type),
      kind: "class-mismatch",
      message: `#${entityId} is ${entity.type}, catalog object ${objectLabel} expects ${objectType.ifcClass}.`,
      severity: "warning",
    });
  }

  if (
    objectType.code &&
    !hasCatalogClassification(document, entityId, objectType)
  ) {
    findings.push({
      catalogObjectId: objectType.id,
      entityId,
      id: findingId(
        entityId,
        objectType.id,
        "missing-classification",
        objectType.code,
      ),
      kind: "missing-classification",
      message: `Catalog classification ${objectType.code} is not linked to #${entityId}.`,
      quickFix: {
        classificationId: objectType.code,
        classificationLocation: CLASSIFICATION_LOCATION,
        classificationName: `${objectType.code} ${objectType.name}`,
        kind: "add-classification",
        label: `Add classification ${objectType.code}`,
      },
      severity: "warning",
    });
  }

  const requiredRules = objectType.propertyRules.filter(isRequiredCatalogRule);
  for (const [psetName, rules] of groupCatalogRulesByPset(requiredRules)) {
    const set = findPset(
      document.propertySetsByEntity.get(entityId) ?? [],
      psetName,
    );
    if (!set) {
      findings.push({
        catalogObjectId: objectType.id,
        entityId,
        id: findingId(entityId, objectType.id, "missing-pset", psetName),
        kind: "missing-pset",
        message: `${psetName} is missing on #${entityId}; ${rules.length.toLocaleString()} required properties are defined by ${objectLabel}.`,
        psetName,
        quickFix: {
          kind: "add-pset-properties",
          label: `Add ${psetName}`,
          properties: rules,
          psetName,
        },
        severity: "warning",
      });
      continue;
    }

    const missingRules = rules.filter(
      (rule) => !findProperty(set, rule.propertyName),
    );
    if (missingRules.length > 0) {
      findings.push({
        catalogObjectId: objectType.id,
        entityId,
        id: findingId(entityId, objectType.id, "missing-property", psetName),
        kind: "missing-property",
        message: `${psetName} on #${entityId} misses ${missingRules.map((rule) => rule.propertyName).join(", ")}.`,
        psetName,
        quickFix: {
          kind: "add-pset-properties",
          label: `Add missing ${psetName} properties`,
          properties: missingRules,
          psetName,
        },
        severity: "warning",
      });
    }

    for (const rule of rules) {
      const property = findProperty(set, rule.propertyName);
      if (!property) {
        continue;
      }
      const actualType = readPropertyValueType(property.value);
      const expectedType = normalizeIfcValueType(rule.valueType);
      if (actualType && actualType !== expectedType) {
        findings.push({
          actualType,
          catalogObjectId: objectType.id,
          entityId,
          expectedType,
          id: findingId(
            entityId,
            objectType.id,
            "property-type-mismatch",
            `${psetName}:${rule.propertyName}`,
          ),
          kind: "property-type-mismatch",
          message: `${psetName}.${rule.propertyName} uses ${actualType}; catalog expects ${expectedType}.`,
          propertyName: rule.propertyName,
          psetName,
          severity: "warning",
        });
      }
      if (isEmptyCatalogValue(property.value)) {
        findings.push({
          catalogObjectId: objectType.id,
          entityId,
          id: findingId(
            entityId,
            objectType.id,
            "empty-required-value",
            `${psetName}:${rule.propertyName}`,
          ),
          kind: "empty-required-value",
          message: `${psetName}.${rule.propertyName} is required but empty on #${entityId}.`,
          propertyName: rule.propertyName,
          psetName,
          severity: "warning",
        });
      }
    }
  }

  return findings;
}

export function applyCatalogQuickFix(
  document: NativeIfcDocument,
  entityId: number,
  finding: CatalogValidationFinding,
) {
  const fix = finding.quickFix;
  if (!fix) {
    return document;
  }
  if (fix.kind === "add-classification") {
    return addNativeClassification(
      document,
      entityId,
      fix.classificationId ?? "",
      fix.classificationName ??
        fix.classificationId ??
        "Catalog classification",
      fix.classificationLocation ?? CLASSIFICATION_LOCATION,
    );
  }
  if (fix.kind === "add-pset-properties") {
    return addNativePropertySetValues(
      document,
      entityId,
      fix.psetName ?? finding.psetName ?? "Pset_Catalog",
      (fix.properties ?? []).map((rule) => ({
        name: rule.propertyName,
        value: defaultCatalogValue(rule),
        valueType: rule.valueType,
      })),
    );
  }
  return document;
}

export function suggestCatalogObjectForEntity(
  document: NativeIfcDocument,
  entityId: number,
  objectTypes: CatalogObjectType[],
) {
  const entity = document.entityById.get(entityId);
  if (!entity) {
    return undefined;
  }
  const resources = (document.resourcesByEntity.get(entityId) ?? []).map(
    normalizeCatalogToken,
  );
  const name = normalizeCatalogToken(entity.name);
  const exactResourceMatch = objectTypes.find(
    (objectType) =>
      objectType.code &&
      resources.some((resource) =>
        resource.includes(normalizeCatalogToken(objectType.code)),
      ),
  );
  if (exactResourceMatch) {
    return exactResourceMatch;
  }
  return objectTypes.find(
    (objectType) =>
      normalizeIfcClass(objectType.ifcClass) ===
        normalizeIfcClass(entity.type) &&
      name &&
      (name.includes(normalizeCatalogToken(objectType.name)) ||
        name.includes(normalizeCatalogToken(objectType.code))),
  );
}

function hasCatalogClassification(
  document: NativeIfcDocument,
  entityId: number,
  objectType: CatalogObjectType,
) {
  const resources = document.resourcesByEntity.get(entityId) ?? [];
  const code = normalizeCatalogToken(objectType.code);
  const name = normalizeCatalogToken(objectType.name);
  return resources.some((resource) => {
    const token = normalizeCatalogToken(resource);
    return (code && token.includes(code)) || (name && token.includes(name));
  });
}

function findPset(sets: NativeIfcPropertySet[], psetName: string) {
  const token = normalizeCatalogToken(psetName);
  return sets.find((set) => normalizeCatalogToken(set.name) === token);
}

function findProperty(set: NativeIfcPropertySet, propertyName: string) {
  const token = normalizeCatalogToken(propertyName);
  return set.values.find(
    (value) => normalizeCatalogToken(value.name) === token,
  );
}

function readPropertyValueType(value: string) {
  return value
    .trim()
    .match(/^([A-Z0-9_]+)\(/i)?.[1]
    ?.toUpperCase();
}

function isEmptyCatalogValue(value: string) {
  const token = value.trim();
  return (
    token === "" ||
    token === "$" ||
    /\(''\)$/i.test(token) ||
    /\(\s*\)$/i.test(token)
  );
}

function defaultCatalogValue(rule: CatalogPropertyRule) {
  const valueType = normalizeIfcValueType(rule.valueType);
  if (valueType === "IFCBOOLEAN") {
    return "FALSE";
  }
  if (
    valueType === "IFCREAL" ||
    valueType === "IFCINTEGER" ||
    valueType.includes("MEASURE")
  ) {
    return "0";
  }
  return "";
}

function findingId(
  entityId: number,
  catalogObjectId: string,
  kind: string,
  suffix: string,
) {
  return `${entityId}:${catalogObjectId}:${kind}:${normalizeCatalogToken(suffix).replace(/[^a-z0-9]+/g, "-")}`;
}
