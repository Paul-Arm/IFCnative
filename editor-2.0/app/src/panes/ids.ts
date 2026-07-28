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
] as const;

export type PaneId = (typeof PANE_IDS)[number];

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
};
