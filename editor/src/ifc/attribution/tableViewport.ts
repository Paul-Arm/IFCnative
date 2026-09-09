export const ATTRIBUTION_ROW_HEIGHT = 32;
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 1200;

export function clampColumnWidth(width: number): number {
  return Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Number.isFinite(width) ? width : 180)));
}

/** The sticky header covers the top of the scrollport; body row zero starts below it. */
export function virtualRowRange(count: number, top: number, height: number, header: number, overscan = 6) {
  const visible = Math.max(1, Math.ceil(Math.max(0, height - header) / ATTRIBUTION_ROW_HEIGHT));
  const first = Math.min(Math.max(0, count - visible), Math.max(0, Math.floor(top / ATTRIBUTION_ROW_HEIGHT)));
  return { start: Math.max(0, first - overscan), end: Math.min(count, first + visible + overscan) };
}

/** Keep only the viewport plus one editing row mounted, never the intervening rows. */
export function virtualRowSlots(count: number, start: number, end: number, pinned = -1) {
  const indices = Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
  if (pinned >= 0 && pinned < count && (pinned < start || pinned >= end)) indices.push(pinned);
  indices.sort((a, b) => a - b);
  return indices.map((index, position) => ({ index, gap: index - (position ? indices[position - 1]! + 1 : 0) }));
}
