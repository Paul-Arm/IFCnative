import { useEffect } from "react";
import { Mosaic, MosaicWindow } from "react-mosaic-component";
import { useCommands } from "../commands/pipeline";
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

  // Tastatur: Ctrl/Cmd+Z Undo, Ctrl+Shift+Z / Ctrl+Y Redo (nicht in Eingabefeldern)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const docId = useDocuments.getState().activeId;
      if (!docId) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        useCommands.getState().undo(docId);
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        useCommands.getState().redo(docId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
