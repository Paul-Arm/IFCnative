/**
 * Werttypen für Property- und Mengen-Eingaben: Auswahllisten für die UI,
 * Darstellung als Entwurfstext und Rückwandlung inklusive Validierung.
 * REAL/INTEGER werden numerisch geprüft — ungültige Entwürfe werden nie
 * committet, sondern nur rot markiert.
 */
import { PropertyValueType, QuantityType } from "@ifc-lite/data";
import type { PropertyValue } from "@ifc-lite/data";

export type ValueKind = "text" | "real" | "integer" | "boolean";

export const PROPERTY_TYPES: ReadonlyArray<{
  type: PropertyValueType;
  label: string;
}> = [
  { type: PropertyValueType.Label, label: "LABEL" },
  { type: PropertyValueType.Text, label: "TEXT" },
  { type: PropertyValueType.Identifier, label: "IDENTIFIER" },
  { type: PropertyValueType.Real, label: "REAL" },
  { type: PropertyValueType.Integer, label: "INTEGER" },
  { type: PropertyValueType.Boolean, label: "BOOLEAN" },
];

export const QUANTITY_TYPES: ReadonlyArray<{
  type: QuantityType;
  label: string;
}> = [
  { type: QuantityType.Length, label: "Länge" },
  { type: QuantityType.Area, label: "Fläche" },
  { type: QuantityType.Volume, label: "Volumen" },
  { type: QuantityType.Count, label: "Anzahl" },
  { type: QuantityType.Weight, label: "Gewicht" },
  { type: QuantityType.Time, label: "Zeit" },
];

/** Welche Eingabeart passt zum Werttyp? */
export function kindOf(type: PropertyValueType): ValueKind {
  switch (type) {
    case PropertyValueType.Real:
      return "real";
    case PropertyValueType.Integer:
      return "integer";
    case PropertyValueType.Boolean:
    case PropertyValueType.Logical:
      return "boolean";
    default:
      return "text";
  }
}

/** Overlay-Wert als Text fürs Eingabefeld. */
export function toDraft(value: PropertyValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map((v) => toDraft(v)).join(", ");
  return String(value);
}

/** Boolescher Entwurf als „ja"/„nein" für das Select. */
export function toBooleanDraft(value: PropertyValue): string {
  const text = toDraft(value).trim().toLowerCase();
  return text === "true" || text === "ja" || text === "1" || text === ".t."
    ? "ja"
    : "nein";
}

export type ParsedValue =
  | { ok: true; value: string | number | boolean }
  | { ok: false };

/** Entwurfstext gemäß Werttyp prüfen und umwandeln. */
export function parseDraft(draft: string, kind: ValueKind): ParsedValue {
  if (kind === "boolean") return { ok: true, value: draft === "ja" };
  if (kind === "text") return { ok: true, value: draft };
  const parsed = parseNumber(draft);
  if (parsed === null) return { ok: false };
  if (kind === "integer" && !Number.isInteger(parsed)) return { ok: false };
  return { ok: true, value: parsed };
}

/** Zahl aus dem Entwurf; akzeptiert Komma als Dezimaltrenner. */
export function parseNumber(draft: string): number | null {
  const text = draft.trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Ist der Entwurf für diese Eingabeart committfähig? */
export function isValidDraft(draft: string, kind: ValueKind): boolean {
  return parseDraft(draft, kind).ok;
}
