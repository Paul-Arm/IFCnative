import type { MosaicViewId } from "./components/ifc-workspace/types";

type IfcNativeDesktopCommand =
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

declare global {
  interface Window {
    ifcNativeDesktop?: {
      isElectron: true;
      onCommand(
        callback: (command: IfcNativeDesktopCommand) => void,
      ): () => void;
      platform: string;
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

