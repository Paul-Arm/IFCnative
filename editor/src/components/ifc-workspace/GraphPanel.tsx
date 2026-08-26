import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { NativeIfcDocument, NativeIfcEntity } from "@/ifc";
import {
    buildGraph,
    layoutGraph,
    retainPinnedPositions,
} from "@/ifc/graphLayout";
import {
  resolveNativeGraphAnchorId,
  type NativeGraphPreset,
  type NativeGraphWarning,
} from "@/ifc/nativeGraph";

import RelationshipFlow from "../relationship-flow";
import type {
    RelationshipFlowClipboardNode,
    RelationshipFlowEdge,
    RelationshipFlowEmbeddedResource,
    RelationshipFlowLayoutMode,
    RelationshipFlowMove,
    RelationshipFlowNode,
} from "../relationship-flow.types";
import { GRAPH_PRESETS } from "./constants";
import type { Point } from "./types";
import type { DropdownOption } from "./ui";

const EMBEDDED_GRAPH_RELATIONSHIP_TYPES = new Set([
  "IFCRELDEFINESBYPROPERTIES",
  "IFCRELASSOCIATESMATERIAL",
  "IFCRELASSOCIATESCLASSIFICATION",
  "IFCRELASSOCIATESDOCUMENT",
]);

export function GraphPanel({
  anchorId,
  classOptions,
  collapsed,
  depth,
  document,
  expanded,
  focusRequest,
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
  onRevealWarningEntity,
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
  focusRequest?: { entityId: number; nonce: number } | null;
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
  onRevealWarningEntity(id: number): void;
  onSelect(id: number, source?: string): void;
  onToggleChildren(id: number, loaded: boolean): void;
  onTogglePin(id: number, point?: Point): void;
}) {
  const [layoutMode, setLayoutMode] =
    useState<RelationshipFlowLayoutMode>("tension");
  const [searchCursor, setSearchCursor] = useState(0);
  const searchQuery = search.trim().toLowerCase();
  const searchMatchIds = useMemo(
    () =>
      new Set(
        searchMatches.flatMap((entity) => {
          const graphId = resolveNativeGraphAnchorId(document, entity.id);
          return graphId === undefined ? [] : [graphId];
        }),
      ),
    [document, searchMatches],
  );
  const activeSearchIndex =
    searchQuery && searchMatches.length
      ? Math.min(searchCursor, searchMatches.length - 1)
      : -1;
  const activeSearchMatch =
    activeSearchIndex >= 0 ? searchMatches[activeSearchIndex] : undefined;
  const graphAnchorId = useMemo(() => {
    return (
      resolveNativeGraphAnchorId(
        document,
        activeSearchMatch?.id ?? anchorId,
      ) ?? anchorId
    );
  }, [activeSearchMatch, anchorId, document]);

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
            embeddedResources: embeddedResourcesForEntity(document, node.id),
            id: node.id,
            pinned: pinned.has(node.id),
            propertySets: document.propertySetsByEntity.get(node.id) ?? [],
            searchMatch: searchMatchIds.has(node.id),
            selected:
              node.id ===
              (resolveNativeGraphAnchorId(document, selectedId) ?? selectedId),
            x: node.x,
            y: node.y,
          },
        ];
      }),
    [
      document.entityById,
      document.propertySetsByEntity,
      graph.childCounts,
      graph.loadedSources,
      layout,
      pinned,
      searchMatchIds,
      selectedId,
    ],
  );
  const topologyRelationshipOptions = useMemo(
    () =>
      relationshipOptions.filter(
        (option) => !EMBEDDED_GRAPH_RELATIONSHIP_TYPES.has(option.value),
      ),
    [relationshipOptions],
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
    <div className="ifc-graph-panel">
      <div className="ifc-graph-panel-viewer">
        <RelationshipFlow
          capped={graph.capped}
          classOptions={classOptions}
          depth={depth}
          edges={flowEdges}
          focusNodeId={
            focusRequest
              ? (resolveNativeGraphAnchorId(document, focusRequest.entityId) ??
                null)
              : null
          }
          focusNonce={focusRequest?.nonce ?? 0}
          layoutMode={layoutMode}
          nodes={flowNodes}
          preset={preset}
          presetOptions={GRAPH_PRESETS}
          relationshipOptions={topologyRelationshipOptions}
          relationshipTypeFilters={[...relationshipTypeFilters]}
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
      </div>
      <GraphWarningsPanel
        document={document}
        warnings={graph.warnings}
        onRevealEntity={onRevealWarningEntity}
      />
    </div>
  );
}

