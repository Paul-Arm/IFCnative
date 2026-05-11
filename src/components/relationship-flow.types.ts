export interface FlowPoint {
  x: number;
  y: number;
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
  id: number;
  pinned: boolean;
  selected: boolean;
  x: number;
  y: number;
}

export interface RelationshipFlowEdge {
  id: string;
  label: string;
  rel: number;
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
  nodes: RelationshipFlowNode[];
  preset: string;
  presetOptions: RelationshipFlowOption[];
  relationshipOptions: RelationshipFlowOption[];
  relationshipCount: number;
  relationshipTypeFilters: string[];
  relationshipTypes: string[];
  onClearPositions(): void;
  onConnectNodes(sourceId: number, targetId: number, relationshipType: string): void;
  onCreateNodeFromConnection(
    sourceId: number,
    type: string,
    name: string,
    relationshipType: string,
    position: FlowPoint,
  ): void;
  onDepth(depth: number): void;
  onLog(code: string): void;
  onRelationshipTypeFilters(filters: string[]): void;
  onMoveEnd(id: number, point: FlowPoint): void;
  onMoveNode(id: number, point: FlowPoint): void;
  onPreset(preset: string): void;
  onSelect(id: number): void;
  onToggleChildren(id: number, loaded: boolean): void;
  onTogglePin(id: number): void;
}
