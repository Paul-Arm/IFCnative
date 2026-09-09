/**
 * Typisierter Zugriff auf das generierte Fachmodell-Schema
 * (fachmodell-schema.json, erzeugt von scripts/generate-fachmodell-schema.ts).
 * Die YAML daneben ist dieselbe Information in lesbarer Form.
 *
 * Das eingebaute Schema ist der Standard; über die zentralen Einstellungen
 * lässt sich eine andere JSON-Datei desselben Formats aktivieren (etwa ein
 * neuer Katalogstand). Alle Module lesen über `activeSchema()`, damit der
 * Wechsel ohne Neuladen wirkt; `schemaRevision()` zählt hoch, damit
 * Memo-Caches (Panel, Label-Cache) den Wechsel bemerken.
 */
import schemaJson from "./fachmodell-schema.json";

export type Importart =
  | "bauwerksmodell"
  | "monitoring"
  | "planung"
  | "einzelergebnisse"
  | "ergebnisse";

export const IMPORTARTEN: Importart[] = [
  "bauwerksmodell",
  "monitoring",
  "planung",
  "einzelergebnisse",
  "ergebnisse",
];

export interface VerfahrenDefinition {
  /** Regex-Fragment des Haupt-Psets (ohne Präfix), z. B. `Kernbohrung` oder `Altlasten\d*`. */
  pset: string;
  erweitert: string[];
  nurAusfuehrung: string[];
}

export interface BefundDefinition {
  felder?: string[];
  de: string;
  gruende?: Record<string, string>;
  limit?: number;
}

export interface KatalogProperty {
  name: string;
  kurz: string;
  typ: string;
  format: string | null;
  einheit: string | null;
  pflicht: boolean;
  loi: number[];
  gewerk: string[];
  zeile: number;
}

export interface KatalogPset {
  name: string;
  portalName: string;
  familie: string | null;
  properties: KatalogProperty[];
}

export interface KatalogKlasse {
  code: string;
  name: string;
  ifcClass: string;
  version: string | null;
  sheet: string;
  psets: KatalogPset[];
}

export interface Katalog {
  kind: "diagnostik" | "monitoring";
  datei: string;
  klassen: number;
  regeln: number;
  gewerke: string[];
  objektklassen: KatalogKlasse[];
}

export interface FachmodellSchema {
  schemaVersion: string;
  erzeugt: string;
  importarten: Record<Importart, { label: string; ids: string | null }> & Record<string, unknown>;
  psetFamilien: Record<string, string>;
  psetAliase: Record<string, string[]>;
  verfahren: VerfahrenDefinition[];
  befunde: Record<string, BefundDefinition>;
  katalog: { bwd: Katalog; mon: Katalog };
}

/** Das mitgelieferte Schema (Stand des Generators im Repo). */
export const fachmodellSchema = schemaJson as unknown as FachmodellSchema;

let active: FachmodellSchema = fachmodellSchema;
let revision = 0;

/** Das gerade wirksame Schema: eingebaut oder aus einer gewählten JSON-Datei. */
export function activeSchema(): FachmodellSchema {
  return active;
}

/** Zählt bei jedem Schemawechsel hoch — als Memo-Abhängigkeit gedacht. */
export function schemaRevision(): number {
  return revision;
}

/** Ob gerade das eingebaute Schema wirkt. */
export function isBuiltinSchemaActive(): boolean {
  return active === fachmodellSchema;
}

/** Schema aktivieren; `null` stellt das eingebaute wieder her. Liefert die neue Revision. */
export function setActiveSchema(schema: FachmodellSchema | null): number {
  const next = schema ?? fachmodellSchema;
  if (next !== active) {
    active = next;
    revision += 1;
  }
  return revision;
}

export type SchemaParseResult = { ok: true; schema: FachmodellSchema } | { ok: false; error: string };

/**
 * JSON-Text einer Schemadatei prüfen: Es muss dieselbe Struktur haben wie
 * `fachmodell-schema.json` (Generator-Ausgabe). Geprüft wird die Form, nicht
 * der Inhalt — ein Katalog mit anderen Klassen ist ja gerade der Zweck.
 */
