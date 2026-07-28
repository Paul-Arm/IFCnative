/**
 * Zeichenfläche des Graph-Panes: React Flow mit den Interaktionen des Panes.
 * Der Container ist fokussierbar, damit Entf auf der Auswahl ankommt —
 * React Flows eigenes Löschen ist deaktiviert (`deleteKeyCode={null}`),
 * weil Löschen über die Command-Pipeline laufen muss.
 */
import type { KeyboardEvent } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnect,
  type OnNodeDrag,
  type OnNodesChange,
} from "@xyflow/react";
import GraphNode, { type IfcFlowNode } from "./GraphNode";

const NODE_TYPES: NodeTypes = { ifc: GraphNode };

export interface GraphCanvasProps {
  nodes: IfcFlowNode[];
  edges: Edge[];
  dark: boolean;
  onNodesChange: OnNodesChange<IfcFlowNode>;
  onNodeClick: NodeMouseHandler<IfcFlowNode>;
  onNodeDoubleClick: NodeMouseHandler<IfcFlowNode>;
  onNodeDragStop: OnNodeDrag<IfcFlowNode>;
  onEdgeClick: EdgeMouseHandler;
  onConnect: OnConnect;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>): void;
}

export default function GraphCanvas(props: GraphCanvasProps) {
  return (
    <div className="graph-flow" tabIndex={0} onKeyDown={props.onKeyDown}>
      <ReactFlow<IfcFlowNode>
        nodes={props.nodes}
        edges={props.edges}
        onNodesChange={props.onNodesChange}
        nodeTypes={NODE_TYPES}
        onNodeClick={props.onNodeClick}
        onNodeDoubleClick={props.onNodeDoubleClick}
        onNodeDragStop={props.onNodeDragStop}
        onEdgeClick={props.onEdgeClick}
        onConnect={props.onConnect}
        colorMode={props.dark ? "dark" : "light"}
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
  );
}
