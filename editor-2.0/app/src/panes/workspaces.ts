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
  Daten: {
    type: "split",
    direction: "row",
    children: [
      "structure",
      { type: "split", direction: "column", children: ["pset-batch", "catalog"], splitPercentages: [60, 40] },
    ],
    splitPercentages: [22, 78],
  },
  Auswertung: {
    type: "split",
    direction: "row",
    children: ["lists", "viewer"],
    splitPercentages: [55, 45],
  },
  Bauen: {
    type: "split",
    direction: "row",
    children: [
      "structure",
      { type: "split", direction: "row", children: ["viewer", "builder"], splitPercentages: [58, 42] },
    ],
    splitPercentages: [20, 80],
  },
  Prüfung: {
    type: "split",
    direction: "row",
    children: [
      "checks",
      { type: "split", direction: "column", children: ["viewer", "inspector"], splitPercentages: [60, 40] },
    ],
    splitPercentages: [40, 60],
  },
  IDS: {
    type: "split",
    direction: "row",
    children: ["ids-validation", "viewer"],
    splitPercentages: [55, 45],
  },
  Hub: {
    type: "split",
    direction: "row",
    children: ["hub", "viewer"],
    splitPercentages: [55, 45],
  },
  Pläne: {
    type: "split",
    direction: "row",
    children: ["drawing", "structure"],
    splitPercentages: [72, 28],
  },
  Start: {
    type: "split",
    direction: "row",
    children: ["recents", "notes"],
    splitPercentages: [55, 45],
  },
};

export const BUILTIN_WORKSPACE_NAMES = Object.keys(BUILTIN_WORKSPACES);
