/**
 * Einfaches BFS-Ebenen-Layout: der Anker steht links, jede weitere Ebene
 * bildet eine Spalte, deren Knoten vertikal um die Mitte verteilt werden.
 *
 * Manuell verschobene Knoten werden pro (docId, ankerId) in einem
 * modul-lokalen Cache gemerkt, damit „Pinnen" Re-Render überlebt.
 */
import type { GraphNodeInfo } from "./useNeighborhood";

export interface NodePosition {
  x: number;
  y: number;
}

const COLUMN_WIDTH = 240;
const ROW_HEIGHT = 64;
/** Wie viele (Dokument, Anker)-Kombinationen gemerkt werden. */
const MAX_CACHED_ANCHORS = 64;

/** Automatisches Ebenen-Layout ohne Berücksichtigung gepinnter Knoten. */
export function layoutByDepth(
  nodes: readonly GraphNodeInfo[],
): Map<number, NodePosition> {
  const byDepth = new Map<number, GraphNodeInfo[]>();
  for (const node of nodes) {
    const bucket = byDepth.get(node.depth);
    if (bucket) bucket.push(node);
    else byDepth.set(node.depth, [node]);
  }

  const positions = new Map<number, NodePosition>();
  for (const [depth, bucket] of byDepth) {
    const ordered = [...bucket].sort(
      (a, b) =>
        a.type.localeCompare(b.type, "de") || a.expressId - b.expressId,
    );
    const offset = (ordered.length - 1) / 2;
    ordered.forEach((node, index) => {
      positions.set(node.expressId, {
        x: depth * COLUMN_WIDTH,
        y: Math.round((index - offset) * ROW_HEIGHT),
      });
    });
  }
  return positions;
}

const PINNED = new Map<string, Map<number, NodePosition>>();

export function pinKey(docId: string, anchorId: number): string {
  return `${docId}#${anchorId}`;
}

/** Layout-Positionen, überschrieben von manuell verschobenen Knoten. */
export function positionsFor(
  key: string,
  nodes: readonly GraphNodeInfo[],
): Map<number, NodePosition> {
  const positions = layoutByDepth(nodes);
  const pinned = PINNED.get(key);
  if (pinned) {
    for (const [expressId, position] of pinned) {
      if (positions.has(expressId)) positions.set(expressId, position);
    }
  }
  return positions;
}

export function pinPosition(
  key: string,
  expressId: number,
  position: NodePosition,
): void {
  let pinned = PINNED.get(key);
  if (!pinned) {
    pinned = new Map();
    PINNED.set(key, pinned);
    if (PINNED.size > MAX_CACHED_ANCHORS) {
      const oldest = PINNED.keys().next();
      if (!oldest.done) PINNED.delete(oldest.value);
    }
  }
  pinned.set(expressId, { x: position.x, y: position.y });
}

export function hasPinned(key: string): boolean {
  return (PINNED.get(key)?.size ?? 0) > 0;
}

export function clearPinned(key: string): void {
  PINNED.delete(key);
}
