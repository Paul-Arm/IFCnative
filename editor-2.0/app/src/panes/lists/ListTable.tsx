/**
 * Tabellenteil des Listen-Panes: sortierbare Spaltenköpfe, Datenzeilen mit
 * Auswahl/Fokus und — bei aktiver Gruppierung — fette Gruppenkopfzeilen mit
 * Anzahl und Summen sowie eine Gesamtzeile. Reine Darstellung: Sortier- und
 * Gruppenlogik liegt im Motor (`executeList`) bzw. in `table.ts`.
 */
import type {
  ColumnDefinition,
  ListDefinition,
  ListSummary,
} from "@ifc-lite/lists";
import {
  columnLabel,
  formatCell,
  formatNumber,
  groupLabel,
  sortMarker,
  type DisplayLine,
} from "./table";

interface ListTableProps {
  columns: readonly ColumnDefinition[];
  lines: readonly DisplayLine[];
  numericIds: ReadonlySet<string>;
  sortBy: ListDefinition["sortBy"];
  summary: ListSummary | undefined;
  selected: ReadonlySet<number>;
  onSort(columnId: string): void;
  onPick(entityId: number, focus: boolean): void;
}

/** Zellinhalt einer fetten Aggregatzeile (Gruppenkopf oder Gesamtzeile). */
function aggregateCell(
  column: ColumnDefinition,
  numericIds: ReadonlySet<string>,
  sums: Record<string, number>,
): string {
  return numericIds.has(column.id) ? formatNumber(sums[column.id] ?? 0) : "";
}

export default function ListTable({
  columns,
  lines,
  numericIds,
  sortBy,
  summary,
  selected,
  onSort,
  onPick,
}: ListTableProps) {
  return (
    <table className="kv-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.id}
              style={{ cursor: "pointer", whiteSpace: "nowrap" }}
              title="Sortieren (auf/ab)"
              onClick={() => onSort(column.id)}
            >
              {columnLabel(column)}
              {sortMarker(sortBy, column.id)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) =>
          line.kind === "group" ? (
            <tr key={`g-${line.group.key}-${index}`}>
              {columns.map((column, columnIndex) => (
                <td key={column.id} style={{ fontWeight: 600 }}>
                  {columnIndex === 0 ? (
                    <span
                      style={{ paddingLeft: (line.group.level ?? 0) * 12 }}
                    >
                      {groupLabel(line.group.label)} ({line.group.count})
                    </span>
                  ) : (
                    aggregateCell(column, numericIds, line.group.sums)
                  )}
                </td>
              ))}
            </tr>
          ) : (
            <tr
              key={`r-${line.row.entityId}-${index}`}
              className="row-item"
              data-selected={selected.has(line.row.entityId)}
              style={{ display: "table-row", cursor: "pointer" }}
              onClick={() => onPick(line.row.entityId, false)}
              onDoubleClick={() => onPick(line.row.entityId, true)}
            >
              {columns.map((column, columnIndex) => (
                <td key={column.id}>{formatCell(line.row.values[columnIndex])}</td>
              ))}
            </tr>
          ),
        )}
        {summary && (
          <tr>
            {columns.map((column, columnIndex) => (
              <td key={column.id} style={{ fontWeight: 600 }}>
                {columnIndex === 0
                  ? `Gesamt (${summary.count})`
                  : aggregateCell(column, numericIds, summary.sums)}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}
