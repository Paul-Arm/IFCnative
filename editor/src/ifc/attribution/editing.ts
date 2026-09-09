import { childId } from "./recipes";
import type { TableColumn, TableRow } from "./table";

export type FillMode = "empty" | "all";
export interface CellChange { row: TableRow; before: string; after: string }
export interface ReferenceOption { value: string; label: string }

/** A preview and its write operation use exactly the same row keys, including numbered Psets. */
export function planColumnChanges(rows: TableRow[], column: TableColumn, value: string, mode: FillMode): CellChange[] {
  if (column.derived || column.position) return [];
  return rows.flatMap((row) => {
    const cell = row.cells.find((entry) => entry.column.key === column.key);
    if (!cell || cell.state === "na" || cell.state === "abgeleitet" || cell.value === value) return [];
    if (mode === "empty" && cell.value) return [];
    return [{ row, before: cell.value, after: value }];
  });
}

export function filterAttributionRows(rows: TableRow[], query: string): TableRow[] {
  const terms = query.toLocaleLowerCase("de-DE").trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((row) => {
    const text = [row.label, row.id, row.psetName, `#${row.entityId}`, ...row.cells.flatMap((cell) => [cell.value, cell.target])].join(" ").toLocaleLowerCase("de-DE");
    return terms.every((term) => text.includes(term));
  });
}

export function planObjectNames(text: string, parentId: string, existingIds: ReadonlySet<string>) {
  const names = text.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  const seen = new Set(existingIds);
  const duplicates = new Set<string>();
  const entries = names.map((name) => {
    const id = childId(parentId, name);
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
    return { name, id };
  });
  return { entries, duplicates: [...duplicates] };
}
