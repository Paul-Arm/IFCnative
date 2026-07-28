/**
 * Pane-Registry: bildet PaneId → React-Komponente ab. Panes werden lazy
 * geladen, damit schwere Abhängigkeiten (React Flow, Renderer) das
 * Startbundle nicht belasten.
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

const COMPONENTS: Record<PaneId, ComponentType> = {
  structure: StructurePane,
  viewer: ViewerPane,
  inspector: InspectorPane,
  graph: GraphPane,
  lens: LensPane,
  notes: NotesPane,
  recents: RecentsPane,
};

export function renderPane(id: PaneId) {
  const Component = COMPONENTS[id];
  return (
    <Suspense fallback={<div className="pane-loading">Lade …</div>}>
      <Component />
    </Suspense>
  );
}
