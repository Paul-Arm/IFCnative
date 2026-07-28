/**
 * Räumliche Struktur: bildet die SpatialHierarchy des Parsers auf schlanke,
 * UI-taugliche Knoten ab (Projekt → Standort → Gebäude → Geschoss → Elemente).
 *
 * Die SpatialHierarchy entsteht einmalig beim Parsen und ist statisch. Damit
 * der Strukturbaum strukturelle Edits überhaupt zeigt (Review-Befund 2),
 * mischt `buildSpatialTree` beim Bauen zwei Sitzungsquellen ein:
 *   - `isDeleted` — tombstonete Objekte (samt Teilbaum) fallen heraus,
 *   - `overlay`   — per Sitzung neu angelegte Containments (ContainsElements)
 *     und Aggregationen (Aggregates) werden zusätzlich eingehängt.
 */
import type { IfcDataStore } from "@ifc-lite/parser";
import { RelationshipType } from "@ifc-lite/data";
import type { RelationOverlay } from "./relationOverlay";

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

export interface SpatialTreeOptions {
  /** Sitzungs-Overlay für nachträglich angelegte Beziehungen */
  overlay?: RelationOverlay;
  /** Tombstone-Abfrage aus dem Mutations-Overlay */
  isDeleted?: (expressId: number) => boolean;
}

interface ParserSpatialNode {
  expressId: number;
  name: string;
  longName?: string;
  elevation?: number;
  children: ParserSpatialNode[];
  elements: number[];
}

/** Overlay-Kanten nach Quellknoten gruppiert. */
interface OverlayEdges {
  aggregates: Map<number, number[]>;
  contains: Map<number, number[]>;
}

interface BuildContext {
  isDeleted?: (expressId: number) => boolean;
  /** Zyklenschutz für per Overlay eingehängte Teilbäume */
  seen: Set<number>;
}

function collectOverlayEdges(overlay: RelationOverlay | undefined): OverlayEdges {
  const aggregates = new Map<number, number[]>();
  const contains = new Map<number, number[]>();
  for (const relation of overlay?.all() ?? []) {
    const bucket =
      relation.relType === RelationshipType.Aggregates
        ? aggregates
        : relation.relType === RelationshipType.ContainsElements
          ? contains
          : null;
    if (!bucket) continue;
    const list = bucket.get(relation.sourceId) ?? [];
    for (const id of relation.targetIds) if (!list.includes(id)) list.push(id);
    bucket.set(relation.sourceId, list);
  }
  return { aggregates, contains };
}

function safeType(store: IfcDataStore, expressId: number): string {
  try {
    return store.entities.getTypeName(expressId) || "";
  } catch {
    return "";
  }
}

function safeName(store: IfcDataStore, expressId: number): string {
  try {
    return store.entities.getName(expressId) || "";
  } catch {
    return "";
  }
}

function elementsFromOverlay(
  parentId: number,
  edges: OverlayEdges,
  context: BuildContext,
): number[] {
  return (edges.contains.get(parentId) ?? []).filter(
    (id) => !context.isDeleted?.(id),
  );
}

function childrenFromOverlay(
  store: IfcDataStore,
  parentId: number,
  edges: OverlayEdges,
  context: BuildContext,
): SpatialTreeNode[] {
  const nodes: SpatialTreeNode[] = [];
  for (const childId of edges.aggregates.get(parentId) ?? []) {
    if (context.isDeleted?.(childId) || context.seen.has(childId)) continue;
    context.seen.add(childId);
    nodes.push({
      expressId: childId,
      type: safeType(store, childId),
      name: safeName(store, childId),
      children: childrenFromOverlay(store, childId, edges, context),
      elements: elementsFromOverlay(childId, edges, context),
    });
  }
  return nodes;
}

function mapNode(
  store: IfcDataStore,
  node: ParserSpatialNode,
  edges: OverlayEdges,
  context: BuildContext,
): SpatialTreeNode | null {
  if (context.isDeleted?.(node.expressId)) return null;
  context.seen.add(node.expressId);

  const children: SpatialTreeNode[] = [];
  for (const child of node.children) {
    const mapped = mapNode(store, child, edges, context);
    if (mapped) children.push(mapped);
  }
  children.push(...childrenFromOverlay(store, node.expressId, edges, context));

  const elements = node.elements.filter((id) => !context.isDeleted?.(id));
  for (const id of elementsFromOverlay(node.expressId, edges, context)) {
    if (!elements.includes(id)) elements.push(id);
  }

  return {
    expressId: node.expressId,
    type: store.entities.getTypeName(node.expressId),
    name: node.name || store.entities.getName(node.expressId),
    longName: node.longName,
    elevation: node.elevation,
    children,
    elements,
  };
}

export function buildSpatialTree(
  store: IfcDataStore,
  options: SpatialTreeOptions = {},
): SpatialTreeNode | null {
  const hierarchy = store.spatialHierarchy as
    | { project?: ParserSpatialNode }
    | undefined;
  if (!hierarchy?.project) return null;
  return mapNode(store, hierarchy.project, collectOverlayEdges(options.overlay), {
    isDeleted: options.isDeleted,
    seen: new Set<number>(),
  });
}

/** Geschoss (expressId) eines Elements, falls zugeordnet. */
export function storeyOf(store: IfcDataStore, expressId: number): number | null {
  const hierarchy = store.spatialHierarchy as
    | { elementToStorey?: Map<number, number> }
    | undefined;
  return hierarchy?.elementToStorey?.get(expressId) ?? null;
}
