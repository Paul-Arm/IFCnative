import type { MosaicViewId } from "./components/ifc-workspace/types";

type IfcNativeDesktopCommand =
  | { type: "add-ifc" }
  | { type: "export-ifc" }
  | { type: "import-catalog" }
  | { type: "load-sample" }
  | { type: "open-ifc" }
  | { type: "reset-layout" }
  | { type: "restore-window"; viewId: MosaicViewId };

type IfcNativeDesktopMenuState = {
  catalogImporting: boolean;
  closedWindowIds: MosaicViewId[];
  hasCatalog: boolean;
  loadingIfcName: string;
};

type IfcNativeDetachedViewPayload = {
  activeDocumentId?: string;
  documentText?: string;
  fileName?: string;
  notes?: string;
  recentIfcFiles?: IfcNativeRecentIfcFileEntry[];
  selectedId?: number;
  snapshot?: IfcNativeWorkspaceSnapshot;
  title?: string;
  viewId: MosaicViewId;
  workspaceName?: string;
};

type IfcNativeDetachedViewResult = {
  ok: boolean;
  reason?: string;
};

type IfcNativeRecentIfcFileEntry = {
  documentId?: string;
  entityCount?: number;
  id: string;
  name: string;
  openedAt: string;
  path?: string;
  schema?: string;
  size?: number;
  source: "opened" | "added" | "sample";
};

type IfcNativeWorkspaceSnapshot = {
  activeDocumentId: string;
  documentText: string;
  fileName: string;
  notes: string;
  recentIfcFiles: IfcNativeRecentIfcFileEntry[];
  selectedId: number;
  ui: IfcNativeWorkspaceUiState;
  version: number;
};

type IfcNativeWorkspaceUiState = {
  graphDepth: number;
  graphPreset: string;
  graphRelationshipTypes: string[];
  inspectorMode: string;
  search: string;
  structureMode: "tree" | "graph";
};

type IfcNativeWorkspaceSyncMessage = {
  clientId: string;
  snapshot: IfcNativeWorkspaceSnapshot;
  type: "snapshot";
};

declare global {
  interface Window {
    ifcNativeDesktop?: {
      getDetachedViewPayload(
        token: string,
      ): Promise<IfcNativeDetachedViewPayload | null>;
      getWorkspaceSyncSnapshot(): Promise<IfcNativeWorkspaceSnapshot | null>;
      isElectron: true;
      onCommand(
        callback: (command: IfcNativeDesktopCommand) => void,
      ): () => void;
      onWorkspaceSync(
        callback: (message: IfcNativeWorkspaceSyncMessage) => void,
      ): () => void;
      openDetachedView(
        payload: IfcNativeDetachedViewPayload,
      ): Promise<IfcNativeDetachedViewResult>;
      platform: string;
      publishWorkspaceSync(message: IfcNativeWorkspaceSyncMessage): void;
      setMenuState(state: IfcNativeDesktopMenuState): void;
      versions: Readonly<{
        chrome: string;
        electron: string;
        node: string;
      }>;
    };
  }
}

export { };

