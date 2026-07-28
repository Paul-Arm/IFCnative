/**
 * Datenmodell des openSIM-Objektkatalogs (Portierung aus 1.x `src/ifc/catalog.ts`).
 *
 * Ein Katalog beschreibt Klassen (Bauteil-/Objekttypen) mit ihren
 * Merkmalsgruppen (Psets) und Merkmalen (Properties). Jedes Merkmal trägt
 * Wertetyp, Format, Einheit, Pflichtangabe, Gewerke-Marker und LoI-Stufen.
 *
 * Die Datenform bleibt bewusst nah an 1.x, hat aber keine 1.x-Abhängigkeiten:
 * einzige externe Kopplung ist `PropertyValueType` von @ifc-lite/data, damit
 * Katalogtypen direkt in das Mutations-Overlay geschrieben werden können.
 */
import { PropertyValueType } from "@ifc-lite/data";

export type CatalogRequirement = "required" | "optional" | "unknown";

export type CatalogKind = "diagnostik" | "monitoring";

export const CATALOG_KINDS: readonly CatalogKind[] = [
  "diagnostik",
  "monitoring",
];

export function catalogKindLabel(kind: CatalogKind): string {
  return kind === "monitoring" ? "Monitoring (MON)" : "Diagnostik (BWD)";
}

export const CATALOG_LOI_LEVELS = [
  "LoI 100",
  "LoI 200",
  "LoI 300",
  "LoI 400",
  "LoI 500",
] as const;

export type CatalogLoiLevel = (typeof CATALOG_LOI_LEVELS)[number];

export type CatalogFindingSeverity = "info" | "warning" | "error";

export type CatalogFindingKind =
  | "class-mismatch"
  | "missing-classification"
  | "missing-pset"
  | "missing-property"
  | "property-type-mismatch"
  | "empty-required-value";

/**
 * Schweregrad je Befundart. Abweichung zu 1.x (dort alles „warning"):
 * fehlende Struktur ist ein Fehler, ein noch leerer Pflichtwert nur ein
 * Hinweis — ein Quick-Fix kann Struktur anlegen, aber keine Inhalte erfinden.
 */
export const CATALOG_SEVERITY_OF: Record<
  CatalogFindingKind,
  CatalogFindingSeverity
> = {
  "class-mismatch": "warning",
  "missing-classification": "warning",
  "missing-pset": "error",
  "missing-property": "error",
  "property-type-mismatch": "warning",
  "empty-required-value": "info",
};

export const CATALOG_SEVERITY_LABEL: Record<CatalogFindingSeverity, string> = {
  error: "Fehler",
  warning: "Warnung",
  info: "Hinweis",
};

export const CATALOG_SEVERITY_COLOR: Record<CatalogFindingSeverity, string> = {
  error: "var(--error)",
  warning: "var(--warn)",
  info: "var(--text-dim)",
};

export interface CatalogPropertyRule {
  id: string;
  psetName: string;
  propertyName: string;
  /** IFC-Wertetyp in Großschreibung, z. B. „IFCLABEL" */
  valueType: string;
  format: string;
  unit: string;
  requirement: CatalogRequirement;
  /** Gewerke-Marker: „TM UP"/„TM EE"/„TM UE" bzw. „TM MEKO"/„TM INSP"/„TM INSD" */
  tradeMarkers: Record<string, boolean>;
  /** LoI-Marker „LoI 100" … „LoI 500" */
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
  kind: CatalogKind;
  objectTypes: CatalogObjectType[];
  /** Import-Diagnostik (deutsch), wird in der Pane angezeigt. */
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
  /** Nur gesetzt, wenn der Befund automatisch behebbar ist. */
  quickFix?: CatalogQuickFix;
}

