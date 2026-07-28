/**
 * CSV-Roundtrip der Batch-Matrix.
 *
 * API-Entscheidung:
 *  - **Export: eigener Generator.** `CsvConnector` aus `@ifc-lite/mutations`
 *    kann nur lesen (`parse`/`match`/`import`); eine Serialisierung gibt es
 *    dort nicht. Das Format ist bewusst deutsch-Excel-tauglich: UTF-8-BOM,
 *    Semikolon als Trenner, `""` als Maskierung von Anführungszeichen.
 *  - **Import: `CsvConnector.parse()` wird real genutzt** — es behandelt
 *    zitierte Felder und den frei wählbaren Trenner. Nicht genutzt werden
 *    `match()`/`import()`: `import()` schreibt direkt ins Overlay und liefe
 *    damit an der Command-Pipeline (und am Undo) vorbei, und das Matching soll
 *    laut Vorgabe über `store.entities.getGlobalIdMap()` laufen. Aus den
 *    geparsten Zeilen werden deshalb hier nur echte Diffs berechnet, die der
 *    Aufrufer als EIN Batch-Command anwendet.
 */
import { CsvConnector } from "@ifc-lite/mutations";
import { PropertyValueType } from "@ifc-lite/data";
import type { ModelSession } from "../../core/session";
import type { CellChange } from "../../commands/batchCommands";
import { parseDraft, toDraft, kindOf } from "../inspector/values";
import { typeIndex, type Matrix } from "./matrix";

export const CSV_DELIMITER = ";";
const BOM = "﻿";
const ID_COLUMN = "GlobalId";
const NAME_COLUMN = "Name";

function escape(text: string): string {
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Matrix als CSV (Spalten: GlobalId, Name, dann „Pset.Property"). */
export function matrixToCsv(matrix: Matrix): string {
  const valueColumns: Array<{ header: string; values: Map<number, string> }> =
    [];
  for (const block of matrix.blocks) {
    for (const row of block.rows) {
      const values = new Map<number, string>();
      for (const cell of row.cells) {
        if (cell.present) values.set(cell.expressId, cell.draft);
      }
      valueColumns.push({ header: `${block.psetName}.${row.propName}`, values });
    }
  }

  const lines: string[] = [
    [ID_COLUMN, NAME_COLUMN, ...valueColumns.map((c) => c.header)]
      .map(escape)
      .join(CSV_DELIMITER),
  ];
  for (const column of matrix.columns) {
    const cells = [
      column.globalId,
      column.name,
      ...valueColumns.map((c) => c.values.get(column.expressId) ?? ""),
    ];
    lines.push(cells.map(escape).join(CSV_DELIMITER));
  }
  return BOM + lines.join("\r\n") + "\r\n";
}

/** Dateiname des Exports — Modellname plus Zeitstempel-freier Suffix. */
export function csvFileName(session: ModelSession): string {
  return `${session.fileName.replace(/\.ifc(zip|x)?$/i, "")}.psets.csv`;
}

export interface ImportDiff {
  change: CellChange;
  /** Anzeigetexte für den Vorschau-Dialog. */
  objectLabel: string;
  property: string;
  before: string;
  after: string;
}

export interface ImportReport {
  diffs: ImportDiff[];
  rowCount: number;
  /** Zeilen ohne passende GlobalId im Modell. */
  unmatched: number;
  /** Spaltenköpfe, die nicht dem Muster „Pset.Property" folgen. */
  ignoredColumns: string[];
}

/**
 * CSV gegen den aktuellen Modellstand halten und die echten Unterschiede
 * berechnen. Zeilen ohne bekannte GlobalId und unveränderte Zellen fallen raus.
 */
export function readCsvDiffs(
  session: ModelSession,
  matrix: Matrix,
  content: string,
): ImportReport {
  const connector = new CsvConnector(session.store.entities, session.view);
  // Der Parser von ifc-lite kennt keine BOM — sie würde sonst im ersten
  // Spaltenkopf landen und das GlobalId-Matching aushebeln.
  const rows = connector.parse(content.replace(/^﻿/, ""), {
    delimiter: CSV_DELIMITER,
  });

  const globalIds = session.store.entities.getGlobalIdMap();
  const types = typeIndex(matrix);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const ignoredColumns: string[] = [];
  const valueColumns: Array<{
    header: string;
    psetName: string;
    propName: string;
  }> = [];
  for (const header of headers) {
    if (header === ID_COLUMN || header === NAME_COLUMN) continue;
    const separator = header.indexOf(".");
    if (separator <= 0 || separator === header.length - 1) {
      ignoredColumns.push(header);
      continue;
    }
    valueColumns.push({
      header,
      psetName: header.slice(0, separator),
      propName: header.slice(separator + 1),
    });
  }

  const diffs: ImportDiff[] = [];
  let unmatched = 0;
  for (const row of rows) {
    const globalId = (row[ID_COLUMN] ?? "").trim();
    const expressId = globalId ? globalIds.get(globalId) : undefined;
    if (expressId === undefined) {
      unmatched += 1;
      continue;
    }
    const objectLabel = session.labelOf(expressId);
    for (const column of valueColumns) {
      const raw = (row[column.header] ?? "").trim();
      if (!raw) continue; // Leerzelle = „nicht anfassen", kein Löschbefehl.
      const valueType =
        types.get(`${column.psetName}.${column.propName}`) ??
        PropertyValueType.Label;
      const kind = kindOf(valueType);
      const parsed = parseDraft(raw, kind);
      if (!parsed.ok) continue; // Ungültig für den Typ — Zeile überspringen.
      const current = session.view.getPropertyValue(
        expressId,
        column.psetName,
        column.propName,
      );
      const before = toDraft(current);
      const after = toDraft(parsed.value);
      if (before === after) continue;
      diffs.push({
        change: {
          expressId,
          psetName: column.psetName,
          propName: column.propName,
          value: parsed.value,
          valueType,
        },
        objectLabel,
        property: `${column.psetName}.${column.propName}`,
        before,
        after,
      });
    }
  }

  return { diffs, rowCount: rows.length, unmatched, ignoredColumns };
}

/** CSV als Datei anbieten (Browser-Download; Tauri nutzt denselben Pfad). */
export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
