/**
 * Beziehungen und Referenzen eines Objekts, aufbereitet für Inspector und Graph.
 * Quelle ist der RelationshipGraph des Parsers (CSR, beide Richtungen), ergänzt
 * um das Sitzungs-Overlay (`RelationOverlay`): dort hinzugefügte Beziehungen
 * kommen hinzu, dort entfernte geparste Beziehungen fallen heraus.
 */
import type { IfcDataStore } from "@ifc-lite/parser";
import { RelationshipType } from "@ifc-lite/data";
import type { RelationOverlay } from "./relationOverlay";

export interface RelationRow {
  /** expressId der Gegenseite */
  otherId: number;
  otherType: string;
  otherName: string;
  /** Beziehungsart, deutsch beschriftet */
  label: string;
  relType: RelationshipType;
  direction: "forward" | "inverse";
  /** expressId der IfcRel*-Instanz (0, wenn der Graph keine liefert) */
  relId: number;
  /** Herkunft der Zeile: aus dem Parse oder aus dem Sitzungs-Overlay */
  origin: "parsed" | "overlay";
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

export function relationLabelOf(type: RelationshipType): string {
  return RELATION_LABELS[type] ?? `Beziehung ${type}`;
}

/** CSR-Kante des Parsers (siehe @ifc-lite/data, relationship-graph.d.ts). */
interface Edge {
  target: number;
  type: RelationshipType;
  relationshipId: number;
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

/** Typ-/Namensabfrage, die auch für Overlay-Ids nicht wirft. */
function typeNameOf(store: IfcDataStore, expressId: number): string {
  try {
    return store.entities.getTypeName(expressId) || "";
  } catch {
    return "";
  }
}

function nameOf(store: IfcDataStore, expressId: number): string {
  try {
    return store.entities.getName(expressId) || "";
  } catch {
    return "";
  }
}

export function relationsOf(
  store: IfcDataStore,
  expressId: number,
  overlay?: RelationOverlay,
): RelationRow[] {
  const rows: RelationRow[] = [];
  for (const direction of ["forward", "inverse"] as const) {
    for (const edge of edgesOf(store, expressId, direction)) {
      const relId = edge.relationshipId ?? 0;
      if (overlay?.isSuppressed(relId)) continue;
      rows.push({
        otherId: edge.target,
        otherType: typeNameOf(store, edge.target),
        otherName: nameOf(store, edge.target),
        label: relationLabelOf(edge.type),
        relType: edge.type,
        direction,
        relId,
        origin: "parsed",
      });
    }
  }
  for (const row of overlay?.relationsFor(expressId) ?? []) {
    rows.push({
      otherId: row.otherId,
      otherType: typeNameOf(store, row.otherId),
      otherName: nameOf(store, row.otherId),
      label: relationLabelOf(row.relType),
      relType: row.relType,
      direction: row.direction,
      relId: row.relId,
      origin: "overlay",
    });
  }
  return rows;
}

/** Nachbar-Ids für den Graphen, optional auf Beziehungsarten gefiltert. */
export function neighborsOf(
  store: IfcDataStore,
  expressId: number,
  types?: ReadonlySet<RelationshipType>,
  overlay?: RelationOverlay,
): RelationRow[] {
  const rows = relationsOf(store, expressId, overlay);
  return types ? rows.filter((r) => types.has(r.relType)) : rows;
}
