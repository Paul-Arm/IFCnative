/**
 * Viewer-Pane: WebGPU-3D-Ansicht des aktiven Dokuments.
 *
 * Geometrie wird streamend geladen (siehe core/viewer.ts), Auswahl läuft in
 * beide Richtungen über den Selection-Store, Farb-Overrides kommen vom
 * Lens-Pane über den Overrides-Store.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  startViewer,
  type PresetView,
  type ViewerHandle,
  type ViewerStatus,
} from "../../core/viewer";
import { useActiveDocument } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import { attachViewerControls } from "./controls";
import { useViewerOverrides } from "./overrides";
import { DEFAULT_SECTION, toSectionPlane, type SectionState } from "./section";
import ViewerToolbar from "./ViewerToolbar";

const NO_IDS: ReadonlySet<number> = new Set<number>();

export default function ViewerPane() {
  const doc = useActiveDocument();
  const docId = doc?.id ?? null;
  const bytes = doc?.bytes ?? null;

  const selection = useSelectionOf(docId);
  const select = useSelection((s) => s.select);
  const clearSelection = useSelection((s) => s.clear);
  const focusNonce = useSelection((s) => s.focusRequest?.nonce ?? 0);

  const lensColors = useViewerOverrides((s) =>
    s.docId === docId ? s.colors : null,
  );
  const lensHidden = useViewerOverrides((s) =>
    s.docId === docId ? s.hidden : NO_IDS,
  );
  const lensSource = useViewerOverrides((s) =>
    s.docId === docId ? s.source : null,
  );
  const clearOverrides = useViewerOverrides((s) => s.clear);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [handle, setHandle] = useState<ViewerHandle | null>(null);
  const [status, setStatus] = useState<ViewerStatus | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(NO_IDS);
  const [isolated, setIsolated] = useState<ReadonlySet<number> | null>(null);
  const [xray, setXray] = useState(false);
  const [section, setSection] = useState<SectionState>(DEFAULT_SECTION);
  const [note, setNote] = useState<string | null>(null);

  // — Viewer-Instanz pro Dokument: bei Wechsel neu laden, alte disposen —
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bytes) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    let instance: ViewerHandle | null = null;
    setStatus({ kind: "loading", meshCount: 0 });
    void startViewer(canvas, bytes, (next) => {
      if (!cancelled) setStatus(next);
    }).then((created) => {
      if (cancelled) {
        created.dispose();
        return;
      }
      instance = created;
      setHandle(created);
    });
    return () => {
      cancelled = true;
      setHandle(null);
      instance?.dispose();
    };
  }, [docId, bytes]);

  // Sicht-Zustand ist dokumentgebunden.
  useEffect(() => {
    setHidden(NO_IDS);
    setIsolated(null);
    setXray(false);
    setSection(DEFAULT_SECTION);
    setNote(null);
  }, [docId]);

  // — Canvas-Größe an das Pane koppeln —
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !handle) return;
    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      handle.resize(
        Math.max(1, Math.round(canvas.clientWidth * dpr)),
        Math.max(1, Math.round(canvas.clientHeight * dpr)),
      );
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [handle]);

  // — Picking: Treffer wählen, Leerklick löscht die Auswahl —
  const pickHandler = useCallback(
    (x: number, y: number, additive: boolean): void => {
      if (!handle || !docId) return;
      void handle.pick(x, y).then((expressId) => {
        if (expressId === null) clearSelection(docId);
        else select(docId, expressId, additive);
      });
    },
    [handle, docId, select, clearSelection],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !handle) return;
    return attachViewerControls(canvas, handle, { onPick: pickHandler });
  }, [handle, pickHandler]);

  // — Auswahl + Sichtbarkeit + Schnitt an den Renderer —
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const hiddenIds = useMemo(() => {
    if (lensHidden.size === 0) return hidden;
    const merged = new Set(hidden);
    for (const id of lensHidden) merged.add(id);
    return merged;
  }, [hidden, lensHidden]);

  useEffect(() => {
    handle?.apply({
      selectedIds,
      hiddenIds,
      isolatedIds: isolated,
      sectionPlane: toSectionPlane(section),
      xray,
    });
  }, [handle, selectedIds, hiddenIds, isolated, section, xray]);

  useEffect(() => {
    handle?.setColorOverrides(lensColors);
  }, [handle, lensColors]);

  // — Fokus-Wunsch aus anderen Panes (Taste „.") —
  useEffect(() => {
    if (!handle || focusNonce === 0) return;
    const request = useSelection.getState().focusRequest;
    if (!request || request.docId !== docId) return;
    if (handle.focusEntity(request.expressId)) {
      setNote(null);
    } else {
      select(request.docId, request.expressId);
      setNote(
        "Kein Geometrie-Umriss für dieses Objekt — nur hervorgehoben statt zentriert.",
      );
    }
  }, [handle, focusNonce, docId, select]);

  function showAll(): void {
    setHidden(NO_IDS);
    setIsolated(null);
    if (lensSource) clearOverrides();
  }

  function toggleIsolation(): void {
    setIsolated((current) =>
      current ? null : selection.length > 0 ? new Set(selection) : null,
    );
  }

  function hideSelection(): void {
    if (selection.length === 0) return;
    setHidden((current) => {
      const next = new Set(current);
      for (const id of selection) next.add(id);
      return next;
    });
  }

  function preset(view: PresetView): void {
    handle?.presetView(view);
  }

  return (
    <div className="pane">
      <ViewerToolbar
        disabled={!handle}
        hasSelection={selection.length > 0}
        isolated={isolated !== null}
        xray={xray}
        section={section}
        onZoomAll={() => handle?.zoomToModel()}
        onIsolate={toggleIsolation}
        onHide={hideSelection}
        onShowAll={showAll}
        onToggleXray={() => setXray((value) => !value)}
        onSection={(patch) => setSection((current) => ({ ...current, ...patch }))}
        onPreset={preset}
      />

      <div className="pane-body" style={{ position: "relative", overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%" }}
        />
        {!doc && <Overlay text="Kein Dokument geöffnet." />}
        {doc && status?.kind === "unavailable" && <Overlay text={status.reason} />}
        {doc && status?.kind === "error" && <Overlay text={status.reason} />}
      </div>

      <StatusLine
        status={status}
        hiddenCount={hiddenIds.size}
        isolatedCount={isolated?.size ?? null}
        lensSource={lensSource}
        note={note}
      />
    </div>
  );
}

function Overlay({ text }: { text: string }) {
  return (
    <p
      className="pane-empty"
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--bg-panel)",
        margin: 0,
      }}
    >
      {text}
    </p>
  );
}

function StatusLine({
  status,
  hiddenCount,
  isolatedCount,
  lensSource,
  note,
}: {
  status: ViewerStatus | null;
  hiddenCount: number;
  isolatedCount: number | null;
  lensSource: string | null;
  note: string | null;
}) {
  const parts: string[] = [];
  if (status?.kind === "loading") parts.push(`Lade … ${status.meshCount} Meshes`);
  else if (status?.kind === "ready") parts.push(`${status.meshCount} Meshes`);
  else if (status) parts.push(status.reason);
  if (hiddenCount > 0) parts.push(`${hiddenCount} ausgeblendet`);
  if (isolatedCount !== null) parts.push(`${isolatedCount} isoliert`);
  if (lensSource) parts.push(`Lens: ${lensSource}`);
  if (note) parts.push(note);
  return (
    <div
      className="text-dim"
      style={{ padding: "4px 8px", borderTop: "1px solid var(--border)" }}
    >
      {parts.length > 0 ? parts.join(" · ") : "Bereit."}
    </div>
  );
}