export function parseFachmodellSchema(text: string): SchemaParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `Kein gültiges JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "Die Datei enthält kein JSON-Objekt." };
  const candidate = parsed as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof candidate.schemaVersion !== "string") missing.push("schemaVersion");
  for (const key of ["importarten", "psetFamilien", "psetAliase", "befunde"]) {
    if (!candidate[key] || typeof candidate[key] !== "object" || Array.isArray(candidate[key])) missing.push(key);
  }
  if (!Array.isArray(candidate.verfahren)) missing.push("verfahren");
  const katalog = candidate.katalog as Record<string, unknown> | undefined;
  if (!katalog || typeof katalog !== "object") {
    missing.push("katalog");
  } else {
    for (const key of ["bwd", "mon"] as const) {
      const entry = katalog[key] as Record<string, unknown> | undefined;
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.objektklassen)) missing.push(`katalog.${key}.objektklassen`);
    }
  }
  if (!missing.length) {
    const importarten = candidate.importarten as Record<string, unknown>;
    for (const art of IMPORTARTEN) {
      const entry = importarten[art] as Record<string, unknown> | undefined;
      if (!entry || typeof entry.label !== "string") missing.push(`importarten.${art}`);
    }
  }
  if (missing.length) {
    return { ok: false, error: `Das ist keine Fachmodell-Schemadatei (Generator-Ausgabe). Es fehlen: ${missing.join(", ")}.` };
  }
  return { ok: true, schema: candidate as unknown as FachmodellSchema };
}

export interface SchemaSummary {
  version: string;
  erzeugt: string;
  bwd: { klassen: number; regeln: number; datei: string };
  mon: { klassen: number; regeln: number; datei: string };
  verfahren: number;
  befunde: number;
}

/** Kennzahlen eines Schemas für die Anzeige in den Einstellungen. */
export function describeSchema(schema: FachmodellSchema = active): SchemaSummary {
  const count = (katalog: Katalog) => ({
    klassen: typeof katalog.klassen === "number" ? katalog.klassen : katalog.objektklassen.length,
    regeln: typeof katalog.regeln === "number" ? katalog.regeln : katalog.objektklassen.reduce((n, klasse) => n + klasse.psets.reduce((m, pset) => m + pset.properties.length, 0), 0),
    datei: katalog.datei ?? "",
  });
  return {
    version: schema.schemaVersion,
    erzeugt: schema.erzeugt ?? "",
    bwd: count(schema.katalog.bwd),
    mon: count(schema.katalog.mon),
    verfahren: schema.verfahren.length,
    befunde: Object.keys(schema.befunde).length,
  };
}

export function importartLabel(importart: Importart): string {
  return active.importarten[importart]?.label ?? importart;
}

/** Katalog, der zur Importart gehört (Bauwerksmodell hat keinen). */
export function katalogFor(importart: Importart): Katalog | null {
  if (importart === "monitoring") return active.katalog.mon;
  if (importart === "bauwerksmodell") return null;
  return active.katalog.bwd;
}

function fullMatch(pattern: string, name: string): boolean {
  return new RegExp(`^(?:${pattern})$`).test(name);
}

export type VerfahrenTreffer =
  | { kind: "main"; verfahren: VerfahrenDefinition }
  | { kind: "extended"; verfahren: VerfahrenDefinition; executionOnly: boolean };

/**
 * Ordnet einen Pset-Namen (ohne Präfix) einem Verfahren zu — wie
 * pset_catalog.py: erst Haupt-Psets, dann erweiterte Psets.
 */
export function classifyMethodPset(psetName: string): VerfahrenTreffer | undefined {
  for (const verfahren of active.verfahren) {
    if (fullMatch(verfahren.pset, psetName)) return { kind: "main", verfahren };
  }
  for (const verfahren of active.verfahren) {
    if (verfahren.nurAusfuehrung.some((pattern) => fullMatch(pattern, psetName))) {
      return { kind: "extended", verfahren, executionOnly: true };
    }
    if (verfahren.erweitert.some((pattern) => fullMatch(pattern, psetName))) {
      return { kind: "extended", verfahren, executionOnly: false };
    }
  }
  return undefined;
}

export function isMainMethodPset(psetName: string): boolean {
  return classifyMethodPset(psetName)?.kind === "main";
}

export function isMeasurementFieldPset(psetName: string): boolean {
  return fullMatch(active.psetFamilien.Messfeld ?? "Messfeld\\d*", psetName);
}

/** Alle Haupt-Pset-Muster der Verfahren, für Auswahllisten. */
export function listMethodPsets(): string[] {
  return active.verfahren.map((verfahren) => verfahren.pset);
}
