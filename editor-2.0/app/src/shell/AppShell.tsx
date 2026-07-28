import { useEffect } from "react";
import { Mosaic, MosaicWindow } from "react-mosaic-component";
import { HeaderBar } from "./HeaderBar";
import { DocumentTabs } from "./DocumentTabs";
import { StatusBar } from "./StatusBar";
import { renderPane } from "../panes/registry";
import { PANE_TITLES, type PaneId } from "../panes/ids";
import { useUi } from "../store/ui";
import { useDocuments } from "../store/documents";
import { onFileOpened } from "../core/tauri";

export function AppShell() {
  const { layout, setLayout } = useUi();
  const openDocument = useDocuments((s) => s.openDocument);

  // Dateien aus der Tauri-Shell (Doppelklick, Zweitinstanz)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onFileOpened(({ fileName, bytes }) => {
      void openDocument(
        fileName,
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      );
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [openDocument]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <HeaderBar />
      <DocumentTabs />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Mosaic<PaneId>
          value={layout}
          onChange={setLayout}
          renderTile={(id, path) => (
            <MosaicWindow<PaneId>
              path={path}
              title={PANE_TITLES[id]}
              toolbarControls={[]}
            >
              {renderPane(id)}
            </MosaicWindow>
          )}
        />
      </div>
      <StatusBar />
    </div>
  );
}
