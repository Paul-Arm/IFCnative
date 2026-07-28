/**
 * Übersetzung der Nachbarschaft in React-Flow-Elemente.
 */
import { MarkerType, type Edge } from "@xyflow/react";
import type { IfcFlowNode } from "./GraphNode";
import type { NodePosition } from "./layout";
import type { GraphEdgeInfo, GraphNodeInfo } from "./useNeighborhood";
import { relationColor } from "./presets";

const ORIGIN: NodePosition = { x: 0, y: 0 };

export function toFlowNodes(
  nodes: readonly GraphNodeInfo[],
  positions: ReadonlyMap<number, NodePosition>,
  anchorId: number,
  picked: ReadonlySet<number>,
  matches: ReadonlySet<number>,
): IfcFlowNode[] {
  return nodes.map((node) => ({
    id: String(node.expressId),
    type: "ifc" as const,
    position: positions.get(node.expressId) ?? ORIGIN,
    data: {
      label: node.label,
      title: node.title,
      typeName: node.type,
      anchor: node.expressId === anchorId,
      picked: picked.has(node.expressId),
      match: matches.has(node.expressId),
    },
  }));
}

export function toFlowEdges(
  edges: readonly GraphEdgeInfo[],
  selectedId?: string | null,
): Edge[] {
  return edges.map((edge) => {
    const color = relationColor(edge.relType);
    const selected = edge.id === selectedId;
    return {
      id: edge.id,
      source: String(edge.source),
      target: String(edge.target),
      type: "smoothstep",
      label: edge.origin === "overlay" ? `${edge.label} ＋` : edge.label,
      labelShowBg: true,
      labelBgPadding: [2, 1],
      labelBgBorderRadius: 3,
      selected,
      style: {
        stroke: color,
        strokeWidth: selected ? 3 : 1.2,
        strokeDasharray: edge.origin === "overlay" ? "6 3" : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color,
      },
    } satisfies Edge;
  });
}

/**
 * Treffer der Suche: Volltext über Typ, Name und expressId, in
 * BFS-Reihenfolge (Anker zuerst).
 */
export function matchingNodes(
  nodes: readonly GraphNodeInfo[],
  query: string,
): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return nodes
    .filter(
      (node) =>
        node.title.toLowerCase().includes(needle) ||
        node.type.toLowerCase().includes(needle) ||
        node.name.toLowerCase().includes(needle) ||
        String(node.expressId).includes(needle),
    )
    .map((node) => node.expressId);
}
