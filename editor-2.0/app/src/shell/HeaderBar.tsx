import { useCallback, useRef } from "react";
import { useDocuments } from "../store/documents";
import { useUi } from "../store/ui";
import { BUILTIN_WORKSPACE_NAMES } from "../panes/workspaces";
import { saveViaDialog } from "../core/tauri";
import {
  useCommands,
  usePendingChangeCount,
  useUndoRedoLabels,
} from "../commands/pipeline";

function UndoRedoButtons({ docId }: { docId: string | null }) {
  const { undoLabel, redoLabel } = useUndoRedoLabels(docId);
  const { undo, redo } = useCommands();
  return (
    <>
      <button
        className="btn"
        disabled={!docId || !undoLabel}
        title={undoLabel ? `Rückgängig: ${undoLabel}` : "Rückgängig (Strg+Z)"}
        onClick={() => docId && undo(docId)}
      >
        ↶
      </button>
      <button
        className="btn"
        disabled={!docId || !redoLabel}
        title={redoLabel ? `Wiederholen: ${redoLabel}` : "Wiederholen (Strg+Y)"}
        onClick={() => docId && redo(docId)}
      >
        ↷
      </button>
    </>
  );
}

export function HeaderBar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const openDocument = useDocuments((s) => s.openDocument);
  const active = useDocuments((s) =>
    s.documents.find((d) => d.id === s.activeId),
  );
  // Befund 15: Badge = offene (undo-bare) Änderungen, nicht die append-only
  // Mutationszahl — sonst blieb die Zahl nach einem Undo stehen.
  const pending = usePendingChangeCount(active?.id ?? null);
  const addRecent = useUi((s) => s.addRecent);
  const {
    theme,
    setTheme,
    uiScale,
    setUiScale,
    workspaceName,
    switchWorkspace,
    customWorkspaces,
    saveCurrentAsWorkspace,
  } = useUi();

  const onFiles = useCallback(
    async (files: FileList | null) => {
      for (const file of files ?? []) {
        await openDocument(file.name, await file.arrayBuffer());
        const doc = useDocuments.getState().documents.at(-1);
        if (doc) {
          const info = doc.session.info();
          addRecent({
            fileName: info.fileName,
            entityCount: info.entityCount,
            schema: info.schema,
            openedAt: new Date().toISOString(),
          });
        }
      }
    },
    [openDocument, addRecent],
  );

  const exportIfc = useCallback(async () => {
    if (!active) return;
    const bytes = active.session.exportStep();
    const name = active.session.fileName.replace(/\.ifc$/i, "") + ".bearbeitet.ifc";
    if (await saveViaDialog(name, bytes)) return;
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: "application/x-step" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, [active]);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      <strong>IFCnative 2.0</strong>

      <button className="btn" onClick={() => fileInput.current?.click()}>
        IFC öffnen
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".ifc,.ifczip,.ifcx"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        className="btn"
        disabled={!active}
        title={
          pending > 0
            ? `${pending} ${pending === 1 ? "Änderung" : "Änderungen"} noch nicht exportiert`
            : "Modell als IFC exportieren"
        }
        onClick={() => void exportIfc()}
      >
        Exportieren
        {pending > 0 ? ` (${pending})` : ""}
      </button>
      <UndoRedoButtons docId={active?.id ?? null} />

      <span style={{ width: 12 }} />
      <label className="text-dim">Workspace</label>
      <select
        className="input"
        value={workspaceName}
        onChange={(e) => switchWorkspace(e.target.value)}
      >
        {BUILTIN_WORKSPACE_NAMES.map((name) => (
          <option key={name}>{name}</option>
        ))}
        {customWorkspaces.map((w) => (
          <option key={w.name}>{w.name}</option>
        ))}
      </select>
      <button
        className="btn"
        title="Aktuelles Layout als Workspace speichern"
        onClick={() => {
          const name = prompt("Name des Workspace:");
          if (name) saveCurrentAsWorkspace(name.trim());
        }}
      >
        Layout sichern
      </button>

      <span style={{ marginLeft: "auto" }} />
      <label className="text-dim">Zoom</label>
      <input
        type="range"
        min={70}
        max={125}
        step={5}
        value={uiScale}
        onChange={(e) => setUiScale(Number(e.target.value))}
      />
      <button
        className="btn"
        title="Theme umschalten"
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? "Dunkel" : "Hell"}
      </button>
    </header>
  );
}
