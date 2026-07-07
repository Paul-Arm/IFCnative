import { normalizeIfcClass } from "../ifc/catalog";

/**
 * Ziel eines Portal-Modells beim Import:
 * - "element": eigenes IFC-Element (Upsert per ExternalId)
 * - "pset": nur Psets am Host-Element (kein eigenes Element)
 * - "skip": Knoten überspringen, Kinder aber weiter importieren (Durchreichen)
 * - "ignore": Knoten SAMT Unterbaum ignorieren (z. B. "vor den Verfahren aufhören")
 */
export type PortalMappingTarget = "element" | "pset" | "skip" | "ignore";

export interface PortalModelMapping {
  /** API-Modellname, z. B. "Untersuchungsbereich" oder "Kernbohrung". */
  model: string;
  /** Normalisierte IFC-Klasse (UPPERCASE, "IFC"-Präfix erzwungen). */
  ifcClass: string;
  /** ObjectType-Attribut des erzeugten Elements, Default = Modellname. */
  objectType: string;
  target: PortalMappingTarget;
  /**
   * false = Psets nur als leere Hüllen anlegen (Name ohne Properties);
   * bei target "element" entsteht das Element dann ohne Katalog-/Rohdaten-Psets
   * mit leeren Pset-Hüllen. Default true.
   */
  writeProperties: boolean;
}

export interface PortalMappingConfig {
  version: 1;
  mode: "proxy" | "custom";
  mappings: PortalModelMapping[];
}

/** Tabellen-Reihenfolge der Mapping-Konfiguration (Diagnostik + Monitoring). */
export const PORTAL_API_MODELS: string[] = [
  "Bauwerk",
  "Teilbauwerk",
  "Bauteil",
  "Untersuchungsbereich",
  "Untersuchungsstelle",
  "Untersuchungsverfahren",
  "Kernbohrung",
  "Oeffnung",
  "Bohrkanal",
  "Bohrkern",
  "Probe",
  "Messkonzept",
  "Massnahme",
  "Messstelle",
  "Kanal",
];

/** Verfahrens-Modelle (Diagnostik) — für Bulk-Aktionen in der Mapping-UI. */
export const PORTAL_VERFAHREN_MAPPING_MODELS: string[] = [
  "Untersuchungsverfahren",
  "Kernbohrung",
  "Oeffnung",
  "Bohrkanal",
  "Bohrkern",
  "Probe",
];

/**
 * Auswählbare IFC-Klassen (wie FreeCAD-Addon, ohne IfcTask — der Editor hat
 * keine Task-Unterstützung). Freier Text bleibt über die UI erlaubt.
 */
export const IFC_CLASS_CHOICES: string[] = [
  "IfcBuilding",
  "IfcBuildingStorey",
  "IfcBuildingElementPart",
  "IfcBuildingElementProxy",
  "IfcElementAssembly",
  "IfcVirtualElement",
  "IfcSpatialZone",
  "IfcZone",
  "IfcGroup",
  "IfcAnnotation",
  "IfcProxy",
];

interface PresetRow {
  ifcClass: string;
  objectType?: string;
  target?: PortalMappingTarget;
}

