/**
 * Die IDS-Dateien des MKP-Portals, eingebettet als Text (Vite `?raw`), und
 * ihr Lauf über den vorhandenen IDS-Validator. Browser-only: parseIdsXml
 * braucht DOMParser.
 *
 * Quelle: mkp-portal packages/mkp-portal-diagnostics/docs/ids/*.ids und
 * packages/mkp-portal-structures/docs/ids/bauwerksmodell.ids (Stand 2026-08-28).
 */
import type { NativeIfcDocument } from "../nativeDocument";
import { parseIdsXml, validateIds, type IdsDocumentModel, type IdsValidationSummary } from "../ids";

import bauwerksmodellIds from "./ids/bauwerksmodell.ids?raw";
import ausfuehrungIds from "./ids/diagnostik-ausfuehrung.ids?raw";
import ergebnisseIds from "./ids/diagnostik-ergebnisse.ids?raw";
import planungIds from "./ids/diagnostik-planung.ids?raw";
import type { Importart } from "./schema";

const IDS_TEXT: Partial<Record<Importart, { fileName: string; text: string }>> = {
  bauwerksmodell: { fileName: "bauwerksmodell.ids", text: bauwerksmodellIds },
  planung: { fileName: "diagnostik-planung.ids", text: planungIds },
  einzelergebnisse: { fileName: "diagnostik-ausfuehrung.ids", text: ausfuehrungIds },
  ergebnisse: { fileName: "diagnostik-ergebnisse.ids", text: ergebnisseIds },
};

const cache = new Map<Importart, IdsDocumentModel>();

/** Geparste Portal-IDS für eine Importart; Monitoring hat keine. */
export function portalIdsFor(importart: Importart): IdsDocumentModel | null {
  const entry = IDS_TEXT[importart];
  if (!entry) return null;
  let model = cache.get(importart);
  if (!model) {
    model = parseIdsXml(entry.text, entry.fileName);
    cache.set(importart, model);
  }
  return model;
}

/** IDS-Lauf des Portals über ein Dokument; null, wenn die Importart keine IDS hat. */
export function runPortalIds(document: NativeIfcDocument, importart: Importart): IdsValidationSummary | null {
  const model = portalIdsFor(importart);
  return model ? validateIds(document, model) : null;
}
