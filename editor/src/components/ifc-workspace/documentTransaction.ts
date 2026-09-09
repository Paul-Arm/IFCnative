import { applyNativeDocumentDelta, diffNativeDocuments, getNativeIdentityAttributeIndexes, isEmptyNativeDocumentDelta, serializeNativeIfcDocument, type NativeDocumentDelta, type NativeIfcDocument, type NativeIfcEntity } from "../../ifc/nativeDocument";
import type { VcsDocumentOrigin } from "../../vcs/types";
import type { Point } from "./types";

const HISTORY_LIMIT = 20;
const serializedDocuments = new WeakMap<NativeIfcDocument, string>();

/** Shared text source for saving, recovery and viewer refresh; never changes dirty state. */
export function readDocumentText(session: WorkspaceDocumentSession): string {
  if (!session.documentTextDirty) {
    if (session.documentText) return session.documentText;
    if (session.sourceIfcBytes) return new TextDecoder().decode(session.sourceIfcBytes);
  }
  let text = serializedDocuments.get(session.document);
  if (text === undefined) {
    text = serializeNativeIfcDocument(session.document);
    serializedDocuments.set(session.document, text);
  }
  return text;
}

/** Refresh the viewer and text cache from exactly the same revision. */
export function refreshDocumentViewer(session: WorkspaceDocumentSession): WorkspaceDocumentSession {
  const text = readDocumentText(session);
  return {
    ...session,
    documentText: text, documentTextDirty: false, pendingViewerChanges: [],
    viewerModelBytes: null, viewerModelFile: null, viewerModelText: text,
    viewerModelRevision: session.viewerModelRevision + 1, viewerModelTextStale: false,
  };
}

export function requestDocumentViewerLoad(session: WorkspaceDocumentSession): WorkspaceDocumentSession {
  const refreshed = session.pendingViewerChanges.length || session.viewerModelTextStale
    ? refreshDocumentViewer(session)
    : { ...session, viewerModelRevision: session.viewerModelRevision + 1 };
  return { ...refreshed, viewerModelLoadRequested: true, viewerModelDeferredReason: "" };
}

export function mergePendingViewerChange(
  current: WorkspaceDocumentSession["pendingViewerChanges"],
  next: WorkspaceDocumentSession["pendingViewerChanges"][number],
): WorkspaceDocumentSession["pendingViewerChanges"] {
  const index = next.key ? current.findIndex((change) => change.key === next.key) : -1;
  if (index < 0) return [...current, next];
  const merged = [...current];
  merged[index] = next;
  return merged;
}

function metadataEntity(entity: NativeIfcEntity) {
  return entity.type.startsWith("IFCPROPERTY") || entity.type.startsWith("IFCQUANTITY") ||
    entity.type === "IFCELEMENTQUANTITY" || entity.type === "IFCRELDEFINESBYPROPERTIES" ||
    entity.type === "IFCGROUP" || entity.type === "IFCRELASSIGNSTOGROUP";
}

export function deltaAffectsGeometry(delta: NativeDocumentDelta, schema: string): boolean {
  if ([...delta.added, ...delta.removed].some((entity) => !metadataEntity(entity))) return true;
  return delta.changed.some(({ before, after }) => {
    if (metadataEntity(before) && metadataEntity(after)) return false;
    if (before.type !== after.type || before.args.length !== after.args.length) return true;
    const identity = getNativeIdentityAttributeIndexes(after, schema);
    return after.args.some((arg, index) => index !== identity.name && index !== identity.description && arg !== before.args[index]);
  });
}

export interface DocumentTransaction {
  base: NativeIfcDocument;
  document: NativeIfcDocument;
  delta: NativeDocumentDelta;
  affectsGeometry: boolean;
  summary: string;
}

export function createDocumentTransaction(base: NativeIfcDocument, document: NativeIfcDocument, summary: string): DocumentTransaction {
  const delta = diffNativeDocuments(base, document);
  return { base, document, delta, affectsGeometry: deltaAffectsGeometry(delta, document.schema), summary };
}

