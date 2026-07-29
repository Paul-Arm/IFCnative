import {
  startTransition,
  useMemo,
  useState,
  type SetStateAction,
} from "react";

import { serializeNativeIfcDocument, type NativeIfcDocument } from "@/ifc";

import type {
  ViewerMirrorOp,
  ViewerMirrorRequest,
  ViewerMirrorResult,
} from "../../that-open-viewer.types";
import { applyStateAction } from "../lib/collections";
import type { Point } from "../types";
import {
  DOCUMENT_HISTORY_LIMIT,
  createInitialWorkspaceDocument,
  createWorkspaceDocumentSession,
  createWorkspaceDocumentSnapshot,
  mergePendingViewerChange,
  type WorkspaceDocumentSession,
  type WorkspaceHistoryEntry,
} from "./documentSession";

export interface CommitDocumentOptions {
  reloadViewer?: boolean;
  /**
   * Fasst wiederholte Änderungen zusammen: existiert bereits ein
   * ausstehender Eintrag mit diesem key, wird nur dessen Label ersetzt
   * (z. B. transform:<id> bei Mehrfach-Verschiebung).
   */
  pendingKey?: string;
  /**
   * Dual-Write: die Änderung wird sofort per Fragments-Edit-API in das
   * geladene Modell gespiegelt. Der Pending-Eintrag bleibt als Fallback
   * bestehen und wird erst bei gemeldetem Mirror-Erfolg entfernt —
   * schlägt der Mirror fehl, bleibt "Modell neu berechnen" verfügbar.
   */
  viewerMirror?: ViewerMirrorOp;
}

export type CommitDocument = (
  next: NativeIfcDocument,
  nextSelectedId: number | undefined,
  summary: string,
  log?: string,
  nextGraphPositions?: Map<number, Point>,
  options?: CommitDocumentOptions,
) => void;

/**
 * Zentrale Verwaltung der offenen IFC-Dokumente: Sessions, aktive Auswahl,
 * Graph-Zustand, Undo/Redo-Historie und die Synchronisation mit dem
 * 3D-Viewer (Pending-Änderungen, Live-Mirror, Re-Konvertierung).
 */
