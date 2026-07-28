/**
 * Räumliche Struktur: bildet die SpatialHierarchy des Parsers auf schlanke,
 * UI-taugliche Knoten ab (Projekt → Standort → Gebäude → Geschoss → Elemente).
 */
import type { IfcDataStore } from "@ifc-lite/parser";

export interface SpatialTreeNode {
  expressId: number;
  /** IFC-Typname, z. B. "IfcBuildingStorey" */
  type: string;
  name: string;
  longName?: string;
  elevation?: number;
  /** Räumliche Kindknoten (Aggregation) */
  children: SpatialTreeNode[];
  /** Direkt enthaltene Elemente (Containment), als expressIds */
  elements: number[];
}

interface ParserSpatialNode {
  expressId: number;
  name: string;
  longName?: string;
  elevation?: number;
  children: ParserSpatialNode[];
  elements: number[];
}

function mapNode(store: IfcDataStore, node: ParserSpatialNode): SpatialTreeNode {
  return {
    expressId: node.expressId,
    type: store.entities.getTypeName(node.expressId),
    name: node.name || store.entities.getName(node.expressId),
    longName: node.longName,
    elevation: node.elevation,
    children: node.children.map((child) => mapNode(store, child)),
    elements: node.elements,
  };
}

export function buildSpatialTree(store: IfcDataStore): SpatialTreeNode | null {
  const hierarchy = store.spatialHierarchy as
    | { project?: ParserSpatialNode }
    | undefined;
  if (!hierarchy?.project) return null;
  return mapNode(store, hierarchy.project);
}

/** Geschoss (expressId) eines Elements, falls zugeordnet. */
export function storeyOf(store: IfcDataStore, expressId: number): number | null {
  const hierarchy = store.spatialHierarchy as
    | { elementToStorey?: Map<number, number> }
    | undefined;
  return hierarchy?.elementToStorey?.get(expressId) ?? null;
}
