/**
 * Ausliefern eines Exportergebnisses (M7).
 *
 * Im Tauri-Kontext übernimmt der native Speichern-Dialog, im Browser bleibt
 * der Blob-Download — genau die Reihenfolge, die der Exportieren-Knopf schon
 * für IFC benutzt hat, jetzt für alle Formate an einer Stelle.
 */
import { saveViaDialog } from "../../core/tauri";
import type { ExportArtifact } from "./formats";

export async function deliverArtifact(
  artifact: ExportArtifact,
): Promise<void> {
  if (await saveViaDialog(artifact.fileName, artifact.bytes)) return;
  const url = URL.createObjectURL(
    new Blob([artifact.bytes as BlobPart], { type: artifact.mime }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
