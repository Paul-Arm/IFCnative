/**
 * Pick-Store (M9): zuletzt gepickter 3D-Weltpunkt plus kurzer Verlauf.
 *
 * Die Punkte liegen in IFC-Modellkoordinaten (Z-up) in METERN — die
 * Umrechnung aus dem Renderer-Rahmen (Y-up, RTC-verschoben) passiert VOR dem
 * Ablegen über `worldCoords.rendererToIfcPoint`. Konsumenten: Statuszeile des
 * Viewers, 3D-Markierung und der „Position aus Pick übernehmen"-Button des
 * Baukastens (CreateSection).
 */
import { create } from "zustand";
import type { WorldVec3 } from "./worldCoords";

/** Maximale Verlaufslänge (jüngster Punkt zuerst). */
export const PICK_HISTORY_LIMIT = 5;

export interface PickPoint extends WorldVec3 {
  /** Dokument, in dem gepickt wurde — fremde Dokumente übernehmen nicht. */
  docId: string;
  /** Zeitstempel (ms) für „zuletzt"-Anzeigen. */
  at: number;
}

interface PickState {
  /** Jüngster Punkt (identisch mit history[0]) oder null. */
  last: PickPoint | null;
  /** Verlauf, jüngster zuerst, maximal PICK_HISTORY_LIMIT Einträge. */
  history: PickPoint[];
  setPoint(docId: string, point: WorldVec3): void;
  clear(): void;
}

export const usePickStore = create<PickState>((set) => ({
  last: null,
  history: [],

  setPoint(docId, point) {
    const entry: PickPoint = {
      docId,
      x: point.x,
      y: point.y,
      z: point.z,
      at: Date.now(),
    };
    set((state) => ({
      last: entry,
      history: [entry, ...state.history].slice(0, PICK_HISTORY_LIMIT),
    }));
  },

  clear() {
    set({ last: null, history: [] });
  },
}));
