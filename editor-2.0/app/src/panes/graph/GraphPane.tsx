/**
 * Beziehungsgraph-Pane (M1 lesend, M2 bearbeitend).
 *
 * Anker ist das zuletzt ausgewählte Objekt; von dort wird die Nachbarschaft
 * per Breitensuche über den RelationshipGraph aufgebaut, nach Beziehungsart
 * gefiltert und in einem Ebenen-Layout dargestellt.
 *
 * Bearbeiten (M2): zwei Knoten verbinden legt nach Auswahl der Beziehungsart
 * eine neue IfcRel*-Instanz an, ausgewählte Kanten und Objekte lassen sich
 * mit Entf löschen. Jede Änderung läuft durch die Command-Pipeline; der
 * Graph wird danach über die Revision der Historie neu aufgebaut.
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
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./graph.css";
import { useActiveDocument } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import { useUi } from "../../store/ui";
import { useCommands } from "../../commands/pipeline";
import GraphNode, { type IfcFlowNode } from "./GraphNode";
import GraphToolbar from "./GraphToolbar";
import CascadeDialog from "./CascadeDialog";
import RelationDialog from "./RelationDialog";
import { useGraphEditing } from "./useGraphEditing";
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
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const fromGraph = useRef(false);

  // Jede ausgeführte, rückgängig gemachte oder wiederholte Operation erhöht
  // die Revision — Store und Overlay ändern sich außerhalb von React.
  const revision = useCommands(
    (s) => s.byDocument[docId ?? ""]?.audit.length ?? 0,
  );
  const editing = useGraphEditing(docId, doc?.session ?? null);

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
    revision,
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
    () => (neighborhood ? toFlowEdges(neighborhood.edges, selectedEdgeId) : []),
    [neighborhood, selectedEdgeId],
  );

  const selectedEdge = useMemo(
    () => neighborhood?.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [neighborhood, selectedEdgeId],
  );

  // Kantenauswahl gilt nur für die aktuell dargestellte Nachbarschaft.
  useEffect(() => {
    setSelectedEdgeId(null);
  }, [neighborhood]);

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

  const onEdgeClick = useCallback<EdgeMouseHandler>((_event, edge) => {
    setSelectedEdgeId((current) => (current === edge.id ? null : edge.id));
  }, []);

  const onDeleteRelation = useCallback(() => {
    if (!selectedEdge?.relId) return;
    editing.deleteRelation(
      selectedEdge.relId,
      `${selectedEdge.label} #${selectedEdge.source} → #${selectedEdge.target}`,
    );
    setSelectedEdgeId(null);
  }, [selectedEdge, editing]);

  const onDeleteSelection = useCallback(() => {
    if (lastSelected === null) return;
    editing.requestRemoval(lastSelected);
  }, [lastSelected, editing]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedEdge) {
        event.preventDefault();
        onDeleteRelation();
      } else if (lastSelected !== null) {
        event.preventDefault();
        onDeleteSelection();
      }
    },
    [selectedEdge, lastSelected, onDeleteRelation, onDeleteSelection],
  );

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
        onDeleteRelation={onDeleteRelation}
        canDeleteRelation={Boolean(selectedEdge?.relId)}
        onDeleteEntity={onDeleteSelection}
        canDeleteEntity={lastSelected !== null}
        status={status}
      />
      {!neighborhood ? (
        <p className="pane-empty">
          Objekt auswählen — der Graph zeigt die Nachbarschaft des zuletzt
          gewählten Objekts.
        </p>
      ) : (
        <div className="graph-flow" tabIndex={0} onKeyDown={onKeyDown}>
          <ReactFlow<IfcFlowNode>
            nodes={nodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            nodeTypes={NODE_TYPES}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeDragStop={onNodeDragStop}
            onEdgeClick={onEdgeClick}
            onConnect={editing.onConnect}
            colorMode={theme === "dark" ? "dark" : "light"}
            nodesConnectable
            edgesReconnectable={false}
            elementsSelectable
            deleteKeyCode={null}
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

      {editing.connect && (
        <RelationDialog
          pending={editing.connect}
          onConfirm={editing.confirmConnect}
          onCancel={editing.cancelConnect}
        />
      )}
      {editing.removal && (
        <CascadeDialog
          pending={editing.removal}
          onConfirm={editing.confirmRemoval}
          onCancel={editing.cancelRemoval}
        />
      )}
    </div>
  );
}
