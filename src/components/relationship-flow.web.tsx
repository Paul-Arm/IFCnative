import {
    applyNodeChanges,
    Background,
    ConnectionMode,
    Controls,
    Handle,
    MarkerType,
    MiniMap,
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
} from "react";

import type {
    FlowPoint,
    RelationshipFlowClipboardNode,
    RelationshipFlowOption,
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

const nodeTypes = {
  ifcNode: IfcNode,
};

export default function RelationshipFlow({
  capped,
  classOptions,
  depth,
  edges,
  nodes,
  preset,
  presetOptions,
  relationshipOptions,
  relationshipCount,
  relationshipTypeFilters,
  relationshipTypes,
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
  const flowRef = useRef<ReactFlowInstance<IfcFlowNode, IfcFlowEdge> | null>(
    null,
  );
  const flowNodesRef = useRef<IfcFlowNode[]>([]);
  const flowEdgesRef = useRef<IfcFlowEdge[]>([]);
  const pasteSerialRef = useRef(0);
  const connectionSourceRef = useRef<ConnectionDraftSource | null>(null);
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
          layoutPosition: { x: node.x, y: node.y },
          name: node.entity.name,
          onRemoveNode,
          onToggleChildren,
          onTogglePin,
          pinned: node.pinned,
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
              ? "#0f766e"
              : containedSpatial
                ? "#0891b2"
                : "#2563eb",
            strokeWidth: vertical ? 2.6 : 2,
          },
          target: String(edge.target),
          targetHandle: vertical
            ? AGGREGATE_TARGET_HANDLE
            : RELATIONSHIP_TARGET_HANDLE,
          type: vertical ? "smoothstep" : "default",
        };
      }),
    [edges],
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
      setPendingConnect({
        relationshipType: preferredRelationship(
          relationshipOptions,
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
    [onLog, relationshipOptions],
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
      setSelectedRelationship(null);
      setPendingConnect(null);
      setPendingCreate({
        name: `New ${shortType(type)}`,
        position,
        relationshipType: preferredRelationship(
          relationshipOptions,
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
    [classOptions, onLog, relationshipOptions],
  );

  const fitView = () => {
    flowRef.current?.fitView({ duration: 250, maxZoom: 1.25, padding: 0.22 });
    onLog("graph.fitView();");
  };

  const autoLayout = () => {
    onClearPositions();
    setFlowNodes(baseFlowNodes);
    window.requestAnimationFrame(fitView);
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
        relationshipOptions,
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
    [copiedNodes, onLog, onPasteNodes, relationshipOptions],
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

  return (
    <div
      className="ifc-relationship-graph"
      ref={rootRef}
      tabIndex={0}
      onMouseDown={() => rootRef.current?.focus()}
    >
      <div className="ifc-graph-toolbar">
        <label>
          <span>Depth {depth}</span>
          <input
            min={0}
            max={MAX_GRAPH_DEPTH}
            step={1}
            type="range"
            value={depth}
            onChange={(event) => onDepth(Number(event.currentTarget.value))}
          />
        </label>
        <label>
          <span>Preset</span>
          <select
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
        </label>
        <label>
          <span>Layout</span>
          <select
            value={layoutMode}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "columns" || value === "tension") {
                onLayoutMode(value);
                onLog(`graph.layout(${JSON.stringify(value)});`);
              }
            }}
          >
            <option value="tension">Tension</option>
            <option value="columns">Columns</option>
          </select>
        </label>
        <button type="button" onClick={fitView}>
          Fit
        </button>
        <button type="button" onClick={autoLayout}>
          Auto
        </button>
        <button type="button" onClick={copySelectedNodes}>
          Copy
        </button>
        <button
          type="button"
          disabled={!copiedNodes.length}
          onClick={() => pasteCopiedNodes(true)}
        >
          Paste{copiedNodes.length ? ` ${copiedNodes.length}` : ""}
        </button>
        <button
          type="button"
          disabled={!copiedNodes.length}
          title="Paste copied nodes without creating relationships (Shift+Ctrl+V)"
          onClick={() => pasteCopiedNodes(false)}
        >
          Paste no rel
        </button>
        <button
          type="button"
          disabled={!trimmedSearch || searchMatchCount === 0}
          title="Previous search result"
          onClick={() => onSearchNavigate("previous")}
        >
          Prev
        </button>
        <button
          type="button"
          disabled={!trimmedSearch || searchMatchCount === 0}
          title="Next search result"
          onClick={() => onSearchNavigate("next")}
        >
          Next
        </button>
        <span
          className="ifc-graph-count"
          title={
            relationshipTypes.length
              ? relationshipTypes.join(", ")
              : "All relationship types"
          }
        >
          {nodes.length} nodes / {relationshipCount} edges
          {relationshipTypes.length
            ? ` · ${relationshipTypes.length} rel filters`
            : " · all rels"}
          {capped ? " capped" : ""}
          {trimmedSearch
            ? ` · ${searchMatchCount ? searchActiveIndex + 1 : 0}/${searchMatchCount.toLocaleString()} search matches`
            : ""}
        </span>
      </div>
      <div
        className="ifc-graph-filter-bar"
        aria-label="Relationship type filters"
      >
        <button
          className={!relationshipTypeFilters.length ? "active" : ""}
          type="button"
          onClick={() => {
            onRelationshipTypeFilters([]);
            onLog("graph.relationshipFilters([]);");
          }}
        >
          All relationships
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
                onLog(`graph.relationshipFilters(${JSON.stringify(next)});`);
              }}
            >
              {option.label.replace(/^IFCREL/i, "")}
            </button>
          );
        })}
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
          <Background color="#d4d4d8" gap={18} />
          <Controls showInteractive={false} />
          <MiniMap
            maskColor="rgb(15 23 42 / 8%)"
            nodeColor={(node) => {
              const data = node.data as IfcFlowNodeData;
              if (data.selectedIfc) {
                return "#0f766e";
              }
              return data.pinned ? "#86efac" : "#67e8f9";
            }}
            pannable
            zoomable
          />
        </ReactFlow>
      </div>
      {pendingCreate ? (
        <FlowPopover
          title="Create connected IFC node"
          onCancel={() => setPendingCreate(null)}
        >
          <label>
            <span>IFC class</span>
            <select
              value={pendingCreate.type}
              onChange={(event) => {
                const type = event.currentTarget.value;
                setPendingCreate((current) =>
                  current
                    ? {
                        ...current,
                        name: current.name.startsWith("New ")
                          ? `New ${shortType(type)}`
                          : current.name,
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
            <span>Relationship</span>
            <select
              value={pendingCreate.relationshipType}
              onChange={(event) => {
                const relationshipType = event.currentTarget.value;
                setPendingCreate((current) =>
                  current ? { ...current, relationshipType } : current,
                );
              }}
            >
              {relationshipOptions.map((option, index) => (
                <option key={optionKey(option, index)} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ifc-flow-popover-actions">
            <button
              className="primary"
              type="button"
              onClick={() => {
                onCreateNodeFromConnection(
                  pendingCreate.sourceId,
                  pendingCreate.type,
                  pendingCreate.name.trim() ||
                    `New ${shortType(pendingCreate.type)}`,
                  pendingCreate.relationshipType,
                  pendingCreate.position,
                );
                setPendingCreate(null);
              }}
            >
              Add + connect
            </button>
          </div>
        </FlowPopover>
      ) : null}
      {pendingConnect ? (
        <FlowPopover
          title={`Connect #${pendingConnect.sourceId} -> #${pendingConnect.targetId}`}
          onCancel={() => setPendingConnect(null)}
        >
          <label>
            <span>Relationship</span>
            <select
              value={pendingConnect.relationshipType}
              onChange={(event) => {
                const relationshipType = event.currentTarget.value;
                setPendingConnect((current) =>
                  current ? { ...current, relationshipType } : current,
                );
              }}
            >
              {relationshipOptions.map((option, index) => (
                <option key={optionKey(option, index)} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="ifc-flow-popover-actions">
            <button
              className="primary"
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
              Add relationship
            </button>
          </div>
        </FlowPopover>
      ) : null}
      {selectedRelationship ? (
        <FlowPopover
          title={`Relationship #${selectedRelationship.relationshipId}`}
          onCancel={() => setSelectedRelationship(null)}
        >
          <div className="ifc-flow-popover-summary">
            <strong>{selectedRelationship.relationshipType}</strong>
            <span>
              #{selectedRelationship.sourceId} -&gt; #
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
              Delete relationship
            </button>
          </div>
        </FlowPopover>
      ) : null}
    </div>
  );
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
  const childLabel = data.childrenLoaded
    ? "-"
    : `+${Math.min(data.childCount, 99)}`;
  const classes = [
    "ifc-flow-node",
    data.selectedIfc || selected ? "selected anchor" : "",
    data.searchMatch ? "search-match" : "",
    data.pinned ? "pinned" : "",
    data.childrenLoaded ? "loaded" : "",
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
                data.childrenLoaded ? "Collapse children" : "Expand children"
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
            title={data.pinned ? "Unpin node" : "Pin node"}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              data.onTogglePin(data.ifcId, data.layoutPosition);
            }}
          >
            {data.pinned ? "Fixed" : "Pin"}
          </button>
          {data.type !== "IFCPROJECT" ? (
            <button
              className="nodrag nopan danger"
              title={`Delete #${data.ifcId}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                data.onRemoveNode(data.ifcId);
              }}
            >
              Del
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
    </div>
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
        <button type="button" onClick={onCancel}>
          x
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

function shortType(type: string) {
  return type.replace(/^IFC/i, "");
}
