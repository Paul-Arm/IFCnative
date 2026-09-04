/**
 * Ableitungen aus Issue-Texten — für kompakte Listen mit vielen Unter-Issues
 * (z. B. 150 Portal-Befunde eines BCF-Imports).
 *
 * Portal-Befunde heißen "Importfehler 12: Das Pflichtfeld 'ID' im PSet
 * 'Objektinformationen' fehlt oder ist leer. …" — Nummer und konkrete Werte
 * variieren, der Rest ist die "Fehlerart". Daraus entsteht eine Gruppierung,
 * ohne dass der Server etwas davon wissen muss.
 */

const NUMBER_PREFIX = /^\s*[A-Za-zÄÖÜäöüß-]+\s*\d+\s*:\s*/;
const QUOTED = /(['"„“‚‘])[^'"„“”‚‘’]{1,120}(['"“”‘’])/g;
const OBJECT_NAME = /Betroffenes IFC-Objekt:\s*['„"‚‘]([^'“"”\n‘’]+)['“"”‘’]/;
const GUID_IN_TEXT = /\bGUID:\s*([0-3][0-9A-Za-z_$]{21})/;

/** Titel ohne Zähl-Präfix ("Importfehler 12: "). */
export function issueTitleCore(title: string): string {
  return title.replace(NUMBER_PREFIX, "").trim();
}

/**
 * Fehlerart: Titel ohne Präfix, konkrete Werte in Anführungszeichen durch
 * "…" ersetzt, nur der erste Satz. Gleiche Fehlerart = gleiche Gruppe.
 */
export function issueCategory(title: string): string {
  const core = issueTitleCore(title).replace(QUOTED, "$1…$2");
  const firstSentence = core.split(/(?<=[.!?])\s+/)[0] ?? core;
  const trimmed = firstSentence.trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 88).trimEnd()}…` : trimmed;
}

/** "Betroffenes IFC-Objekt: 'US.04'" → "US.04" (Portal-Befunde). */
export function issueObjectName(body: string): string | null {
  const match = OBJECT_NAME.exec(body);
  return match?.[1]?.trim() || null;
}

/** IFC-Klasse hinter dem Objektnamen ("…'US.04', IfcBuildingElementProxy, GUID: …"). */
export function issueObjectClass(body: string): string | null {
  const match = /Betroffenes IFC-Objekt:[^\n]*?,\s*(Ifc[A-Za-z]+)/.exec(body);
  return match?.[1] ?? null;
}

/** GUID aus dem Text (Fallback-Anzeige, wenn das Issue keine Verortung hat). */
export function issueTextGuid(body: string): string | null {
  return GUID_IN_TEXT.exec(body)?.[1] ?? null;
}

/** Stabiler Farbton (0..359) für einen Text — für Gruppen-Markierungen. */
export function hueFor(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}
