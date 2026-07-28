/**
 * Viewer-Pane: WebGPU-3D-Ansicht des aktiven Dokuments.
 *
 * Geometrie wird streamend geladen (core/viewer.ts), Auswahl läuft beidseitig
 * über den Selection-Store, Farb-Overrides über die Lens. Die Szene stammt aus
 * EINEM Byte-Stand (useGeometryRebuild); neuer Stand ⇒ Viewer-Neustart.
 *
 * Werkzeuge (M9, `useViewerTools`): „Verschieben" (Taste W, Achsen-Gizmo) und
 * „Koordinaten picken" (raycastScene → pickStore + Zwischenablage); deren
 * Overlays liegen als SVG ÜBER dem Canvas (Renderer hat keine Gizmo-API).
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
import { useGeometryRebuild } from "./useGeometryRebuild";
import { useViewerOverrides } from "./overrides";
import { useViewerTools } from "./useViewerTools";
import { DEFAULT_SECTION, toSectionPlane, type SectionState } from "./section";
import ViewerToolbar from "./ViewerToolbar";
import ViewerStatusLine from "./ViewerStatusLine";
import MoveGizmo from "./MoveGizmo";
import PickMarker from "./PickMarker";

const NO_IDS: ReadonlySet<number> = new Set<number>();

export default function ViewerPane() {
  const doc = useActiveDocument();
  const docId = doc?.id ?? null;

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

  const geometry = useGeometryRebuild(doc);
  const source = geometry.source;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [handle, setHandle] = useState<ViewerHandle | null>(null);
  const [status, setStatus] = useState<ViewerStatus | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(NO_IDS);
  const [isolated, setIsolated] = useState<ReadonlySet<number> | null>(null);
  const [xray, setXray] = useState(false);
  const [section, setSection] = useState<SectionState>(DEFAULT_SECTION);
  const [note, setNote] = useState<string | null>(null);

  // — Viewer-Instanz pro Geometrie-Stand: bei Wechsel neu laden, alte disposen —
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    let instance: ViewerHandle | null = null;
    setStatus({ kind: "loading", meshCount: 0 });
    void startViewer(canvas, source.bytes, (next) => {
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
  }, [source]);

  // Overlay-Zugriff (Gizmo/Pick) — ein Objekt je Viewer-Instanz.
  const access = useMemo(() => handle?.overlay() ?? null, [handle]);

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

  // — Auswahl + Sichtbarkeit + Schnitt an den Renderer —
  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const hiddenIds = useMemo(() => {
    if (lensHidden.size === 0) return hidden;
    const merged = new Set(hidden);
    for (const id of lensHidden) merged.add(id);
    return merged;
  }, [hidden, lensHidden]);

  // — Werkzeuge (M9): Verschieben-Gizmo + Koordinaten-Pick —
  // prettier-ignore
  const tools = useViewerTools(access, doc, docId, selection, hiddenIds, isolated, setNote);

  // — Picking: Treffer wählen, Leerklick löscht die Auswahl —
  const { tool, performPick } = tools; // stabil, anders als das tools-Objekt
  const pickHandler = useCallback(
    (x: number, y: number, additive: boolean): void => {
      if (tool === "pick") {
        performPick(x, y);
        return;
      }
      if (!handle || !docId) return;
      void handle.pick(x, y).then((expressId) => {
        // Review-Befund 4c: Solange der Geometrie-Stand älter ist als die
        // Löschung, kennt die Szene keine Tombstones — ein Treffer auf ein
        // gelöschtes Objekt zählt deshalb wie ein Klick ins Leere.
        const deleted = expressId !== null && (doc?.session.isDeleted(expressId) ?? false);
        if (expressId === null || deleted) clearSelection(docId);
        else select(docId, expressId, additive);
      });
    },
    [tool, performPick, handle, docId, doc, select, clearSelection],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !handle) return;
    return attachViewerControls(canvas, handle, { onPick: pickHandler });
  }, [handle, pickHandler]);

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

  const onGizmoDone = useCallback((text: string) => setNote(text), []);
  const onGizmoBoundsMissing = useCallback(() => {
    setNote("Kein Geometrie-Umriss für dieses Objekt — nicht verschiebbar.");
  }, []);

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

  const pickPoint = tools.pickPoint;
  return (
    <div className="pane">
      <ViewerToolbar
        disabled={!handle}
        hasSelection={selection.length > 0}
        isolated={isolated !== null}
        xray={xray}
        section={section}
        tool={tool}
        onSelectTool={tools.selectTool}
        pendingRebuild={geometry.pending}
        rebuilding={geometry.rebuilding}
        autoRebuild={geometry.auto}
        onRebuild={geometry.rebuild}
        onToggleAutoRebuild={geometry.toggleAuto}
        onZoomAll={() => handle?.zoomToModel()}
        onIsolate={toggleIsolation}
        onHide={hideSelection}
        onShowAll={showAll}
        onToggleXray={() => setXray((value) => !value)}
        onSection={(patch) => setSection((current) => ({ ...current, ...patch }))}
        onPreset={(view: PresetView) => handle?.presetView(view)}
      />

      <div
        className="pane-body"
        style={{
          position: "relative",
          overflow: "hidden",
          cursor: tool === "pick" ? "crosshair" : undefined,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%" }}
        />
        {access && canvasRef.current && pickPoint && pickPoint.docId === docId && (
          <PickMarker access={access} canvas={canvasRef.current} point={pickPoint} />
        )}
        {access && canvasRef.current && doc && docId && tools.moveTarget !== null && (
          <MoveGizmo
            key={tools.moveTarget}
            access={access}
            canvas={canvasRef.current}
            docId={docId}
            session={doc.session}
            elementId={tools.moveTarget}
            onLiveDelta={tools.setMoveDelta}
            onDone={onGizmoDone}
            onBoundsMissing={onGizmoBoundsMissing}
          />
        )}
        {!doc && <Overlay text="Kein Dokument geöffnet." />}
        {doc && status?.kind === "unavailable" && <Overlay text={status.reason} />}
        {doc && status?.kind === "error" && <Overlay text={status.reason} />}
      </div>

      <ViewerStatusLine
        status={status}
        hiddenCount={hiddenIds.size}
        isolatedCount={isolated?.size ?? null}
        lensSource={lensSource}
        note={geometry.error ?? note}
        geometryRevision={source?.revision ?? null}
        pendingRebuild={geometry.pending}
        extraParts={tools.extraParts}
      />
    </div>
  );
}

// prettier-ignore
const OVERLAY_STYLE = { position: "absolute", inset: 0, background: "var(--bg-panel)", margin: 0 } as const;

function Overlay({ text }: { text: string }) {
  return (
    <p className="pane-empty" style={OVERLAY_STYLE}>
      {text}
    </p>
  );
}
