/**
 * Reine Tabellen-Hilfen für das Listen-Pane: Spaltenbau, Beschriftung,
 * Zahlenformat, Gruppen-/Zeilen-Reihenfolge und CSV-Download.
 *
 * CSV: `listResultToCSV` des Pakets erzeugt den Text inklusive
 * Formel-Injection-Schutz (führendes `=`, `+`, `-`, `@`, Tab wird gequotet).
 * Als Trennzeichen nutzen wir das Semikolon — die API erlaubt es als zweiten
 * Parameter, und deutsches Excel öffnet damit ohne Import-Assistent. Die
 * UTF-8-BOM davor sorgt dafür, dass Umlaute in Excel korrekt ankommen.
 */
import {
  groupPathKey,
  groupingColumnIds,
  listResultToCSV,
  type CellValue,
  type ColumnDefinition,
  type ListDefinition,
  type ListGroup,
  type ListGrouping,
  type ListResult,
  type ListRow,
} from "@ifc-lite/lists";

/** Ersatzbezeichnung des Motors für leere Gruppenwerte. */
const NO_VALUE = "(none)";

const NUMBER_FORMAT = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 3,
});

/** Sichtbare Spaltenüberschrift: Label, sonst „Pset.Property". */
export function columnLabel(column: ColumnDefinition): string {
  if (column.label) return column.label;
  return column.psetName
    ? `${column.psetName}.${column.propertyName}`
    : column.propertyName;
}

export function formatNumber(value: number): string {
  return Number.isFinite(value) ? NUMBER_FORMAT.format(value) : "";
}

export function formatCell(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  return value;
}

export function groupLabel(label: string): string {
  return label === NO_VALUE ? "(ohne Wert)" : label;
}

/** Spalten-Fabriken — IDs folgen der Konvention der Paket-Presets. */
function slug(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

export function attributeColumn(name: string): ColumnDefinition {
  return { id: `attr-${slug(name)}`, source: "attribute", propertyName: name };
}

export function propertyColumn(
  psetName: string,
  propertyName: string,
): ColumnDefinition {
  return {
    id: slug(`prop-${psetName}-${propertyName}`),
    source: "property",
    psetName,
    propertyName,
    label: propertyName,
  };
}

export function quantityColumn(
  qsetName: string,
  quantityName: string,
): ColumnDefinition {
  return {
    id: slug(`quant-${qsetName}-${quantityName}`),
    source: "quantity",
    psetName: qsetName,
    propertyName: quantityName,
    label: quantityName,
  };
}

/** Klick auf den Spaltenkopf: auf → ab → aus. */
export function nextSort(
  current: ListDefinition["sortBy"],
  columnId: string,
): ListDefinition["sortBy"] {
  if (current?.columnId !== columnId) return { columnId, direction: "asc" };
  if (current.direction === "asc") return { columnId, direction: "desc" };
  return undefined;
}

export function sortMarker(
  sortBy: ListDefinition["sortBy"],
  columnId: string,
): string {
  if (sortBy?.columnId !== columnId) return "";
  return sortBy.direction === "asc" ? " ▲" : " ▼";
}

/** Spalten, die mindestens einen Zahlenwert liefern — nur die werden summiert. */
export function numericColumnIds(result: ListResult): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of result.rows) {
    for (let i = 0; i < result.columns.length; i++) {
      if (typeof row.values[i] === "number") ids.add(result.columns[i].id);
    }
    if (ids.size === result.columns.length) break;
  }
  return ids;
}

export type DisplayLine =
  | { kind: "group"; group: ListGroup }
  | { kind: "row"; row: ListRow };

export interface DisplayLines {
  lines: DisplayLine[];
  /** Tatsächlich gerenderte Datenzeilen (durch `maxRows` begrenzt). */
  shown: number;
}

function bucketKey(
  row: ListRow,
  indices: readonly number[],
): string {
  const path = indices.map((index) => {
    const raw = index >= 0 ? row.values[index] : null;
    return raw === null || raw === undefined || raw === "" ? NO_VALUE : String(raw);
  });
  return groupPathKey(path);
}

/**
 * Anzeigereihenfolge: ohne Gruppierung die (bereits sortierten) Zeilen, mit
 * Gruppierung die flache Pre-Order-Liste des Motors, wobei die Zeilen jeweils
 * hinter ihrer Blattgruppe stehen.
 */
export function buildDisplayLines(
  result: ListResult,
  grouping: ListGrouping | undefined,
  maxRows: number,
): DisplayLines {
  if (!result.groups || result.groups.length === 0) {
    const rows = result.rows.slice(0, maxRows);
    return {
      lines: rows.map((row) => ({ kind: "row", row })),
      shown: rows.length,
    };
  }

  const groupIds = groupingColumnIds(grouping).filter((id) =>
    result.columns.some((column) => column.id === id),
  );
  const indices =
    groupIds.length > 0
      ? groupIds.map((id) => result.columns.findIndex((c) => c.id === id))
      : [-1];
  const leafLevel = indices.length - 1;

  const rowsByKey = new Map<string, ListRow[]>();
  for (const row of result.rows) {
    const key = bucketKey(row, indices);
    const bucket = rowsByKey.get(key);
    if (bucket) bucket.push(row);
    else rowsByKey.set(key, [row]);
  }

  const lines: DisplayLine[] = [];
  let shown = 0;
  for (const group of result.groups) {
    lines.push({ kind: "group", group });
    if ((group.level ?? 0) !== leafLevel) continue;
    for (const row of rowsByKey.get(group.key) ?? []) {
      if (shown >= maxRows) break;
      lines.push({ kind: "row", row });
      shown++;
    }
  }
  return { lines, shown };
}

/** CSV des Pakets als „liste.csv" herunterladen (Semikolon + UTF-8-BOM). */
export function downloadListCsv(result: ListResult): void {
  const csv = listResultToCSV(result, ";");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "liste.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
