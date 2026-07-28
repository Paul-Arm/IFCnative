import { useCallback, useEffect, useRef, useState } from "react";
import { ModelSession, type ModelInfo, type PsetView } from "./core/session";
import { startViewer, type ViewerHandle, type ViewerStatus } from "./core/viewer";
import { isTauri, onFileOpened, saveViaDialog } from "./core/tauri";

export default function App() {
  const [session, setSession] = useState<ModelSession | null>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<number | null>(null);
  const [psets, setPsets] = useState<PsetView[]>([]);
  const [changeCount, setChangeCount] = useState(0);
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);

  const openBuffer = useCallback(async (fileName: string, buffer: ArrayBuffer) => {
    setProgress("Parse …");
    viewerRef.current?.dispose();
    setViewerStatus(null);
    try {
      const next = await ModelSession.open(fileName, buffer, (percent, phase) =>
        setProgress(`${phase} ${percent.toFixed(0)} %`),
      );
      bytesRef.current = new Uint8Array(buffer);
      setSession(next);
      setInfo(next.info());
      setSelectedType(null);
      setSelectedEntity(null);
      setPsets([]);
      setChangeCount(0);
    } finally {
      setProgress(null);
    }
  }, []);

  // 3D nach dem Parsen streamend laden
  useEffect(() => {
    if (!session || !canvasRef.current || !bytesRef.current) return;
    let disposed = false;
    startViewer(canvasRef.current, bytesRef.current, (status) => {
      if (!disposed) setViewerStatus(status);
    }).then((handle) => {
      viewerRef.current = handle;
    });
    return () => {
      disposed = true;
      viewerRef.current?.dispose();
    };
  }, [session]);

  // Explorer-Doppelklick / „Öffnen mit" über die Tauri-Shell
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onFileOpened(({ fileName, bytes }) => {
      void openBuffer(
        fileName,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [openBuffer]);

  const openViaInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) await openBuffer(file.name, await file.arrayBuffer());
      event.target.value = "";
    },
    [openBuffer],
  );

  const exportIfc = useCallback(async () => {
    if (!session) return;
    const bytes = session.exportStep();
    const name = session.fileName.replace(/\.ifc$/i, "") + ".bearbeitet.ifc";
    if (await saveViaDialog(name, bytes)) return;
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: "application/x-step" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, [session]);

  const selectEntity = useCallback(
    (expressId: number) => {
      if (!session) return;
      setSelectedEntity(expressId);
      setPsets(session.psetsOf(expressId));
    },
    [session],
  );

  const commitProperty = useCallback(
    (pset: string, prop: string, value: string) => {
      if (!session || selectedEntity === null) return;
      session.setProperty(selectedEntity, pset, prop, value);
      setChangeCount(session.changeCount);
      setPsets(session.psetsOf(selectedEntity));
    },
    [session, selectedEntity],
  );

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <strong>IFCnative Editor 2.0</strong>
        <span style={styles.badge}>M0-Durchstich</span>
        <label style={styles.button}>
          IFC öffnen
          <input
            type="file"
            accept=".ifc,.ifczip,.ifcx"
            style={{ display: "none" }}
            onChange={openViaInput}
          />
        </label>
        <button
          style={styles.button}
          disabled={!session}
          onClick={() => void exportIfc()}
        >
          Exportieren{changeCount > 0 ? ` (${changeCount} Änderungen)` : ""}
        </button>
        <span style={{ marginLeft: "auto", opacity: 0.7 }}>
          {isTauri() ? "Desktop (Tauri)" : "Browser-Modus"}
          {progress ? ` · ${progress}` : ""}
        </span>
      </header>

      <main style={styles.main}>
        <section style={styles.column}>
          <h3 style={styles.h3}>Modell</h3>
          {info ? (
            <>
              <p style={styles.meta}>
                {info.fileName} · {info.schema} ·{" "}
                {info.entityCount.toLocaleString("de-DE")} Entities ·{" "}
                {info.parseTimeMs} ms
              </p>
              <ul style={styles.list}>
                {info.typeCounts.slice(0, 40).map(({ type, count }) => (
                  <li key={type}>
                    <button
                      style={{
                        ...styles.rowButton,
                        fontWeight: type === selectedType ? 700 : 400,
                      }}
                      onClick={() => setSelectedType(type)}
                    >
                      {type} <span style={{ opacity: 0.6 }}>({count})</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p style={styles.meta}>Keine Datei geöffnet.</p>
          )}
        </section>

        <section style={styles.column}>
          <h3 style={styles.h3}>Entities {selectedType ? `· ${selectedType}` : ""}</h3>
          <ul style={styles.list}>
            {session && selectedType
              ? session.entitiesOfType(selectedType).map((row) => (
                  <li key={row.expressId}>
                    <button
                      style={{
                        ...styles.rowButton,
                        fontWeight:
                          row.expressId === selectedEntity ? 700 : 400,
                      }}
                      onClick={() => selectEntity(row.expressId)}
                    >
                      #{row.expressId} {row.name || "(ohne Name)"}
                    </button>
                  </li>
                ))
              : null}
          </ul>
        </section>

        <section style={styles.column}>
          <h3 style={styles.h3}>
            Eigenschaften {selectedEntity !== null ? `· #${selectedEntity}` : ""}
          </h3>
          {psets.map((pset) => (
            <div key={pset.name} style={{ marginBottom: 12 }}>
              <strong>{pset.name}</strong>
              <table style={styles.table}>
                <tbody>
                  {pset.properties.map((prop) => (
                    <tr key={prop.name}>
                      <td style={styles.cellName}>{prop.name}</td>
                      <td>
                        <input
                          style={styles.input}
                          defaultValue={prop.value}
                          onBlur={(e) => {
                            if (e.target.value !== prop.value)
                              commitProperty(pset.name, prop.name, e.target.value);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {selectedEntity !== null && psets.length === 0 && (
            <p style={styles.meta}>Keine Property Sets an diesem Objekt.</p>
          )}
        </section>

        <section style={{ ...styles.column, flex: 2 }}>
          <h3 style={styles.h3}>3D</h3>
          <canvas ref={canvasRef} style={styles.canvas} />
          {viewerStatus && (
            <p style={styles.meta}>
              {viewerStatus.kind === "loading" &&
                `Lade Geometrie … ${viewerStatus.meshCount} Meshes`}
              {viewerStatus.kind === "ready" &&
                `${viewerStatus.meshCount} Meshes geladen`}
              {viewerStatus.kind === "unavailable" && viewerStatus.reason}
              {viewerStatus.kind === "error" &&
                `3D-Fehler: ${viewerStatus.reason}`}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    fontFamily: "system-ui, sans-serif",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 12px",
    borderBottom: "1px solid #ccc",
  },
  badge: {
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 10,
    background: "#eef",
  },
  button: {
    padding: "4px 12px",
    border: "1px solid #999",
    borderRadius: 6,
    background: "#f8f8f8",
    cursor: "pointer",
    fontSize: 14,
  },
  main: { display: "flex", flex: 1, minHeight: 0 },
  column: {
    flex: 1,
    overflow: "auto",
    padding: 12,
    borderRight: "1px solid #eee",
    minWidth: 0,
  },
  h3: { margin: "0 0 8px" },
  meta: { fontSize: 13, opacity: 0.8 },
  list: { listStyle: "none", margin: 0, padding: 0 },
  rowButton: {
    background: "none",
    border: "none",
    padding: "2px 0",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    fontSize: 13,
  },
  table: { width: "100%", fontSize: 13, borderCollapse: "collapse" },
  cellName: { padding: "2px 6px 2px 0", whiteSpace: "nowrap", opacity: 0.8 },
  input: { width: "100%", fontSize: 13, padding: "2px 4px" },
  canvas: { width: "100%", height: "70%", background: "#1a1d21", borderRadius: 6 },
};
