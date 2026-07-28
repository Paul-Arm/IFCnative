/**
 * Bauplan der bestätigungspflichtigen Massenänderungen: jede Funktion liefert
 * Vorschauzeilen UND den fertigen Command. Erst die Bestätigung im Dialog gibt
 * ihn an die Pipeline weiter — abgebrochene Vorschauen ändern nichts.
 *
 * Der Command wird bewusst schon hier gebaut: er sichert seinen Vorzustand im
 * Konstruktor, und zwischen Vorschau und Bestätigung liegt keine andere
 * Änderung (der Dialog ist modal).
 */
import { cmdSetPropertyOnMany } from "../../commands/propertyCommands";
import {
  cmdDeletePropertyOnMany,
  cmdSetCells,
} from "../../commands/batchCommands";
import type { EditorCommand } from "../../commands/pipeline";
import type { ModelSession } from "../../core/session";
import { parseDraft } from "../inspector/values";
import type { PreviewRow } from "./PreviewDialog";
import type { Matrix, MatrixRow } from "./matrix";
import { readCsvDiffs } from "./csv";

export interface Pending {
  title: string;
  note?: string;
  confirmLabel: string;
  rows: PreviewRow[];
  command: EditorCommand;
}

/** „Wert für alle setzen" — ein Undo-Schritt über die ganze Auswahl. */
export function setAllPreview(
  session: ModelSession,
  selection: readonly number[],
  matrix: Matrix,
  psetName: string,
  row: MatrixRow,
  draft: string,
): Pending | null {
  const parsed = parseDraft(draft, row.kind);
  if (!parsed.ok) return null;
  return {
    title: `${psetName}.${row.propName} für alle setzen`,
    confirmLabel: "Übernehmen",
    rows: matrix.columns.map((column, index) => ({
      key: String(column.expressId),
      object: column.title,
      before: row.cells[index]?.draft ?? "",
      after: draft,
    })),
    command: cmdSetPropertyOnMany(
      session,
      selection,
      psetName,
      row.propName,
      parsed.value,
      row.type,
    ),
  };
}

/** Zeile auf allen Objekten löschen, die sie überhaupt haben. */
export function deleteRowPreview(
  session: ModelSession,
  selectionSize: number,
  psetName: string,
  row: MatrixRow,
): Pending {
  const affected = row.cells.filter((cell) => cell.present);
  return {
    title: `${psetName}.${row.propName} überall löschen`,
    note: `Betrifft ${affected.length} von ${selectionSize} Objekten.`,
    confirmLabel: "Löschen",
    rows: affected.map((cell) => ({
      key: String(cell.expressId),
      object: session.labelOf(cell.expressId),
      before: cell.draft,
      after: "",
    })),
    command: cmdDeletePropertyOnMany(
      session,
      affected.map((cell) => cell.expressId),
      psetName,
      row.propName,
      row.type,
    ),
  };
}

/** CSV-Import: nur echte Diffs, angewandt als EIN Batch-Command. */
export function csvImportPreview(
  session: ModelSession,
  matrix: Matrix,
  fileName: string,
  content: string,
): Pending {
  const report = readCsvDiffs(session, matrix, content);
  const notes = [`${report.rowCount} Zeile(n) gelesen.`];
  if (report.unmatched > 0)
    notes.push(`${report.unmatched} ohne passende GlobalId.`);
  if (report.ignoredColumns.length > 0)
    notes.push(`Ignoriert: ${report.ignoredColumns.join(", ")}.`);
  return {
    title: `CSV-Import „${fileName}"`,
    note: notes.join(" "),
    confirmLabel: "Übernehmen",
    rows: report.diffs.map((diff, index) => ({
      key: String(index),
      object: diff.objectLabel,
      property: diff.property,
      before: diff.before,
      after: diff.after,
    })),
    command: cmdSetCells(
      session,
      report.diffs.map((diff) => diff.change),
      `CSV-Import: ${report.diffs.length} Werte aus „${fileName}"`,
    ),
  };
}
