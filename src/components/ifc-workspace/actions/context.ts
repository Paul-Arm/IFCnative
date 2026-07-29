import type { NativeIfcDocument } from "@/ifc";

import type { CommitDocument } from "../session/useDocumentSessions";

/**
 * Gemeinsamer Kontext aller Edit-Aktionen: Die Aktionen lesen das aktuelle
 * Dokument samt Auswahl und schreiben Änderungen ausschließlich über
 * commitDocument (Undo-Historie, Viewer-Sync und Logging inklusive).
 */
export interface WorkspaceEditContext {
  commitDocument: CommitDocument;
  document: NativeIfcDocument;
  logAction: (code: string) => void;
  selectedId: number;
}