// Soll-Struktur laut Beispiel-IFCs (20260623_Beispiel2_FM_DIA_2012_EE_2.ifc +
// KIB-Strukturmodell): Es gibt KEINE IfcBuildingElementPart-Elemente. Die
// Untersuchungsstellen liegen flach als Proxies im Geschoss; Teilbauwerk und
// Bauteil formen den Baum NICHT, sondern werden über Dot-ID-Psets verlinkt
// (_BauteilID/_UntersuchungsbereichID in ePset_Objektinformationen). Der
// Untersuchungsbereich ist ein nummeriertes Pset (ePset_Untersuchungsbereich<NN>),
// Verfahren sind Psets auf der US plus Klassifikationsreferenz
// ("openSIM BIM Objektkatalog", "BWD - <Kürzel>").
const PROXY_PRESET_ROWS: Record<string, PresetRow> = {
  Bauteil: { ifcClass: "IfcBuildingElementProxy", target: "skip" },
  Bauwerk: { ifcClass: "IfcBuilding" },
  Bohrkanal: { ifcClass: "IfcBuildingElementProxy", target: "pset" },
  Bohrkern: { ifcClass: "IfcBuildingElementProxy", target: "pset" },
  Kanal: { ifcClass: "IfcBuildingElementProxy", target: "pset" },
  Kernbohrung: { ifcClass: "IfcBuildingElementProxy", target: "pset" },
  Massnahme: { ifcClass: "IfcBuildingElementProxy", target: "pset" },
  Messkonzept: { ifcClass: "IfcBuildingElementProxy", target: "skip" },
  Messstelle: { ifcClass: "IfcBuildingElementProxy", objectType: "Sensor" },
  Oeffnung: { ifcClass: "IfcBuildingElementProxy", target: "pset" },
  // Proben sind im Beispiel-IFC eigene Proxies ("probe01.01").
  Probe: { ifcClass: "IfcBuildingElementProxy" },
  Teilbauwerk: { ifcClass: "IfcBuildingStorey", target: "skip" },
  Untersuchungsbereich: { ifcClass: "IfcBuildingElementProxy", target: "pset" },
  Untersuchungsstelle: { ifcClass: "IfcBuildingElementProxy" },
  Untersuchungsverfahren: { ifcClass: "IfcBuildingElementProxy", target: "pset" },
};

function createPresetRow(model: string): PortalModelMapping {
  const preset = PROXY_PRESET_ROWS[model];
  return {
    ifcClass: normalizeIfcClass(preset?.ifcClass ?? "IfcBuildingElementProxy"),
    model,
    objectType: preset?.objectType ?? model,
    target: preset?.target ?? "element",
    writeProperties: true,
  };
}

