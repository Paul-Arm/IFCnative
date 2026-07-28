/**
 * CSV-Bericht des IDS-Fensters.
 *
 * Format wie im übrigen Editor (`panes/pset-batch/csv.ts`): UTF-8-BOM,
 * Semikolon als Trenner, `""` als Maskierung — damit deutsches Excel die Datei
 * ohne Import-Assistent und mit korrekten Umlauten öffnet.
 *
 * Spalten: Spezifikation;Entity;GlobalId;Status;Detail. Die Spezifikation wird
 * mit dem IDS-Dokument qualifiziert („<Dokument>: <Spezifikation>"), weil
 * mehrere Dokumente gleichzeitig geladen sein dürfen und Spezifikationsnamen
 * darin nicht eindeutig sind.
 *
 * BCF wird hier bewusst NICHT angeboten — das kann das Prüfzentrum bereits.
 */
import {
  STATUS_LABELS,
  failureText,
  filterEntities,
  type IdsFilter,
  type IdsRunResult,
} from "./model";

const BOM = "\uFEFF";
const DELIMITER = ";";
const HEADER = ["Spezifikation", "Entity", "GlobalId", "Status", "Detail"];

function escape(text: string): string {
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Die Ergebnisse in der aktuell gefilterten Sicht als CSV-Text. Ohne Treffer
 * bleibt die Kopfzeile stehen, damit die Datei immer les- und importierbar ist.
 */
export function runResultToCsv(result: IdsRunResult, filter: IdsFilter): string {
  const lines: string[] = [HEADER.map(escape).join(DELIMITER)];
  for (const doc of result.documents) {
    for (const spec of doc.specs) {
      const specCell = `${doc.name}: ${spec.name}`;
      for (const entity of filterEntities(spec.entities, filter)) {
        const detail = entity.passed
          ? ""
          : entity.failures.map(failureText).join(" | ");
        lines.push(
          [
            specCell,
            entity.label,
            entity.globalId ?? "",
            STATUS_LABELS[entity.passed ? "pass" : "fail"],
            detail,
          ]
            .map(escape)
            .join(DELIMITER),
        );
      }
    }
  }
  return BOM + lines.join("\r\n") + "\r\n";
}

/** Dateiname des Berichts — Modellname plus fester Suffix. */
export function csvFileName(fileName: string): string {
  return `${fileName.replace(/\.ifc(zip|x)?$/i, "")}.ids-bericht.csv`;
}

export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
