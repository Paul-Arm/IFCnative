/**
 * Validierungslauf des IDS-Fensters.
 *
 * Bewusst KEINE eigene Maschinerie: Dokumente kommen aus dem app-weiten Store
 * `useIdsDocuments`, der Sitzungszugriff aus `sessionAccessor` (beide in
 * `domain/checks/idsSource.ts`) und die Prüfung selbst aus `validateIDS`.
 * Der Unterschied zum Prüfzentrum liegt allein in der Auswertung: dort wird
 * der Bericht zu einer flachen Befundliste, hier bleibt er als Baum erhalten
 * (siehe `model.ts`).
 */
import { createTranslationService, validateIDS } from "@ifc-lite/ids";

import type { ModelSession } from "../../core/session";
import { sessionAccessor, type IdsEntry } from "../../domain/checks/idsSource";
import { documentRow, runTotals, type IdsDocRow, type IdsRunResult } from "./model";

/** Deutsche Meldungen — dieselbe Sprache wie im Prüfzentrum. */
const translator = createTranslationService("de");

/**
 * Alle geladenen IDS-Dokumente gegen die Sitzung prüfen. Der Accessor wird
 * einmal gebaut und für alle Dokumente wiederverwendet — er cached das
 * Sitzungs-Delta je Objekt.
 */
export async function runIdsValidation(
  session: ModelSession,
  entries: readonly IdsEntry[],
  revision: number,
): Promise<IdsRunResult> {
  const started = Date.now();
  const accessor = sessionAccessor(session);
  const modelInfo = {
    modelId: session.fileName,
    schemaVersion: session.store.schemaVersion ?? "IFC4",
    entityCount: session.store.entityCount,
  };
  const labelOf = (expressId: number): string => session.labelOf(expressId);

  const documents: IdsDocRow[] = [];
  for (const entry of entries) {
    const report = await validateIDS(entry.document, accessor, modelInfo, {
      translator,
    });
    documents.push(documentRow(report, entry.id, entry.name, labelOf));
  }

  return {
    documents,
    totals: runTotals(documents),
    ranAtRevision: revision,
    durationMs: Date.now() - started,
  };
}
