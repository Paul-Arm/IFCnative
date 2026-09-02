import type { GuidChangeStatus, GuidDiffEntry, GuidDiffSummary } from "../ifc";

/**
 * Lese-Sichten auf eine Diff-Summary für die Web-UI.
 *
 * Ein Diff großer Modelle hat leicht 100k+ Einträge — als ein JSON an den
 * Browser geschickt, friert der beim Rendern ein. Deshalb liefert der Server
 * erst eine kompakte Übersicht (Zähler je Status und IFC-Typ) und die
 * Einträge selbst nur seitenweise, wahlweise auf Status/Typ eingegrenzt oder
 * per Volltext gefiltert.
 */

export interface DiffTypeCount {
  type: string;
  count: number;
}

export interface DiffStatusOverview {
  count: number;
  /** Absteigend nach Anzahl, dann alphabetisch. */
  types: DiffTypeCount[];
}

export interface DiffOverview {
  identical: boolean;
  beforeManifestHash: string;
  afterManifestHash: string;
  unchanged: number;
  added: DiffStatusOverview;
  modified: DiffStatusOverview;
  removed: DiffStatusOverview;
}

export interface DiffPageQuery {
  status?: GuidChangeStatus;
  type?: string;
  /** Volltext (Typ, Name, GlobalId; ohne Groß-/Kleinschreibung). */
  q?: string;
  offset: number;
  limit: number;
}

export interface DiffPage {
  entries: GuidDiffEntry[];
  total: number;
  offset: number;
  limit: number;
}

export const DIFF_PAGE_LIMIT_DEFAULT = 200;
export const DIFF_PAGE_LIMIT_MAX = 1000;

function statusOverview(entries: GuidDiffEntry[]): DiffStatusOverview {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  }
  return {
    count: entries.length,
    types: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  };
}

export function diffOverview(summary: GuidDiffSummary): DiffOverview {
  return {
    identical: summary.identical,
    beforeManifestHash: summary.beforeManifestHash,
    afterManifestHash: summary.afterManifestHash,
    unchanged: summary.unchanged,
    added: statusOverview(summary.added),
    modified: statusOverview(summary.modified),
    removed: statusOverview(summary.removed),
  };
}

export function diffPage(summary: GuidDiffSummary, query: DiffPageQuery): DiffPage {
  const limit = Math.max(
    1,
    Math.min(DIFF_PAGE_LIMIT_MAX, query.limit || DIFF_PAGE_LIMIT_DEFAULT),
  );
  const offset = Math.max(0, query.offset || 0);
  const needle = query.q?.trim().toLowerCase() ?? "";
  const sources: GuidDiffEntry[][] = query.status
    ? [summary[query.status] as GuidDiffEntry[]]
    : [summary.added, summary.modified, summary.removed];

  const matches = (entry: GuidDiffEntry): boolean => {
    if (query.type && entry.type !== query.type) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return (
      entry.type.toLowerCase().includes(needle) ||
      entry.name.toLowerCase().includes(needle) ||
      entry.globalId.toLowerCase().includes(needle)
    );
  };

  const entries: GuidDiffEntry[] = [];
  let total = 0;
  for (const list of sources) {
    for (const entry of list) {
      if (!matches(entry)) {
        continue;
      }
      if (total >= offset && entries.length < limit) {
        entries.push(entry);
      }
      total += 1;
    }
  }
  return { entries, total, offset, limit };
}
