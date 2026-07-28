/**
 * Knotendarstellung des Beziehungsgraphen: kompaktes Label, Anker und
 * ausgewählte bzw. gesuchte Knoten hervorgehoben.
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export type IfcNodeData = {
  label: string;
  /** Volles Label für den Tooltip */
  title: string;
  typeName: string;
  /** Ankerknoten der Nachbarschaft */
  anchor: boolean;
  /** Teil der aktuellen Auswahl */
  picked: boolean;
  /** Treffer der Suche */
  match: boolean;
};

export type IfcFlowNode = Node<IfcNodeData, "ifc">;

export default function GraphNode({ data }: NodeProps<IfcFlowNode>) {
  return (
    <div
      className="graph-node"
      title={data.title}
      data-anchor={data.anchor}
      data-picked={data.picked}
      data-match={data.match}
    >
      <Handle type="target" position={Position.Left} className="graph-handle" />
      <span className="graph-node-label">{data.label}</span>
      <Handle
        type="source"
        position={Position.Right}
        className="graph-handle"
      />
    </div>
  );
}
