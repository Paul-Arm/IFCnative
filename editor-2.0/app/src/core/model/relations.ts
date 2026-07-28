/**
 * Beziehungen und Referenzen eines Objekts, aufbereitet für Inspector und Graph.
 * Quelle ist der RelationshipGraph des Parsers (CSR, beide Richtungen).
 */
import type { IfcDataStore } from "@ifc-lite/parser";
import { RelationshipType } from "@ifc-lite/data";

export interface RelationRow {
  /** expressId der Gegenseite */
  otherId: number;
  otherType: string;
  otherName: string;
  /** Beziehungsart, deutsch beschriftet */
  label: string;
  relType: RelationshipType;
  direction: "forward" | "inverse";
}

export const RELATION_LABELS: Record<number, string> = {
  [RelationshipType.ContainsElements]: "Enthält räumlich",
  [RelationshipType.Aggregates]: "Aggregiert",
  [RelationshipType.DefinesByProperties]: "Eigenschaften",
  [RelationshipType.DefinesByType]: "Typzuweisung",
  [RelationshipType.AssociatesMaterial]: "Material",
  [RelationshipType.AssociatesClassification]: "Klassifikation",
  [RelationshipType.AssociatesDocument]: "Dokument",
  [RelationshipType.ConnectsPathElements]: "Verbindet (Pfad)",
  [RelationshipType.FillsElement]: "Füllt Öffnung",
  [RelationshipType.VoidsElement]: "Öffnung",
  [RelationshipType.ConnectsElements]: "Verbindet",
  [RelationshipType.SpaceBoundary]: "Raumbegrenzung",
  [RelationshipType.AssignsToGroup]: "Gruppe/System",
  [RelationshipType.AssignsToProduct]: "Produktzuordnung",
  [RelationshipType.ReferencedInSpatialStructure]: "Referenziert in Struktur",
};

interface Edge {
  target: number;
  type: RelationshipType;
}

function edgesOf(
  store: IfcDataStore,
  expressId: number,
  direction: "forward" | "inverse",
): Edge[] {
  const graph = store.relationships as {
    forward: { getEdges(id: number): Edge[] };
    inverse: { getEdges(id: number): Edge[] };
  };
  return graph[direction].getEdges(expressId) ?? [];
}

export function relationsOf(
  store: IfcDataStore,
  expressId: number,
): RelationRow[] {
  const rows: RelationRow[] = [];
  for (const direction of ["forward", "inverse"] as const) {
    for (const edge of edgesOf(store, expressId, direction)) {
      rows.push({
        otherId: edge.target,
        otherType: store.entities.getTypeName(edge.target),
        otherName: store.entities.getName(edge.target),
        label: RELATION_LABELS[edge.type] ?? `Beziehung ${edge.type}`,
        relType: edge.type,
        direction,
      });
    }
  }
  return rows;
}

/** Nachbar-Ids für den Graphen, optional auf Beziehungsarten gefiltert. */
export function neighborsOf(
  store: IfcDataStore,
  expressId: number,
  types?: ReadonlySet<RelationshipType>,
): RelationRow[] {
  const rows = relationsOf(store, expressId);
  return types ? rows.filter((r) => types.has(r.relType)) : rows;
}
