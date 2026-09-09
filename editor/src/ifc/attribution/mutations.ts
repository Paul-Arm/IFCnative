import type { NativeIfcDocument } from "../nativeDocument";

/** Ergebnis einer Änderung; mit `createdEntityIds`/`movedEntityIds`, wenn 3D-Objekte entstanden oder verschoben sind (Viewer lädt sie nach). */
export interface MutationEffects {
  document: NativeIfcDocument;
  createdEntityIds?: number[];
  movedEntityIds?: number[];
}
export type MutationResult = NativeIfcDocument | MutationEffects;
export type DocumentMutation = (document: NativeIfcDocument) => MutationResult;

export function unwrapMutation(result: MutationResult): Required<MutationEffects> {
  if ("entityById" in result) return { document: result, createdEntityIds: [], movedEntityIds: [] };
  return { document: result.document, createdEntityIds: result.createdEntityIds ?? [], movedEntityIds: result.movedEntityIds ?? [] };
}

