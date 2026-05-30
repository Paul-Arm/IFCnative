import { useEffect, useMemo, useState } from "react";

import type { NativeIfcDocument, NativeIfcEntity } from "@/ifc";
import {
    buildGraph,
    layoutGraph,
    retainPinnedPositions,
} from "@/ifc/graphLayout";
import type { NativeGraphPreset } from "@/ifc/nativeGraph";

import RelationshipFlow from "../relationship-flow";
import type {
    RelationshipFlowClipboardNode,
    RelationshipFlowEdge,
    RelationshipFlowLayoutMode,
    RelationshipFlowMove,
    RelationshipFlowNode,
} from "../relationship-flow.types";
import { GRAPH_PRESETS } from "./constants";
import type { Point } from "./types";
import type { DropdownOption } from "./ui";

export function GraphPanel({
  anchorId,
  classOptions,
  collapsed,
  depth,
  document,
  expanded,
  pinned,
  positions,
  preset,
  relationshipOptions,
  relationshipTypeFilters,
  search,
  searchMatches,
  selectedId,
  onConnectNodes,
  onCreateNodeFromConnection,
  onDepth,
  onLog,
  onPasteNodes,
  onPositions,
  onPreset,
  onRemoveNode,
  onRemoveRelationship,
  onRelationshipTypeFilters,
  onSelect,
  onToggleChildren,
  onTogglePin,
}: {
  anchorId: number;
  classOptions: DropdownOption[];
  collapsed: Set<number>;
  depth: number;
  document: NativeIfcDocument;
  expanded: Set<number>;
  pinned: Set<number>;
  positions: Map<number, Point>;
  preset: NativeGraphPreset;
  relationshipOptions: DropdownOption[];
  relationshipTypeFilters: Set<string>;
  search: string;
  searchMatches: NativeIfcEntity[];
  selectedId: number;
  onConnectNodes(
    sourceId: number,
    targetId: number,
    relationshipType: string,
  ): void;
  onCreateNodeFromConnection(
    sourceId: number,
    type: string,
    name: string,
    relationshipType: string,
    position: Point,
  ): void;
  onDepth(depth: number): void;
  onLog(code: string): void;
  onPasteNodes(
    sourceId: number,
    relationshipType: string,
    nodes: RelationshipFlowClipboardNode[],
    connect: boolean,
  ): void;
  onPositions(positions: Map<number, Point>): void;
  onPreset(preset: NativeGraphPreset): void;
  onRemoveNode(id: number): void;
  onRemoveRelationship(relationshipId: number): void;
  onRelationshipTypeFilters(filters: string[]): void;
  onSelect(id: number, source?: string): void;
  onToggleChildren(id: number, loaded: boolean): void;
  onTogglePin(id: number, point?: Point): void;
}) {
  const [layoutMode, setLayoutMode] =
    useState<RelationshipFlowLayoutMode>("tension");
  const [searchCursor, setSearchCursor] = useState(0);
  const searchQuery = search.trim().toLowerCase();
  const searchMatchIds = useMemo(
    () => new Set(searchMatches.map((entity) => entity.id)),
    [searchMatches],
  );
  const activeSearchIndex =
    searchQuery && searchMatches.length
      ? Math.min(searchCursor, searchMatches.length - 1)
      : -1;
  const activeSearchMatch =
    activeSearchIndex >= 0 ? searchMatches[activeSearchIndex] : undefined;
  const graphAnchorId = useMemo(() => {
    return activeSearchMatch?.id ?? anchorId;
  }, [activeSearchMatch, anchorId]);

  useEffect(() => {
    if (!searchQuery || !searchMatches.length) {
      setSearchCursor(0);
      return;
    }
    const selectedSearchIndex = searchMatches.findIndex(
      (entity) => entity.id === selectedId,
    );
    setSearchCursor((current) => {
      if (selectedSearchIndex >= 0) {
        return selectedSearchIndex;
      }
      return current < searchMatches.length ? current : 0;
    });
  }, [searchMatches, searchQuery, selectedId]);
  const graph = useMemo(
    () =>
      buildGraph(
        document,
        graphAnchorId,
        pinned,
        expanded,
        collapsed,
        depth,
        preset,
        relationshipTypeFilters,
      ),
    [
      collapsed,
      depth,
      document,
      expanded,
      graphAnchorId,
      pinned,
      preset,
      relationshipTypeFilters,
    ],
  );
  const layout = useMemo(
    () =>
      layoutGraph(
        graph.nodeIds,
        graph.levels,
        graph.edges,
        positions,
        pinned,
        layoutMode,
      ),
    [graph.edges, graph.levels, graph.nodeIds, layoutMode, pinned, positions],
  );
  const flowNodes = useMemo<RelationshipFlowNode[]>(
    () =>
      layout.flatMap((node) => {
        const entity = document.entityById.get(node.id);
        if (!entity) {
          return [];
        }
        return [
          {
            childCount: graph.childCounts.get(node.id) ?? 0,
            childrenLoaded: graph.loadedSources.has(node.id),
            entity: {
              description: entity.description,
              globalId: entity.globalId,
              id: entity.id,
              name: entity.name,
              type: entity.type,
            },
            id: node.id,
            pinned: pinned.has(node.id),
            searchMatch: searchMatchIds.has(node.id),
            selected: node.id === selectedId,
            x: node.x,
            y: node.y,
          },
        ];
      }),
    [
      document.entityById,
      graph.childCounts,
      graph.loadedSources,
      layout,
      pinned,
      searchMatchIds,
      selectedId,
    ],
  );
  const flowEdges = useMemo<RelationshipFlowEdge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: `${edge.rel}-${edge.source}-${edge.target}`,
        label: edge.label,
        rel: edge.rel,
        relationshipType: edge.type,
        source: edge.source,
        target: edge.target,
      })),
    [graph.edges],
  );

  const moveNodes = (moves: RelationshipFlowMove[]) => {
    if (!moves.length) {
      return;
    }
    const next = new Map(positions);
    for (const move of moves) {
      next.set(move.id, move.point);
    }
    onPositions(next);
  };

  const moveNode = (id: number, point: Point) => {
    moveNodes([{ id, point }]);
  };

  const navigateSearchResult = (direction: "previous" | "next") => {
    if (!searchQuery || !searchMatches.length) {
      return;
    }
    const currentIndex = activeSearchIndex >= 0 ? activeSearchIndex : 0;
    const nextIndex =
      direction === "next"
        ? (currentIndex + 1) % searchMatches.length
        : (currentIndex - 1 + searchMatches.length) % searchMatches.length;
    const target = searchMatches[nextIndex];
    setSearchCursor(nextIndex);
    onSelect(target.id, "graph");
    onLog(
      `graph.searchResult({ direction: '${direction}', index: ${nextIndex + 1}, count: ${searchMatches.length}, id: ${target.id} });`,
    );
  };

  return (
    <RelationshipFlow
      capped={graph.capped}
      classOptions={classOptions}
      depth={depth}
      edges={flowEdges}
      layoutMode={layoutMode}
      nodes={flowNodes}
      preset={preset}
      presetOptions={GRAPH_PRESETS}
      relationshipOptions={relationshipOptions}
      relationshipCount={graph.edges.length}
      relationshipTypeFilters={[...relationshipTypeFilters]}
      relationshipTypes={graph.relationshipTypes}
      relationshipWarnings={graph.warnings.map((warning) => warning.message)}
      search={search}
      searchActiveId={activeSearchMatch?.id ?? null}
      searchActiveIndex={activeSearchIndex}
      searchMatchCount={searchMatches.length}
      onClearPositions={() => {
        onPositions(retainPinnedPositions(positions, pinned));
        onLog(`graph.autoLayout({ mode: '${layoutMode}' });`);
      }}
      onConnectNodes={onConnectNodes}
      onCreateNodeFromConnection={onCreateNodeFromConnection}
      onDepth={(value) => {
        onDepth(value);
        onLog(`graph.depth(${value});`);
      }}
      onLayoutMode={(value) => {
        setLayoutMode(value);
        onPositions(retainPinnedPositions(positions, pinned));
      }}
      onLog={onLog}
      onMoveEnd={(id, point) =>
        onLog(
          `graph.moveNode({ id: ${id}, x: ${point.x.toFixed(1)}, y: ${point.y.toFixed(1)} });`,
        )
      }
      onMoveNode={moveNode}
      onMoveNodes={moveNodes}
      onMoveNodesEnd={(moves) => {
        const ids = moves
          .map((move) => move.id)
          .slice(0, 12)
          .join(", ");
        onLog(`graph.moveNodes({ count: ${moves.length}, ids: [${ids}] });`);
      }}
      onPasteNodes={onPasteNodes}
      onPreset={(value) => onPreset(value as NativeGraphPreset)}
      onRemoveNode={onRemoveNode}
      onRemoveRelationship={onRemoveRelationship}
      onRelationshipTypeFilters={onRelationshipTypeFilters}
      onSearchNavigate={navigateSearchResult}
      onSelect={(id) => onSelect(id, "graph")}
      onToggleChildren={(id, loaded) => onToggleChildren(id, loaded)}
      onTogglePin={onTogglePin}
    />
  );
}
