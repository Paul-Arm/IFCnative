/**
 * Strukturbaum: räumliche Hierarchie (Projekt → Standort → Gebäude →
 * Geschoss) samt enthaltener Elemente, mit Suche, Mehrfachauswahl und
 * Fenster-Virtualisierung für sehr große Modelle.
 *
 * M9: Rechtsklick öffnet ein eigenes Kontextmenü (Kamera zentrieren,
 * Kind anlegen, Löschen mit Kaskadenplan) — jede Modelländerung läuft als
 * Command durch die Pipeline.
 */
import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { useCommands } from "../../commands/pipeline";
import {
  cmdDeleteEntityCascade,
  planEntityRemoval,
} from "../../commands/entityCommands";
import { cmdCreateSpatialChild } from "../../commands/resourceCommands";
import { cmdCreateElement } from "../../commands/geometryCommands";
import { DEFAULT_CREATE_PARAMS } from "../../domain/geometry";
import { useActiveDocument } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import ConfirmDeleteDialog, {
  type PendingTreeRemoval,
} from "./ConfirmDeleteDialog";
import ContextMenu, { type MenuTarget } from "./ContextMenu";
import type { ChildOption } from "./contextModel";
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

  // — Kontextmenü + Lösch-Dialog (M9) —
  const execute = useCommands((s) => s.execute);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [removal, setRemoval] = useState<PendingTreeRemoval | null>(null);
  const session = document?.session ?? null;

  const onContext = useCallback(
    (event: MouseEvent, index: number) => {
      event.preventDefault();
      if (!docId) return;
      const item = items[index];
      select(docId, item.expressId);
      setMenu({
        x: event.clientX,
        y: event.clientY,
        expressId: item.expressId,
        type: item.type,
        label: `${item.type} ${item.name || "(ohne Namen)"} (#${item.expressId})`,
      });
    },
    [docId, items, select],
  );

  const onDeleteRequest = useCallback(
    (expressId: number) => {
      if (!session) return;
      setRemoval({
        expressId,
        label: session.labelOf(expressId),
        plan: planEntityRemoval(session, expressId),
      });
    },
    [session],
  );

  const onConfirmDelete = useCallback(() => {
    if (!docId || !session || !removal) return;
    execute(docId, cmdDeleteEntityCascade(session, removal.expressId, docId));
    setRemoval(null);
  }, [docId, session, removal, execute]);

  const onCreateChild = useCallback(
    (parentId: number, option: ChildOption) => {
      if (!docId || !session) return;
      const command =
        option.kind === "spatial"
          ? cmdCreateSpatialChild(session, parentId, option.ifcClass, "")
          : cmdCreateElement(session, parentId, {
              ...DEFAULT_CREATE_PARAMS,
              klasse: option.builderId ?? "wall",
              name: "",
            });
      execute(docId, command);
    },
    [docId, session, execute],
  );

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
          onContext={onContext}
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
      onContext,
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
