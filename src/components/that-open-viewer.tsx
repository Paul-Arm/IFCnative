import type { NativeIfcDocument } from "@/ifc";
import type { BodyElementDraft } from "./ifc-workspace/types";

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
  createBodyRequest?: ViewerCreateBodyRequest | null;
  editBodyRequest?: ViewerEditBodyRequest | null;
  focusRequest?: { documentId: string; entityId: number; nonce: number } | null;
  models: ThatOpenViewerModel[];
  onLoadActiveModel?(): void;
  onFragmentsModelChanged?(change: ViewerFragmentsModelChange): void;
  onLog?(line: string): void;
  onMoveSelected?(delta: ViewerMoveDelta): void;
  onRotateSelected?(rotation: ViewerRotationChange): void;
  onPickCoordinates?(pick: ViewerCoordinatePick): void;
  onSelect(
    id: number,
    source?: string,
    globalId?: string,
    documentId?: string,
  ): void;
}
export interface ViewerCreateBodyRequest {
  documentId: string;
  nonce: number;
  options: BodyElementDraft;
  selectedId: number;
}

export interface ViewerEditBodyRequest {
  documentId: string;
  nonce: number;
  options: BodyElementDraft;
  selectedId: number;
}

export interface ViewerFragmentsModelChange {
  document: NativeIfcDocument;
  documentId: string;
  selectedId: number;
  summary: string;
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

export default function ThatOpenViewer({
  activeDocumentId,
  activeModelDeferredReason,
  activeModelFileName,
  activeModelLoaded = true,
  models,
  onLoadActiveModel,
}: ThatOpenViewerProps) {
  const activeModel =
    models.find((model) => model.documentId === activeDocumentId) ?? models[0];
  return (
    <div className="grid min-h-[440px] place-items-center rounded-xl border bg-muted/30 p-6 text-center">
      <div className="grid max-w-lg gap-2">
        <h2 className="text-base font-semibold text-foreground">
          ThatOpen Viewer
        </h2>
        <p className="text-sm text-muted-foreground">
          {activeModel?.fileName ?? activeModelFileName ?? "No IFC loaded"}
        </p>
        {!activeModelLoaded && activeModelDeferredReason ? (
          <p className="text-sm text-muted-foreground">
            {activeModelDeferredReason}
          </p>
        ) : null}
        {!activeModelLoaded && onLoadActiveModel ? (
          <p className="text-sm text-muted-foreground">
            3D loading is available in the web build.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          The ThatOpen WebGL viewer is available in the web build.
        </p>
      </div>
    </div>
  );
}
