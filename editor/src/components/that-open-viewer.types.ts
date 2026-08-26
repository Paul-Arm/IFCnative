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

/**
 * Ziel eines Rechtsklicks im Viewer: der per Raycast getroffene Körper plus
 * der Trefferpunkt in echten IFC-Weltkoordinaten (Viewer-Achsen, Meter).
 */
export interface ViewerContextMenuTarget {
  clientX: number;
  clientY: number;
  documentId: string;
  entityId: number;
  fileName?: string;
  globalId?: string;
  point: { x: number; y: number; z: number };
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
  cutPlane?: ViewerCutPlaneState;
  focusRequest?: { documentId: string; entityId: number; nonce: number } | null;
  editCapabilities?: ViewerEditCapabilities;
  /**
   * Live-Mirror: eine bereits im nativen Dokument committete Änderung, die per
   * Fragments-Edit-API sofort in das geladene Modell übernommen werden soll
   * (statt auf "Modell neu berechnen" zu warten).
   */
  mirrorRequest?: ViewerMirrorRequest | null;
  models: ThatOpenViewerModel[];
  onLoadActiveModel?(): void;
  /** Rotary-Menü: neuen Körper am Rechtsklick-Punkt anlegen. */
  onAddBodyAt?(
    profile: NativeBodyProfile,
    target: ViewerContextMenuTarget,
  ): void;
  onCutPlaneActiveChange?(active: boolean): void;
  /** Rotary-Menü/Zerteilen: Schnittebenen-Achse zyklisch drehen (Y→X→Z). */
  onCutPlaneAxisCycle?(): void;
  onCutPlaneChange?(change: ViewerCutPlaneChange): void;
  onCutPlaneModeChange?(mode: ViewerCutPlaneMode): void;
  /** Rotary-Menü: Geometrie entfernen (withEntity=false) oder Objekt-Löschdialog öffnen. */
  onDeleteBody?(entityId: number, withEntity: boolean): void;
  /** Rotary-Menü: Produkt mit geteilter Repräsentation duplizieren. */
  onDuplicateBody?(entityId: number): void;
  onLog?(line: string): void;
  onMirrorApplied?(result: ViewerMirrorResult): void;
  onMoveSelected?(
    entityId: number,
    delta: ViewerMoveDelta,
  ): ViewerTransformCommitReceipt | null;
  onRecalculateModel?(): void;
  onRotateSelected?(
    entityId: number,
    rotation: ViewerRotationChange,
  ): ViewerTransformCommitReceipt | null;
  onPickCoordinates?(pick: ViewerCoordinatePick): void;
  onSelect(
    id: number,
    source?: string,
    globalId?: string,
    documentId?: string,
  ): void;
  /** Rotary-Menü/Zerteilen: Auswahl an der aktiven Schnittebene zerteilen. */
  onSplitSelected?(): void;
  /**
   * Ausstehende Geometrie-Änderungen (Labels) des aktiven Dokuments, die erst
   * mit "Modell neu berechnen" in das Fragments-Modell übernommen werden.
   */
  pendingViewerChanges?: string[];
}

export type ViewerCutPlaneMode = "translate" | "rotate";

export interface ViewerCutPlaneState {
  active: boolean;
  mode: ViewerCutPlaneMode;
  normal: { x: number; y: number; z: number };
  /** Absolute IFC-Weltposition in Viewerachsen und Metern. */
  position?: { x: number; y: number; z: number };
  /** Änderung erzwingt eine neue Zentrierung auf der aktuellen Auswahl. */
  resetNonce: number;
}

export interface ViewerCutPlaneChange {
  normal: { x: number; y: number; z: number };
  position: { x: number; y: number; z: number };
}

export interface ViewerEditCapabilities {
  canMove: boolean;
  canRotate: boolean;
  transformDisabledReason?: string;
}

/** Bestätigung, dass ein erfolgreicher Fragments-Edit ins native IFC synchronisiert wurde. */
export interface ViewerTransformCommitReceipt {
  label: string;
  pendingKey: string;
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
  | {
      /**
       * Partielle Rekonvertierung: nur die betroffenen Produkte werden als
       * Mini-IFC neu konvertiert und als Zusatzmodell lagerichtig über das
       * Basismodell gelegt (Fragments koordiniert über die im Subset
       * erhaltenen IFC-Weltkoordinaten); die ersetzten/entfernten Elemente
       * werden im Basismodell ausgeblendet. Express-Ids bleiben erhalten.
       */
      kind: "reconvert-subset";
      /** Produkte, die das Subset rendert (neue Teile, geänderte Körper). */
      entityIds: number[];
      /** Im Basismodell (und früheren Subsets) auszublendende Produkte. */
      replacedEntityIds: number[];
      /** Eigenständiges Mini-IFC (STEP-Text) mit erhaltenen Express-Ids. */
      subsetIfcText: string;
    }
  | {
      kind: "remove";
      entityId: number;
      /**
       * Kaskadiert mitgelöschte Produkte (z. B. Inhalt einer gelöschten
       * Site/eines Buildings) — der Container selbst hat meist keine eigene
       * Geometrie, seine Elemente müssen mit aus der Anzeige verschwinden.
       */
      cascadeEntityIds?: number[];
    };

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
