/**
 * Zustandslogik des Strukturbaums: Baum bauen, Aufklapp-Zustand halten,
 * Suche anwenden und daraus die sichtbare Zeilenliste ableiten.
 */
import { useCallback, useMemo, useRef, useState } from "react";
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
  const items = useMemo(
    () => (document ? buildTreeItems(document.session) : []),
    [document?.id, document?.session],
  );

  const [expanded, setExpanded] = useState<Set<number>>(() =>
    initialExpanded(items),
  );
  // Neues Dokument → Aufklapp-Zustand zurücksetzen (Render-Phase-Update).
  const builtFor = useRef(items);
  if (builtFor.current !== items) {
    builtFor.current = items;
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
