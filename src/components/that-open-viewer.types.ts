import type { NativeBodyProfile } from "@/ifc";

export interface ViewerCoordinatePick {
  documentId?: string;
  entityId?: number;
  fileName?: string;
  globalId?: string;
  localId?: number;
  modelId?: string;
  source: "thatopen";
  x: number;
  y: number;
  z: number;
}

export interface ThatOpenViewerModel {
  documentId: string;
  fileName: string;
  ifcBytes?: ArrayBuffer | null;
  ifcFile?: File | null;
  ifcText: string;
  revision: number;
  selectedId: number;
  selectedName?: string;
}

export interface ThatOpenViewerProps {
  activeDocumentId: string;
  activeModelDeferredReason?: string;
  activeModelFileName?: string;
  activeModelLoaded?: boolean;
  focusRequest?: { documentId: string; entityId: number; nonce: number } | null;
  /**
   * Live-Mirror: eine bereits im nativen Dokument committete Änderung, die per
   * Fragments-Edit-API sofort in das geladene Modell übernommen werden soll
   * (statt auf "Modell neu berechnen" zu warten).
   */
  mirrorRequest?: ViewerMirrorRequest | null;
  models: ThatOpenViewerModel[];
  onLoadActiveModel?(): void;
  onLog?(line: string): void;
  onMirrorApplied?(result: ViewerMirrorResult): void;
  onMoveSelected?(delta: ViewerMoveDelta, viewerApplied: boolean): void;
  onRecalculateModel?(): void;
  onRotateSelected?(
    rotation: ViewerRotationChange,
    viewerApplied: boolean,
  ): void;
  onPickCoordinates?(pick: ViewerCoordinatePick): void;
  onSelect(
    id: number,
    source?: string,
    globalId?: string,
    documentId?: string,
  ): void;
  /**
   * Ausstehende Geometrie-Änderungen (Labels) des aktiven Dokuments, die erst
   * mit "Modell neu berechnen" in das Fragments-Modell übernommen werden.
   */
  pendingViewerChanges?: string[];
}

/**
 * Eine Mirror-Operation spiegelt eine im nativen STEP-Dokument bereits
 * committete Änderung per Fragments-Edit-API in das geladene Modell. Das
 * native Dokument bleibt Source of Truth; das Fragments-Modell ist nur die
 * Anzeige. Alle Koordinaten in Viewer-Achsen (Y-up) und Metern.
 */
export type ViewerMirrorOp =
  | {
      kind: "create-body";
      /** Native Entitäts-Id (STEP-Express-Id) des neuen Produkts. */
      entityId: number;
      /** GlobalId der nativen Entität — bleibt über Rekonversionen stabil. */
      globalId?: string;
      category: string;
      name: string;
      tag?: string;
      profile?: NativeBodyProfile;
      width: string;
      depth: string;
      height: string;
      /** Platzierung in echten IFC-Weltkoordinaten (Viewer-Achsen). */
      position: { x: number; y: number; z: number };
      /**
       * Orientierung der Geometrie-Basis (Viewer-Achsen): geerbte Rotation
       * der Platzierungskette (georeferenzierte/rotierte Sites). Fehlt sie,
       * wird achsenparallel gespiegelt.
       */
      axes?: {
        x: { x: number; y: number; z: number };
        y: { x: number; y: number; z: number };
        z: { x: number; y: number; z: number };
      };
    }
  | {
      kind: "replace-body";
      entityId: number;
      profile?: NativeBodyProfile;
      width: string;
      depth: string;
      height: string;
      /**
       * Rückfall, wenn das Element keine editierbaren Meshes liefert (z. B.
       * ohne bisherige Repräsentation oder selbst per Mirror erzeugt): altes
       * Element ausblenden und mit den neuen Maßen neu erzeugen.
       */
      recreate?: {
        category: string;
        globalId?: string;
        name?: string;
        tag?: string;
        /** Platzierung in echten IFC-Weltkoordinaten (Viewer-Achsen). */
        position: { x: number; y: number; z: number };
        /** Orientierung wie bei create-body (Viewer-Achsen). */
        axes?: {
          x: { x: number; y: number; z: number };
          y: { x: number; y: number; z: number };
          z: { x: number; y: number; z: number };
        };
      };
    }
  | {
      kind: "move";
      entityId: number;
      /** Verschiebung relativ zur aktuellen Position (Szenen-Delta). */
      delta: { x: number; y: number; z: number };
    }
  | { kind: "remove"; entityId: number };

export interface ViewerMirrorRequest {
  documentId: string;
  /** Commit-Zusammenfassung; identifiziert den Pending-Eintrag ohne key. */
  label: string;
  nonce: number;
  op: ViewerMirrorOp;
  /** Key des zugehörigen pendingViewerChanges-Eintrags (Fallback-Recalc). */
  pendingKey?: string;
}

export interface ViewerMirrorResult {
  documentId: string;
  label: string;
  ok: boolean;
  pendingKey?: string;
  reason?: string;
}

export interface ViewerMoveDelta {
  x?: number;
  y?: number;
  z?: number;
}

export interface ViewerRotationChange {
  axis: Required<ViewerMoveDelta>;
  refDirection: Required<ViewerMoveDelta>;
  rotation: ViewerMoveDelta;
}
