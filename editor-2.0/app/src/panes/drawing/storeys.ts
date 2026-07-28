/**
 * Geschosse aus dem Strukturbaum der Sitzung (`session.spatialTree()`).
 *
 * Der Parser liefert `elevation` bereits in METERN — der
 * SpatialHierarchyBuilder skaliert die IFC-Attributwerte mit dem
 * Längeneinheiten-Faktor des Projekts (mm-Dateien eingeschlossen) und fällt
 * auf das Z der ObjectPlacement-Kette zurück, wenn das Attribut leer ist.
 * Bleibt beides leer (z. B. Cache-Restore-Pfad des Parsers), ist `elevation`
 * `null`; die Schnitthöhe kommt dann allein aus der Geometrie (siehe
 * `geometry.ts`).
 */
import type { SpatialTreeNode } from "../../core/model/spatial";

export interface StoreyOption {
  expressId: number;
  name: string;
  /** Höhenlage in Metern, `null` wenn im Modell nicht auflösbar. */
  elevation: number | null;
  /** expressIds aller enthaltenen Elemente, inklusive Unterknoten (Räume). */
  elementIds: number[];
}

const STOREY_TYPE = "IfcBuildingStorey";

const METERS = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Meterangabe mit Vorzeichen, wie in Bauplänen üblich (+2,75 m). */
export function formatElevation(value: number): string {
  return `${value >= 0 ? "+" : "−"}${METERS.format(Math.abs(value))} m`;
}

function collectElements(node: SpatialTreeNode, into: number[]): void {
  for (const id of node.elements) into.push(id);
  for (const child of node.children) collectElements(child, into);
}

/** Alle Geschosse des Baums, sortiert von unten nach oben. */
export function collectStoreys(tree: SpatialTreeNode | null): StoreyOption[] {
  const storeys: StoreyOption[] = [];
  const walk = (node: SpatialTreeNode): void => {
    if (node.type === STOREY_TYPE) {
      const elementIds: number[] = [];
      collectElements(node, elementIds);
      storeys.push({
        expressId: node.expressId,
        name: node.name || node.longName || `Geschoss #${node.expressId}`,
        elevation: node.elevation ?? null,
        elementIds,
      });
    }
    for (const child of node.children) walk(child);
  };
  if (tree) walk(tree);
  return storeys.sort((a, b) => {
    // Geschosse ohne Höhenlage ans Ende, sonst aufsteigend nach Höhe.
    if (a.elevation === null || b.elevation === null) {
      return (a.elevation === null ? 1 : 0) - (b.elevation === null ? 1 : 0);
    }
    return a.elevation - b.elevation;
  });
}

/** Beschriftung für die Auswahlliste. */
export function storeyLabel(storey: StoreyOption): string {
  const height =
    storey.elevation === null ? "Höhe unbekannt" : formatElevation(storey.elevation);
  return `${storey.name} (${height})`;
}
