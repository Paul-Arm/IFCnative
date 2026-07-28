/**
 * Flaches Baummodell für den Strukturbaum.
 *
 * Der räumliche Baum wird einmalig je Sitzung in ein Pre-Order-Array
 * gepresst. Jeder Eintrag kennt seinen Elternindex und die Größe seines
 * Teilbaums — damit lassen sich zugeklappte Äste in O(1) überspringen und
 * die sichtbaren Zeilen in O(sichtbar) berechnen (100k+ Zeilen).
 */
import type { ModelSession } from "../../core/session";
import type { SpatialTreeNode } from "../../core/model/spatial";
import { attrText } from "../../domain/resources/emit";

export const ROW_HEIGHT = 22;

/** Ab dieser Anzahl bleibt eine Elementliste anfangs zugeklappt. */
const AUTO_COLLAPSE_ELEMENTS = 50;

export type TreeKind = "spatial" | "element";

export interface TreeItem {
  expressId: number;
  type: string;
  name: string;
  /** Zusatzinfo (LongName, Höhe) für die abgeblendete Spalte */
  detail: string;
  depth: number;
  kind: TreeKind;
  /** Index des Elternknotens im Array, -1 für die Wurzel */
  parent: number;
  /** Anzahl der Nachfahren, die im Array direkt folgen */
  subtreeSize: number;
  /** Anfangszustand des Aufklapp-Chevrons */
  defaultOpen: boolean;
  /** vorberechnete Kleinschreibung für die Suche */
  search: string;
}

export interface SearchResult {
  /** sichtbare Zeilen als Indizes in `items` */
  rows: number[];
  /** 1 = direkter Treffer (nicht nur Pfad zum Treffer) */
  matched: Uint8Array;
  count: number;
}

function isStorey(type: string): boolean {
  return type.toUpperCase() === "IFCBUILDINGSTOREY";
}

/**
 * Typ/Name für Overlay-Knoten (M9, Kontextmenü „Kind anlegen"): per Sitzung
 * angelegte räumliche Kinder existieren nur als NewEntity im Mutations-
 * Overlay — die Entity-Tabelle des Parsers liefert für sie leere Strings.
 */
function nodeIdentity(
  session: ModelSession,
  node: SpatialTreeNode,
): { type: string; name: string } {
  // Die Entity-Tabelle liefert für Overlay-Ids "UNKNOWN" bzw. leere Namen.
  const unknownType = !node.type || node.type.toUpperCase() === "UNKNOWN";
  if (!unknownType && node.name) return node;
  const record = session.view.getNewEntity(node.expressId);
  if (!record) return node;
  return {
    type: unknownType ? record.type : node.type,
    name: node.name || attrText(record.attributes[2]), // IfcRoot.Name
  };
}

function spatialDetail(node: SpatialTreeNode): string {
  const parts: string[] = [];
  if (node.longName && node.longName !== node.name) parts.push(node.longName);
  if (node.elevation !== undefined && node.elevation !== null) {
    parts.push(
      `${node.elevation.toLocaleString("de-DE", { maximumFractionDigits: 3 })} m`,
    );
  }
  return parts.join(" · ");
}

function pushSpatial(
  session: ModelSession,
  node: SpatialTreeNode,
  depth: number,
  parent: number,
  belowStorey: boolean,
  items: TreeItem[],
): void {
  const index = items.length;
  const identity = nodeIdentity(session, node);
  items.push({
    expressId: node.expressId,
    type: identity.type,
    name: identity.name,
    detail: spatialDetail(node),
    depth,
    kind: "spatial",
    parent,
    subtreeSize: 0,
    // Bis zur Geschoss-Ebene offen; große Elementlisten bleiben zu.
    defaultOpen: !belowStorey && node.elements.length <= AUTO_COLLAPSE_ELEMENTS,
    search: `${identity.type} ${identity.name}`.toLowerCase(),
  });

  const childBelowStorey = belowStorey || isStorey(identity.type);
  for (const child of node.children) {
    pushSpatial(session, child, depth + 1, index, childBelowStorey, items);
  }
  for (const expressId of node.elements) {
    const identity = session.identityOf(expressId);
    items.push({
      expressId,
      type: identity.type,
      name: identity.name,
      detail: identity.objectType,
      depth: depth + 1,
      kind: "element",
      parent: index,
      subtreeSize: 0,
      defaultOpen: false,
      search: `${identity.type} ${identity.name}`.toLowerCase(),
    });
  }
  items[index].subtreeSize = items.length - index - 1;
}

export function buildTreeItems(session: ModelSession): TreeItem[] {
  const root = session.spatialTree();
  if (!root) return [];
  const items: TreeItem[] = [];
  pushSpatial(session, root, 0, -1, false, items);
  return items;
}

export function initialExpanded(items: TreeItem[]): Set<number> {
  const expanded = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (items[i].subtreeSize > 0 && items[i].defaultOpen) expanded.add(i);
  }
  return expanded;
}

/** Alle Knoten mit Kindern (für „Alles aufklappen"). */
export function allBranches(items: TreeItem[]): Set<number> {
  const expanded = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (items[i].subtreeSize > 0) expanded.add(i);
  }
  return expanded;
}

/** Sichtbare Zeilen ohne Suche: zugeklappte Teilbäume werden übersprungen. */
export function flattenVisible(
  items: TreeItem[],
  expanded: Set<number>,
): number[] {
  const rows: number[] = [];
  let i = 0;
  while (i < items.length) {
    rows.push(i);
    const item = items[i];
    i += item.subtreeSize > 0 && !expanded.has(i) ? item.subtreeSize + 1 : 1;
  }
  return rows;
}

/**
 * Sichtbare Zeilen mit Suche: Treffer plus deren Pfad zur Wurzel. Pfade zu
 * Treffern gelten dabei immer als aufgeklappt.
 */
export function searchVisible(
  items: TreeItem[],
  query: string,
): SearchResult {
  const needle = query.trim().toLowerCase();
  const matched = new Uint8Array(items.length);
  const visible = new Uint8Array(items.length);
  let count = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (
      item.search.includes(needle) ||
      String(item.expressId).includes(needle)
    ) {
      matched[i] = 1;
      visible[i] = 1;
      count++;
    }
  }
  // Pre-Order: Eltern stehen vor ihren Kindern → rückwärts propagieren.
  for (let i = items.length - 1; i >= 0; i--) {
    if (visible[i] && items[i].parent >= 0) visible[items[i].parent] = 1;
  }

  const rows: number[] = [];
  let i = 0;
  while (i < items.length) {
    if (visible[i]) {
      rows.push(i);
      i += 1;
    } else {
      i += items[i].subtreeSize + 1;
    }
  }
  return { rows, matched, count };
}
