/**
 * Zustandslogik des Strukturbaums: Baum bauen, Aufklapp-Zustand halten,
 * Suche anwenden und daraus die sichtbare Zeilenliste ableiten.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useDocRevision } from "../../commands/pipeline";
import type { DocumentEntry } from "../../store/documents";
import {
  allBranches,
  buildTreeItems,
  flattenVisible,
  initialExpanded,
  searchVisible,
  type TreeItem,
} from "./treeModel";

const NO_MATCHES = new Uint8Array(0);

export interface TreeRowsApi {
  items: TreeItem[];
  /** Indizes in `items`, in Anzeigereihenfolge */
  rows: number[];
  expanded: Set<number>;
  searching: boolean;
  matched: Uint8Array;
  matchCount: number;
  toggle(index: number): void;
  expandAll(): void;
  collapseAll(): void;
}

export function useTreeRows(
  document: DocumentEntry | null,
  query: string,
): TreeRowsApi {
  // Review-Befund 2: Ohne die Dokument-Revision als Abhängigkeit blieb der
  // Baum auf dem Parse-Stand stehen — Löschungen und neu angelegte
  // Containments/Aggregationen wurden nie sichtbar. `useDocRevision` steigt
  // bei do, undo UND redo.
  const revision = useDocRevision(document?.id ?? null);

  const items = useMemo(
    () => (document ? buildTreeItems(document.session) : []),
    [document?.id, document?.session, revision],
  );

  const [expanded, setExpanded] = useState<Set<number>>(() =>
    initialExpanded(items),
  );
  // Neues Dokument → Aufklapp-Zustand zurücksetzen (Render-Phase-Update).
  // Bewusst am Dokument, NICHT an `items`: seit Befund 2 wird der Baum bei
  // jeder Modelländerung neu gebaut — ein Reset daran hätte den Baum nach
  // jedem Edit zugeklappt.
  const builtFor = useRef(document?.id ?? null);
  if (builtFor.current !== (document?.id ?? null)) {
    builtFor.current = document?.id ?? null;
    setExpanded(initialExpanded(items));
  }

  const searching = query.trim().length > 0;

  const search = useMemo(
    () => (searching ? searchVisible(items, query) : null),
    [items, query, searching],
  );

  const rows = useMemo(
    () => (search ? search.rows : flattenVisible(items, expanded)),
    [items, expanded, search],
  );

  const toggle = useCallback((index: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setExpanded(allBranches(items)), [items]);
  const collapseAll = useCallback(() => setExpanded(new Set<number>()), []);

  return {
    items,
    rows,
    expanded,
    searching,
    matched: search ? search.matched : NO_MATCHES,
    matchCount: search ? search.count : 0,
    toggle,
    expandAll,
    collapseAll,
  };
}
