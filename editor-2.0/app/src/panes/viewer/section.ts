/**
 * Schnittebenen-Zustand des Viewers. Der Renderer erwartet die Achsennamen
 * 'side' | 'down' | 'front' (X / Y / Z) und eine Position in Prozent der
 * Modellausdehnung.
 */
import type { SectionPlane } from "@ifc-lite/renderer";

export type SectionAxis = SectionPlane["axis"];

export interface SectionState {
  axis: SectionAxis;
  /** 0–100 % der Modellausdehnung entlang der Achse. */
  position: number;
  enabled: boolean;
}

export const SECTION_AXES: ReadonlyArray<{ id: SectionAxis; label: string }> = [
  { id: "side", label: "X" },
  { id: "down", label: "Y" },
  { id: "front", label: "Z" },
];

export const DEFAULT_SECTION: SectionState = {
  axis: "down",
  position: 50,
  enabled: false,
};

export function toSectionPlane(state: SectionState): SectionPlane | null {
  if (!state.enabled) return null;
  return {
    axis: state.axis,
    position: state.position,
    enabled: true,
  };
}
