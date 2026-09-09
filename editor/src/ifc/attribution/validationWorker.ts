import type { NativeIfcDocument } from "../nativeDocument";
import type { IdsDocumentModel, IdsValidationSummary } from "../ids";
import type { PortalCheckResult } from "./portalCheck";
import type { FachmodellSchema, Importart } from "./schema";

export interface AttributionValidationRequest {
  id: number;
  document: NativeIfcDocument;
  models: NativeIfcDocument[];
  importart: Importart;
  schema: FachmodellSchema;
  idsModel: IdsDocumentModel | null;
}
export type AttributionValidationResponse = { id: number; check: PortalCheckResult; ids: IdsValidationSummary | null } | { id: number; error: string };
