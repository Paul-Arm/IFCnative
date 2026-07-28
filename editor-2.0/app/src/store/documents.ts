/**
 * Dokumente-Slice: Multi-Tab-Verwaltung der geöffneten Modelle.
 * Jedes Dokument hält seine ModelSession (Parser-Store + Mutations-Overlay)
 * und die Originalbytes für den Viewer.
 */
import { create } from "zustand";
import { ModelSession } from "../core/session";
import { useCommands } from "../commands/pipeline";
import { useSelection } from "./selection";
import { resolveIfcSource } from "../domain/export/archive";

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

/** Anzeigedauer einer Öffnen-Fehlermeldung in der Statusleiste (Befund 9). */
const ERROR_TIMEOUT_MS = 8000;
let errorTimer: ReturnType<typeof setTimeout> | null = null;

/** Flache Kopie ohne einen Schlüssel (Befund 8). */
function withoutKey<T>(
  record: Record<string, T>,
  key: string,
): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export const useDocuments = create<DocumentsState>((set, get) => ({
  documents: [],
  activeId: null,
  progress: null,

  async openDocument(fileName, buffer) {
    if (errorTimer !== null) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
    set({ progress: "Parse …" });
    try {
      // M7: ifcZIP/ZIP vor dem Parsen auspacken. Erkannt wird über die
      // Endung ODER die PK-Signatur (siehe domain/export/archive.ts), damit
      // auch falsch benannte Archive aufgehen; der Eintragsname wird zum
      // Sitzungsnamen. Ohne brauchbaren Puffer bleibt der alte Weg — der
      // Parser wirft dann wie bisher (Befund 9).
      const source = buffer ? resolveIfcSource(fileName, new Uint8Array(buffer)) : null;
      const session = await ModelSession.open(
        source?.fileName ?? fileName,
        source?.fromArchive ? source.bytes.slice().buffer : buffer,
        (percent, phase) => set({ progress: `${phase} ${percent.toFixed(0)} %` }),
      );
      const id = `doc-${nextId++}`;
      const entry: DocumentEntry = {
        id,
        session,
        bytes: source?.bytes ?? new Uint8Array(buffer),
        changeCount: 0,
      };
      set((state) => ({
        documents: [...state.documents, entry],
        activeId: id,
      }));
      set({ progress: null });
    } catch (error) {
      // Review-Befund 9: Ohne dieses catch endete jede kaputte Datei als
      // unhandled rejection — die Statusleiste blieb stumm. Der Fehler wird
      // im progress-Feld gemeldet und nach ERROR_TIMEOUT_MS (oder beim
      // nächsten Öffnen) wieder gelöscht.
      const message = error instanceof Error ? error.message : String(error);
      set({ progress: `Fehler beim Öffnen von ${fileName}: ${message}` });
      errorTimer = setTimeout(() => {
        errorTimer = null;
        set({ progress: null });
      }, ERROR_TIMEOUT_MS);
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
    // Review-Befund 8: Undo-/Redo-Stapel, Audit-Log und Auswahl sind je
    // Dokument abgelegt und überlebten das Schließen — ein Leck, das bei
    // langen Sitzungen wächst und (bei wiederverwendeten docIds) fremde
    // Historie zurückbringen könnte. Aufgeräumt wird per setState, weil
    // pipeline.ts keine passende Aktion anbietet.
    useCommands.setState((state) => ({
      byDocument: withoutKey(state.byDocument, id),
    }));
    useSelection.setState((state) => ({
      byDocument: withoutKey(state.byDocument, id),
    }));
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
