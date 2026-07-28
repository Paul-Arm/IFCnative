/**
 * BCF-Export der aktuellen Fehlschläge (M5).
 *
 * Real genutzte Paket-APIs (@ifc-lite/bcf 1.16.3):
 *  - `createBCFProject({ name, version })` → BCFProject (Standard 2.1)
 *  - `createBCFTopic({ title, description, author, topicType, priority })`
 *  - `addTopicToProject` / `addViewpointToTopic`
 *  - `generateUuid()` (aus @ifc-lite/encoding, re-exportiert) für Viewpoint-GUIDs
 *  - `writeBCF(project)` → Blob (.bcfzip-Archiv)
 *
 * Je Befund entsteht ein Topic: Titel = Meldung, Beschreibung = Detail +
 * Quelle, betroffene Objekte als Viewpoint-Auswahl mit ihren IFC-GlobalIds
 * (`store.entities.getGlobalId`). Einen Kamerastandpunkt schreiben wir NICHT
 * mit — die Pane kennt den Viewer-Zustand nicht, und ein erfundener Standpunkt
 * wäre schlechter als keiner. Der Viewpoint trägt daher nur die Auswahl.
 */
import {
  addTopicToProject,
  addViewpointToTopic,
  createBCFProject,
  createBCFTopic,
  generateUuid,
  writeBCF,
  type BCFComponent,
  type BCFViewpoint,
} from "@ifc-lite/bcf";

import type { ModelSession } from "../../core/session";
import { SEVERITY_LABELS, SOURCE_LABELS, type CheckFinding } from "./types";

/** Dateiname des Downloads (Endung laut Paket: .bcfzip-Archiv). */
export const BCF_FILE_NAME = "pruefung.bcfzip";

/** BCF-Priorität je Schweregrad. */
const PRIORITY: Record<CheckFinding["severity"], string> = {
  error: "High",
  warning: "Normal",
  info: "Low",
};

const TOPIC_TYPE: Record<CheckFinding["severity"], string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

/** GlobalIds der betroffenen Objekte (leere Ids fallen heraus). */
function globalIdsOf(session: ModelSession, entityIds: readonly number[]): string[] {
  const ids: string[] = [];
  for (const entityId of entityIds) {
    const globalId = session.store.entities.getGlobalId(entityId);
    if (globalId) ids.push(globalId);
  }
  return ids;
}

function describe(session: ModelSession, finding: CheckFinding): string {
  const objects = finding.entityIds
    .slice(0, 20)
    .map((id) => `#${id} ${session.labelOf(id)}`.trim());
  return [
    finding.detail ?? "",
    `Quelle: ${SOURCE_LABELS[finding.source]} · Schweregrad: ${SEVERITY_LABELS[finding.severity]}`,
    objects.length > 0 ? `Betroffene Objekte: ${objects.join(", ")}` : "",
    finding.entityIds.length > objects.length
      ? `… und ${finding.entityIds.length - objects.length} weitere`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Findings → BCF-Archiv (Blob). */
export async function buildBcf(
  session: ModelSession,
  findings: readonly CheckFinding[],
): Promise<Blob> {
  const project = createBCFProject({
    name: `Prüfung ${session.fileName}`,
    version: "2.1",
  });
  for (const finding of findings) {
    const topic = createBCFTopic({
      title: finding.message,
      description: describe(session, finding),
      author: "IFCnative Editor 2.0",
      topicType: TOPIC_TYPE[finding.severity],
      topicStatus: "Open",
      priority: PRIORITY[finding.severity],
      labels: [SOURCE_LABELS[finding.source], finding.kind],
    });
    const selection: BCFComponent[] = globalIdsOf(session, finding.entityIds).map(
      (ifcGuid) => ({ ifcGuid, originatingSystem: "IFCnative Editor 2.0" }),
    );
    if (selection.length > 0) {
      const viewpoint: BCFViewpoint = {
        guid: generateUuid(),
        components: { selection },
      };
      addViewpointToTopic(topic, viewpoint);
    }
    addTopicToProject(project, topic);
  }
  return writeBCF(project);
}

/** Archiv erzeugen und im Browser herunterladen. */
export async function exportFindingsAsBcf(
  session: ModelSession,
  findings: readonly CheckFinding[],
): Promise<void> {
  const blob = await buildBcf(session, findings);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = BCF_FILE_NAME;
  anchor.click();
  URL.revokeObjectURL(url);
}
