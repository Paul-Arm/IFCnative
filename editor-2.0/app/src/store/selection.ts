/**
 * Auswahl-Slice: Mehrfachauswahl je Dokument, synchron über Baum, Graph,
 * Inspector und Viewer. `focusRequest` bittet den Viewer, die Kamera auf ein
 * Objekt zu zentrieren (Taste „." wie in 1.x).
 */
import { create } from "zustand";

interface SelectionState {
  /** docId → ausgewählte expressIds (Einfüge-Reihenfolge = Auswahlreihenfolge) */
  byDocument: Record<string, number[]>;
  /** Letzter Fokus-Wunsch an den Viewer */
  focusRequest: { docId: string; expressId: number; nonce: number } | null;

  select(docId: string, expressId: number, additive?: boolean): void;
  setSelection(docId: string, expressIds: number[]): void;
  clear(docId: string): void;
  requestFocus(docId: string, expressId: number): void;
}

export const useSelection = create<SelectionState>((set) => ({
  byDocument: {},
  focusRequest: null,

  select(docId, expressId, additive = false) {
    set((state) => {
      const current = state.byDocument[docId] ?? [];
      let next: number[];
      if (!additive) {
        next = [expressId];
      } else if (current.includes(expressId)) {
        next = current.filter((id) => id !== expressId);
      } else {
        next = [...current, expressId];
      }
      return { byDocument: { ...state.byDocument, [docId]: next } };
    });
  },

  setSelection(docId, expressIds) {
    set((state) => ({
      byDocument: { ...state.byDocument, [docId]: [...expressIds] },
    }));
  },

  clear(docId) {
    set((state) => ({
      byDocument: { ...state.byDocument, [docId]: [] },
    }));
  },

  requestFocus(docId, expressId) {
    set((state) => ({
      focusRequest: {
        docId,
        expressId,
        nonce: (state.focusRequest?.nonce ?? 0) + 1,
      },
    }));
  },
}));

/** Auswahl des Dokuments (leeres Array statt undefined). */
const EMPTY: number[] = [];
export function useSelectionOf(docId: string | null): number[] {
  return useSelection((s) => (docId ? (s.byDocument[docId] ?? EMPTY) : EMPTY));
}
