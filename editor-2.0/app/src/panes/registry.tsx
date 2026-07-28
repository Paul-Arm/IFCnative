/**
 * Pane-Registry: bildet PaneId → React-Komponente ab. Panes werden lazy
 * geladen, damit schwere Abhängigkeiten (React Flow, Renderer) das
 * Startbundle nicht belasten.
 *
 * Befund 10: Layouts kommen auch aus dem localStorage und können Pane-Ids
 * älterer Versionen enthalten. `renderPane` rendert dafür einen Platzhalter
 * statt `<undefined />` (Laufzeitfehler im ganzen Mosaic-Baum); zusätzlich
 * verwirft `store/ui.ts` beim Laden Workspaces mit unbekannten Ids.
 */
import { Suspense, lazy, type ComponentType } from "react";
import type { PaneId } from "./ids";

const StructurePane = lazy(() => import("./structure/StructurePane"));
const ViewerPane = lazy(() => import("./viewer/ViewerPane"));
const InspectorPane = lazy(() => import("./inspector/InspectorPane"));
const GraphPane = lazy(() => import("./graph/GraphPane"));
const LensPane = lazy(() => import("./lens/LensPane"));
const NotesPane = lazy(() => import("./notes/NotesPane"));
const RecentsPane = lazy(() => import("./recents/RecentsPane"));
const PsetBatchPane = lazy(() => import("./pset-batch/PsetBatchPane"));
const CatalogPane = lazy(() => import("./catalog/CatalogPane"));
const ListsPane = lazy(() => import("./lists/ListsPane"));
const BuilderPane = lazy(() => import("./builder/BuilderPane"));

const COMPONENTS: Record<PaneId, ComponentType> = {
  structure: StructurePane,
  viewer: ViewerPane,
  inspector: InspectorPane,
  graph: GraphPane,
  lens: LensPane,
  notes: NotesPane,
  recents: RecentsPane,
  "pset-batch": PsetBatchPane,
  catalog: CatalogPane,
  lists: ListsPane,
  builder: BuilderPane,
};

/** Platzhalter für Ids, die es in dieser Version nicht (mehr) gibt. */
export function UnknownPane({ id }: { id: string }) {
  return (
    <p className="pane-empty">
      Unbekanntes Panel „{id}" — Layout zurücksetzen über Workspace-Menü.
    </p>
  );
}

export function renderPane(id: PaneId) {
  const Component = COMPONENTS[id] as ComponentType | undefined;
  if (!Component) return <UnknownPane id={String(id)} />;
  return (
    <Suspense fallback={<div className="pane-loading">Lade …</div>}>
      <Component />
    </Suspense>
  );
}
