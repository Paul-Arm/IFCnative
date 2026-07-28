/**
 * Geteilter Zustand des Polygon-Zeichenwerkzeugs (M10): der Viewer schreibt
 * den fertig gezeichneten Linienzug (IFC-Weltkoordinaten, Meter), der
 * Baukasten übernimmt ihn als Polygon-Profil für die Extrusion.
 */
import { create } from "zustand";

export interface DrawnPolygon {
  docId: string;
  /** Eckpunkte in IFC-Weltkoordinaten (Meter), ohne Wiederholung des ersten. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Höhenlage der Zeichenebene (IFC-Z, Meter). */
  z: number;
}

interface DrawState {
  polygon: DrawnPolygon | null;
  setPolygon(polygon: DrawnPolygon): void;
  clear(): void;
}

export const useDrawStore = create<DrawState>((set) => ({
  polygon: null,
  setPolygon: (polygon) => set({ polygon }),
  clear: () => set({ polygon: null }),
}));
