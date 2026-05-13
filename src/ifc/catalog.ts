export type CatalogRequirement = "required" | "optional" | "unknown";

export type CatalogFindingSeverity = "info" | "warning" | "error";

export type CatalogFindingKind =
  | "class-mismatch"
  | "missing-classification"
  | "missing-pset"
  | "missing-property"
  | "property-type-mismatch"
  | "empty-required-value";

export interface CatalogPropertyRule {
  id: string;
  psetName: string;
  propertyName: string;
  valueType: string;
  format: string;
  unit: string;
  requirement: CatalogRequirement;
  tradeMarkers: Record<string, boolean>;
  loiMarkers: Record<string, boolean>;
  sourceSheet: string;
  sourceRow: number;
}

export interface CatalogObjectType {
  id: string;
  name: string;
  code: string;
  ifcClass: string;
  version: string;
  sheetName: string;
  propertyRules: CatalogPropertyRule[];
}

export interface IfcObjectCatalog {
  fileName: string;
  importedAt: string;
  objectTypes: CatalogObjectType[];
  diagnostics: string[];
}

export interface CatalogQuickFix {
  kind: "add-pset-properties" | "add-classification";
  label: string;
  psetName?: string;
  properties?: CatalogPropertyRule[];
  classificationId?: string;
  classificationName?: string;
  classificationLocation?: string;
}

export interface CatalogValidationFinding {
  id: string;
  severity: CatalogFindingSeverity;
  kind: CatalogFindingKind;
  entityId: number;
  catalogObjectId: string;
  message: string;
  psetName?: string;
  propertyName?: string;
  expectedType?: string;
  actualType?: string;
  quickFix?: CatalogQuickFix;
}

export function normalizeCatalogToken(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeIfcClass(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "IFCBUILDINGELEMENTPROXY";
  }
  const normalized = text.toUpperCase().replace(/[^A-Z0-9_]/g, "");
  return normalized.startsWith("IFC") ? normalized : `IFC${normalized}`;
}

export function normalizeIfcValueType(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "IFCLABEL";
  }
  const normalized = text.toUpperCase().replace(/[^A-Z0-9_]/g, "");
  return normalized.startsWith("IFC") ? normalized : `IFC${normalized}`;
}

export function normalizeCatalogRequirement(
  value: unknown,
): CatalogRequirement {
  const token = normalizeCatalogToken(value);
  if (
    ["erforderlich", "required", "mandatory", "pflicht"].some((word) =>
      token.includes(word),
    )
  ) {
    return "required";
  }
  if (["optional", "wahlweise"].some((word) => token.includes(word))) {
    return "optional";
  }
  return "unknown";
}

export function isRequiredCatalogRule(rule: CatalogPropertyRule) {
  return rule.requirement === "required";
}

export function catalogObjectLabel(objectType: CatalogObjectType) {
  return objectType.code
    ? `${objectType.name} (${objectType.code})`
    : objectType.name;
}

export function findCatalogObject(
  catalog: IfcObjectCatalog | null,
  id: string,
) {
  return catalog?.objectTypes.find((objectType) => objectType.id === id);
}

export function groupCatalogRulesByPset(rules: CatalogPropertyRule[]) {
  const groups = new Map<string, CatalogPropertyRule[]>();
  for (const rule of rules) {
    const key = rule.psetName;
    const existing = groups.get(key);
    if (existing) {
      existing.push(rule);
    } else {
      groups.set(key, [rule]);
    }
  }
  return groups;
}
