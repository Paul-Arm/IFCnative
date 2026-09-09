import { useEffect, useRef, useState } from "react";
import type { NativeIfcDocument } from "../../ifc/nativeDocument";
import { portalIdsFor } from "../../ifc/attribution/idsBundle";
import { activeSchema, type Importart } from "../../ifc/attribution/schema";
import type { AttributionValidationRequest, AttributionValidationResponse } from "../../ifc/attribution/validationWorker";

export function useAttributionValidation(document: NativeIfcDocument, models: NativeIfcDocument[], importart: Importart, schemaRevision: number) {
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const [result, setResult] = useState<{ key: object; response: AttributionValidationResponse } | null>(null);
  // References to the derived indexes survive pure geometry changes.
  const keyRef = useRef<{ document: NativeIfcDocument; models: NativeIfcDocument[]; importart: Importart; schemaRevision: number } | null>(null);
  const previous = keyRef.current;
  if (!previous || previous.document.propertySetsByEntity !== document.propertySetsByEntity ||
      previous.document.relationships !== document.relationships || previous.models !== models ||
      previous.importart !== importart || previous.schemaRevision !== schemaRevision) {
    keyRef.current = { document, models, importart, schemaRevision };
  }
  const key = keyRef.current!;
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; }, []);
  useEffect(() => {
    const id = ++requestId.current;
    // Debounce rapid edits before cloning the document into the worker.
    const timer = setTimeout(() => {
      try {
        worker.current ??= new Worker(new URL("../../ifc/attribution/validation.worker.ts", import.meta.url), { type: "module", name: "ifcnative-validation" });
        const current = worker.current;
        current.onmessage = (event: MessageEvent<AttributionValidationResponse>) => {
          if (event.data.id === requestId.current) setResult({ key, response: event.data });
        };
        current.onerror = (event) => {
          if (id === requestId.current) setResult({ key, response: { id, error: event.message || "Prüfung fehlgeschlagen." } });
          current.terminate();
          if (worker.current === current) worker.current = null;
        };
        current.postMessage({ id, document: key.document, models: key.models, importart: key.importart, schema: activeSchema(), idsModel: portalIdsFor(key.importart) } satisfies AttributionValidationRequest);
      } catch (error) { setResult({ key, response: { id, error: String(error) } }); }
    }, 150);
    return () => { clearTimeout(timer); requestId.current++; };
  }, [key]);
  const response = result?.response;
  return {
    pending: result?.key !== key,
    error: result?.key === key && response && "error" in response ? response.error : null,
    check: result?.key === key && response && "check" in response ? response.check : null,
    ids: result?.key === key && response && "ids" in response ? response.ids : null,
  };
}
