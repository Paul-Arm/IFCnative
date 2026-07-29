import { useEffect } from "react";

import { MOSAIC_VIEW_IDS } from "../constants";
import type { MosaicViewId } from "../types";

/**
 * Bindet die Electron-Menüleiste an: eingehende Menü-Kommandos werden auf
 * die Workspace-Aktionen gemappt, der Menü-Zustand (Lade-Status, offene
 * Fenster) wird zurückgemeldet. No-op im Browser.
 */
export function useDesktopIntegration(options: {
  catalogImporting: boolean;
  closedMosaicIds: MosaicViewId[];
  hasCatalog: boolean;
  loadingIfcName: string;
  onAddIfc: () => void;
  onExportIfc: () => void;
  onImportCatalog: () => void;
  onLoadSample: () => void;
  onOpenIfc: () => void;
  onResetLayout: () => void;
  onRestoreWindow: (id: MosaicViewId) => void;
}) {
  const desktopApi =
    typeof window === "undefined" ? undefined : window.ifcNativeDesktop;
  const {
    catalogImporting,
    closedMosaicIds,
    hasCatalog,
    loadingIfcName,
    onAddIfc,
    onExportIfc,
    onImportCatalog,
    onLoadSample,
    onOpenIfc,
    onResetLayout,
    onRestoreWindow,
  } = options;

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    return desktopApi.onCommand((command) => {
      switch (command.type) {
        case "add-ifc":
          if (!loadingIfcName) {
            onAddIfc();
          }
          break;
        case "open-ifc":
          if (!loadingIfcName) {
            onOpenIfc();
          }
          break;
        case "load-sample":
          onLoadSample();
          break;
        case "import-catalog":
          if (!catalogImporting) {
            onImportCatalog();
          }
          break;
        case "export-ifc":
          if (!loadingIfcName) {
            onExportIfc();
          }
          break;
        case "reset-layout":
          onResetLayout();
          break;
        case "restore-window":
          if (MOSAIC_VIEW_IDS.includes(command.viewId)) {
            onRestoreWindow(command.viewId);
          }
          break;
      }
    });
  });

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    desktopApi.setMenuState({
      catalogImporting,
      closedWindowIds: closedMosaicIds,
      hasCatalog,
      loadingIfcName,
    });
  }, [catalogImporting, closedMosaicIds, desktopApi, hasCatalog, loadingIfcName]);
}
