export type StructureMode = "tree" | "graph";

export type InspectorMode =
  | "info"
  | "edit"
  | "placement"
  | "psets"
  | "relations"
  | "resources"
  | "refs"
  | "units";

export type MosaicViewId =
  | "structure"
  | "viewer"
  | "inspector"
  | "builder"
  | "diff"
  | "console"
  | "diagnostics";

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
  entityId?: number;
  localId?: number;
  source: "thatopen" | "system";
  x: string;
  y: string;
  z: string;
}

export type ParsedCoordinates = Pick<CoordinateClipboard, "x" | "y" | "z">;
