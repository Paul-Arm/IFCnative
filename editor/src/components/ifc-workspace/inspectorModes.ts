import type { InspectorMode } from "./types";

export const INSPECTOR_MODES: { value: InspectorMode; label: string }[] = [
  { value: "overview", label: "Übersicht" },
  { value: "properties", label: "Eigenschaften" },
  { value: "placement", label: "Platzierung" },
  { value: "relations", label: "Beziehungen" },
];