export function normalizeCatalogToken(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeIfcClass(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "IFCBUILDINGELEMENTPROXY";
  const normalized = text.toUpperCase().replace(/[^A-Z0-9_]/g, "");
  return normalized.startsWith("IFC") ? normalized : `IFC${normalized}`;
}

export function normalizeIfcValueType(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "IFCLABEL";
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

export function isRequiredCatalogRule(rule: CatalogPropertyRule): boolean {
  return rule.requirement === "required";
}

export function catalogRequirementLabel(value: CatalogRequirement): string {
  if (value === "required") return "Pflicht";
  if (value === "optional") return "optional";
  return "unbestimmt";
}

export function catalogObjectLabel(objectType: CatalogObjectType): string {
  return objectType.code
    ? `${objectType.name} (${objectType.code})`
    : objectType.name;
}

export function findCatalogObject(
  catalog: IfcObjectCatalog | null,
  id: string | null,
): CatalogObjectType | undefined {
  if (!catalog || !id) return undefined;
  return catalog.objectTypes.find((objectType) => objectType.id === id);
}

/** Merkmale nach Merkmalsgruppe bündeln (Reihenfolge = Katalogreihenfolge). */
export function groupCatalogRulesByPset(
  rules: readonly CatalogPropertyRule[],
): Map<string, CatalogPropertyRule[]> {
  const groups = new Map<string, CatalogPropertyRule[]>();
  for (const rule of rules) {
    const existing = groups.get(rule.psetName);
    if (existing) existing.push(rule);
    else groups.set(rule.psetName, [rule]);
  }
  return groups;
}

/** Kurzform der gesetzten LoI-Stufen, z. B. „200, 300, 400". */
export function catalogRuleLoiLabel(rule: CatalogPropertyRule): string {
  const levels = CATALOG_LOI_LEVELS.filter(
    (level) => rule.loiMarkers[level],
  ).map((level) => level.replace("LoI ", ""));
  return levels.join(", ");
}

/** Gesetzte Gewerke-Marker, z. B. „UP, EE". */
export function catalogRuleTradeLabel(rule: CatalogPropertyRule): string {
  return Object.entries(rule.tradeMarkers)
    .filter(([, set]) => set)
    .map(([label]) => label.replace(/^TM\s+/, ""))
    .join(", ");
}

export function matchesLoiLevel(
  rule: CatalogPropertyRule,
  level: CatalogLoiLevel | null,
): boolean {
  return level === null ? true : rule.loiMarkers[level] === true;
}

/** IFC-Wertetyp des Katalogs → Werttyp des Mutations-Overlays. */
export function catalogValueTypeToPropertyType(
  valueType: string,
): PropertyValueType {
  const type = normalizeIfcValueType(valueType);
  if (type === "IFCBOOLEAN") return PropertyValueType.Boolean;
  if (type === "IFCLOGICAL") return PropertyValueType.Logical;
  if (type === "IFCINTEGER" || type === "IFCCOUNTMEASURE") {
    return PropertyValueType.Integer;
  }
  if (type === "IFCREAL" || type.includes("MEASURE")) {
    return PropertyValueType.Real;
  }
  if (type === "IFCTEXT") return PropertyValueType.Text;
  if (type === "IFCIDENTIFIER") return PropertyValueType.Identifier;
  return PropertyValueType.Label;
}

/** Rückabbildung für Befundtexte; null, wenn nicht eindeutig benennbar. */
export function ifcTypeOfPropertyValueType(
  type: PropertyValueType,
): string | null {
  switch (type) {
    case PropertyValueType.Boolean:
      return "IFCBOOLEAN";
    case PropertyValueType.Logical:
      return "IFCLOGICAL";
    case PropertyValueType.Integer:
      return "IFCINTEGER";
    case PropertyValueType.Real:
      return "IFCREAL";
    case PropertyValueType.Text:
      return "IFCTEXT";
    case PropertyValueType.Identifier:
      return "IFCIDENTIFIER";
    case PropertyValueType.Label:
      return "IFCLABEL";
    default:
      return null;
  }
}

/** Neutraler Startwert eines Merkmals (0 / FALSE / leerer Text). */
export function defaultCatalogValue(
  rule: CatalogPropertyRule,
): string | number | boolean {
  const type = catalogValueTypeToPropertyType(rule.valueType);
  if (type === PropertyValueType.Boolean || type === PropertyValueType.Logical) {
    return false;
  }
  if (type === PropertyValueType.Integer || type === PropertyValueType.Real) {
    return 0;
  }
  return "";
}
