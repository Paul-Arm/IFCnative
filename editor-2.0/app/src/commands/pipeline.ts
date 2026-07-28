/**
 * Command-Pipeline (M2): jede Änderung am Modell läuft als EditorCommand
 * mit `run`/`undo` durch `execute()`. Die Pipeline führt Undo-/Redo-Stapel
 * je Dokument, schreibt das Audit-Log (eine menschenlesbare Zeile pro
 * Operation) und stößt die UI-Aktualisierung an (documents.touch).
 *
 * Die eigentliche Modelländerung passiert im Mutations-Overlay von
 * ifc-lite (`MutablePropertyView`/`StoreEditor`); Undo nutzt dessen
 * `skipHistory`-Pfade, damit die Mutationsliste fürs Exportieren sauber bleibt.
 */
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useDocuments } from "../store/documents";

export interface EditorCommand {
  /** Menschenlesbar, z. B. „Property ‚FireRating' auf 3 Objekte gesetzt" */
  label: string;
  run(): void;
  undo(): void;
}

export interface AuditEntry {
  label: string;
  at: string;
  kind: "do" | "undo" | "redo";
}

interface DocHistory {
  undoStack: EditorCommand[];
  redoStack: EditorCommand[];
  audit: AuditEntry[];
}

interface CommandState {
  byDocument: Record<string, DocHistory>;
  execute(docId: string, command: EditorCommand): void;
  undo(docId: string): void;
  redo(docId: string): void;
}

const HISTORY_LIMIT = 100;
const AUDIT_LIMIT = 500;

const emptyHistory = (): DocHistory => ({
  undoStack: [],
  redoStack: [],
  audit: [],
});

function withAudit(history: DocHistory, label: string, kind: AuditEntry["kind"]): AuditEntry[] {
  return [
    ...history.audit.slice(-AUDIT_LIMIT + 1),
    { label, at: new Date().toISOString(), kind },
  ];
}

export const useCommands = create<CommandState>((set, get) => ({
  byDocument: {},

  execute(docId, command) {
    command.run();
    set((state) => {
      const history = state.byDocument[docId] ?? emptyHistory();
      return {
        byDocument: {
          ...state.byDocument,
          [docId]: {
            undoStack: [...history.undoStack.slice(-HISTORY_LIMIT + 1), command],
            redoStack: [],
            audit: withAudit(history, command.label, "do"),
          },
        },
      };
    });
    useDocuments.getState().touch(docId);
  },

  undo(docId) {
    const history = get().byDocument[docId];
    const command = history?.undoStack.at(-1);
    if (!command) return;
    command.undo();
    set((state) => ({
      byDocument: {
        ...state.byDocument,
        [docId]: {
          undoStack: history.undoStack.slice(0, -1),
          redoStack: [...history.redoStack, command],
          audit: withAudit(history, command.label, "undo"),
        },
      },
    }));
    useDocuments.getState().touch(docId);
  },

  redo(docId) {
    const history = get().byDocument[docId];
    const command = history?.redoStack.at(-1);
    if (!command) return;
    command.run();
    set((state) => ({
      byDocument: {
        ...state.byDocument,
        [docId]: {
          undoStack: [...history.undoStack, command],
          redoStack: history.redoStack.slice(0, -1),
          audit: withAudit(history, command.label, "redo"),
        },
      },
    }));
    useDocuments.getState().touch(docId);
  },
}));

/** Nächste Undo-/Redo-Beschriftung für Tooltips (null = nichts vorhanden). */
export function useUndoRedoLabels(docId: string | null): {
  undoLabel: string | null;
  redoLabel: string | null;
} {
  return useCommands(
    useShallow((s) => {
      const history = docId ? s.byDocument[docId] : undefined;
      return {
        undoLabel: history?.undoStack.at(-1)?.label ?? null,
        redoLabel: history?.redoStack.at(-1)?.label ?? null,
      };
    }),
  );
}
