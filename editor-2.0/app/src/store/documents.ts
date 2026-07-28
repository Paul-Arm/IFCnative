/**
 * Dokumente-Slice: Multi-Tab-Verwaltung der geöffneten Modelle.
 * Jedes Dokument hält seine ModelSession (Parser-Store + Mutations-Overlay)
 * und die Originalbytes für den Viewer.
 */
import { create } from "zustand";
import { ModelSession } from "../core/session";

export interface DocumentEntry {
  id: string;
  session: ModelSession;
  /** Originalbytes für Geometrie-Streaming im Viewer */
  bytes: Uint8Array;
  /** Zähler für Undo-lose M1-Änderungsanzeige (Mutations im Overlay) */
  changeCount: number;
}

interface DocumentsState {
  documents: DocumentEntry[];
  activeId: string | null;
  openDocument(fileName: string, buffer: ArrayBuffer): Promise<void>;
  closeDocument(id: string): void;
  setActive(id: string): void;
  /** Nach einer Mutation aufrufen, damit Tabs/Statusleiste aktualisieren. */
  touch(id: string): void;
  /** Parse-Fortschritt für die Statusleiste */
  progress: string | null;
}

let nextId = 1;

export const useDocuments = create<DocumentsState>((set, get) => ({
  documents: [],
  activeId: null,
  progress: null,

  async openDocument(fileName, buffer) {
    set({ progress: "Parse …" });
    try {
      const session = await ModelSession.open(fileName, buffer, (percent, phase) =>
        set({ progress: `${phase} ${percent.toFixed(0)} %` }),
      );
      const id = `doc-${nextId++}`;
      const entry: DocumentEntry = {
        id,
        session,
        bytes: new Uint8Array(buffer),
        changeCount: 0,
      };
      set((state) => ({
        documents: [...state.documents, entry],
        activeId: id,
      }));
    } finally {
      set({ progress: null });
    }
  },

  closeDocument(id) {
    set((state) => {
      const documents = state.documents.filter((d) => d.id !== id);
      const activeId =
        state.activeId === id
          ? (documents[documents.length - 1]?.id ?? null)
          : state.activeId;
      return { documents, activeId };
    });
  },

  setActive(id) {
    if (get().documents.some((d) => d.id === id)) set({ activeId: id });
  },

  touch(id) {
    set((state) => ({
      documents: state.documents.map((d) =>
        d.id === id ? { ...d, changeCount: d.session.changeCount } : d,
      ),
    }));
  },
}));

/** Aktives Dokument oder null — der Standard-Hook der Panes. */
export function useActiveDocument(): DocumentEntry | null {
  return useDocuments(
    (s) => s.documents.find((d) => d.id === s.activeId) ?? null,
  );
}
