import {
  CHANGE_FACETS,
  diffObjectDetails,
  type ChangeFacet,
  type ObjectChangeEntry,
  type ObjectChangeStatus,
  type ObjectDetail,
  type ObjectDiffSummary,
  type ObjectFieldChange,
} from "../ifc";

/**
 * Lese-Sichten auf den objektzentrierten Diff für die Web-UI.
 *
 * Wie bei `diffView.ts` geht nie der ganze Diff an den Browser: erst eine
 * kompakte Übersicht (Zähler je Status, Typ, Facette, Geschoss), dann
 * gefilterte Seiten. Jede Zeile einer Seite trägt bereits ihre wichtigsten
 * Vorher/Nachher-Werte (`highlights`) bzw. Eckdaten (`facts`) — die UI zeigt
 * also sofort, WAS sich geändert hat, ohne einen Klick je Objekt.
 */

export interface ChangesTypeCount {
  type: string;
  count: number;
}

export interface ChangesStatusOverview {
  count: number;
  /** Absteigend nach Anzahl, dann alphabetisch. */
  types: ChangesTypeCount[];
}

export interface ChangesOverview {
  /** Gleicher Manifest-Hash: Re-Export ohne jede Änderung. */
  identical: boolean;
  unchanged: number;
  added: ChangesStatusOverview;
  modified: ChangesStatusOverview;
  removed: ChangesStatusOverview;
  /** Geänderte Objekte je Facette (ein Objekt kann mehrere haben). */
  facets: Record<ChangeFacet, number>;
  /** Betroffene Objekte je räumlichem Container, absteigend. */
  containers: { name: string; count: number }[];
}

export interface ChangesQuery {
  status?: ObjectChangeStatus;
  type?: string;
  facet?: ChangeFacet;
  /** "" = ohne räumliche Zuordnung. */
  container?: string;
  /** Volltext (Typ, Name, GlobalId, Container). */
  q?: string;
  offset: number;
  limit: number;
}

export interface ChangeFact {
  label: string;
  value: string;
}

export interface ChangeItem extends ObjectChangeEntry {
  /** Die wichtigsten Feldänderungen (nur "modified"). */
  highlights: ObjectFieldChange[];
  /** Gesamtzahl der Feldänderungen (>= highlights.length). */
  changeCount: number;
  /** Eckdaten neuer/entfernter Objekte. */
  facts: ChangeFact[];
}

export interface ChangesPage {
  items: ChangeItem[];
  total: number;
  offset: number;
  limit: number;
}

export const CHANGES_PAGE_LIMIT_DEFAULT = 50;
export const CHANGES_PAGE_LIMIT_MAX = 200;
export const CHANGES_GUIDS_LIMIT = 50_000;
const HIGHLIGHT_LIMIT = 4;

function statusOverview(entries: ObjectChangeEntry[]): ChangesStatusOverview {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  }
  return {
    count: entries.length,
    types: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : 1)),
  };
}

export function changesOverview(
  summary: ObjectDiffSummary,
  identical: boolean,
): ChangesOverview {
  const facets = Object.fromEntries(
    CHANGE_FACETS.map((facet) => [facet, 0]),
  ) as Record<ChangeFacet, number>;
  for (const entry of summary.modified) {
    for (const facet of entry.facets) {
      facets[facet] += 1;
    }
  }
  const containers = new Map<string, number>();
  for (const list of [summary.added, summary.modified, summary.removed]) {
    for (const entry of list) {
      containers.set(entry.container, (containers.get(entry.container) ?? 0) + 1);
    }
  }
  return {
    identical,
    unchanged: summary.unchanged,
    added: statusOverview(summary.added),
    modified: statusOverview(summary.modified),
    removed: statusOverview(summary.removed),
    facets,
    containers: [...containers.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)),
  };
}

function matcher(query: Omit<ChangesQuery, "offset" | "limit">) {
  const needle = query.q?.trim().toLowerCase() ?? "";
  return (entry: ObjectChangeEntry): boolean => {
    if (query.type && entry.type !== query.type) return false;
    if (query.container !== undefined && entry.container !== query.container) {
      return false;
    }
    if (query.facet && !entry.facets.includes(query.facet)) return false;
    if (!needle) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.type.toLowerCase().includes(needle) ||
      entry.globalId.toLowerCase().includes(needle) ||
      entry.container.toLowerCase().includes(needle)
    );
  };
}

