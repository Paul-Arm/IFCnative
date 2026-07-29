import {
  createNativeSampleDocument,
  serializeNativeIfcDocument,
  type NativeIfcDocument,
} from "@/ifc";

import type { Point } from "../types";

export interface WorkspaceDocumentSnapshot {
  document: NativeIfcDocument;
  graphAnchorId: number;
  graphCollapsed: Set<number>;
  graphExpanded: Set<number>;
  graphPinned: Set<number>;
  graphPositions: Map<number, Point>;
  selectedId: number;
  selectedIds: Set<number>;
}

export interface WorkspaceHistoryEntry {
  snapshot: WorkspaceDocumentSnapshot;
  summary: string;
}

export interface PendingViewerChange {
  key?: string;
  label: string;
}

export interface WorkspaceDocumentSession {
  id: string;
  document: NativeIfcDocument;
  documentText: string;
  documentTextDirty: boolean;
  graphAnchorId: number;
  graphCollapsed: Set<number>;
  graphExpanded: Set<number>;
  graphPinned: Set<number>;
  graphPositions: Map<number, Point>;
  /**
   * Geometrie-Änderungen, die im Dokument committed, aber noch nicht in das
   * Fragments-Modell übernommen sind. Werden mit "Modell neu berechnen" im
   * Viewer abgearbeitet (Revision-Bump → Re-Konvertierung). Einträge mit
   * gleichem key (z. B. Mehrfach-Verschiebung desselben Elements) werden
   * zusammengefasst und zählen als EINE Änderung.
   */
  pendingViewerChanges: PendingViewerChange[];
  selectedId: number;
  selectedIds: Set<number>;
  sourceIfcBytes: ArrayBuffer | null;
  sourceIfcFile: File | null;
  redoStack: WorkspaceHistoryEntry[];
  undoStack: WorkspaceHistoryEntry[];
  viewerModelBytes: ArrayBuffer | null;
  viewerModelDeferredReason: string;
  viewerModelFile: File | null;
  viewerModelLoadRequested: boolean;
  viewerModelRevision: number;
  viewerModelText: string;
}

let nextWorkspaceDocumentId = 0;

export const DOCUMENT_HISTORY_LIMIT = 20;

export function createWorkspaceDocumentSession(
  document: NativeIfcDocument,
  options?: {
    bytes?: ArrayBuffer | null;
    file?: File | null;
    graphPositions?: Map<number, Point>;
    id?: string;
    selectedId?: number;
    text?: string;
    viewerModelLoadRequested?: boolean;
    viewerModelRevision?: number;
  },
): WorkspaceDocumentSession {
  const sourceBytes = options?.bytes ?? null;
  const sourceFile = options?.file ?? null;
  const text =
    options?.text ?? (sourceBytes ? "" : serializeNativeIfcDocument(document));
  const viewerModelLoadRequested = options?.viewerModelLoadRequested ?? true;
  const viewerModelDeferredReason = "";
  const fallbackId =
    document.spatialRoots[0]?.id ?? document.entities[0]?.id ?? 0;
  const selectedId = document.entityById.has(options?.selectedId ?? 0)
    ? (options?.selectedId as number)
    : fallbackId;
  return {
    document,
    documentText: text,
    documentTextDirty: false,
    graphAnchorId: selectedId,
    graphCollapsed: new Set(),
    graphExpanded: new Set(),
    graphPinned: new Set(),
    graphPositions: options?.graphPositions ?? new Map(),
    id: options?.id ?? createWorkspaceDocumentId(document.fileName),
    pendingViewerChanges: [],
    redoStack: [],
    selectedId,
    selectedIds: new Set(),
    sourceIfcBytes: sourceBytes,
    sourceIfcFile: sourceFile,
    undoStack: [],
    viewerModelBytes: sourceBytes,
    viewerModelDeferredReason,
    viewerModelFile: sourceFile,
    viewerModelLoadRequested,
    viewerModelRevision: options?.viewerModelRevision ?? 0,
    viewerModelText: text,
  };
}

function createWorkspaceDocumentId(fileName: string) {
  nextWorkspaceDocumentId += 1;
  return `${fileName || "IFC"}:${Date.now().toString(36)}:${nextWorkspaceDocumentId}`;
}

export function createWorkspaceDocumentSnapshot(
  session: WorkspaceDocumentSession,
): WorkspaceDocumentSnapshot {
  return {
    document: session.document,
    graphAnchorId: session.graphAnchorId,
    graphCollapsed: new Set(session.graphCollapsed),
    graphExpanded: new Set(session.graphExpanded),
    graphPinned: new Set(session.graphPinned),
    graphPositions: new Map(session.graphPositions),
    selectedId: session.selectedId,
    selectedIds: new Set(session.selectedIds),
  };
}

export function createInitialWorkspaceDocument() {
  const document = createNativeSampleDocument();
  return createWorkspaceDocumentSession(document);
}

export function mergePendingViewerChange(
  current: PendingViewerChange[],
  next: PendingViewerChange,
): PendingViewerChange[] {
  if (next.key) {
    const index = current.findIndex((change) => change.key === next.key);
    if (index >= 0) {
      const merged = [...current];
      merged[index] = next;
      return merged;
    }
  }
  return [...current, next];
}
