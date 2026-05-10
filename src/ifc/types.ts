export type IfcDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface IfcDiagnostic {
  code: string;
  message: string;
  severity: IfcDiagnosticSeverity;
  expressID?: number;
}

export interface StepHeaderSummary {
  schema?: string;
  fileName?: string;
  timestamp?: string;
  authors: string[];
  organizations: string[];
  originatingSystem?: string;
  preprocessorVersion?: string;
  authorization?: string;
  descriptions: string[];
}

export interface StepPreflightResult {
  valid: boolean;
  header: StepHeaderSummary;
  diagnostics: IfcDiagnostic[];
  hasIsoStart: boolean;
  hasHeaderSection: boolean;
  hasDataSection: boolean;
  hasIsoEnd: boolean;
}

export interface IfcEntitySummary {
  expressID: number;
  typeCode: number;
  typeName: string;
  globalId?: string;
  name?: string;
  description?: string;
}

export interface IfcRelationshipLink {
  relationshipID: number;
  relationshipType: string;
  relatingID?: number;
  relatedIDs: number[];
}

export interface IfcTreeNode {
  expressID: number;
  label: string;
  typeName: string;
  relationship?: string;
  children: IfcTreeNode[];
}

export interface IfcGraphIndex {
  byExpressID: Map<number, IfcEntitySummary>;
  byGlobalId: Map<string, IfcEntitySummary>;
  entityCounts: { typeName: string; typeCode: number; count: number }[];
  spatialTree: IfcTreeNode[];
  containmentTree: IfcTreeNode[];
  typeAssignments: Map<number, number[]>;
  typeByOccurrence: Map<number, number>;
  groupAssignments: Map<number, number[]>;
  materialByObject: Map<number, number[]>;
  classificationByObject: Map<number, number[]>;
  documentByObject: Map<number, number[]>;
  relationships: IfcRelationshipLink[];
  diagnostics: IfcDiagnostic[];
}

export interface IfcPropertyValue {
  name: string;
  value: string;
  valueType?: string;
  unit?: string;
}

export interface IfcPropertySetSummary {
  expressID: number;
  name: string;
  typeName: string;
  values: IfcPropertyValue[];
}

export interface IfcPropertyIndex {
  byObject: Map<number, IfcPropertySetSummary[]>;
  byType: Map<number, IfcPropertySetSummary[]>;
  units: { expressID: number; label: string }[];
  materials: Map<number, string[]>;
  classifications: Map<number, string[]>;
  documents: Map<number, string[]>;
  diagnostics: IfcDiagnostic[];
}

export interface IfcGeometryPiece {
  expressID: number;
  typeName: string;
  geometryExpressID: number;
  color: [number, number, number, number];
  matrix: number[];
  positions: Float32Array;
  normals?: Float32Array;
  indices: Uint32Array;
}

export interface IfcGeometryIndex {
  pieces: IfcGeometryPiece[];
  byExpressID: Map<number, IfcGeometryPiece[]>;
  typeCounts: { typeName: string; count: number }[];
  bounds?: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
    radius: number;
  };
  diagnostics: IfcDiagnostic[];
}

export interface IfcModelSession {
  api: import('web-ifc').IfcAPI;
  modelID: number;
  filename: string;
  size: number;
  schema?: string;
  header: StepHeaderSummary;
  preflight: StepPreflightResult;
  graph: IfcGraphIndex;
  properties: IfcPropertyIndex;
  geometry?: IfcGeometryIndex;
  diagnostics: IfcDiagnostic[];
  save(): Uint8Array;
  close(): void;
}