/** One entry point for model revision, history, text cache and viewer invalidation. */
export function commitDocumentTransaction(
  session: WorkspaceDocumentSession,
  transaction: DocumentTransaction,
  options: { selectedId?: number; graphPositions?: Map<number, Point>; pendingKey?: string } = {},
): WorkspaceDocumentSession {
  if (isEmptyNativeDocumentDelta(transaction.delta)) return session;
  let next = transaction.document;
  if (session.document !== transaction.base) {
    const touched = [...transaction.delta.removed, ...transaction.delta.changed.map((pair) => pair.before)];
    if (touched.some((entity) => session.document.entityById.get(entity.id) !== entity) ||
        transaction.delta.added.some((entity) => session.document.entityById.has(entity.id))) {
      throw new Error("Das Dokument wurde inzwischen geändert. Bitte die Bearbeitung erneut ausführen.");
    }
    next = applyNativeDocumentDelta(session.document, transaction.delta, "redo");
  }
  const selectedId = next.entityById.has(options.selectedId ?? 0) ? options.selectedId! :
    next.entityById.has(session.selectedId) ? session.selectedId : next.spatialRoots[0]?.id ?? next.entities[0]?.id ?? 0;
  const surviving = [...session.selectedIds].filter((id) => next.entityById.has(id));
  const selectedIds = surviving.includes(selectedId) ? new Set(surviving) :
    !surviving.length || next.entityById.has(session.selectedId) ? new Set([selectedId]) : new Set([...surviving, selectedId]);
  const pendingViewerChanges = transaction.affectsGeometry
    ? mergePendingViewerChange(session.pendingViewerChanges, { key: options.pendingKey, label: transaction.summary })
    : session.pendingViewerChanges;
  return {
    ...session, document: next, documentRevision: session.documentRevision + 1,
    documentTextDirty: true, hasUnexportedChanges: true,
    selectedId, selectedIds, graphPositions: options.graphPositions ?? session.graphPositions,
    pendingViewerChanges, redoStack: [],
    undoStack: [...session.undoStack, { delta: transaction.delta, affectsGeometry: transaction.affectsGeometry, summary: transaction.summary, ui: createWorkspaceUiSnapshot(session) }].slice(-HISTORY_LIMIT),
    sourceIfcBytes: null, sourceIfcFile: null,
  };
}

export function restoreDocumentTransaction(session: WorkspaceDocumentSession, direction: "undo" | "redo"): WorkspaceDocumentSession {
  const entry = (direction === "undo" ? session.undoStack : session.redoStack).at(-1);
  if (!entry) return session;
  const document = applyNativeDocumentDelta(session.document, entry.delta, direction);
  const currentEntry = { ...entry, ui: createWorkspaceUiSnapshot(session) };
  const selectedId = document.entityById.has(entry.ui.selectedId) ? entry.ui.selectedId : document.spatialRoots[0]?.id ?? document.entities[0]?.id ?? 0;
  const restored: WorkspaceDocumentSession = {
    ...session, ...entry.ui, document, selectedId,
    selectedIds: new Set([...entry.ui.selectedIds].filter((id) => document.entityById.has(id))),
    documentRevision: session.documentRevision + 1,
    documentTextDirty: true, hasUnexportedChanges: true,
    sourceIfcBytes: null, sourceIfcFile: null,
    undoStack: direction === "undo" ? session.undoStack.slice(0, -1) : [...session.undoStack, currentEntry].slice(-HISTORY_LIMIT),
    redoStack: direction === "redo" ? session.redoStack.slice(0, -1) : [...session.redoStack, currentEntry].slice(-HISTORY_LIMIT),
  };
  return entry.affectsGeometry ? refreshDocumentViewer(restored) : restored;
}

export interface DocumentSaveSnapshot {
  sessionId: string;
  document: NativeIfcDocument;
  revision: number;
  text: string;
}

export function captureDocumentSave(session: WorkspaceDocumentSession): DocumentSaveSnapshot {
  return {
    sessionId: session.id, document: session.document, revision: session.documentRevision,
    text: readDocumentText(session),
  };
}

/** Acknowledging an older revision never replaces the current text cache or dirty state. */
export function acknowledgeDocumentSave(session: WorkspaceDocumentSession, snapshot: DocumentSaveSnapshot): WorkspaceDocumentSession {
  if (session.id !== snapshot.sessionId || session.document !== snapshot.document || session.documentRevision !== snapshot.revision) return session;
  return { ...session, documentText: snapshot.text, documentTextDirty: false, hasUnexportedChanges: false };
}

export interface WorkspaceUiSnapshot {
  graphAnchorId: number;
  graphCollapsed: Set<number>;
  graphExpanded: Set<number>;
  graphPinned: Set<number>;
  graphPositions: Map<number, Point>;
  selectedId: number;
  selectedIds: Set<number>;
}

/**
 * Undo/Redo-Eintrag: statt vollständiger Dokument-Snapshots wird nur das
 * Entity-Delta gespeichert. Dank Structural Sharing des Dokuments sind das
 * wenige geteilte Objektreferenzen — auch bei großen IFCs.
 */
