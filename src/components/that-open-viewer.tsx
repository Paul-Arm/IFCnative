import {
    Box,
    Copy,
    LocateFixed,
    Maximize,
    MousePointer2,
    Move,
    RefreshCw,
    RotateCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
    ThatOpenViewerProps,
    ViewerCoordinatePick,
} from "./that-open-viewer.types";
import { createThatOpenRuntime } from "./viewer/runtime";
import {
    formatCoordinatePickClipboard,
    formatCoordinatePickLabel,
    isViewerShortcutTarget,
    stringifyError,
    writeClipboardText,
} from "./viewer/utils";

type ViewerRuntime = Awaited<ReturnType<typeof createThatOpenRuntime>>;

export default function ThatOpenViewer({
  activeDocumentId,
  activeModelDeferredReason,
  activeModelFileName,
  activeModelLoaded = true,
  editCapabilities = {
    canMove: false,
    canRotate: false,
  },
  focusRequest,
  mirrorRequest,
  models,
  onLoadActiveModel,
  onLog,
  onMirrorApplied,
  onMoveSelected,
  onRecalculateModel,
  onRotateSelected,
  onPickCoordinates,
  onSelect,
  pendingViewerChanges,
}: ThatOpenViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const modelsRef = useRef(models);
  const selectedByDocumentIdRef = useRef(new Map<string, number>());
  const onLogRef = useRef(onLog);
  const onMirrorAppliedRef = useRef(onMirrorApplied);
  const onMoveSelectedRef = useRef(onMoveSelected);
  const onRotateSelectedRef = useRef(onRotateSelected);
  const onPickCoordinatesRef = useRef(onPickCoordinates);
  const onSelectRef = useRef(onSelect);
  const handledFocusNonceRef = useRef<number | undefined>(undefined);
  const handledMirrorNonceRef = useRef<number | undefined>(undefined);
  const pickerActiveRef = useRef(false);
  const [runtimeReady, setRuntimeReady] = useState(0);
  const [modelReady, setModelReady] = useState(0);
  const [, setStatus] = useState("Starting ThatOpen viewer...");
  const [error, setError] = useState("");
  const [moveGizmoActive, setMoveGizmoActive] = useState(false);
  const [moveGizmoMode, setMoveGizmoMode] = useState<"translate" | "rotate">(
    "translate",
  );
  const [pickerActive, setPickerActive] = useState(false);
  const [lastPick, setLastPick] = useState<ViewerCoordinatePick | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [loadProgress, setLoadProgress] = useState<{
    fileName: string;
    percent: number;
  } | null>(null);
  const activeModel = useMemo(
    () => models.find((model) => model.documentId === activeDocumentId),
    [activeDocumentId, models],
  );
  const activeSelectedId = activeModel?.selectedId ?? 0;
  const activeModelVisible = Boolean(activeModel);
  const hasVisibleModels = models.length > 0;
  const pendingChangeCount = pendingViewerChanges?.length ?? 0;
  const showDeferredActiveModel =
    !activeModelLoaded && Boolean(activeModelDeferredReason);
  const modelLoadSignature = useMemo(
    () =>
      models
        .map(
          (model) =>
            `${model.documentId}:${model.revision}:${model.ifcBytes?.byteLength ?? model.ifcText.length}`,
        )
        .join("|"),
    [models],
  );

  activeDocumentIdRef.current = activeDocumentId;
  modelsRef.current = models;
  selectedByDocumentIdRef.current = new Map(
    models.map((model) => [model.documentId, model.selectedId]),
  );
  onLogRef.current = onLog;
  onMirrorAppliedRef.current = onMirrorApplied;
  onMoveSelectedRef.current = onMoveSelected;
  onRotateSelectedRef.current = onRotateSelected;
  onPickCoordinatesRef.current = onPickCoordinates;
  onSelectRef.current = onSelect;
  pickerActiveRef.current = pickerActive;

  const copyPick = async (pick: ViewerCoordinatePick) => {
    const text = formatCoordinatePickClipboard(pick);
    await writeClipboardText(text);
    setCopyStatus("Kopiert");
    onLogRef.current?.(`viewer.coordinates.copy(${JSON.stringify(text)});`);
  };

  const closeCoordinateReadout = () => {
    setLastPick(null);
    setCopyStatus("");
    runtimeRef.current?.hideCoordinateCursor();
  };

  useEffect(() => {
    let disposed = false;

    async function init() {
      if (!containerRef.current) {
        return;
      }
      setStatus("Initializing ThatOpen Components...");
      const runtime = await createThatOpenRuntime(containerRef.current, {
        getActiveDocumentId: () => activeDocumentIdRef.current,
        getSelectedId: (documentId) =>
          selectedByDocumentIdRef.current.get(
            documentId ?? activeDocumentIdRef.current,
          ) ?? 0,
        onError: (message) => {
          setError(message);
          setStatus("ThatOpen viewer error");
        },
        onLog: (line) => onLogRef.current?.(line),
        onMoveSelected: (entityId, delta) =>
          onMoveSelectedRef.current?.(entityId, delta) ?? null,
        onRotateSelected: (entityId, rotation) =>
          onRotateSelectedRef.current?.(entityId, rotation) ?? null,
        onTransformResult: (result) =>
          onMirrorAppliedRef.current?.(result),
        onPickCoordinates: (pick) => {
          setLastPick(pick);
          onPickCoordinatesRef.current?.(pick);
          void copyPick(pick).catch((reason) => {
            const message = stringifyError(reason);
            setCopyStatus("Kopieren fehlgeschlagen");
            onLogRef.current?.(
              `viewer.coordinates.copyError(${JSON.stringify(message)});`,
            );
          });
        },
        isCoordinatePickerActive: () => pickerActiveRef.current,
        onCoordinatePickerUsed: () => setPickerActive(false),
        onProgress: (progress) => setLoadProgress(progress),
        onSelect: (id, source, globalId, documentId) =>
          onSelectRef.current(id, source, globalId, documentId),
        onStatus: setStatus,
      });
      if (disposed) {
        await runtime.dispose();
        return;
      }
      runtimeRef.current = runtime;
      setRuntimeReady((value) => value + 1);
    }

    void init().catch((reason) => {
      const message = stringifyError(reason);
      setError(message);
      setStatus("ThatOpen viewer failed to initialize");
      onLogRef.current?.(`viewer.error(${JSON.stringify(message)});`);
    });

    return () => {
      disposed = true;
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (runtime) {
        void runtime.dispose();
      }
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtimeReady) {
      return;
    }
    let cancelled = false;
    setError("");
    setStatus("Converting IFC with ThatOpen...");
    const frameId = requestAnimationFrame(() => {
      void runtime
        .syncModels(modelsRef.current, { fitAfterLoad: true })
        .then(async () => {
          if (cancelled) {
            return;
          }
          setLoadProgress(null);
          setModelReady((value) => value + 1);
          const documentId = activeDocumentIdRef.current;
          await runtime.highlight(
            documentId,
            selectedByDocumentIdRef.current.get(documentId) ?? 0,
          );
        })
        .catch((reason) => {
          if (cancelled) {
            return;
          }
          setLoadProgress(null);
          const message = stringifyError(reason);
          setError(message);
          setStatus("ThatOpen IFC load failed");
          onLogRef.current?.(`viewer.loadError(${JSON.stringify(message)});`);
        });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [modelLoadSignature, runtimeReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !modelReady) {
      return;
    }
    void runtime.highlight(activeDocumentId, activeSelectedId);
    void runtime.updateGrid(activeDocumentId);
  }, [activeDocumentId, activeSelectedId, modelReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      !modelReady ||
      !focusRequest ||
      focusRequest.documentId !== activeDocumentId ||
      handledFocusNonceRef.current === focusRequest.nonce
    ) {
      return;
    }
    handledFocusNonceRef.current = focusRequest.nonce;
    void runtime.focusSelected(focusRequest.documentId, focusRequest.entityId);
  }, [activeDocumentId, focusRequest, modelReady]);

  // Live-Mirror: eine im nativen Dokument committete Änderung sofort per
  // Fragments-Edit-API in das geladene Modell übernehmen. Läuft im Runtime
  // hinter der Modell-Lade-Queue, damit ein Mirror nie ein gerade neu
  // konvertiertes Modell (das die Änderung schon enthält) doppelt trifft.
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      !runtimeReady ||
      !mirrorRequest ||
      handledMirrorNonceRef.current === mirrorRequest.nonce
    ) {
      return;
    }
    handledMirrorNonceRef.current = mirrorRequest.nonce;
    void runtime
      .applyMirror(mirrorRequest)
      .then((result) => onMirrorAppliedRef.current?.(result))
      .catch((reason) => {
        onMirrorAppliedRef.current?.({
          documentId: mirrorRequest.documentId,
          label: mirrorRequest.label,
          ok: false,
          pendingKey: mirrorRequest.pendingKey,
          reason: stringifyError(reason),
        });
      });
  }, [mirrorRequest, runtimeReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtimeReady) {
      return;
    }
    void runtime.setMoveGizmoEnabled(moveGizmoActive);
  }, [moveGizmoActive, runtimeReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtimeReady) {
      return;
    }
    runtime.setMoveGizmoMode(moveGizmoMode);
  }, [moveGizmoMode, runtimeReady]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isViewerShortcutTarget(event.target)
      ) {
        return;
      }
      if (event.key === "Escape") {
        setMoveGizmoActive(false);
        setPickerActive(false);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "w" && editCapabilities.canMove) {
        event.preventDefault();
        setPickerActive(false);
        setMoveGizmoMode("translate");
        setMoveGizmoActive(true);
      } else if (key === "r" && editCapabilities.canRotate) {
        event.preventDefault();
        setPickerActive(false);
        setMoveGizmoMode("rotate");
        setMoveGizmoActive(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editCapabilities.canMove, editCapabilities.canRotate]);

  useEffect(() => {
    if (
      moveGizmoActive &&
      ((moveGizmoMode === "translate" && !editCapabilities.canMove) ||
        (moveGizmoMode === "rotate" && !editCapabilities.canRotate))
    ) {
      setMoveGizmoActive(false);
    }
  }, [
    editCapabilities.canMove,
    editCapabilities.canRotate,
    moveGizmoActive,
    moveGizmoMode,
  ]);

  return (
    <div className="ifcnative-thatopen-shell">
      <div
        ref={containerRef}
        className={`ifcnative-thatopen-viewport${pickerActive ? " is-picking" : ""}`}
      >
        <div className="ifcnative-thatopen-viewport-toolbar">
          <button
            aria-label="Auswählen"
            className={`ifcnative-thatopen-tool${!moveGizmoActive && !pickerActive ? " is-active" : ""}`}
            title="Auswählen"
            type="button"
            onClick={() => {
              setMoveGizmoActive(false);
              setPickerActive(false);
            }}
          >
            <MousePointer2 aria-hidden size={16} />
          </button>
          <button
            aria-label="Verschieben (Gizmo)"
            className={`ifcnative-thatopen-tool${moveGizmoActive && moveGizmoMode === "translate" ? " is-active" : ""}`}
            disabled={!activeModelVisible || !editCapabilities.canMove}
            title={
              editCapabilities.canMove
                ? "Verschieben (Gizmo) · W"
                : editCapabilities.transformDisabledReason ??
                  "Auswahl kann nicht verschoben werden"
            }
            type="button"
            onClick={() => {
              setPickerActive(false);
              setMoveGizmoMode("translate");
              setMoveGizmoActive((current) =>
                moveGizmoMode === "translate" ? !current : true,
              );
            }}
          >
            <Move aria-hidden size={16} />
          </button>
          <button
            aria-label="Rotieren (Gizmo)"
            className={`ifcnative-thatopen-tool${moveGizmoActive && moveGizmoMode === "rotate" ? " is-active" : ""}`}
            disabled={!activeModelVisible || !editCapabilities.canRotate}
            title={
              editCapabilities.canRotate
                ? "Rotieren (Gizmo) · R"
                : editCapabilities.transformDisabledReason ??
                  "Auswahl kann nicht rotiert werden"
            }
            type="button"
            onClick={() => {
              setPickerActive(false);
              setMoveGizmoMode("rotate");
              setMoveGizmoActive((current) =>
                moveGizmoMode === "rotate" ? !current : true,
              );
            }}
          >
            <RotateCw aria-hidden size={16} />
          </button>
          <div aria-hidden className="ifcnative-thatopen-tool-divider" />
          <button
            aria-label="Koordinaten picken"
            className={`ifcnative-thatopen-tool${pickerActive ? " is-active" : ""}`}
            disabled={!hasVisibleModels}
            title="Koordinaten picken"
            type="button"
            onClick={() => {
              setCopyStatus("");
              setPickerActive((current) => !current);
            }}
          >
            <LocateFixed aria-hidden size={16} />
          </button>
          <button
            aria-label="Auf Modell zoomen"
            className="ifcnative-thatopen-tool"
            disabled={!hasVisibleModels}
            title="Auf Modell zoomen"
            type="button"
            onClick={() => void runtimeRef.current?.fit()}
          >
            <Maximize aria-hidden size={16} />
          </button>
          <button
            aria-label="Kamera zurücksetzen"
            className="ifcnative-thatopen-tool"
            disabled={!hasVisibleModels}
            title="Kamera zurücksetzen"
            type="button"
            onClick={() => void runtimeRef.current?.resetCamera()}
          >
            <Box aria-hidden size={16} />
          </button>
          <div aria-hidden className="ifcnative-thatopen-tool-divider" />
          <button
            aria-label="Modell neu berechnen"
            className={`ifcnative-thatopen-tool ifcnative-thatopen-recalc${pendingChangeCount ? " has-pending" : ""}`}
            disabled={!pendingChangeCount || !activeModelVisible}
            title={
              pendingChangeCount
                ? `Modell neu berechnen — ${pendingChangeCount} ausstehende Änderung${pendingChangeCount === 1 ? "" : "en"}:\n${(pendingViewerChanges ?? []).slice(-8).join("\n")}`
                : "Modell neu berechnen — keine ausstehenden Änderungen"
            }
            type="button"
            onClick={() => onRecalculateModel?.()}
          >
            <RefreshCw aria-hidden size={16} />
            {pendingChangeCount ? (
              <span className="ifcnative-thatopen-tool-badge">
                {pendingChangeCount > 99 ? "99+" : pendingChangeCount}
              </span>
            ) : null}
          </button>
        </div>
        {pickerActive ? (
          <div className="ifcnative-thatopen-picker-hint">
            Punkt im Modell anklicken
          </div>
        ) : null}
        {lastPick ? (
          <div className="ifcnative-thatopen-coordinate-readout">
            <span>{formatCoordinatePickLabel(lastPick)}</span>
            {copyStatus ? <strong>{copyStatus}</strong> : null}
            <button
              aria-label="Koordinaten kopieren"
              className="ifcnative-thatopen-coordinate-close"
              title="Koordinaten kopieren"
              type="button"
              onClick={() => void copyPick(lastPick)}
            >
              <Copy aria-hidden size={12} />
            </button>
            <button
              aria-label="Koordinatenanzeige schließen"
              className="ifcnative-thatopen-coordinate-close"
              title="Koordinatenanzeige schließen"
              type="button"
              onClick={closeCoordinateReadout}
            >
              ×
            </button>
          </div>
        ) : null}
        {loadProgress ? (
          <div className="ifcnative-thatopen-progress">
            <div className="ifcnative-thatopen-progress-label">
              <span>{loadProgress.fileName}</span>
              <strong>{loadProgress.percent}%</strong>
            </div>
            <div className="ifcnative-thatopen-progress-track">
              <div
                className="ifcnative-thatopen-progress-fill"
                style={{ width: `${loadProgress.percent}%` }}
              />
            </div>
          </div>
        ) : null}
        {showDeferredActiveModel ? (
          <div className="ifcnative-thatopen-deferred-load">
            <strong>{activeModelFileName ?? "Aktive IFC"}</strong>
            <span>{activeModelDeferredReason}</span>
            <button type="button" onClick={onLoadActiveModel}>
              3D laden
            </button>
          </div>
        ) : null}
        {error ? <div className="ifcnative-thatopen-error">{error}</div> : null}
      </div>
    </div>
  );
}
