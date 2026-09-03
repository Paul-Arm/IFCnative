/**
 * Typisierter Zugriff auf das generierte Fachmodell-Schema
 * (fachmodell-schema.json, erzeugt von scripts/generate-fachmodell-schema.ts).
 * Die YAML daneben ist dieselbe Information in lesbarer Form.
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

export const fachmodellSchema = schemaJson as unknown as FachmodellSchema;

export function importartLabel(importart: Importart): string {
  return fachmodellSchema.importarten[importart]?.label ?? importart;
}

/** Katalog, der zur Importart gehört (Bauwerksmodell hat keinen). */
export function katalogFor(importart: Importart): Katalog | null {
  if (importart === "monitoring") return fachmodellSchema.katalog.mon;
  if (importart === "bauwerksmodell") return null;
  return fachmodellSchema.katalog.bwd;
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
  for (const verfahren of fachmodellSchema.verfahren) {
    if (fullMatch(verfahren.pset, psetName)) return { kind: "main", verfahren };
  }
  for (const verfahren of fachmodellSchema.verfahren) {
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
  return fullMatch(fachmodellSchema.psetFamilien.Messfeld ?? "Messfeld\\d*", psetName);
}

/** Alle Haupt-Pset-Muster der Verfahren, für Auswahllisten. */
export function listMethodPsets(): string[] {
  return fachmodellSchema.verfahren.map((verfahren) => verfahren.pset);
}
