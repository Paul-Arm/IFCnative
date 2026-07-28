/**
 * Strukturbaum: räumliche Hierarchie (Projekt → Standort → Gebäude →
 * Geschoss) samt enthaltener Elemente, mit Suche, Mehrfachauswahl und
 * Fenster-Virtualisierung für sehr große Modelle.
 */
import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { useActiveDocument } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import TreeRow from "./TreeRow";
import VirtualList from "./VirtualList";
import { ROW_HEIGHT } from "./treeModel";
import { useTreeRows } from "./useTreeRows";

export default function StructurePane() {
  const document = useActiveDocument();
  const [query, setQuery] = useState("");
  const tree = useTreeRows(document, query);

  const docId = document?.id ?? null;
  const selection = useSelectionOf(docId);
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const select = useSelection((s) => s.select);
  const setSelection = useSelection((s) => s.setSelection);
  const requestFocus = useSelection((s) => s.requestFocus);

  /** Ankerzeile für Shift-Bereichsauswahl (Position in tree.rows) */
  const anchor = useRef<number | null>(null);

  const { items, rows } = tree;

  const onActivate = useCallback(
    (event: MouseEvent, row: number, expressId: number) => {
      if (!docId) return;
      if (event.shiftKey && anchor.current !== null) {
        const from = Math.min(anchor.current, row);
        const to = Math.max(anchor.current, row);
        const ids: number[] = [];
        for (let i = from; i <= to && i < rows.length; i++) {
          ids.push(items[rows[i]].expressId);
        }
        setSelection(docId, ids);
        return;
      }
      anchor.current = row;
      select(docId, expressId, event.ctrlKey || event.metaKey);
    },
    [docId, items, rows, select, setSelection],
  );

  const onFocus = useCallback(
    (expressId: number) => {
      if (docId) requestFocus(docId, expressId);
    },
    [docId, requestFocus],
  );

  const renderRow = useCallback(
    (row: number) => {
      const index = rows[row];
      const item = items[index];
      return (
        <TreeRow
          key={index}
          item={item}
          index={index}
          row={row}
          selected={selectedIds.has(item.expressId)}
          highlighted={tree.searching && tree.matched[index] === 1}
          expanded={tree.expanded.has(index)}
          onToggle={tree.toggle}
          onActivate={onActivate}
          onFocus={onFocus}
        />
      );
    },
    [
      items,
      rows,
      selectedIds,
      tree.searching,
      tree.matched,
      tree.expanded,
      tree.toggle,
      onActivate,
      onFocus,
    ],
  );

  if (!document) {
    return <p className="pane-empty">Kein Dokument geöffnet.</p>;
  }

  const empty = items.length === 0;

  return (
    <div className="pane">
      <div className="pane-toolbar">
        <input
          className="input"
          type="search"
          placeholder="Suchen (Name, Typ, #Id) …"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ flex: "1 1 140px", minWidth: 120 }}
        />
        <button className="btn" onClick={tree.expandAll} disabled={empty}>
          Alles aufklappen
        </button>
        <button className="btn" onClick={tree.collapseAll} disabled={empty}>
          Alles zuklappen
        </button>
        <span className="text-dim">
          {tree.searching
            ? `${tree.matchCount.toLocaleString("de-DE")} Treffer`
            : `${rows.length.toLocaleString("de-DE")} Zeilen`}
        </span>
      </div>

      {empty ? (
        <p className="pane-empty">Keine räumliche Struktur im Modell.</p>
      ) : rows.length === 0 ? (
        <p className="pane-empty">Keine Treffer für „{query}".</p>
      ) : (
        <VirtualList
          className="pane-body"
          count={rows.length}
          rowHeight={ROW_HEIGHT}
          renderRow={renderRow}
          resetKey={`${document.id}|${query}`}
        />
      )}
    </div>
  );
}
