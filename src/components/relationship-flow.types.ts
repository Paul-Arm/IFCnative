export interface FlowPoint {
  x: number;
  y: number;
}

export type RelationshipFlowLayoutMode = "columns" | "tension";

export interface RelationshipFlowMove {
  id: number;
  point: FlowPoint;
}

export interface RelationshipFlowClipboardNode {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
}

export interface RelationshipFlowPropertySet {
  id: number;
  kind: string;
  name: string;
  values: Array<{
    id: number;
    name: string;
    type: string;
    value: string;
  }>;
}

export interface RelationshipFlowEmbeddedResource {
  id: number;
  kind: "Material" | "Klassifikation" | "Dokument";
  name: string;
  type: string;
}

export interface RelationshipFlowNode {
  childCount: number;
  childrenLoaded: boolean;
  entity: {
    description: string;
    globalId: string;
    id: number;
    name: string;
    type: string;
  };
  embeddedResources: RelationshipFlowEmbeddedResource[];
  id: number;
  pinned: boolean;
  propertySets: RelationshipFlowPropertySet[];
  searchMatch: boolean;
  selected: boolean;
  x: number;
  y: number;
}

export interface RelationshipFlowEdge {
  id: string;
  label: string;
  rel: number;
  relationshipType: string;
  source: number;
  target: number;
}

export interface RelationshipFlowOption {
  detail?: string;
  label: string;
  value: string;
}

export interface RelationshipFlowProps {
  capped: boolean;
  classOptions: RelationshipFlowOption[];
  depth: number;
  edges: RelationshipFlowEdge[];
  layoutMode: RelationshipFlowLayoutMode;
  nodes: RelationshipFlowNode[];
  preset: string;
  presetOptions: RelationshipFlowOption[];
  focusNodeId?: number | null;
  focusNonce?: number;
  relationshipOptions: RelationshipFlowOption[];
  relationshipTypeFilters: string[];
  search: string;
  searchActiveId: number | null;
  searchActiveIndex: number;
  searchMatchCount: number;
  onClearPositions(): void;
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
    position: FlowPoint,
  ): void;
  onDepth(depth: number): void;
  onLayoutMode(mode: RelationshipFlowLayoutMode): void;
  onLog(code: string): void;
  onRemoveNode(id: number): void;
  onRemoveRelationship(relationshipId: number): void;
  onRelationshipTypeFilters(filters: string[]): void;
  onMoveEnd(id: number, point: FlowPoint): void;
  onMoveNode(id: number, point: FlowPoint): void;
  onMoveNodes?(moves: RelationshipFlowMove[]): void;
  onMoveNodesEnd?(moves: RelationshipFlowMove[]): void;
  onPasteNodes(
    sourceId: number,
    relationshipType: string,
    nodes: RelationshipFlowClipboardNode[],
    connect: boolean,
  ): void;
  onPreset(preset: string): void;
  onSearchNavigate(direction: "previous" | "next"): void;
  onSelect(id: number): void;
  onToggleChildren(id: number, loaded: boolean): void;
  onTogglePin(id: number, point?: FlowPoint): void;
}
