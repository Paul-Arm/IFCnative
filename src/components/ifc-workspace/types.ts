export type StructureMode = "tree" | "graph";

export type InspectorMode =
  | "info"
  | "edit"
  | "placement"
  | "psets"
  | "object-info"
  | "relations"
  | "resources"
  | "refs"
  | "units";

export type MosaicViewId =
  | "structure"
  | "viewer"
  | "inspector"
  | "builder"
  | "catalog"
  | "catalog-review"
  | "pset-batch"
  | "resource-references"
  | "resource-controls"
  | "object-info"
  | "diagnostics"
  | "recent"
  | "notes"
  | "portal"
  | "portal-settings";

export interface Point {
  x: number;
  y: number;
}

export interface EntityEditDraft {
  type: string;
  name: string;
  description: string;
  rawArgs: string;
}

export interface BodyElementDraft {
  type: string;
  name: string;
  parentId?: number;
  placementMode?: "parent" | "world";
  width: string;
  depth: string;
  height: string;
  profile?: "rectangle" | "cylinder";
  x: string;
  y: string;
  z: string;
  tag?: string;
}

export interface CoordinateClipboard {
  copiedAt: string;
  documentId?: string;
  entityId?: number;
  fileName?: string;
  localId?: number;
  modelId?: string;
  source: "thatopen" | "system";
  x: string;
  y: string;
  z: string;
}

export type ParsedCoordinates = Pick<CoordinateClipboard, "x" | "y" | "z"> &
  Partial<
    Pick<
      CoordinateClipboard,
      "documentId" | "entityId" | "fileName" | "localId" | "modelId" | "source"
    >
  >;
