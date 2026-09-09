import { validateIds } from "../ids";
import { runPortalCheck } from "./portalCheck";
import { setActiveSchema } from "./schema";
import type { AttributionValidationRequest, AttributionValidationResponse } from "./validationWorker";

self.onmessage = (event: MessageEvent<AttributionValidationRequest>) => {
  const request = event.data;
  try {
    setActiveSchema(request.schema);
    const check = runPortalCheck(request.document, { importart: request.importart, bauwerksmodelle: request.models });
    const ids = request.idsModel ? validateIds(request.document, request.idsModel) : null;
    self.postMessage({ id: request.id, check, ids } satisfies AttributionValidationResponse);
  } catch (error) {
    self.postMessage({ id: request.id, error: String(error) } satisfies AttributionValidationResponse);
  }
};
