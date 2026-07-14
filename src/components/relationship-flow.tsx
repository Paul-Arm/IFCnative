import {
    applyNodeChanges,
    Background,
    ConnectionMode,
    Controls,
    Handle,
    MarkerType,
    Position,
    ReactFlow,
    SelectionMode,
    type Connection,
    type Edge,
    type EdgeMouseHandler,
    type FinalConnectionState,
    type NodeChange,
    type NodeProps,
    type OnConnectStartParams,
    type ReactFlowInstance,
    type Node as ReactFlowNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";

import { relationshipTypesForEndpointTypes } from "@/ifc";

import { shortType } from "./ifc-workspace/ui";
import type {
    FlowPoint,
    RelationshipFlowClipboardNode,
    RelationshipFlowEmbeddedResource,
    RelationshipFlowOption,
    RelationshipFlowPropertySet,
    RelationshipFlowProps,
} from "./relationship-flow.types";

interface IfcFlowNodeData extends Record<string, unknown> {
  childCount: number;
  childrenLoaded: boolean;
  description: string;
  globalId: string;
  ifcId: number;
  layoutPosition: FlowPoint;
  name: string;
  onRemoveNode(id: number): void;
  onToggleChildren(id: number, loaded: boolean): void;
  onTogglePin(id: number, point?: FlowPoint): void;
  pinned: boolean;
  embeddedResources: RelationshipFlowEmbeddedResource[];
  propertySets: RelationshipFlowPropertySet[];
  searchMatch: boolean;
  selectedIfc: boolean;
  type: string;
}

type IfcFlowNode = ReactFlowNode<IfcFlowNodeData, "ifcNode">;

interface IfcFlowEdgeData extends Record<string, unknown> {
  label: string;
  relationshipId: number;
  relationshipType: string;
  sourceId: number;
  targetId: number;
}

type IfcFlowEdge = Edge<IfcFlowEdgeData>;

interface PendingCreate {
  name: string;
  position: FlowPoint;
  relationshipType: string;
  sourceId: number;
  type: string;
}

interface PendingConnect {
  relationshipType: string;
  sourceId: number;
  targetId: number;
}

interface SelectedRelationship {
  label: string;
  relationshipId: number;
  relationshipType: string;
  sourceId: number;
  targetId: number;
}

interface ConnectionDraftSource {
  handleId: string | null;
  nodeId: number;
}

const AGGREGATE_RELATIONSHIP_TYPE = "IFCRELAGGREGATES";
const CONTAINED_SPATIAL_RELATIONSHIP_TYPE = "IFCRELCONTAINEDINSPATIALSTRUCTURE";
const AGGREGATE_SOURCE_HANDLE = "aggregate-source";
const AGGREGATE_TARGET_HANDLE = "aggregate-target";
const RELATIONSHIP_SOURCE_HANDLE = "relationship-source";
const RELATIONSHIP_TARGET_HANDLE = "relationship-target";
const MAX_GRAPH_DEPTH = 25;
const NEW_NODE_NAME_PREFIX = "Neu: ";

const nodeTypes = {
  ifcNode: IfcNode,
};

export default function RelationshipFlow({
  capped,
  classOptions,
  depth,
  edges,
  focusNodeId,
  focusNonce,
  nodes,
  preset,
  presetOptions,
  relationshipOptions,
  relationshipTypeFilters,
  search,
  searchActiveId,
  searchActiveIndex,
  searchMatchCount,
  layoutMode,
  onClearPositions,
  onConnectNodes,
  onCreateNodeFromConnection,
  onDepth,
  onLayoutMode,
  onLog,
  onMoveEnd,
  onMoveNode,
  onMoveNodes,
  onMoveNodesEnd,
  onPasteNodes,
  onPreset,
  onRemoveNode,
  onRemoveRelationship,
  onRelationshipTypeFilters,
  onSearchNavigate,
  onSelect,
  onToggleChildren,
  onTogglePin,
}: RelationshipFlowProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const colors = useGraphFlowColors();
  const flowRef = useRef<ReactFlowInstance<IfcFlowNode, IfcFlowEdge> | null>(
    null,
  );
  const flowNodesRef = useRef<IfcFlowNode[]>([]);
  const flowEdgesRef = useRef<IfcFlowEdge[]>([]);
  const pasteSerialRef = useRef(0);
  const connectionSourceRef = useRef<ConnectionDraftSource | null>(null);
  const handledFocusNonceRef = useRef<number | undefined>(undefined);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );
  const [pendingConnect, setPendingConnect] = useState<PendingConnect | null>(
    null,
  );
  const [selectedRelationship, setSelectedRelationship] =
    useState<SelectedRelationship | null>(null);
  const [copiedNodes, setCopiedNodes] = useState<
    RelationshipFlowClipboardNode[]
  >([]);
  const trimmedSearch = search.trim();
  const searchFocusNodeId =
    searchActiveId === null ? "" : String(searchActiveId);
  const requestedFocusNodeId =
    focusNodeId === null || focusNodeId === undefined
      ? ""
      : String(focusNodeId);
  const nodeSignature = useMemo(
    () => nodes.map((node) => node.id).join(","),
    [nodes],
  );
  const baseFlowNodes = useMemo<IfcFlowNode[]>(
    () =>
      nodes.map((node) => ({
        data: {
          childCount: node.childCount,
          childrenLoaded: node.childrenLoaded,
          description: node.entity.description,
          globalId: node.entity.globalId,
          ifcId: node.id,
          embeddedResources: node.embeddedResources,
          layoutPosition: { x: node.x, y: node.y },
          name: node.entity.name,
          onRemoveNode,
          onToggleChildren,
          onTogglePin,
          pinned: node.pinned,
          propertySets: node.propertySets,
          searchMatch: node.searchMatch,
          selectedIfc: node.selected,
          type: node.entity.type,
        },
        id: String(node.id),
        position: { x: node.x, y: node.y },
        selected: node.selected,
        type: "ifcNode",
      })),
    [nodes, onToggleChildren, onTogglePin],
  );
  const nodeTypeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.entity.type])),
    [nodes],
  );
  const relationshipOptionsForTypes = useCallback(
    (
      sourceType: string | undefined,
      targetType: string | undefined,
      sourceId?: number,
      targetId?: number,
    ) => {
      const allowed = new Set(
        relationshipTypesForEndpointTypes(
          relationshipOptions.map((option) => option.value),
          sourceType,
          targetType,
          sourceId,
          targetId,
        ),
      );
      return relationshipOptions.filter((option) => allowed.has(option.value));
    },
    [relationshipOptions],
  );
  const relationshipOptionsForIds = useCallback(
    (sourceId: number, targetId: number) =>
      relationshipOptionsForTypes(
        nodeTypeById.get(sourceId),
        nodeTypeById.get(targetId),
        sourceId,
        targetId,
      ),
    [nodeTypeById, relationshipOptionsForTypes],
  );
  const [flowNodes, setFlowNodes] = useState<IfcFlowNode[]>(baseFlowNodes);
  const flowEdges = useMemo<IfcFlowEdge[]>(
    () =>
      edges.map((edge, index) => {
        const aggregate = isAggregateRelationship(edge.relationshipType);
        const containedSpatial = isContainedSpatialRelationship(
          edge.relationshipType,
        );
        const vertical = aggregate || containedSpatial;
        return {
          animated: false,
          className: aggregate
            ? "ifc-flow-edge-aggregate"
            : containedSpatial
              ? "ifc-flow-edge-contained"
              : "ifc-flow-edge-reference",
          data: {
            label: edge.label,
            relationshipId: edge.rel,
            relationshipType: edge.relationshipType,
            sourceId: edge.source,
            targetId: edge.target,
          },
          id: `${edge.id}-${index}`,
          label: edge.label,
          markerEnd: { type: MarkerType.ArrowClosed },
          source: String(edge.source),
          sourceHandle: vertical
            ? AGGREGATE_SOURCE_HANDLE
            : RELATIONSHIP_SOURCE_HANDLE,
          style: {
            stroke: aggregate
              ? colors.aggregate
              : containedSpatial
                ? colors.contained
                : colors.reference,
            strokeWidth: vertical ? 2.6 : 2,
          },
          target: String(edge.target),
          targetHandle: vertical
            ? AGGREGATE_TARGET_HANDLE
            : RELATIONSHIP_TARGET_HANDLE,
          type: vertical ? "smoothstep" : "default",
        };
      }),
    [colors, edges],
  );

  useEffect(() => {
    flowNodesRef.current = flowNodes;
  }, [flowNodes]);

  useEffect(() => {
    flowEdgesRef.current = flowEdges;
  }, [flowEdges]);

  useEffect(() => {
    setFlowNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      return baseFlowNodes.map((node) => {
        const current = currentById.get(node.id);
        return current
          ? {
              ...node,
              data: {
                ...node.data,
                layoutPosition: current.position,
              },
              position: current.position,
              selected: current.selected ?? node.selected,
            }
          : node;
      });
    });
  }, [baseFlowNodes]);

  const focusNode = useCallback((id: string) => {
    const instance = flowRef.current;
    const node = instance?.getNode(id);
    if (!instance || !node) {
      return;
    }
    const width = typeof node.width === "number" ? node.width : 260;
    const height = typeof node.height === "number" ? node.height : 84;
    void instance.setCenter(
      node.position.x + width / 2,
      node.position.y + height / 2,
      { duration: 240, zoom: 1.35 },
    );
  }, []);

  useEffect(() => {
    if (!trimmedSearch || !searchFocusNodeId || !flowRef.current) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      focusNode(searchFocusNodeId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusNode, nodeSignature, searchFocusNodeId, trimmedSearch]);

  useEffect(() => {
    if (
      !requestedFocusNodeId ||
      !flowRef.current ||
      focusNonce === undefined ||
      handledFocusNonceRef.current === focusNonce
    ) {
      return;
    }
    handledFocusNonceRef.current = focusNonce;
    const firstFrame = window.requestAnimationFrame(() => {
      focusNode(requestedFocusNodeId);
    });
    const secondFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusNode(requestedFocusNodeId);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [focusNode, focusNonce, requestedFocusNodeId]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<IfcFlowNode>[]) => {
      setFlowNodes((currentNodes) =>
        syncNodeDataPositions(applyNodeChanges(changes, currentNodes)),
      );
    },
    [],
  );

  const commitMovedNodes = useCallback(
    (movedNodes: IfcFlowNode[]) => {
      const moves = movedNodes
        .map((node) => ({
          id: Number(node.id),
          point: node.position as FlowPoint,
        }))
        .filter((move) => Number.isFinite(move.id));
      if (!moves.length) {
        return;
      }
      if (onMoveNodes) {
        onMoveNodes(moves);
      } else {
        moves.forEach((move) => onMoveNode(move.id, move.point));
      }
      if (moves.length === 1) {
        onMoveEnd(moves[0].id, moves[0].point);
      } else if (onMoveNodesEnd) {
        onMoveNodesEnd(moves);
      } else {
        moves.forEach((move) => onMoveEnd(move.id, move.point));
      }
    },
    [onMoveEnd, onMoveNode, onMoveNodes, onMoveNodesEnd],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const sourceId = Number(connection.source);
      const targetId = Number(connection.target);
      if (
        !Number.isFinite(sourceId) ||
        !Number.isFinite(targetId) ||
        sourceId === targetId
      ) {
        return;
      }
      setSelectedRelationship(null);
      setPendingCreate(null);
      const validRelationshipOptions = relationshipOptionsForIds(
        sourceId,
        targetId,
      );
      setPendingConnect({
        relationshipType: preferredRelationship(
          validRelationshipOptions,
          prefersAggregateRelationship(
            connection.sourceHandle,
            connection.targetHandle,
          )
            ? AGGREGATE_RELATIONSHIP_TYPE
            : "IFCRELASSIGNSTOGROUP",
        ),
        sourceId,
        targetId,
      });
      onLog(
        `graph.connectDraft({ sourceId: ${sourceId}, targetId: ${targetId} });`,
      );
    },
    [onLog, relationshipOptionsForIds],
  );

  const handleConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
      connectionSourceRef.current = params.nodeId
        ? {
            handleId: params.handleId,
            nodeId: Number(params.nodeId),
          }
        : null;
    },
    [],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid) {
        connectionSourceRef.current = null;
        return;
      }
      const source = connectionSourceRef.current;
      connectionSourceRef.current = null;
      if (!source?.nodeId) {
        return;
      }
      const sourceId = source.nodeId;
      const point = clientPointFromEvent(event);
      const position = flowRef.current?.screenToFlowPosition(point) ?? point;
      const type = preferredClass(classOptions);
      const validRelationshipOptions = relationshipOptionsForTypes(
        nodeTypeById.get(sourceId),
        type,
        sourceId,
      );
      setSelectedRelationship(null);
      setPendingConnect(null);
      setPendingCreate({
        name: defaultNodeName(type),
        position,
        relationshipType: preferredRelationship(
          validRelationshipOptions,
          source.handleId === AGGREGATE_SOURCE_HANDLE
            ? AGGREGATE_RELATIONSHIP_TYPE
            : "IFCRELASSIGNSTOGROUP",
        ),
        sourceId,
        type,
      });
      onLog(
        `graph.createDraft({ sourceId: ${sourceId}, x: ${position.x.toFixed(1)}, y: ${position.y.toFixed(1)} });`,
      );
    },
    [classOptions, nodeTypeById, onLog, relationshipOptionsForTypes],
  );

  const fitView = () => {
    flowRef.current?.fitView({ duration: 250, maxZoom: 1.25, padding: 0.22 });
    onLog("graph.fitView();");
  };

  const autoLayout = () => {
    onClearPositions();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(fitView);
    });
  };

  const copySelectedNodes = useCallback(() => {
    const currentNodes = flowNodesRef.current;
    const selectedNodes = currentNodes.filter((node) => node.selected);
    const sourceNodes = selectedNodes.length
      ? selectedNodes
      : currentNodes.filter((node) => node.data.selectedIfc);
    if (!sourceNodes.length) {
      return;
    }
    const copied = sourceNodes.map((node) => ({
      id: node.data.ifcId,
      name: node.data.name,
      type: node.data.type,
      x: node.position.x,
      y: node.position.y,
    }));
    setCopiedNodes(copied);
    onLog(
      `graph.copyNodes({ count: ${copied.length}, ids: [${copied.map((node) => node.id).join(", ")}] });`,
    );
  }, [onLog]);

  const pasteCopiedNodes = useCallback(
    (connect: boolean) => {
      if (!copiedNodes.length) {
        return;
      }
      const currentNodes = flowNodesRef.current;
      const sourceId =
        currentNodes.find((node) => node.data.selectedIfc)?.data.ifcId ??
        copiedNodes[0].id;
      const copiedIds = new Set(copiedNodes.map((node) => node.id));
      const copiedIncomingRelationship = flowEdgesRef.current.find((edge) => {
        const data = edge.data;
        return (
          data && data.sourceId === sourceId && copiedIds.has(data.targetId)
        );
      })?.data?.relationshipType;
      const relationshipType = preferredRelationship(
        relationshipOptionsForTypes(
          nodeTypeById.get(sourceId),
          copiedNodes[0]?.type,
          sourceId,
        ),
        copiedIncomingRelationship ?? AGGREGATE_RELATIONSHIP_TYPE,
      );
      pasteSerialRef.current += 1;
      const offset = 36 * (((pasteSerialRef.current - 1) % 5) + 1);
      onPasteNodes(
        sourceId,
        relationshipType,
        copiedNodes.map((node) => ({
          ...node,
          x: node.x + offset,
          y: node.y + offset,
        })),
        connect,
      );
      onLog(
        `graph.pasteNodes({ sourceId: ${sourceId}, relationship: '${relationshipType}', connect: ${connect}, count: ${copiedNodes.length} });`,
      );
    },
    [
      copiedNodes,
      nodeTypeById,
      onLog,
      onPasteNodes,
      relationshipOptionsForTypes,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isCopyPasteShortcut(event)) {
        return;
      }
      const targetNode = event.target as Node | null;
      if (
        !targetNode ||
        !rootRef.current?.contains(targetNode) ||
        isEditableEventTarget(event.target)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        copySelectedNodes();
      } else if (key === "v") {
        event.preventDefault();
        pasteCopiedNodes(!event.shiftKey);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copySelectedNodes, pasteCopiedNodes]);

  const handleEdgeClick = useCallback<EdgeMouseHandler<IfcFlowEdge>>(
    (_event, edge) => {
      const data = edge.data;
      if (!data) {
        return;
      }
      setPendingCreate(null);
      setPendingConnect(null);
      setSelectedRelationship({
        label: data.label,
        relationshipId: data.relationshipId,
        relationshipType: data.relationshipType,
        sourceId: data.sourceId,
        targetId: data.targetId,
      });
      onLog(
        `graph.selectRelationship({ id: ${data.relationshipId}, class: '${data.relationshipType}' });`,
      );
    },
    [onLog],
  );

  const pendingCreateRelationshipOptions = pendingCreate
    ? relationshipOptionsForTypes(
        nodeTypeById.get(pendingCreate.sourceId),
        pendingCreate.type,
        pendingCreate.sourceId,
      )
    : [];
  const pendingConnectRelationshipOptions = pendingConnect
    ? relationshipOptionsForIds(
        pendingConnect.sourceId,
        pendingConnect.targetId,
      )
    : [];

  return (
    <div
      className="ifc-relationship-graph"
      ref={rootRef}
      tabIndex={0}
      onMouseDown={() => rootRef.current?.focus()}
    >
      <div className="ifc-graph-toolbar">
        <label className="ifc-graph-depth" title="Anzeigetiefe des Graphen">
          <span>Tiefe</span>
          <input
            min={0}
            max={MAX_GRAPH_DEPTH}
            step={1}
            title={`Anzeigetiefe: ${depth}`}
            type="range"
            value={depth}
            onChange={(event) => onDepth(Number(event.currentTarget.value))}
          />
          <output>{depth}</output>
        </label>
        <select
          aria-label="Graph-Voreinstellung"
          title="Voreinstellung für den Graphausschnitt"
          value={preset}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onPreset(value);
            onLog(`graph.preset(${JSON.stringify(value)});`);
          }}
        >
          {presetOptions.map((option, index) => (
            <option key={optionKey(option, index)} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Graph-Layout"
          title="Layout-Modus des Graphen"
          value={layoutMode}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "columns" || value === "tension") {
              onLayoutMode(value);
              onLog(`graph.layout(${JSON.stringify(value)});`);
            }
          }}
        >
          <option value="tension">Spannung</option>
          <option value="columns">Spalten</option>
        </select>
        <button
          type="button"
          title="Automatisches Layout neu berechnen"
          onClick={autoLayout}
        >
          Auto-Layout
        </button>
        <details className="ifc-graph-menu">
          <summary>
            Beziehungen
            {relationshipTypeFilters.length
              ? ` (${relationshipTypeFilters.length.toLocaleString("de-DE")})`
              : ""}
          </summary>
          <div
            className="ifc-graph-menu-panel ifc-graph-filter-menu"
            aria-label="Beziehungstyp-Filter"
          >
            <button
              className={!relationshipTypeFilters.length ? "active" : ""}
              title="Alle Beziehungstypen anzeigen"
              type="button"
              onClick={() => {
                onRelationshipTypeFilters([]);
                onLog("graph.relationshipFilters([]);");
              }}
            >
              Alle Beziehungen
            </button>
            {relationshipOptions.map((option, index) => {
              const active = relationshipTypeFilters.includes(option.value);
              return (
                <button
                  key={optionKey(option, index)}
                  className={active ? "active" : ""}
                  title={option.detail ?? option.value}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? relationshipTypeFilters.filter(
                          (value) => value !== option.value,
                        )
                      : [...relationshipTypeFilters, option.value];
                    onRelationshipTypeFilters(next);
                    onLog(
                      `graph.relationshipFilters(${JSON.stringify(next)});`,
                    );
                  }}
                >
                  {option.label.replace(/^IFCREL/i, "")}
                </button>
              );
            })}
          </div>
        </details>
        {trimmedSearch ? (
          <div className="ifc-graph-search-nav" aria-label="Suchtreffer">
            <button
              type="button"
              disabled={searchMatchCount === 0}
              title="Vorheriges Suchergebnis"
              onClick={() => onSearchNavigate("previous")}
            >
              ←
            </button>
            <span>
              {searchMatchCount ? searchActiveIndex + 1 : 0}/
              {searchMatchCount.toLocaleString("de-DE")}
            </span>
            <button
              type="button"
              disabled={searchMatchCount === 0}
              title="Nächstes Suchergebnis"
              onClick={() => onSearchNavigate("next")}
            >
              →
            </button>
          </div>
        ) : null}
        <details className="ifc-graph-menu">
          <summary>Aktionen</summary>
          <div className="ifc-graph-menu-panel ifc-graph-action-menu">
            <button
              type="button"
              title="Ausgewählte Knoten kopieren (Strg+C)"
              onClick={copySelectedNodes}
            >
              Kopieren
            </button>
            <button
              type="button"
              disabled={!copiedNodes.length}
              title="Kopierte Knoten einfügen und verbinden (Strg+V)"
              onClick={() => pasteCopiedNodes(true)}
            >
              Einfügen
              {copiedNodes.length
                ? ` (${copiedNodes.length.toLocaleString("de-DE")})`
                : ""}
            </button>
            <button
              type="button"
              disabled={!copiedNodes.length}
              title="Kopierte Knoten ohne Beziehungen einfügen (Umschalt+Strg+V)"
              onClick={() => pasteCopiedNodes(false)}
            >
              Ohne Beziehungen einfügen
            </button>
          </div>
        </details>
        {capped ? (
          <span className="ifc-graph-limit" title="Der Graphausschnitt ist begrenzt">
            Begrenzt
          </span>
        ) : null}
      </div>
      <div className="ifc-reactflow-shell">
        <ReactFlow
          connectionMode={ConnectionMode.Loose}
          edges={flowEdges}
          fitView
          isValidConnection={(connection) =>
            connection.source !== connection.target
          }
          maxZoom={2.2}
          minZoom={0.08}
          multiSelectionKeyCode={["Shift", "Control", "Meta"]}
          nodes={flowNodes}
          nodesDraggable
          nodeTypes={nodeTypes}
          panOnDrag={[1, 2]}
          panOnScroll
          panActivationKeyCode="Space"
          proOptions={{ hideAttribution: true }}
          selectionMode={SelectionMode.Partial}
          selectionOnDrag
          zoomOnDoubleClick
          zoomOnScroll
          onInit={(instance) => {
            flowRef.current = instance;
          }}
          onConnect={handleConnect}
          onConnectEnd={handleConnectEnd}
          onConnectStart={handleConnectStart}
          onEdgeClick={handleEdgeClick}
          onNodeClick={(_event, node) => onSelect(Number(node.id))}
          onNodeDragStop={(_event, node, draggedNodes) => {
            commitMovedNodes(draggedNodes.length ? draggedNodes : [node]);
          }}
          onPaneClick={() => setSelectedRelationship(null)}
          onSelectionDragStop={(_event, selectedNodes) => {
            commitMovedNodes(selectedNodes);
          }}
          onNodesChange={handleNodesChange}
        >
          <Background color={colors.background} gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {pendingCreate ? (
        <FlowPopover
          title="Verknüpften IFC-Knoten erstellen"
          onCancel={() => setPendingCreate(null)}
        >
          <label>
            <span>IFC-Klasse</span>
            <select
              value={pendingCreate.type}
              onChange={(event) => {
                const type = event.currentTarget.value;
                setPendingCreate((current) =>
                  current
                    ? {
                        ...current,
                        name: current.name.startsWith(NEW_NODE_NAME_PREFIX)
                          ? defaultNodeName(type)
                          : current.name,
                        relationshipType: preferredRelationship(
                          relationshipOptionsForTypes(
                            nodeTypeById.get(current.sourceId),
                            type,
                            current.sourceId,
                          ),
                          current.relationshipType,
                        ),
                        type,
                      }
                    : current,
                );
              }}
            >
              {classOptions.map((option, index) => (
                <option key={optionKey(option, index)} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Name</span>
            <input
              value={pendingCreate.name}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setPendingCreate((current) =>
                  current ? { ...current, name } : current,
                );
              }}
            />
          </label>
          <label>
            <span>Beziehung</span>
            <select
              value={pendingCreate.relationshipType}
              onChange={(event) => {
                const relationshipType = event.currentTarget.value;
                setPendingCreate((current) =>
                  current ? { ...current, relationshipType } : current,
                );
              }}
            >
              {pendingCreateRelationshipOptions.map((option, index) => (
                <option key={optionKey(option, index)} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {!pendingCreateRelationshipOptions.length ? (
            <div className="ifc-flow-popover-note">
              Keine gültige Beziehung für diese Kombination aus Quelle und
              Klasse.
            </div>
          ) : null}
          <div className="ifc-flow-popover-actions">
            <button
              className="primary"
              disabled={
                !pendingCreateRelationshipOptions.some(
                  (option) => option.value === pendingCreate.relationshipType,
                )
              }
              type="button"
              onClick={() => {
                onCreateNodeFromConnection(
                  pendingCreate.sourceId,
                  pendingCreate.type,
                  pendingCreate.name.trim() ||
                    defaultNodeName(pendingCreate.type),
                  pendingCreate.relationshipType,
                  pendingCreate.position,
                );
                setPendingCreate(null);
              }}
            >
              Hinzufügen + verbinden
            </button>
          </div>
        </FlowPopover>
      ) : null}
      {pendingConnect ? (
        <FlowPopover
          title={`Verbinden #${pendingConnect.sourceId} → #${pendingConnect.targetId}`}
          onCancel={() => setPendingConnect(null)}
        >
          <label>
            <span>Beziehung</span>
            <select
              value={pendingConnect.relationshipType}
              onChange={(event) => {
                const relationshipType = event.currentTarget.value;
                setPendingConnect((current) =>
                  current ? { ...current, relationshipType } : current,
                );
              }}
            >
              {pendingConnectRelationshipOptions.map((option, index) => (
                <option key={optionKey(option, index)} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {!pendingConnectRelationshipOptions.length ? (
            <div className="ifc-flow-popover-note">
              Keine gültige Beziehung für diese Endpunkt-Klassen.
            </div>
          ) : null}
          <div className="ifc-flow-popover-actions">
            <button
              className="primary"
              disabled={
                !pendingConnectRelationshipOptions.some(
                  (option) => option.value === pendingConnect.relationshipType,
                )
              }
              type="button"
              onClick={() => {
                onConnectNodes(
                  pendingConnect.sourceId,
                  pendingConnect.targetId,
                  pendingConnect.relationshipType,
                );
                setPendingConnect(null);
              }}
            >
              Beziehung hinzufügen
            </button>
          </div>
        </FlowPopover>
      ) : null}
      {selectedRelationship ? (
        <FlowPopover
          title={`Beziehung #${selectedRelationship.relationshipId}`}
          onCancel={() => setSelectedRelationship(null)}
        >
          <div className="ifc-flow-popover-summary">
            <strong>{selectedRelationship.relationshipType}</strong>
            <span>
              #{selectedRelationship.sourceId} → #
              {selectedRelationship.targetId}
            </span>
            <span>{selectedRelationship.label}</span>
          </div>
          <div className="ifc-flow-popover-actions">
            <button
              className="danger"
              type="button"
              onClick={() => {
                onRemoveRelationship(selectedRelationship.relationshipId);
                setSelectedRelationship(null);
              }}
            >
              Beziehung löschen
            </button>
          </div>
        </FlowPopover>
      ) : null}
    </div>
  );
}

interface GraphFlowColors {
  aggregate: string;
  background: string;
  contained: string;
  reference: string;
}

function subscribeToThemeChanges(onChange: () => void) {
  if (typeof document === "undefined") {
    return () => {};
  }
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  });
  return () => observer.disconnect();
}

function themeSnapshot() {
  // Nur das Dark-Flag beobachten: fremde Klassen-Toggles auf <html> (Modal-
  // Locks, Drag-Marker) dürfen keinen Graph-Re-Render mit 8 getComputedStyle-
  // Aufrufen auslösen.
  return typeof document === "undefined"
    ? "light"
    : document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
}

function resolveCssVariable(name: string, fallback: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/**
 * Resolves the graph colors from the CSS custom properties once per render
 * and re-resolves them when the html class attribute changes (theme switch).
 */
function useGraphFlowColors(): GraphFlowColors {
  const themeClass = useSyncExternalStore(
    subscribeToThemeChanges,
    themeSnapshot,
    () => "",
  );
  return useMemo(() => {
    void themeClass;
    return {
      aggregate: resolveCssVariable("--graph-edge-aggregate", "#0f766e"),
      background: resolveCssVariable("--border", "#d4d4d8"),
      contained: resolveCssVariable("--graph-edge-contained", "#0891b2"),
      reference: resolveCssVariable("--graph-edge-reference", "#2563eb"),
    };
  }, [themeClass]);
}

function defaultNodeName(type: string) {
  return `${NEW_NODE_NAME_PREFIX}${shortType(type)}`;
}

function syncNodeDataPositions(nodes: IfcFlowNode[]) {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      layoutPosition: node.position,
    },
  }));
}

