/**
 * Eingebaute Arbeitsbereiche. Ein Workspace besteht seit dem Sidebar-Umbau
 * aus zwei Teilen: dem Mosaic-Layout der HAUPTFENSTER (nur MainPaneId) und
 * optional dem Werkzeug, das dazu in der rechten Sidebar aufgeht.
 * Nutzerdefinierte Workspaces kommen aus dem UI-Slice.
 */
import type { MosaicNode } from "react-mosaic-component";
import type { MainPaneId, ToolPaneId } from "./ids";

export interface WorkspaceDef {
  layout: MosaicNode<MainPaneId>;
  /** Sidebar-Werkzeug, das dieser Arbeitsbereich öffnet (undefined = zu). */
  tool?: ToolPaneId;
}

export const BUILTIN_WORKSPACES: Record<string, WorkspaceDef> = {
  Editor: {
    layout: {
      type: "split",
      direction: "row",
      children: [
        "structure",
        { type: "split", direction: "row", children: ["viewer", "inspector"], splitPercentages: [55, 45] },
      ],
      splitPercentages: [22, 78],
    },
  },
  Review: {
    layout: {
      type: "split",
      direction: "row",
      children: ["viewer", "inspector"],
      splitPercentages: [65, 35],
    },
    tool: "notes",
  },
  Graph: {
    layout: {
      type: "split",
      direction: "row",
      children: [
        "structure",
        { type: "split", direction: "row", children: ["graph", "inspector"], splitPercentages: [60, 40] },
      ],
      splitPercentages: [20, 80],
    },
  },
  Koordination: {
    layout: {
      type: "split",
      direction: "row",
      children: ["viewer", "structure"],
      splitPercentages: [75, 25],
    },
    tool: "lens",
  },
  Daten: {
    layout: {
      type: "split",
      direction: "row",
      children: ["structure", "pset-batch"],
      splitPercentages: [25, 75],
    },
    tool: "catalog",
  },
  Auswertung: {
    layout: {
      type: "split",
      direction: "row",
      children: ["lists", "viewer"],
      splitPercentages: [55, 45],
    },
  },
  Bauen: {
    layout: {
      type: "split",
      direction: "row",
      children: ["structure", "viewer"],
      splitPercentages: [25, 75],
    },
    tool: "builder",
  },
  Prüfung: {
    layout: {
      type: "split",
      direction: "row",
      children: ["viewer", "inspector"],
      splitPercentages: [60, 40],
    },
    tool: "checks",
  },
  IDS: {
    layout: "viewer",
    tool: "ids-validation",
  },
  Hub: {
    layout: "viewer",
    tool: "hub",
  },
  Pläne: {
    layout: {
      type: "split",
      direction: "row",
      children: ["drawing", "structure"],
      splitPercentages: [72, 28],
    },
  },
  Start: {
    layout: "viewer",
    tool: "recents",
  },
};

export const BUILTIN_WORKSPACE_NAMES = Object.keys(BUILTIN_WORKSPACES);
