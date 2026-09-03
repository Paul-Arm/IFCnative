/**
 * Normalisierung genau wie der MKP-Portal-Importer
 * (mkp/portal/ifc/importer/psets.py::_cleanup_psets,
 *  mkp/portal/diagnostics/importer/helpers.py::get_property_value,
 *  clean_required_value).
 *
 * Ziel: Editor und Portal lesen dieselbe Datei gleich. Was das Portal nicht
 * normalisiert (Pset-Namen nach dem Präfix, Umlaute), normalisiert auch dieses
 * Modul nicht.
 */
import type { NativeIfcDocument, NativeIfcPropertySet } from "../nativeDocument";
import { normalizeObjectInfoIdValue } from "../objectInfoValidation";

const PSET_PREFIX = /^(Pset_|ePset_|ePSet_)/;

/** `ePset_Objektinformation` → `Objektinformation` (Portal: removeprefix). */
export function stripPsetPrefix(name: string): string {
  return name.trim().replace(PSET_PREFIX, "");
}

/** `_BauteilID` → `BauteilID` (Portal: removeprefix("_")). */
export function stripPropertyPrefix(name: string): string {
  return name.trim().replace(/^_/, "");
}

/**
 * Pset-Muster des Schemas: entweder ein exakter Name (`Objektinformation`)
 * oder ein Regex-Fragment mit Ziffernklasse (`Untersuchungsbereich\d*`).
 * Vergleich ist wie im Portal exakt und groß-/kleinschreibungsabhängig.
 */
export function psetMatches(fileName: string, pattern: string): boolean {
  const name = stripPsetPrefix(fileName);
  if (!/[\\[\]()*+?|]/.test(pattern)) {
    return name === pattern;
  }
  return new RegExp(`^(?:${pattern})$`).test(name);
}

/** Alle Psets eines Objekts, deren Name (ohne Präfix) einem Muster entspricht. */
export function findPsets(
  document: NativeIfcDocument,
  entityId: number,
  pattern: string,
): NativeIfcPropertySet[] {
  return (document.propertySetsByEntity.get(entityId) ?? []).filter((set) =>
    psetMatches(set.name, pattern),
  );
}

/** Erstes Pset, das einem von mehreren Mustern entspricht (Aliase in Reihenfolge). */
export function findPset(
  document: NativeIfcDocument,
  entityId: number,
  ...patterns: string[]
): NativeIfcPropertySet | undefined {
  for (const pattern of patterns) {
    const set = findPsets(document, entityId, pattern)[0];
    if (set) return set;
  }
  return undefined;
}

export interface PropertyHit {
  propertyId: number;
  /** Name in der Datei, unverändert. */
  rawName: string;
  /** STEP-Wert in der Datei, unverändert (`IFCLABEL('x')`). */
  rawValue: string;
  /** Entpackter Textwert; `''` wenn leer, `-` oder `$`. */
  value: string;
}

/**
 * Property-Suche mit Portal-Semantik: führender `_` wird ignoriert, Vergleich
 * ohne Groß-/Kleinschreibung, und `Name_<Suffix>` (Katalogkürzel wie `_OI`)
 * gilt wie `Name`. Mehrere Namen sind Aliase in Priorität.
 */
export function getProperty(
  set: NativeIfcPropertySet | undefined,
  ...names: string[]
): PropertyHit | undefined {
  if (!set) return undefined;
  const wanted = names.map((name) => stripPropertyPrefix(name).toLowerCase());
  // 1. exakter Treffer (nach Präfixstrip, casefold)
  for (const target of wanted) {
    const hit = set.values.find(
      (property) => stripPropertyPrefix(property.name).toLowerCase() === target,
    );
    if (hit) return toHit(hit);
  }
  // 2. Suffix-Treffer `name_<suffix>`
  for (const target of wanted) {
    const hit = set.values.find((property) =>
      stripPropertyPrefix(property.name).toLowerCase().startsWith(`${target}_`),
    );
    if (hit) return toHit(hit);
  }
  return undefined;
}

/** Wie getProperty, liefert aber nur den bereinigten Wert (`''` wenn leer). */
export function getValue(set: NativeIfcPropertySet | undefined, ...names: string[]): string {
  return getProperty(set, ...names)?.value ?? "";
}

/** Alle Properties eines Psets, deren bereinigter Name einem Regex entspricht. */
export function findProperties(
  set: NativeIfcPropertySet | undefined,
  pattern: RegExp,
): PropertyHit[] {
  if (!set) return [];
  return set.values
    .filter((property) => pattern.test(stripPropertyPrefix(property.name)))
    .map(toHit);
}

/** Portal: `clean_required_value` — `None`, leer und `-` sind leer. */
export function cleanValue(raw: string): string {
  const text = normalizeObjectInfoIdValue(raw).trim();
  return text === "-" ? "" : text;
}

/** Portal: `_is_objective_id_property` — `UntersuchungszielID`, `UntersuchungszielIDs`, jeweils auch mit Suffix. */
export function isObjectiveIdProperty(name: string): boolean {
  const normalized = stripPropertyPrefix(name).toLowerCase();
  return ["untersuchungszielid", "untersuchungszielids"].some(
    (base) => normalized === base || normalized.startsWith(`${base}_`),
  );
}

/** Portal: Listenwerte in `UntersuchungszielID(s)` sind mit `, ; |` oder Zeilenumbruch getrennt. */
export function splitIdList(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(/[,;|\n]/)) {
    const cleaned = cleanValue(part);
    if (cleaned) seen.add(cleaned);
  }
  return [...seen];
}

/** Alles vor dem letzten Punkt (Portal: `rsplit('.', 1)[0]`). */
export function idPrefix(id: string): string {
  const index = id.lastIndexOf(".");
  return index < 0 ? id : id.slice(0, index);
}

function toHit(property: { id: number; name: string; value: string }): PropertyHit {
  return {
    propertyId: property.id,
    rawName: property.name,
    rawValue: property.value,
    value: cleanValue(property.value),
  };
}
