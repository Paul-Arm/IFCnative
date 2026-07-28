/**
 * Versionsvergleich über `@ifc-lite/diff`.
 *
 * Abbildung auf den API-Vertrag der App (`app/src/domain/hub/types.ts`):
 *  - ifc-lite kennt `added | modified | deleted | unchanged`;
 *    die API nennt `deleted` → **`removed`** und lässt `unchanged` weg.
 *  - `changedComponents` wird durchgereicht, wenn vorhanden. Es benennt die
 *    betroffene Komponente (`pset:Pset_WallCommon`, `attr:core`, …) — **nicht**
 *    das einzelne Feld mit alt/neu. Für Feld-Detail müsste `entityFieldDiff`
 *    aus dem React-Projekt portiert werden (siehe README, Risiko R2/B5).
 *
 * Vergleichsumfang ist `data`: der Hub erzeugt keine Geometrie-Hashes (dafür
 * bräuchte es den WASM-Mesh-Pass), ein Geometrie-Scope wäre also stets leer.
 */
import { diffModels, type DiffEntry, type ModelDiff } from "@ifc-lite/diff";
import { parseIfc } from "./parse.js";
import { buildFingerprints, type EntityRef } from "./fingerprints.js";

export interface DiffElement {
  globalId: string;
  expressId?: number;
  label?: string;
  /** Betroffene Komponenten, nur bei `modified` und nur wenn ermittelbar. */
  changedComponents?: string[];
}

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
}

export interface DiffResult {
  added: DiffElement[];
  removed: DiffElement[];
  modified: DiffElement[];
  summary: DiffSummary;
  /** Vergleichsumfang, mit dem gerechnet wurde. */
  scope: "data";
  /**
   * `false` — `@ifc-lite/diff` liefert Komponenten-Granularität, aber keine
   * Feld-Änderungen mit Alt-/Neuwert. Das Flag macht die Grenze für die App
   * sichtbar, ohne dass sie die Paketdoku kennen muss.
   */
  fieldDetail: false;
}

function toElement(
  entry: DiffEntry<EntityRef>,
  side: "base" | "head",
): DiffElement {
  const fingerprint = side === "base" ? entry.base : entry.head;
  const element: DiffElement = { globalId: entry.key };
  if (fingerprint) {
    element.expressId = fingerprint.ref.expressId;
    element.label = fingerprint.ref.label;
  }
  if (entry.changedComponents && entry.changedComponents.length > 0) {
    element.changedComponents = [...entry.changedComponents].sort();
  }
  return element;
}

/**
 * Übersetzt das ifc-lite-Ergebnis in den API-Vertrag. Getrennt exportiert,
 * weil hier die Umbenennung `deleted` → `removed` und die Seitenwahl
 * (added zeigt auf head, removed auf base) steckt.
 */
export function toDiffResult(diff: ModelDiff<EntityRef>): DiffResult {
  const added: DiffElement[] = [];
  const removed: DiffElement[] = [];
  const modified: DiffElement[] = [];
  for (const entry of diff.entries) {
    switch (entry.state) {
      case "added":
        added.push(toElement(entry, "head"));
        break;
      case "deleted":
        removed.push(toElement(entry, "base"));
        break;
      case "modified":
        modified.push(toElement(entry, "head"));
        break;
      case "unchanged":
        break;
    }
  }

  return {
    added,
    removed,
    modified,
    summary: {
      added: diff.counts.added,
      removed: diff.counts.deleted,
      modified: diff.counts.modified,
      unchanged: diff.counts.unchanged,
    },
    scope: "data",
    fieldDetail: false,
  };
}

/** Vergleicht zwei IFC-Blobs; `base` ist der ältere Bezugsstand. */
export async function diffIfcBytes(
  base: Uint8Array,
  head: Uint8Array,
): Promise<DiffResult> {
  const [baseStore, headStore] = await Promise.all([
    parseIfc(base),
    parseIfc(head),
  ]);
  return toDiffResult(
    diffModels(buildFingerprints(baseStore), buildFingerprints(headStore), {
      scope: "data",
    }),
  );
}
