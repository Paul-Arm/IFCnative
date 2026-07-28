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
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type NodeMouseHandler,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./graph.css";
import { useActiveDocument } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import { useUi } from "../../store/ui";
import { useCommands } from "../../commands/pipeline";
import type { IfcFlowNode } from "./GraphNode";
import GraphCanvas from "./GraphCanvas";
import GraphToolbar from "./GraphToolbar";
import CascadeDialog from "./CascadeDialog";
import RelationDialog from "./RelationDialog";
import { useGraphEditing } from "./useGraphEditing";
import { useEdgeSelection } from "./useEdgeSelection";
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
  const edgeSelection = useEdgeSelection(neighborhood, editing, lastSelected);
  const flowEdges = useMemo(
    () =>
      neighborhood
        ? toFlowEdges(neighborhood.edges, edgeSelection.selectedEdgeId)
        : [],
    [neighborhood, edgeSelection.selectedEdgeId],
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
        onDeleteRelation={edgeSelection.onDeleteRelation}
        canDeleteRelation={Boolean(edgeSelection.selectedEdge?.relId)}
        onDeleteEntity={edgeSelection.onDeleteEntity}
        canDeleteEntity={lastSelected !== null}
        status={status}
      />
      {!neighborhood ? (
        <p className="pane-empty">
          Objekt auswählen — der Graph zeigt die Nachbarschaft des zuletzt
          gewählten Objekts.
        </p>
      ) : (
        <GraphCanvas
          nodes={nodes}
          edges={flowEdges}
          dark={theme === "dark"}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeDragStop={onNodeDragStop}
          onEdgeClick={edgeSelection.onEdgeClick}
          onConnect={editing.onConnect}
          onKeyDown={edgeSelection.onKeyDown}
        />
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