export interface WorkspaceHistoryEntry {
  delta: NativeDocumentDelta;
  affectsGeometry: boolean;
  summary: string;
  ui: WorkspaceUiSnapshot;
}

export interface WorkspaceDocumentSession {
  id: string;
  document: NativeIfcDocument;
  documentRevision: number;
  documentText: string;
  /**
   * Reines Cache-Flag: documentText hinkt dem Dokument hinterher und muss vor
   * Verwendung neu serialisiert werden. Sagt NICHTS über gespeichert/exportiert
   * aus — dafür gibt es hasUnexportedChanges.
   */
  documentTextDirty: boolean;
  /**
   * Das Dokument enthält Änderungen, die noch in keiner exportierten Datei
   * stehen. Steuert Autosave/Recovery, Tab-Punkt, Footer und die
   * Schließen-Rückfrage; wird nur von einem erfolgreichen Export gelöscht.
   */
  hasUnexportedChanges: boolean;
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
  pendingViewerChanges: { key?: string; label: string }[];
  selectedId: number;
  selectedIds: Set<number>;
  sourceIfcBytes: ArrayBuffer | null;
  sourceIfcFile: File | null;
  redoStack: WorkspaceHistoryEntry[];
  undoStack: WorkspaceHistoryEntry[];
  /**
   * Hub-Herkunft des Dokuments (Projekt/Modell/Branch): gesetzt, wenn der
   * Stand vom IFC Hub geladen wurde. Steuert den Speichern-Dialog mit der
   * Option "auf den Hub committen"; null = rein lokales Dokument.
   */
  vcsOrigin: VcsDocumentOrigin | null;
  viewerModelBytes: ArrayBuffer | null;
  viewerModelDeferredReason: string;
  viewerModelFile: File | null;
  viewerModelLoadRequested: boolean;
  viewerModelRevision: number;
  viewerModelText: string;
  /**
   * Die Anzeige ist per Live-Mirror weiter als viewerModelText: Ein Remount
   * des Viewers würde vom veralteten Text konvertieren und alle gespiegelten
   * Edits verlieren. Wird beim Mount über eine erzwungene Rekonvertierung
   * aufgelöst; jedes frische Setzen von viewerModelText löscht das Flag.
   */
  viewerModelTextStale: boolean;
}

export function createWorkspaceUiSnapshot(
  session: WorkspaceDocumentSession,
): WorkspaceUiSnapshot {
  return {
    graphAnchorId: session.graphAnchorId,
    graphCollapsed: new Set(session.graphCollapsed),
    graphExpanded: new Set(session.graphExpanded),
    graphPinned: new Set(session.graphPinned),
    graphPositions: new Map(session.graphPositions),
    selectedId: session.selectedId,
    selectedIds: new Set(session.selectedIds),
  };
}

let nextWorkspaceDocumentId = 0;


export function createWorkspaceDocumentSession(
  document: NativeIfcDocument,
  options?: {
    bytes?: ArrayBuffer | null;
    file?: File | null;
    graphPositions?: Map<number, Point>;
    id?: string;
    selectedId?: number;
    text?: string;
    vcsOrigin?: VcsDocumentOrigin | null;
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
    documentRevision: 0,
    documentText: text,
    documentTextDirty: false,
    graphAnchorId: selectedId,
    graphCollapsed: new Set(),
    graphExpanded: new Set(),
    graphPinned: new Set(),
    graphPositions: options?.graphPositions ?? new Map(),
    hasUnexportedChanges: false,
    id: options?.id ?? createWorkspaceDocumentId(document.fileName),
    pendingViewerChanges: [],
    redoStack: [],
    selectedId,
    selectedIds: new Set(),
    sourceIfcBytes: sourceBytes,
    sourceIfcFile: sourceFile,
    undoStack: [],
    vcsOrigin: options?.vcsOrigin ?? null,
    viewerModelBytes: sourceBytes,
    viewerModelDeferredReason,
    viewerModelFile: sourceFile,
    viewerModelLoadRequested,
    viewerModelRevision: options?.viewerModelRevision ?? 0,
    viewerModelText: text,
    viewerModelTextStale: false,
  };
}

function createWorkspaceDocumentId(fileName: string) {
  nextWorkspaceDocumentId += 1;
  return `${fileName || "IFC"}:${Date.now().toString(36)}:${nextWorkspaceDocumentId}`;
}
