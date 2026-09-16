export type Scalar = string | number | boolean | null;
export interface Property {
  name: string;
  type: string;
  value: Scalar;
  inherited: boolean;
}
export interface Element {
  id: string;
  modelId: string;
  name: string;
  ifcClass: string;
  globalId: string;
  properties: Property[];
}
export interface Snapshot {
  projectId: string;
  projectName: string;
  elements: Element[];
  loadedAt: string;
}
export interface Mapping {
  classProperty: string;
  guidProperty: string;
  separator: string;
}
export const DEFAULT_MAPPING: Mapping = {
  classProperty: 'IFC:Type', guidProperty: 'IFC:GlobalId', separator: ':',
};
export interface Finding {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  elementId?: string;
  elementName?: string;
  pset?: string;
  property?: string;
}
export interface Change {
  elementId: string;
  modelId: string;
  elementName: string;
  propertyName: string;
  type: string;
  before: Scalar;
  existed: boolean;
  after: Scalar;
}
export interface ApplyResult {
  applied: Change[];
  error?: string;
}
export interface Host {
  kind: 'vdc' | 'demo';
  load(mapping: Mapping, progress?: (done: number, total: number) => void): Promise<Snapshot>;
  selected(): Promise<string[]>;
  select(ids: string[]): Promise<void>;
  apply(snapshot: Snapshot, changes: Change[]): Promise<ApplyResult>;
}
