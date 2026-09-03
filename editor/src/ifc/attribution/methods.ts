/**
 * Verfahren: Bereiche nennen sie als Text (`Untersuchungsverfahren0..n`),
 * Stellen tragen sie als Psets (Kernbohrung, Druckfestigkeit, …). Beides
 * wird über Umlaut- und Schreibweisen-Normalisierung abgeglichen, damit
 * „Druckfestigkeitsprüfung“ die Katalogklasse „Druckfestigkeitspruefung“
 * mit dem Pset „Druckfestigkeit“ trifft.
 */
import type { NativeIfcPropertySet } from "../nativeDocument";

import { findProperties, psetMatches } from "./normalize";
import { classifyMethodPset, fachmodellSchema } from "./schema";

export function normalizeMethodName(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

const labelCache = new Map<string, string>();

/** Lesbarer Verfahrensname zu einem Haupt-Pset: Katalogklasse (BWD), sonst der Pset-Name ohne Index. */
export function methodLabelForPset(psetName: string): string {
  const cached = labelCache.get(psetName);
  if (cached) return cached;
  const klasse = fachmodellSchema.katalog.bwd.objektklassen.find((entry) => entry.psets.some((pset) => psetMatches(psetName, pset.familie ?? pset.portalName)));
  const label = klasse?.name ?? psetName.replace(/\d+$/, "");
  labelCache.set(psetName, label);
  return label;
}

/** Schlüssel, unter denen ein Verfahrens-Pset erkannt wird: Katalogname, Pset-Name, Pset-Name ohne Index. */
export function methodKeysForPset(psetName: string): string[] {
  return [...new Set([normalizeMethodName(methodLabelForPset(psetName)), normalizeMethodName(psetName), normalizeMethodName(psetName.replace(/\d+$/, ""))])].filter(Boolean);
}

export interface AreaMethodEntry {
  property: string;
  value: string;
}

/** Die im Bereich genannten Verfahren (`Untersuchungsverfahren`, `Untersuchungsverfahren0..n`), leere Werte ausgelassen. */
export function areaMethodEntries(set: NativeIfcPropertySet | undefined): AreaMethodEntry[] {
  if (!set) return [];
  return findProperties(set, /^Untersuchungsverfahren\d*(?:_[A-Z0-9ß]{1,6})?$/i)
    .filter((hit) => hit.value)
    .map((hit) => ({ property: hit.rawName.replace(/^_/, "").replace(/_[A-Z0-9ß]{1,6}$/, ""), value: hit.value }));
}

/** Haupt-Verfahrens-Psets eines Objekts (ohne erweiterte oder Ausführungs-Psets). */
export function mainMethodPsets(psetNames: string[]): string[] {
  return psetNames.filter((name) => classifyMethodPset(name)?.kind === "main");
}

export interface AreaMethodComparison {
  /** Im Bereich genannt, aber an keiner Stelle des Bereichs als Pset vorhanden. */
  unused: AreaMethodEntry[];
  /** Als Pset an Stellen vorhanden, im Bereich nicht genannt (Pset-Name → Verfahrensname). */
  missing: Array<{ pset: string; label: string }>;
}

export function compareAreaMethods(entries: AreaMethodEntry[], stellenPsets: string[]): AreaMethodComparison {
  const listed = entries.map((entry) => ({ entry, key: normalizeMethodName(entry.value) }));
  const present = [...new Set(stellenPsets)].map((pset) => ({ pset, keys: methodKeysForPset(pset) }));
  const unused = listed.filter((item) => !present.some((candidate) => candidate.keys.includes(item.key))).map((item) => item.entry);
  const missing = present.filter((candidate) => !listed.some((item) => candidate.keys.includes(item.key))).map((candidate) => ({ pset: candidate.pset, label: methodLabelForPset(candidate.pset) }));
  return { unused, missing };
}