function IfcNode({ data, selected }: NodeProps<IfcFlowNode>) {
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const childLabel = data.childrenLoaded
    ? "-"
    : `+${Math.min(data.childCount, 99)}`;
  const classes = [
    "ifc-flow-node",
    data.selectedIfc || selected ? "selected anchor" : "",
    data.searchMatch ? "search-match" : "",
    data.pinned ? "pinned" : "",
    data.childrenLoaded ? "loaded" : "",
    propertiesOpen ? "properties-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <Handle
        className="ifc-flow-handle ifc-flow-handle-target"
        id={RELATIONSHIP_TARGET_HANDLE}
        type="target"
        position={Position.Left}
      />
      <Handle
        className="ifc-flow-handle ifc-flow-handle-source"
        id={RELATIONSHIP_SOURCE_HANDLE}
        type="source"
        position={Position.Right}
      />
      <Handle
        className="ifc-flow-handle ifc-flow-handle-aggregate-target"
        id={AGGREGATE_TARGET_HANDLE}
        type="target"
        position={Position.Top}
      />
      <Handle
        className="ifc-flow-handle ifc-flow-handle-aggregate-source"
        id={AGGREGATE_SOURCE_HANDLE}
        type="source"
        position={Position.Bottom}
      />
      <div className="ifc-flow-node-header">
        <div className="ifc-flow-node-labels">
          <span className="ifc-flow-node-id">#{data.ifcId}</span>
          <strong className="ifc-flow-node-type" title={data.type}>
            {data.type}
          </strong>
        </div>
        <div className="ifc-flow-node-actions">
          {data.childCount > 0 ? (
            <button
              className={`nodrag nopan${data.childrenLoaded ? " expanded" : ""}`}
              title={
                data.childrenLoaded
                  ? "Untergeordnete Knoten einklappen"
                  : "Untergeordnete Knoten laden"
              }
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onToggleChildren(data.ifcId, data.childrenLoaded);
              }}
            >
              {childLabel}
            </button>
          ) : null}
          <button
            className={`nodrag nopan${data.pinned ? " expanded" : ""}`}
            title={data.pinned ? "Knoten lösen" : "Knoten anheften"}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onTogglePin(data.ifcId, data.layoutPosition);
            }}
          >
            {data.pinned ? "Fixiert" : "Pin"}
          </button>
          {data.type !== "IFCPROJECT" ? (
            <button
              className="nodrag nopan danger"
              title={`#${data.ifcId} löschen`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onRemoveNode(data.ifcId);
              }}
            >
              Entf
            </button>
          ) : null}
        </div>
      </div>
      <span
        className="ifc-flow-node-name"
        title={data.name || data.globalId || data.description || data.type}
      >
        {data.name || data.globalId || data.description || data.type}
      </span>
      {data.propertySets.length || data.embeddedResources.length ? (
        <div className="ifc-flow-node-metadata nodrag nopan">
          <PropertySetSummary
            open={propertiesOpen}
            resources={data.embeddedResources}
            sets={data.propertySets}
            onToggle={() => setPropertiesOpen((current) => !current)}
          />
        </div>
      ) : null}
    </div>
  );
}