export function useDocumentSessions(options: {
  logAction: (code: string) => void;
  /** Wird vor Undo/Redo aufgerufen (z. B. offene Lösch-Dialoge schließen). */
  onBeforeHistoryRestore?: () => void;
}) {
  const { logAction, onBeforeHistoryRestore } = options;
  const [initialDocument] = useState(createInitialWorkspaceDocument);
  const [documentSessions, setDocumentSessions] = useState<
    WorkspaceDocumentSession[]
  >(() => [initialDocument]);
  const [activeDocumentId, setActiveDocumentId] = useState(initialDocument.id);
  const [viewerMirrorRequest, setViewerMirrorRequest] =
    useState<ViewerMirrorRequest | null>(null);

  const activeSession =
    documentSessions.find((session) => session.id === activeDocumentId) ??
    documentSessions[0];
  const document = activeSession.document;
  const selectedId = activeSession.selectedId;
  const selectedIds = activeSession.selectedIds;

  const updateActiveSession = (
    updater: (session: WorkspaceDocumentSession) => WorkspaceDocumentSession,
  ) => {
    setDocumentSessions((current) =>
      current.map((session) =>
        session.id === activeSession.id ? updater(session) : session,
      ),
    );
  };

  const setSelectedId = (action: SetStateAction<number>) => {
    updateActiveSession((session) => ({
      ...session,
      selectedId: applyStateAction(session.selectedId, action),
    }));
  };

  const setSelectedIds = (action: SetStateAction<Set<number>>) => {
    updateActiveSession((session) => ({
      ...session,
      selectedIds: applyStateAction(session.selectedIds, action),
    }));
  };

  // Objects targeted by batch operations: the explicit multi-selection from the
  // tree, or the single active object when nothing else is selected.
  const batchSelectionIds = useMemo(() => {
    const ids = [...selectedIds].filter((id) => document.entityById.has(id));
    return ids.length > 0
      ? ids
      : document.entityById.has(selectedId)
        ? [selectedId]
        : [];
  }, [document, selectedId, selectedIds]);

  const setGraphAnchorId = (action: SetStateAction<number>) => {
    updateActiveSession((session) => ({
      ...session,
      graphAnchorId: applyStateAction(session.graphAnchorId, action),
    }));
  };

  const setGraphPinned = (action: SetStateAction<Set<number>>) => {
    updateActiveSession((session) => ({
      ...session,
      graphPinned: applyStateAction(session.graphPinned, action),
    }));
  };

  const setGraphExpanded = (action: SetStateAction<Set<number>>) => {
    updateActiveSession((session) => ({
      ...session,
      graphExpanded: applyStateAction(session.graphExpanded, action),
    }));
  };

  const setGraphCollapsed = (action: SetStateAction<Set<number>>) => {
    updateActiveSession((session) => ({
      ...session,
      graphCollapsed: applyStateAction(session.graphCollapsed, action),
    }));
  };

  const setGraphPositions = (action: SetStateAction<Map<number, Point>>) => {
    updateActiveSession((session) => ({
      ...session,
      graphPositions: applyStateAction(session.graphPositions, action),
    }));
  };

  const replaceDocument = (
    next: NativeIfcDocument,
    nextSelectedId?: number,
    log?: string,
    nextGraphPositions?: Map<number, Point>,
    nextText?: string,
    nextBytes?: ArrayBuffer | null,
    nextFile?: File | null,
  ) => {
    const session = createWorkspaceDocumentSession(next, {
      bytes: nextBytes,
      file: nextFile,
      graphPositions: nextGraphPositions,
      selectedId: nextSelectedId,
      text: nextText,
    });
    startTransition(() => {
      setDocumentSessions([session]);
      setActiveDocumentId(session.id);
    });
    if (log) {
      logAction(log);
    }
    return session;
  };

  const appendSessions = (nextSessions: WorkspaceDocumentSession[]) => {
    if (!nextSessions.length) {
      return;
    }
    startTransition(() => {
      setDocumentSessions((current) => [...current, ...nextSessions]);
      setActiveDocumentId(nextSessions[0].id);
    });
  };

  const commitDocument: CommitDocument = (
    next,
    nextSelectedId,
    summary,
    log,
    nextGraphPositions,
    options,
  ) => {
    const committedSessionId = activeSession.id;
    const previousSnapshot = createWorkspaceDocumentSnapshot(activeSession);
    const resolvedSelectedId = next.entityById.has(nextSelectedId ?? 0)
      ? (nextSelectedId as number)
      : (next.spatialRoots[0]?.id ?? next.entities[0]?.id ?? selectedId);
    setDocumentSessions((current) =>
      current.map((session) => {
        if (session.id !== committedSessionId) {
          return session;
        }
        return {
          ...session,
          document: next,
          // Bewusst NICHT sofort serialisieren (O(Dokumentgröße) pro Edit,
          // relevant bei großen IFC-Dateien): Export und Neuberechnung
          // serialisieren bei documentTextDirty selbst.
          documentTextDirty: true,
          graphPositions: nextGraphPositions ?? session.graphPositions,
          // Geometrie-Änderungen sammeln sich als ausstehende Änderungen;
          // der Live-Mirror räumt sie bei Erfolg wieder ab. Ohne Mirror
          // übernimmt "Modell neu berechnen" (Revision-Bump) sie in den
          // Viewer. viewerModel* bleibt bis dahin unverändert (stabiler
          // Load-Key).
          pendingViewerChanges: options?.reloadViewer
            ? mergePendingViewerChange(session.pendingViewerChanges, {
                key: options.pendingKey,
                label: summary,
              })
            : session.pendingViewerChanges,
          redoStack: next === session.document ? (session.redoStack ?? []) : [],
          selectedId: resolvedSelectedId,
          selectedIds: new Set(
            [...session.selectedIds].filter((id) => next.entityById.has(id)),
          ),
          sourceIfcBytes: options?.reloadViewer ? null : session.sourceIfcBytes,
          sourceIfcFile: options?.reloadViewer ? null : session.sourceIfcFile,
          viewerModelDeferredReason: options?.reloadViewer
            ? session.viewerModelLoadRequested
              ? ""
              : session.viewerModelDeferredReason ||
                "3D-Konvertierung pausiert."
            : session.viewerModelDeferredReason,
          viewerModelLoadRequested: session.viewerModelLoadRequested,
          undoStack:
            next === session.document
              ? (session.undoStack ?? [])
              : [
                  ...(session.undoStack ?? []),
                  {
                    snapshot: previousSnapshot,
                    summary,
                  },
                ].slice(-DOCUMENT_HISTORY_LIMIT),
        };
      }),
    );
    if (
      options?.reloadViewer &&
      options.viewerMirror &&
      activeSession.viewerModelLoadRequested
    ) {
      setViewerMirrorRequest({
        documentId: committedSessionId,
        label: summary,
        nonce: Date.now() + Math.random(),
        op: options.viewerMirror,
        pendingKey: options.pendingKey,
      });
    }
    if (log) {
      logAction(log);
    }
  };

  // Rückmeldung des Live-Mirrors: bei Erfolg ist die Änderung im Viewer
  // sichtbar — der zugehörige Pending-Eintrag (Fallback-Recalc) entfällt.
  // Bei Fehlschlag bleibt er bestehen bzw. wird wiederhergestellt.
  const applyViewerMirrorResult = (result: ViewerMirrorResult) => {
    setDocumentSessions((current) =>
      current.map((session) => {
        if (session.id !== result.documentId) {
          return session;
        }
        if (!result.ok) {
          return {
            ...session,
            pendingViewerChanges: mergePendingViewerChange(
              session.pendingViewerChanges,
              { key: result.pendingKey, label: result.label },
            ),
          };
        }
        const remaining = session.pendingViewerChanges.filter((change) =>
          result.pendingKey
            ? change.key !== result.pendingKey
            : change.label !== result.label,
        );
        return remaining.length === session.pendingViewerChanges.length
          ? session
          : { ...session, pendingViewerChanges: remaining };
      }),
    );
    logAction(
      result.ok
        ? `viewer.mirrorApplied({ label: ${JSON.stringify(result.label)} });`
        : `viewer.mirrorFailed({ label: ${JSON.stringify(result.label)}, reason: ${JSON.stringify(result.reason ?? "unknown")} });`,
    );
  };

  // "Modell neu berechnen": alle ausstehenden Geometrie-Änderungen in einem
  // Rutsch übernehmen — Viewer-Quelle auf den aktuellen IFC-Text setzen und
  // per Revision-Bump die Re-Konvertierung des aktiven Dokuments auslösen.
  const recalculateViewerModel = () => {
    const sessionId = activeSession.id;
    const pendingCount = activeSession.pendingViewerChanges.length;
    if (!pendingCount) {
      return;
    }
    setDocumentSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              pendingViewerChanges: [],
              viewerModelBytes: null,
              viewerModelFile: null,
              viewerModelRevision: session.viewerModelRevision + 1,
              viewerModelText: session.documentTextDirty
                ? serializeNativeIfcDocument(session.document)
                : session.documentText,
            }
          : session,
      ),
    );
    logAction(
      `viewer.recalculate({ file: '${activeSession.document.fileName}', pending: ${pendingCount} });`,
    );
  };

  const restoreDocumentHistory = (direction: "undo" | "redo") => {
    const sourceStack =
      direction === "undo" ? activeSession.undoStack : activeSession.redoStack;
    const entry = sourceStack.at(-1);
    if (!entry) {
      return;
    }
    const restored = entry.snapshot;
    const restoredSelectedId = restored.document.entityById.has(
      restored.selectedId,
    )
      ? restored.selectedId
      : (restored.document.spatialRoots[0]?.id ??
        restored.document.entities[0]?.id ??
        0);
    const viewerModelText = serializeNativeIfcDocument(restored.document);
    const sessionId = activeSession.id;
    onBeforeHistoryRestore?.();
    setDocumentSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        const currentEntry: WorkspaceHistoryEntry = {
          snapshot: createWorkspaceDocumentSnapshot(session),
          summary: entry.summary,
        };
        return {
          ...session,
          document: restored.document,
          documentTextDirty: true,
          graphAnchorId: restored.graphAnchorId,
          graphCollapsed: new Set(restored.graphCollapsed),
          graphExpanded: new Set(restored.graphExpanded),
          graphPinned: new Set(restored.graphPinned),
          graphPositions: new Map(restored.graphPositions),
          pendingViewerChanges: [],
          redoStack:
            direction === "undo"
              ? [...(session.redoStack ?? []), currentEntry].slice(
                  -DOCUMENT_HISTORY_LIMIT,
                )
              : (session.redoStack ?? []).slice(0, -1),
          selectedId: restoredSelectedId,
          selectedIds: new Set(
            [...restored.selectedIds].filter((id) =>
              restored.document.entityById.has(id),
            ),
          ),
          sourceIfcBytes: null,
          sourceIfcFile: null,
          undoStack:
            direction === "undo"
              ? (session.undoStack ?? []).slice(0, -1)
              : [...(session.undoStack ?? []), currentEntry].slice(
                  -DOCUMENT_HISTORY_LIMIT,
                ),
          viewerModelBytes: null,
          viewerModelFile: null,
          viewerModelRevision: session.viewerModelRevision + 1,
          viewerModelText,
        };
      }),
    );
    logAction(
      `history.${direction}({ summary: ${JSON.stringify(entry.summary)} });`,
    );
  };

  const requestActiveViewerLoad = () => {
    const sessionId = activeSession.id;
    setDocumentSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        // Ausstehende Geometrie-Änderungen sind noch nicht in viewerModel*:
        // dann vom aktuellen IFC-Text statt von den Original-Bytes laden.
        const hasPending = session.pendingViewerChanges.length > 0;
        return {
          ...session,
          pendingViewerChanges: [],
          viewerModelBytes: hasPending ? null : session.viewerModelBytes,
          viewerModelDeferredReason: "",
          viewerModelFile: hasPending ? null : session.viewerModelFile,
          viewerModelLoadRequested: true,
          viewerModelRevision: session.viewerModelRevision + 1,
          viewerModelText: hasPending
            ? session.documentTextDirty
              ? serializeNativeIfcDocument(session.document)
              : session.documentText
            : session.viewerModelText,
        };
      }),
    );
    logAction(
      `viewer.loadRequested({ file: '${activeSession.document.fileName}' });`,
    );
  };

  const closeDocumentSession = (sessionId: string) => {
    const session = documentSessions.find((item) => item.id === sessionId);
    if (!session || documentSessions.length <= 1) {
      return;
    }
    if (
      session.documentTextDirty &&
      !globalThis.confirm(
        `"${session.document.fileName}" hat ungespeicherte Änderungen. Trotzdem schließen?`,
      )
    ) {
      return;
    }
    const remaining = documentSessions.filter((item) => item.id !== sessionId);
    setDocumentSessions(remaining);
    if (activeDocumentId === sessionId && remaining.length) {
      setActiveDocumentId(remaining[0].id);
    }
    logAction(
      `workspace.closeDocument({ file: '${session.document.fileName}' });`,
    );
  };

  return {
    activeDocumentId,
    activeSession,
    appendSessions,
    applyViewerMirrorResult,
    batchSelectionIds,
    closeDocumentSession,
    commitDocument,
    document,
    documentSessions,
    recalculateViewerModel,
    redoDocument: () => restoreDocumentHistory("redo"),
    replaceDocument,
    requestActiveViewerLoad,
    selectedId,
    selectedIds,
    setActiveDocumentId,
    setDocumentSessions,
    setGraphAnchorId,
    setGraphCollapsed,
    setGraphExpanded,
    setGraphPinned,
    setGraphPositions,
    setSelectedId,
    setSelectedIds,
    undoDocument: () => restoreDocumentHistory("undo"),
    updateActiveSession,
    viewerMirrorRequest,
  };
}
