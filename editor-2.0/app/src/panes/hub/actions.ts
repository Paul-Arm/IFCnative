/**
 * Aktionen der Hub-Pane, die Modell-Sitzung und Hub verbinden.
 *
 * Bewusst ohne React: die Pane ruft sie in try/catch auf und zeigt die
 * deutsche Meldung des Clients in ihrer Statuszeile.
 */
import { downloadVersion, createVersion } from "../../domain/hub/client";
import type { HubConfig, HubVersion } from "../../domain/hub/types";
import type { ModelSession } from "../../core/session";
import { documentNameFor } from "./format";

/** Autor, wenn in den Einstellungen keiner hinterlegt ist. */
const FALLBACK_AUTHOR = "IFCnative 2.0";

/**
 * „Stand sichern": das aktive Dokument über `exportStep()` (Mutationen
 * eingerechnet) als neue Version im Hub ablegen.
 */
export async function saveSessionAsVersion(
  config: HubConfig,
  projectId: string,
  modelId: string,
  session: ModelSession,
  message: string,
  author: string,
): Promise<HubVersion> {
  const bytes = session.exportStep();
  return createVersion(config, projectId, modelId, bytes, {
    message,
    author: author.trim() || FALLBACK_AUTHOR,
  });
}

/** „Stand öffnen": Bytes holen und als neuen Tab in die Dokumente hängen. */
export async function openVersionAsDocument(
  config: HubConfig,
  projectId: string,
  modelId: string,
  modelName: string,
  version: HubVersion,
  open: (fileName: string, buffer: ArrayBuffer) => Promise<void>,
): Promise<string> {
  const buffer = await downloadVersion(config, projectId, modelId, version.id);
  const fileName = documentNameFor(modelName, version);
  await open(fileName, buffer);
  return fileName;
}

/**
 * GlobalId eines Diff-Eintrags im aktiven Dokument auflösen.
 *
 * Nur über `store.entities.getGlobalIdMap()` — die `expressId` aus dem Diff
 * gehört zum Stand im Hub und würde im lokalen Modell auf ein beliebiges
 * anderes Objekt zeigen. `getGlobalIdMap()` wird abgesichert aufgerufen, wie
 * in `domain/checks/sources/diagnostics.ts`.
 */
export function expressIdForGlobalId(
  session: ModelSession,
  globalId: string,
): number | null {
  try {
    return session.store.entities.getGlobalIdMap().get(globalId) ?? null;
  } catch {
    return null;
  }
}
