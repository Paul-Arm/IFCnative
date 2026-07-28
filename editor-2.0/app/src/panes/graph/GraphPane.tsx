/**
 * Beziehungsgraph-Pane (lesend, M1).
 *
 * Anker ist das zuletzt ausgewählte Objekt; von dort wird die Nachbarschaft
 * per Breitensuche über den RelationshipGraph aufgebaut, nach Beziehungsart
 * gefiltert und in einem Ebenen-Layout dargestellt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./graph.css";
import { useActiveDocument } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import { useUi } from "../../store/ui";
import GraphNode, { type IfcFlowNode } from "./GraphNode";
import GraphToolbar from "./GraphToolbar";
import { matchingNodes, toFlowEdges, toFlowNodes } from "./elements";
import {
  clearPinned,
  hasPinned,
  pinKey,
  pinPosition,
  positionsFor,
  type NodePosition,
} from "./layout";
import { useTypeFilter } from "./useTypeFilter";
import { NODE_CAP, useNeighborhood } from "./useNeighborhood";

const NODE_TYPES: NodeTypes = { ifc: GraphNode };
const EMPTY_POSITIONS: ReadonlyMap<number, NodePosition> = new Map();

export default function GraphPane() {
  return (
    <ReactFlowProvider>
      <GraphPaneInner />
    </ReactFlowProvider>
  );
}

function GraphPaneInner() {
  const doc = useActiveDocument();
  const docId = doc?.id ?? null;
  const selection = useSelectionOf(docId);
  const select = useSelection((s) => s.select);
  const requestFocus = useSelection((s) => s.requestFocus);
  const theme = useUi((s) => s.theme);
  const { fitView } = useReactFlow();

  const [depth, setDepth] = useState(2);
  const [search, setSearch] = useState("");
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const fromGraph = useRef(false);

  const filter = useTypeFilter(doc?.session.store ?? null);
  const lastSelected =
    selection.length > 0 ? selection[selection.length - 1] : null;

  // Auswahl von außen (Baum, Viewer) setzt den Anker neu; Klicks im Graphen
  // sollen die Nachbarschaft dagegen nicht umbauen.
  useEffect(() => {
    if (fromGraph.current) {
      fromGraph.current = false;
      return;
    }
    setAnchorId(lastSelected);
  }, [lastSelected, docId]);

  // Sicherheitsnetz: die Markierung gilt nur für den Render direkt nach dem
  // Klick — sonst würde eine folgenlose Auswahl sie dauerhaft stehen lassen.
  useEffect(() => {
    fromGraph.current = false;
  });

  const neighborhood = useNeighborhood(
    doc?.session ?? null,
    anchorId,
    depth,
    filter.activeTypes,
  );

  const key = docId && anchorId !== null ? pinKey(docId, anchorId) : "";
  const positions = useMemo(
    () =>
      neighborhood ? positionsFor(key, neighborhood.nodes) : EMPTY_POSITIONS,
    // layoutVersion erzwingt Neuberechnung nach Pinnen/Zurücksetzen
    [neighborhood, key, layoutVersion],
  );

  const pickedSet = useMemo(() => new Set(selection), [selection]);
  const matches = useMemo(
    () => matchingNodes(neighborhood?.nodes ?? [], search),
    [neighborhood, search],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);

  const flowNodes = useMemo(
    () =>
      neighborhood
        ? toFlowNodes(
            neighborhood.nodes,
            positions,
            neighborhood.anchorId,
            pickedSet,
            matchSet,
          )
        : [],
    [neighborhood, positions, pickedSet, matchSet],
  );
  const flowEdges = useMemo(
    () => (neighborhood ? toFlowEdges(neighborhood.edges) : []),
    [neighborhood],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<IfcFlowNode>([]);
  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  // Neuer Anker/neue Tiefe: Ausschnitt auf den ganzen Graphen setzen.
  useEffect(() => {
    if (!neighborhood) return;
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.2, duration: 200 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [neighborhood, fitView]);

  // Suche zentriert auf den ersten Treffer.
  useEffect(() => {
    const first = matches[0];
    if (first === undefined) return;
    const timer = window.setTimeout(() => {
      void fitView({
        nodes: [{ id: String(first) }],
        padding: 0.4,
        maxZoom: 1.4,
        duration: 300,
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [matches, fitView]);

  const onNodeClick = useCallback<NodeMouseHandler<IfcFlowNode>>(
    (event, node) => {
      if (!docId) return;
      fromGraph.current = true;
      select(docId, Number(node.id), event.ctrlKey || event.metaKey);
    },
    [docId, select],
  );

  const onNodeDoubleClick = useCallback<NodeMouseHandler<IfcFlowNode>>(
    (event, node) => {
      if (!docId) return;
      const expressId = Number(node.id);
      fromGraph.current = true;
      select(docId, expressId, event.ctrlKey || event.metaKey);
      requestFocus(docId, expressId);
    },
    [docId, select, requestFocus],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<IfcFlowNode>>(
    (_event, node) => {
      if (!key) return;
      pinPosition(key, Number(node.id), node.position);
      setLayoutVersion((version) => version + 1);
    },
    [key],
  );

  const onResetLayout = useCallback(() => {
    if (!key) return;
    clearPinned(key);
    setLayoutVersion((version) => version + 1);
  }, [key]);

  if (!doc) {
    return <p className="pane-empty">Kein Dokument geöffnet.</p>;
  }

  const status = neighborhood
    ? `${neighborhood.nodes.length} Knoten · ${neighborhood.edges.length} Kanten` +
      (neighborhood.capped ? ` · gekappt bei ${NODE_CAP}` : "") +
      (matches.length > 0 ? ` · ${matches.length} Treffer` : "")
    : "kein Anker";

  return (
    <div className="pane graph-pane">
      <GraphToolbar
        presetId={filter.presetId}
        onPreset={filter.setPreset}
        depth={depth}
        onDepth={setDepth}
        availableTypes={filter.availableTypes}
        activeTypes={filter.activeTypes}
        onToggleType={filter.toggleType}
        onAllTypes={filter.selectAll}
        onNoTypes={filter.selectNone}
        search={search}
        onSearch={setSearch}
        onAnchorFromSelection={() => setAnchorId(lastSelected)}
        canAnchor={lastSelected !== null && lastSelected !== anchorId}
        onResetLayout={onResetLayout}
        canResetLayout={key !== "" && hasPinned(key)}
        status={status}
      />
      {!neighborhood ? (
        <p className="pane-empty">
          Objekt auswählen — der Graph zeigt die Nachbarschaft des zuletzt
          gewählten Objekts.
        </p>
      ) : (
        <div className="graph-flow">
          <ReactFlow<IfcFlowNode>
            nodes={nodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeDragStop={onNodeDragStop}
            colorMode={theme === "dark" ? "dark" : "light"}
            nodesConnectable={false}
            edgesReconnectable={false}
            minZoom={0.05}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            fitView
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
