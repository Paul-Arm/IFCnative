/**
 * Namens- und Wertkonventionen der Objektinfo-Familie (M6).
 *
 * Ausgelagert aus `objectInfo.ts`, weil genau diese Regeln die Portierung von
 * 1.x (`/src/ifc/objectInfoValidation.ts`) ausmachen und einzeln nachvollzogen
 * werden müssen:
 *  - Pset-Namen `ePset_Objektinformation` / `…informationen` (case-egal),
 *  - `_ID` definiert eine ID, jedes andere Property mit Endung „ID"/„IDs"
 *    verweist auf eine,
 *  - Werte werden von Typwrappern (`IFCIDENTIFIER('A-1')`), Quotes, `$` und
 *    Rand-Leerzeichen befreit; `-` und Leerstring gelten als leer,
 *  - Referenzwerte dürfen Semikolon-Listen sein (Konvention
 *    `_UntersuchungszielIDs`).
 */
import type { PropertyValue } from "@ifc-lite/data";

const OBJECT_INFO_PSET_ALIASES: readonly string[] = [
  "epset_objektinformation",
  "epset_objektinformationen",
];
const ID_PROPERTY_NAME = "_id";

const normalizeName = (name: string): string => name.trim().toLowerCase();

export const isObjectInfoPset = (name: string): boolean =>
  OBJECT_INFO_PSET_ALIASES.includes(normalizeName(name));

export const isIdProperty = (name: string): boolean =>
  normalizeName(name) === ID_PROPERTY_NAME;

/**
 * `…ID` / `…IDs`, aber nicht die Definition `_ID` selbst. 1.x prüfte nur
 * `endsWith("id")` und übersah damit die Pluralform der Listen-Properties.
 */
export function isReferenceProperty(name: string): boolean {
  const normalized = normalizeName(name);
  if (normalized === ID_PROPERTY_NAME) return false;
  return normalized.endsWith("id") || normalized.endsWith("ids");
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith("'") && value.endsWith("'")
    ? value.slice(1, -1)
    : value;
}

/** Einzelwert normalisieren (Typwrapper `IFCIDENTIFIER(...)` und Quotes weg). */
export function normalizeScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw || raw === "$") return "";
  const typed = /^IFC[A-Z0-9_]*\((.*)\)$/i.exec(raw)?.[1]?.trim() ?? raw;
  return unquote(typed).trim();
}

/** Property-Wert → Text; Listenwerte werden als Semikolon-Liste geführt. */
export function normalizeValue(value: PropertyValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeScalar(item)).join(";");
  }
  return normalizeScalar(value);
}

export const isBlank = (value: string): boolean => !value || value === "-";

/** Semikolon-Liste in Einzelwerte zerlegen. */
export function splitIdList(value: string): string[] {
  return value
    .split(";")
    .map((part) => normalizeScalar(part))
    .filter((part) => part.length > 0);
}
