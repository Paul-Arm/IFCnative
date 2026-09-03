import type { NativeBodyProfile } from "@/ifc";

export type StructureMode = "tree" | "graph" | "groups";

export type InspectorMode =
  | "overview"
  | "properties"
  | "placement"
  | "relations";

export type MosaicViewId =
  | "structure"
  | "viewer"
  | "inspector"
  | "builder"
  | "catalog"
  | "catalog-review"
  | "attribution"
  | "pset-batch"
  | "resource-references"
  | "resource-controls"
  | "check"
  | "diagnostics"
  | "recent"
  | "notes"
  | "portal"
  | "vcs";

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
  /** Platzierungskette dieses Elements erben (kleine lokale Koordinaten). */
  placementRelativeToId?: number;
  width: string;
  depth: string;
  height: string;
  profile?: NativeBodyProfile;
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
