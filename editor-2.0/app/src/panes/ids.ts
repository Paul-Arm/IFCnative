/** Pane-Ids des Mosaic-Layouts. Neue Panes: Id ergänzen + in registry.tsx registrieren. */
export const PANE_IDS = [
  "structure",
  "viewer",
  "inspector",
  "graph",
  "lens",
  "notes",
  "recents",
  "pset-batch",
  "catalog",
  "lists",
  "builder",
  "checks",
  "hub",
  "drawing",
  "ids-validation",
] as const;

export type PaneId = (typeof PANE_IDS)[number];

/**
 * Hauptfenster: großflächige Arbeitsflächen, die als Mosaic-Fenster frei
 * angeordnet werden. Nur diese Ids dürfen in Layout-Bäumen vorkommen.
 */
export const MAIN_PANE_IDS = [
  "structure",
  "viewer",
  "inspector",
  "graph",
  "pset-batch",
  "lists",
  "drawing",
] as const;

export type MainPaneId = (typeof MAIN_PANE_IDS)[number];

/**
 * Werkzeuge: der „Kleinkram", der als Mosaic-Fenster schwer zu verwalten
 * war — lebt jetzt in der rechten Sidebar (Icon-Leiste, genau ein
 * Werkzeug offen).
 */
export const TOOL_PANE_IDS = [
  "builder",
  "catalog",
  "lens",
  "checks",
  "ids-validation",
  "hub",
  "notes",
  "recents",
] as const;

export type ToolPaneId = (typeof TOOL_PANE_IDS)[number];

const TOOL_SET: ReadonlySet<string> = new Set(TOOL_PANE_IDS);

export function isToolPane(id: PaneId): id is ToolPaneId {
  return TOOL_SET.has(id);
}

export const PANE_TITLES: Record<PaneId, string> = {
  structure: "Struktur",
  viewer: "3D-Viewer",
  inspector: "Inspector",
  graph: "Graph",
  lens: "Lens",
  notes: "Notizen",
  recents: "Kürzlich verwendet",
  "pset-batch": "Pset Batch",
  catalog: "Objektkatalog",
  lists: "Listen",
  builder: "Baukasten",
  checks: "Prüfzentrum",
  hub: "IFC-Hub",
  drawing: "2D-Ansicht",
  "ids-validation": "IDS-Validierung",
};