function PropertySetSummary({
  open,
  resources,
  sets,
  onToggle,
}: {
  open: boolean;
  resources: RelationshipFlowEmbeddedResource[];
  sets: RelationshipFlowPropertySet[];
  onToggle(): void;
}) {
  const psetCount = sets.filter((set) => set.kind !== "Qto").length;
  const quantityCount = sets.length - psetCount;
  const valueCount = sets.reduce((total, set) => total + set.values.length, 0);
  return (
    <>
      <button
        aria-expanded={open}
        className={`ifc-flow-node-metadata-toggle${open ? " expanded" : ""}`}
        title={`${sets.length.toLocaleString("de-DE")} Property- und Quantity-Sets mit ${valueCount.toLocaleString("de-DE")} Werten, ${resources.length.toLocaleString("de-DE")} eingebettete Ressourcen`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <span>{psetCount.toLocaleString("de-DE")} Psets</span>
        <span aria-hidden>·</span>
        <span>{quantityCount.toLocaleString("de-DE")} Qtos</span>
        <span aria-hidden>·</span>
        <span>{valueCount.toLocaleString("de-DE")} Werte</span>
        {resources.length ? (
          <>
            <span aria-hidden>·</span>
            <span>{resources.length.toLocaleString("de-DE")} Ressourcen</span>
          </>
        ) : null}
      </button>
      {open ? (
        <div
          aria-label="Eingebettete Eigenschaften und Ressourcen"
          className="ifc-flow-node-properties-panel"
          onClick={(event) => event.stopPropagation()}
        >
          {sets.map((set) => (
            <section key={set.id} className="ifc-flow-property-set">
              <header>
                <span>{set.kind}</span>
                <strong title={set.name}>{set.name}</strong>
                <small>#{set.id}</small>
              </header>
              {set.values.length ? (
                <dl>
                  {set.values.map((value) => (
                    <div key={value.id}>
                      <dt title={`${value.type} · #${value.id}`}>
                        {value.name}
                      </dt>
                      <dd title={value.value || "–"}>{value.value || "–"}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>Keine Werte</p>
              )}
            </section>
          ))}
          {resources.map((resource) => (
            <section
              key={`${resource.kind}-${resource.id}`}
              className="ifc-flow-property-set ifc-flow-resource"
            >
              <header>
                <span>{resource.kind}</span>
                <strong title={resource.name}>{resource.name}</strong>
                <small>#{resource.id}</small>
              </header>
              <p title={resource.type}>{resource.type}</p>
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}

function FlowPopover({
  children,
  title,
  onCancel,
}: {
  children: React.ReactNode;
  title: string;
  onCancel(): void;
}) {
  return (
    <div className="ifc-flow-popover">
      <div className="ifc-flow-popover-title">
        <strong>{title}</strong>
        <button
          aria-label="Schließen"
          title="Schließen"
          type="button"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

function clientPointFromEvent(event: MouseEvent | TouchEvent): FlowPoint {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    return { x: touch.clientX, y: touch.clientY };
  }
  if ("touches" in event && event.touches.length > 0) {
    const touch = event.touches[0];
    return { x: touch.clientX, y: touch.clientY };
  }
  if ("clientX" in event) {
    return { x: event.clientX, y: event.clientY };
  }
  return { x: 0, y: 0 };
}

function preferredClass(options: RelationshipFlowOption[]) {
  return optionValue(options, "IFCBUILDINGELEMENTPROXY");
}

function preferredRelationship(
  options: RelationshipFlowOption[],
  preferred: string,
) {
  return optionValue(options, preferred);
}

function prefersAggregateRelationship(
  sourceHandle: string | null,
  targetHandle: string | null,
) {
  return (
    sourceHandle === AGGREGATE_SOURCE_HANDLE ||
    targetHandle === AGGREGATE_TARGET_HANDLE
  );
}

function isAggregateRelationship(type: string) {
  return type.trim().toUpperCase() === AGGREGATE_RELATIONSHIP_TYPE;
}

function isContainedSpatialRelationship(type: string) {
  return type.trim().toUpperCase() === CONTAINED_SPATIAL_RELATIONSHIP_TYPE;
}

function optionValue(options: RelationshipFlowOption[], preferred: string) {
  return options.some((option) => option.value === preferred)
    ? preferred
    : (options[0]?.value ?? preferred);
}

function optionKey(option: RelationshipFlowOption, index: number) {
  return `${option.value}-${index}`;
}

function isCopyPasteShortcut(event: KeyboardEvent) {
  return (event.ctrlKey || event.metaKey) && !event.altKey;
}

function isEditableEventTarget(target: EventTarget | null) {
  const element = target as {
    isContentEditable?: boolean;
    tagName?: string;
  } | null;
  const tagName = element?.tagName?.toLowerCase();
  return (
    Boolean(element?.isContentEditable) ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}