export function createProxyPresetMapping(): PortalMappingConfig {
  return {
    mappings: PORTAL_API_MODELS.map((model) => createPresetRow(model)),
    mode: "proxy",
    version: 1,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readTarget(value: unknown): PortalMappingTarget | null {
  const token = readString(value).trim().toLowerCase();
  if (
    token === "element" ||
    token === "pset" ||
    token === "skip" ||
    token === "ignore"
  ) {
    return token;
  }
  return null;
}

function looksLikeMappingRow(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return ["ifc_class", "ifcClass", "object_type", "objectType", "target"].some(
    (key) => key in record,
  );
}

function readRawMappingRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  if ("mappings" in record) {
    return readRawMappingRows(record.mappings);
  }
  // Dict-Form { "<Model>": { ifc_class, object_type, target } } (FreeCAD-kompatibel).
  const entries = Object.entries(record).filter(([, row]) => looksLikeMappingRow(row));
  return entries.map(([model, row]) => ({ model, ...(asRecord(row) ?? {}) }));
}

function normalizeMappingRow(raw: Record<string, unknown>): PortalModelMapping | null {
  const model = readString(raw.model).trim();
  if (!model) {
    return null;
  }
  const preset = createPresetRow(model);
  const ifcClassRaw = (readString(raw.ifcClass) || readString(raw.ifc_class)).trim();
  const objectTypeRaw = (readString(raw.objectType) || readString(raw.object_type)).trim();
  const writePropertiesRaw = raw.writeProperties ?? raw.write_properties;
  return {
    ifcClass: ifcClassRaw ? normalizeIfcClass(ifcClassRaw) : preset.ifcClass,
    model,
    objectType: objectTypeRaw || preset.objectType,
    target: readTarget(raw.target) ?? preset.target,
    writeProperties:
      typeof writePropertiesRaw === "boolean"
        ? writePropertiesRaw
        : preset.writeProperties,
  };
}

/**
 * Toleranter Normalisierer: akzeptiert die eigene Config, FreeCAD-Dateien
 * ({version, mappings:[{model, ifc_class, object_type}]}), Dict-by-Model und
 * nackte Listen. Fehlende Standardmodelle werden aus dem Proxy-Preset ergänzt,
 * unbrauchbare Zeilen durch die Preset-Zeile ersetzt.
 */
export function normalizePortalMapping(value: unknown): PortalMappingConfig {
  const rows = readRawMappingRows(value);
  const byModel = new Map<string, PortalModelMapping>();
  const extraOrder: string[] = [];
  for (const raw of rows) {
    const mapping = normalizeMappingRow(raw);
    if (!mapping) {
      continue;
    }
    const key = mapping.model.toLowerCase();
    if (byModel.has(key)) {
      continue;
    }
    byModel.set(key, mapping);
    if (!PORTAL_API_MODELS.some((model) => model.toLowerCase() === key)) {
      extraOrder.push(key);
    }
  }
  const mappings: PortalModelMapping[] = PORTAL_API_MODELS.map(
    (model) => byModel.get(model.toLowerCase()) ?? createPresetRow(model),
  );
  for (const key of extraOrder) {
    const mapping = byModel.get(key);
    if (mapping) {
      mappings.push(mapping);
    }
  }
  const record = asRecord(value);
  const modeRaw = readString(record?.mode).trim().toLowerCase();
  const mode: PortalMappingConfig["mode"] =
    modeRaw === "proxy" || modeRaw === "custom"
      ? modeRaw
      : rows.length > 0
        ? "custom"
        : "proxy";
  if (mode === "proxy") {
    // Proxy-Modus bedeutet "aktuelles Preset": gespeicherte Zeilen sind nur
    // ein Snapshot eines älteren Presets und würden Preset-Korrekturen
    // (z. B. Verfahren als Psets statt Proxies) sonst dauerhaft überdecken.
    return createProxyPresetMapping();
  }
  return { mappings, mode, version: 1 };
}

/**
 * Exakte Modell-Übereinstimmung (case-insensitive); Verfahrens-Modelle ohne
 * eigene Zeile fallen auf die Zeile "Untersuchungsverfahren" zurück.
 */
export function mappingForModel(
  config: PortalMappingConfig,
  model: string,
): PortalModelMapping {
  const wanted = model.trim().toLowerCase();
  const exact = config.mappings.find(
    (mapping) => mapping.model.toLowerCase() === wanted,
  );
  if (exact) {
    return exact;
  }
  const fallback = config.mappings.find(
    (mapping) => mapping.model.toLowerCase() === "untersuchungsverfahren",
  );
  return fallback ?? createPresetRow(model);
}

const CAMEL_IFC_CLASSES = [
  ...IFC_CLASS_CHOICES,
  "IfcBeam",
  "IfcColumn",
  "IfcCovering",
  "IfcDistributionElement",
  "IfcDoor",
  "IfcFurnishingElement",
  "IfcMember",
  "IfcPlate",
  "IfcProject",
  "IfcRailing",
  "IfcSensor",
  "IfcSite",
  "IfcSlab",
  "IfcSpace",
  "IfcTask",
  "IfcWall",
  "IfcWindow",
];

const CAMEL_IFC_CLASS_BY_UPPER = new Map(
  CAMEL_IFC_CLASSES.map((name) => [name.toUpperCase(), name]),
);

function camelIfcClass(ifcClass: string): string {
  const normalized = normalizeIfcClass(ifcClass);
  const known = CAMEL_IFC_CLASS_BY_UPPER.get(normalized);
  if (known) {
    return known;
  }
  // Best-effort für unbekannte Klassen: "IFCXYZ" -> "IfcXyz".
  const rest = normalized.slice(3);
  return rest ? `Ifc${rest.charAt(0)}${rest.slice(1).toLowerCase()}` : "Ifc";
}

/**
 * Serialisiert die Konfiguration im FreeCAD-Dateiformat
 * ({"version":1,"mappings":[{"model","ifc_class","object_type","target"}]}).
 */
export function serializeFreecadMapping(config: PortalMappingConfig): string {
  const payload = {
    mappings: config.mappings.map((mapping) => ({
      model: mapping.model,
      ifc_class: camelIfcClass(mapping.ifcClass),
      object_type: mapping.objectType,
      target: mapping.target,
      write_properties: mapping.writeProperties,
    })),
    version: 1,
  };
  return JSON.stringify(payload, null, 2);
}

/** Akzeptiert auch FreeCAD-Dateien ohne "target"/"mode". */
export function parseFreecadMapping(json: string): PortalMappingConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Mapping-Datei enthält kein gültiges JSON.");
  }
  return normalizePortalMapping(parsed);
}