function sources(
  summary: ObjectDiffSummary,
  query: Omit<ChangesQuery, "offset" | "limit">,
): ObjectChangeEntry[][] {
  if (query.status) {
    return [summary[query.status]];
  }
  // Eine Facette gibt es nur an geänderten Objekten.
  return query.facet
    ? [summary.modified]
    : [summary.modified, summary.added, summary.removed];
}

/** Gefilterte Seite OHNE Details — die ergänzt `withDetails`. */
export function changesPageEntries(
  summary: ObjectDiffSummary,
  query: ChangesQuery,
): { entries: ObjectChangeEntry[]; total: number; offset: number; limit: number } {
  const limit = Math.max(
    1,
    Math.min(CHANGES_PAGE_LIMIT_MAX, query.limit || CHANGES_PAGE_LIMIT_DEFAULT),
  );
  const offset = Math.max(0, query.offset || 0);
  const matches = matcher(query);
  const entries: ObjectChangeEntry[] = [];
  let total = 0;
  for (const list of sources(summary, query)) {
    for (const entry of list) {
      if (!matches(entry)) continue;
      if (total >= offset && entries.length < limit) {
        entries.push(entry);
      }
      total += 1;
    }
  }
  return { entries, total, offset, limit };
}

/** GlobalIds je Status für die 3D-Einfärbung (gleiche Filter wie die Liste). */
export function changesGuids(
  summary: ObjectDiffSummary,
  query: Omit<ChangesQuery, "offset" | "limit">,
): {
  added: string[];
  modified: string[];
  removed: string[];
  truncated: boolean;
} {
  const matches = matcher(query);
  const result = {
    added: [] as string[],
    modified: [] as string[],
    removed: [] as string[],
    truncated: false,
  };
  for (const list of sources(summary, query)) {
    for (const entry of list) {
      if (!matches(entry)) continue;
      const target = result[entry.status];
      if (target.length >= CHANGES_GUIDS_LIMIT) {
        result.truncated = true;
        continue;
      }
      target.push(entry.globalId);
    }
  }
  return result;
}

/** Eckdaten eines neuen/entfernten Objekts für die Listenzeile. */
function factsOf(detail: ObjectDetail | undefined): ChangeFact[] {
  if (!detail) return [];
  const facts: ChangeFact[] = [];
  const put = (label: string, value: string | undefined) => {
    if (value) facts.push({ label, value });
  };
  put("Typ", detail.relations["Typ"]);
  put(
    "Art",
    detail.attributes["PredefinedType"] ?? detail.attributes["ObjectType"],
  );
  put("Material", detail.relations["Material"]);
  put("Klassifikation", detail.relations["Klassifikation"]);
  if (detail.geometry) {
    put(
      "Geometrie",
      detail.geometry.profiles[0] ??
        detail.geometry.representations[0] ??
        undefined,
    );
  } else {
    facts.push({ label: "Geometrie", value: "keine" });
  }
  const psetCount = Object.keys(detail.psets).length;
  if (psetCount) {
    put("Property-Sets", String(psetCount));
  }
  return facts.slice(0, 5);
}

/**
 * Wichtigste Änderungen zuerst: konkrete Werte (Attribute, Eigenschaften,
 * Verschiebung) vor technischen Kennwerten.
 */
function pickHighlights(changes: ObjectFieldChange[]): ObjectFieldChange[] {
  const rank = (change: ObjectFieldChange): number => {
    if (change.field === "Verschiebung") return 0;
    if (change.facet === "attributes") return 1;
    if (change.facet === "properties") return 2;
    if (change.facet === "relations") return 3;
    if (change.facet === "geometry") return 4;
    return 5; // einzelne Lage-Koordinaten — die Verschiebung sagt mehr
  };
  return [...changes]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, HIGHLIGHT_LIMIT);
}

export function withDetails(
  entries: ObjectChangeEntry[],
  details: Map<string, ObjectDetail>,
): ChangeItem[] {
  return entries.map((entry) => {
    const before = entry.beforeHash ? details.get(entry.beforeHash) : undefined;
    const after = entry.afterHash ? details.get(entry.afterHash) : undefined;
    if (entry.status === "modified" && before && after) {
      const changes = diffObjectDetails(before, after);
      return {
        ...entry,
        highlights: pickHighlights(changes),
        changeCount: changes.length,
        facts: [],
      };
    }
    return {
      ...entry,
      highlights: [],
      changeCount: 0,
      facts: factsOf(after ?? before),
    };
  });
}
