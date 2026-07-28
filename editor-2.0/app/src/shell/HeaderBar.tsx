import { useCallback, useEffect, useRef, useState } from "react";
import { useDocuments } from "../store/documents";
import { useUi } from "../store/ui";
import { BUILTIN_WORKSPACE_NAMES } from "../panes/workspaces";
import {
  CSV_MODE_LABELS,
  FORMAT_LABELS,
  deliverArtifact,
  runExport,
  type CsvMode,
  type ExportRequest,
} from "../domain/export";
import type { ModelSession } from "../core/session";
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

const CSV_MODES: readonly CsvMode[] = [
  "entities",
  "properties",
  "quantities",
  "spatial",
];

/** Menüeinträge neben dem Standardklick (IFC); CSV mit seinen vier Modi. */
const MENU_ITEMS: ReadonlyArray<{ label: string; request: ExportRequest }> = [
  { label: FORMAT_LABELS.ifczip, request: { format: "ifczip" } },
  { label: FORMAT_LABELS.glb, request: { format: "glb" } },
  { label: FORMAT_LABELS.jsonld, request: { format: "jsonld" } },
  { label: FORMAT_LABELS.bos, request: { format: "bos" } },
  ...CSV_MODES.map((mode) => ({
    label: `${FORMAT_LABELS.csv}: ${CSV_MODE_LABELS[mode]}`,
    request: { format: "csv", mode } as ExportRequest,
  })),
];

const MENU_ITEM_STYLE = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "transparent",
  padding: "5px 10px",
  cursor: "pointer",
} as const;

/**
 * Exportieren als Split-Button: der linke Teil exportiert wie bisher IFC
 * (inkl. Speichern-Dialog bzw. Download), der rechte öffnet das Menü der
 * übrigen Formate. Die Badge-Logik (offene Änderungen) bleibt unverändert.
 */
function ExportButton({
  session,
  pending,
}: {
  session: ModelSession | null;
  pending: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const run = useCallback(
    async (request: ExportRequest, label: string) => {
      if (!session) return;
      setOpen(false);
      setBusy(label);
      try {
        await deliverArtifact(await runExport(session, request));
      } catch (error) {
        // Die Exportfunktionen werfen bereits deutsche Meldungen.
        alert(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
    },
    [session],
  );

  const disabled = !session || busy !== null;
  return (
    <div ref={box} style={{ position: "relative", display: "flex" }}>
      <button
        className="btn"
        disabled={disabled}
        title={
          pending > 0
            ? `${pending} ${pending === 1 ? "Änderung" : "Änderungen"} noch nicht exportiert`
            : "Modell als IFC exportieren"
        }
        onClick={() => void run({ format: "ifc" }, FORMAT_LABELS.ifc)}
      >
        {busy ? `${busy} …` : "Exportieren"}
        {!busy && pending > 0 ? ` (${pending})` : ""}
      </button>
      <button
        className="btn"
        disabled={disabled}
        title="Weitere Exportformate"
        aria-label="Weitere Exportformate"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ▾
      </button>
      {open ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            minWidth: 210,
            padding: "4px 0",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            boxShadow: "0 6px 18px rgba(0,0,0,.28)",
            zIndex: 30,
          }}
        >
          {MENU_ITEMS.map((item) => (
            <button
              key={item.label}
              className="btn"
              style={MENU_ITEM_STYLE}
              onClick={() => void run(item.request, item.label)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
        accept=".ifc,.ifczip,.zip,.ifcx"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <ExportButton session={active?.session ?? null} pending={pending} />
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
