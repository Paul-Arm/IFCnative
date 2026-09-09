/**
 * Einstellungen der IFC-Attribuierung, die der Workspace lokal speichert:
 * derzeit die gewählte Schemadatei. Der Text der Datei wird mitgespeichert,
 * damit das Schema nach einem Neustart ohne erneutes Wählen wirkt — ein
 * Dateipfad wäre im Browser nicht wieder lesbar.
 */
import { parseFachmodellSchema, setActiveSchema } from "./schema";

export interface AttributionSchemaFile {
  name: string;
  size: number;
  /** ISO-Zeitstempel, wann die Datei gewählt wurde. */
  loadedAt: string;
  /** Vollständiger JSON-Text (wird beim Start wieder geparst). */
  text: string;
}

export interface AttributionSettings {
  /** `null` = eingebautes Schema. */
  schemaFile: AttributionSchemaFile | null;
}

/** Größer wollen wir nicht im LocalStorage ablegen (Budget ~5 MB je Origin). */
export const MAX_SCHEMA_FILE_BYTES = 3 * 1024 * 1024;

export function createDefaultAttributionSettings(): AttributionSettings {
  return { schemaFile: null };
}

/**
 * Wirksames Schema aus den Einstellungen setzen. Liefert die Schema-Revision;
 * eine nicht mehr lesbare Datei fällt still auf das eingebaute Schema zurück
 * (der Lader verwirft ungültige Dateien schon beim Lesen).
 */
export function applyAttributionSettings(settings: AttributionSettings): number {
  if (!settings.schemaFile) return setActiveSchema(null);
  const parsed = parseFachmodellSchema(settings.schemaFile.text);
  return setActiveSchema(parsed.ok ? parsed.schema : null);
}
