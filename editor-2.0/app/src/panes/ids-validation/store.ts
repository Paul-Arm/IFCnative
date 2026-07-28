/**
 * Laufzustand des IDS-Fensters je Dokument. Eigener kleiner Store statt
 * Komponentenzustand, damit ein Layout-Wechsel (Pane wird aus- und wieder
 * eingehängt) das Ergebnis nicht verwirft. Der Prüfzentrums-Store
 * (`domain/checks/store.ts`) bleibt unangetastet — er hält flache Befunde,
 * hier liegt der Spezifikations-Baum.
 */
import { create } from "zustand";

import type { ModelSession } from "../../core/session";
import { useIdsDocuments } from "../../domain/checks/idsSource";
import type { IdsRunResult } from "./model";
import { runIdsValidation } from "./run";

export interface IdsDocState {
  running: boolean;
  result: IdsRunResult | null;
  error: string | null;
}

export const EMPTY_IDS_STATE: IdsDocState = {
  running: false,
  result: null,
  error: null,
};

interface IdsValidationStore {
  byDocument: Record<string, IdsDocState>;
  run(docId: string, session: ModelSession, revision: number): Promise<void>;
  reset(docId: string): void;
}

export const useIdsValidation = create<IdsValidationStore>((set, get) => ({
  byDocument: {},

  async run(docId, session, revision) {
    if (get().byDocument[docId]?.running) return;
    const entries = useIdsDocuments.getState().entries;
    const patch = (state: IdsDocState): void => {
      set((s) => ({ byDocument: { ...s.byDocument, [docId]: state } }));
    };
    patch({ running: true, result: get().byDocument[docId]?.result ?? null, error: null });
    try {
      const result = await runIdsValidation(session, entries, revision);
      patch({ running: false, result, error: null });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      patch({
        running: false,
        result: get().byDocument[docId]?.result ?? null,
        error: `Validierung fehlgeschlagen: ${reason}`,
      });
    }
  },

  reset(docId) {
    set((s) => ({ byDocument: { ...s.byDocument, [docId]: EMPTY_IDS_STATE } }));
  },
}));

export function useIdsDocState(docId: string | null): IdsDocState {
  return useIdsValidation((s) =>
    docId ? (s.byDocument[docId] ?? EMPTY_IDS_STATE) : EMPTY_IDS_STATE,
  );
}
