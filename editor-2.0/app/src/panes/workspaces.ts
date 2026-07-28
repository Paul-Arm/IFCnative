/** Eingebaute Workspace-Layouts (Mosaic-v6-Bäume). Nutzerdefinierte kommen aus dem UI-Slice. */
import type { MosaicNode } from "react-mosaic-component";
import type { PaneId } from "./ids";

export const BUILTIN_WORKSPACES: Record<string, MosaicNode<PaneId>> = {
  Editor: {
    type: "split",
    direction: "row",
    children: [
      "structure",
      { type: "split", direction: "row", children: ["viewer", "inspector"], splitPercentages: [55, 45] },
    ],
    splitPercentages: [22, 78],
  },
  Review: {
    type: "split",
    direction: "row",
    children: [
      { type: "split", direction: "column", children: ["viewer", "notes"], splitPercentages: [70, 30] },
      "inspector",
    ],
    splitPercentages: [65, 35],
  },
  Graph: {
    type: "split",
    direction: "row",
    children: [
      "structure",
      { type: "split", direction: "row", children: ["graph", "inspector"], splitPercentages: [60, 40] },
    ],
    splitPercentages: [20, 80],
  },
  Koordination: {
    type: "split",
    direction: "row",
    children: [
      { type: "split", direction: "column", children: ["viewer", "lens"], splitPercentages: [65, 35] },
      "structure",
    ],
    splitPercentages: [75, 25],
  },
  Start: {
    type: "split",
    direction: "row",
    children: ["recents", "notes"],
    splitPercentages: [55, 45],
  },
};

export const BUILTIN_WORKSPACE_NAMES = Object.keys(BUILTIN_WORKSPACES);