const EMBEDDED_RESOURCE_KINDS = new Map<
  string,
  RelationshipFlowEmbeddedResource["kind"]
>([
  ["IFCRELASSOCIATESMATERIAL", "Material"],
  ["IFCRELASSOCIATESCLASSIFICATION", "Klassifikation"],
  ["IFCRELASSOCIATESDOCUMENT", "Dokument"],
]);

function embeddedResourcesForEntity(
  document: NativeIfcDocument,
  entityId: number,
) {
  const resources = new Map<number, RelationshipFlowEmbeddedResource>();
  for (const relationship of document.relationshipsByEntity.get(entityId) ?? []) {
    const kind = EMBEDDED_RESOURCE_KINDS.get(
      relationship.type.trim().toUpperCase(),
    );
    if (!kind || !relationship.sourceIds.includes(entityId)) {
      continue;
    }
    for (const resourceId of relationship.targetIds) {
      const resource = document.entityById.get(resourceId);
      if (!resource) {
        continue;
      }
      resources.set(resourceId, {
        id: resourceId,
        kind,
        name:
          resource.name || resource.description || resource.globalId || `#${resourceId}`,
        type: resource.type,
      });
    }
  }
  return [...resources.values()];
}

function GraphWarningsPanel({
  document,
  warnings,
  onRevealEntity,
}: {
  document: NativeIfcDocument;
  warnings: NativeGraphWarning[];
  onRevealEntity(id: number): void;
}) {
  const count = warnings.length;
  if (!count) {
    return null;
  }
  return (
    <details
      className="group min-h-0 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-warning" />
        <strong className="min-w-0 truncate text-xs font-semibold text-warning-foreground dark:text-warning">
          {count.toLocaleString("de-DE")}{" "}
          {count === 1 ? "Graph-Warnung" : "Graph-Warnungen"}
        </strong>
        <span className="ml-auto text-[10px] text-muted-foreground group-open:hidden">
          Anzeigen
        </span>
        <span className="ml-auto hidden text-[10px] text-muted-foreground group-open:inline">
          Ausblenden
        </span>
      </summary>
      <ul className="mt-1.5 grid max-h-28 list-none gap-1 overflow-y-auto p-0">
        {warnings.map((warning, index) => (
          <li
            key={`${warning.message}-${index}`}
            className="min-w-0 border-t border-warning/25 pt-1 text-xs leading-relaxed text-foreground first:border-t-0 first:pt-0 [overflow-wrap:anywhere]"
          >
            {renderWarningMessage(document, warning.message, onRevealEntity)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function renderWarningMessage(
  document: NativeIfcDocument,
  message: string,
  onRevealEntity: (id: number) => void,
) {
  const parts: ReactNode[] = [];
  const pattern = /#(\d+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message))) {
    const id = Number(match[1]);
    const entity = document.entityById.get(id);
    if (match.index > lastIndex) {
      parts.push(message.slice(lastIndex, match.index));
    }
    parts.push(
      entity ? (
        <button
          key={`${id}-${match.index}`}
          className="mx-0.5 inline-flex max-w-full items-center rounded bg-primary/10 px-1 py-px align-baseline font-mono text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
          title={`#${id} ${entity.type} im Graphen anzeigen`}
          type="button"
          onClick={() => onRevealEntity(id)}
        >
          <span className="truncate">
            #{id} {entity.type}
          </span>
        </button>
      ) : (
        match[0]
      ),
    );
    lastIndex = match.index + match[0].length;
    if (entity && message.slice(lastIndex).startsWith(` ${entity.type}`)) {
      lastIndex += entity.type.length + 1;
    }
  }
  if (lastIndex < message.length) {
    parts.push(message.slice(lastIndex));
  }
  return parts;
}
