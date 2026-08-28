import {
    Box,
    Check,
    Circle,
    Combine,
    Copy,
    CopyPlus,
    Cylinder,
    Eraser,
    LocateFixed,
    MapPin,
    Maximize,
    MousePointer2,
    Move,
    Plus,
    RefreshCw,
    Rotate3d,
    RotateCw,
    Slice,
    Square,
    Trash2,
    Triangle,
    X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { recordDiagnostic } from "../diagnostics/watchdog";
import {
    convertIfcToFragmentsInWorker,
    type ConvertIfcToFragmentsProgress,
} from "../ifc/fragmentConversionWorker";
import {
    fragmentModelPointToScene,
    fragmentScenePointToIfcWorld,
} from "../ifc/fragmentSceneCoordinates";
import type { NativeBodyProfile } from "../ifc/nativeDocument";
import { createBodyGeometry } from "./bodyGeometry";
import type {
    ThatOpenViewerModel,
    ThatOpenViewerProps,
    ViewerContextMenuTarget,
    ViewerCoordinatePick,
    ViewerCutPlaneChange,
    ViewerCutPlaneMode,
    ViewerCutPlaneState,
    ViewerMirrorOp,
    ViewerMirrorRequest,
    ViewerMirrorResult,
    ViewerMoveDelta,
    ViewerRotationChange,
    ViewerTransformCommitReceipt,
} from "./that-open-viewer.types";
import {
    ViewerRotaryMenu,
    type RotaryMenuChild,
    type RotaryMenuItem,
} from "./viewer-rotary-menu";

type ViewerRuntime = Awaited<ReturnType<typeof createThatOpenRuntime>>;

export default function ThatOpenViewer({
  activeDocumentId,
  activeModelDeferredReason,
  activeModelFileName,
  activeModelLoaded = true,
  combineSelectionCount = 0,
  cutPlane,
  editCapabilities = {
    canMove: false,
    canRotate: false,
  },
  focusRequest,
  mirrorRequests,
  models,
  onLoadActiveModel,
  onAddBodyAt,
  onCombineSelected,
  onCutPlaneActiveChange,
  onViewerMounted,
  onCutPlaneAxisCycle,
  onCutPlaneChange,
  onCutPlaneModeChange,
  onDeleteBody,
  onDuplicateBody,
  onLog,
  onMirrorApplied,
  onMoveSelected,
  onRecalculateModel,
  onRotateSelected,
  onPickCoordinates,
  onSelect,
  onSplitSelected,
  pendingViewerChanges,
  selectedEntityIds,
}: ThatOpenViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const modelsRef = useRef(models);
  const selectedByDocumentIdRef = useRef(new Map<string, number>());
  const selectedEntityIdsRef = useRef<number[]>([]);
  const onLogRef = useRef(onLog);
  const onCutPlaneChangeRef = useRef(onCutPlaneChange);
  const onMirrorAppliedRef = useRef(onMirrorApplied);
  const onMoveSelectedRef = useRef(onMoveSelected);
  const onRotateSelectedRef = useRef(onRotateSelected);
  const onPickCoordinatesRef = useRef(onPickCoordinates);
  const onSelectRef = useRef(onSelect);
  const onViewerMountedRef = useRef(onViewerMounted);
  const handledFocusNonceRef = useRef<number | undefined>(undefined);
  const handledMirrorNoncesRef = useRef(new Set<number>());
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
  const [contextTarget, setContextTarget] =
    useState<ViewerContextMenuTarget | null>(null);
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
  // Änderungssignatur der Mehrfachauswahl — triggert das Highlight neu.
  const selectionSignature = (selectedEntityIds ?? []).join(",");
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
  selectedEntityIdsRef.current = selectedEntityIds ?? [];
  onLogRef.current = onLog;
  onCutPlaneChangeRef.current = onCutPlaneChange;
  onMirrorAppliedRef.current = onMirrorApplied;
  onMoveSelectedRef.current = onMoveSelected;
  onRotateSelectedRef.current = onRotateSelected;
  onPickCoordinatesRef.current = onPickCoordinates;
  onSelectRef.current = onSelect;
  onViewerMountedRef.current = onViewerMounted;
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

    // Vor der ersten Konvertierung melden: der Workspace bumpt dann die
    // Revision von Sessions mit veraltetem viewerModelText (Live-Mirror war
    // weiter), damit dieser Mount nicht den alten Stand konvertiert.
    onViewerMountedRef.current?.();

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
        getSelectedIds: (documentId) =>
          documentId === activeDocumentIdRef.current
            ? selectedEntityIdsRef.current
            : [],
        onError: (message) => {
          setError(message);
          setStatus("ThatOpen viewer error");
        },
        onLog: (line) => onLogRef.current?.(line),
        onCutPlaneChange: (change) => onCutPlaneChangeRef.current?.(change),
        onMoveSelected: (entityId, delta) =>
          onMoveSelectedRef.current?.(entityId, delta) ?? null,
        onRotateSelected: (entityId, rotation) =>
          onRotateSelectedRef.current?.(entityId, rotation) ?? null,
        onTransformResult: (result) => onMirrorAppliedRef.current?.(result),
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
        onContextTarget: (target) => setContextTarget(target),
        onProgress: (progress) => setLoadProgress(progress),
        onSelect: (id, source, globalId, documentId, additive) =>
          onSelectRef.current(id, source, globalId, documentId, additive),
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
    // requestAnimationFrame feuert nicht, solange das Fenster verdeckt oder
    // minimiert ist. Ohne Timeout-Rückfall bliebe eine im Hintergrund
    // angestoßene Konvertierung endlos in "Converting…" hängen und der Viewer
    // wirkte nach dem Zurückwechseln tot.
    let started = false;
    const startSync = () => {
      if (started || cancelled) {
        return;
      }
      started = true;
      window.clearTimeout(fallbackId);
      cancelAnimationFrame(frameId);
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
    };
    const frameId = requestAnimationFrame(startSync);
    const fallbackId = window.setTimeout(() => {
      recordDiagnostic(
        "note",
        "Modell-Sync per Timeout gestartet (kein Animationsframe — Fenster im Hintergrund?)",
      );
      startSync();
    }, 2_000);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(fallbackId);
    };
  }, [modelLoadSignature, runtimeReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !modelReady) {
      return;
    }
    void runtime.highlight(activeDocumentId, activeSelectedId);
    void runtime.updateGrid(activeDocumentId);
  }, [activeDocumentId, activeSelectedId, modelReady, selectionSignature]);

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

  // Live-Mirror-Queue: im nativen Dokument committete Änderungen in
  // Reihenfolge per Fragments-Edit-API übernehmen. Läuft im Runtime hinter
  // der Modell-Lade-Queue, damit ein Mirror nie ein gerade neu konvertiertes
  // Modell (das die Änderung schon enthält) doppelt trifft. Verarbeitete
  // Nonces werden lokal gemerkt; aus der Queue entfernt sie der Workspace
  // über die Result-Nonce.
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtimeReady || !mirrorRequests?.length) {
      return;
    }
    for (const request of mirrorRequests) {
      if (handledMirrorNoncesRef.current.has(request.nonce)) {
        continue;
      }
      handledMirrorNoncesRef.current.add(request.nonce);
      void runtime
        .applyMirror(request)
        .then((result) => onMirrorAppliedRef.current?.(result))
        .catch((reason) => {
          onMirrorAppliedRef.current?.({
            documentId: request.documentId,
            label: request.label,
            nonce: request.nonce,
            ok: false,
            pendingKey: request.pendingKey,
            reason: stringifyError(reason),
          });
        });
    }
  }, [mirrorRequests, runtimeReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtimeReady) {
      return;
    }
    void runtime.setMoveGizmoEnabled(moveGizmoActive && !cutPlane?.active);
  }, [cutPlane?.active, moveGizmoActive, runtimeReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtimeReady) {
      return;
    }
    runtime.setMoveGizmoMode(moveGizmoMode);
  }, [moveGizmoMode, runtimeReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtimeReady || !modelReady) {
      return;
    }
    void runtime.setCutPlane(cutPlane);
  }, [
    activeDocumentId,
    activeSelectedId,
    cutPlane?.active,
    cutPlane?.mode,
    cutPlane?.normal.x,
    cutPlane?.normal.y,
    cutPlane?.normal.z,
    cutPlane?.position?.x,
    cutPlane?.position?.y,
    cutPlane?.position?.z,
    cutPlane?.resetNonce,
    modelReady,
    runtimeReady,
  ]);

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
        if (cutPlane?.active) {
          onCutPlaneActiveChange?.(false);
        }
        setMoveGizmoActive(false);
        setPickerActive(false);
        return;
      }
      const key = event.key.toLowerCase();
      if (cutPlane?.active && (key === "w" || key === "r")) {
        event.preventDefault();
        onCutPlaneModeChange?.(key === "w" ? "translate" : "rotate");
        return;
      }
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
  }, [
    cutPlane?.active,
    editCapabilities.canMove,
    editCapabilities.canRotate,
    onCutPlaneActiveChange,
    onCutPlaneModeChange,
  ]);

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

  const rotaryItems = useMemo<RotaryMenuItem[]>(
    () => [
      {
        children: [
          { icon: Square, id: "add:rectangle", label: "Quader" },
          { icon: Cylinder, id: "add:cylinder", label: "Zylinder" },
          { icon: Circle, id: "add:ellipse", label: "Ellipse" },
          { icon: Triangle, id: "add:triangle", label: "Dreieck" },
          { icon: MapPin, id: "add:marker", label: "Marker" },
        ],
        icon: Plus,
        id: "add",
        label: "Hier hinzufügen",
      },
      { icon: CopyPlus, id: "duplicate", label: "Duplizieren" },
      { icon: Slice, id: "split", label: "Zerteilen" },
      {
        disabled: combineSelectionCount < 2,
        icon: Combine,
        id: "combine",
        label:
          combineSelectionCount >= 2
            ? `Kombinieren (${combineSelectionCount})`
            : "Kombinieren",
      },
      {
        accent: "var(--destructive, #dc2626)",
        children: [
          {
            description: "IFC-Objekt bleibt erhalten",
            icon: Eraser,
            id: "delete:geometry",
            label: "Nur Geometrie",
          },
          {
            description: "Objekt samt Kaskade löschen",
            icon: Trash2,
            id: "delete:entity",
            label: "Mit IFC-Objekt",
          },
        ],
        icon: Trash2,
        id: "delete",
        label: "Körper löschen",
      },
    ],
    [combineSelectionCount],
  );

  const ADD_PROFILES: Record<string, NativeBodyProfile> = {
    "add:cylinder": "cylinder",
    "add:ellipse": "ellipse",
    "add:marker": "marker",
    "add:rectangle": "rectangle",
    "add:triangle": "triangle",
  };

  const handleRotarySelect = (item: RotaryMenuChild) => {
    const target = contextTarget;
    if (!target) {
      return;
    }
    const profile = ADD_PROFILES[item.id];
    if (profile) {
      onAddBodyAt?.(profile, target);
    } else if (item.id === "duplicate") {
      onDuplicateBody?.(target.entityId);
    } else if (item.id === "combine") {
      onCombineSelected?.();
    } else if (item.id === "split") {
      // Schnittebene auf der (per Rechtsklick selektierten) Auswahl spawnen;
      // bestätigt wird über die Leiste unten in der Mitte.
      setMoveGizmoActive(false);
      setPickerActive(false);
      onCutPlaneActiveChange?.(true);
    } else if (item.id === "delete:geometry") {
      onDeleteBody?.(target.entityId, false);
    } else if (item.id === "delete:entity") {
      onDeleteBody?.(target.entityId, true);
    }
  };

  return (
    <div className="ifcnative-thatopen-shell">
      <div
        ref={containerRef}
        className={`ifcnative-thatopen-viewport${pickerActive ? " is-picking" : ""}`}
      >
        <div className="ifcnative-thatopen-viewport-toolbar">
          <button
            aria-label="Auswählen"
            className={`ifcnative-thatopen-tool${!moveGizmoActive && !pickerActive && !cutPlane?.active ? " is-active" : ""}`}
            title="Auswählen"
            type="button"
            onClick={() => {
              onCutPlaneActiveChange?.(false);
              setMoveGizmoActive(false);
              setPickerActive(false);
            }}
          >
            <MousePointer2 aria-hidden size={16} />
          </button>
          <button
            aria-label={
              cutPlane?.active
                ? "Schnittebene verschieben"
                : "Verschieben (Gizmo)"
            }
            className={`ifcnative-thatopen-tool${cutPlane?.active ? (cutPlane.mode === "translate" ? " is-active" : "") : moveGizmoActive && moveGizmoMode === "translate" ? " is-active" : ""}`}
            disabled={
              !activeModelVisible ||
              (!cutPlane?.active && !editCapabilities.canMove)
            }
            title={
              cutPlane?.active
                ? "Schnittebene verschieben · W"
                : editCapabilities.canMove
                  ? "Verschieben (Gizmo) · W"
                  : (editCapabilities.transformDisabledReason ??
                    "Auswahl kann nicht verschoben werden")
            }
            type="button"
            onClick={() => {
              setPickerActive(false);
              if (cutPlane?.active) {
                onCutPlaneModeChange?.("translate");
                return;
              }
              setMoveGizmoMode("translate");
              setMoveGizmoActive((current) =>
                moveGizmoMode === "translate" ? !current : true,
              );
            }}
          >
            <Move aria-hidden size={16} />
          </button>
          <button
            aria-label={
              cutPlane?.active ? "Schnittebene rotieren" : "Rotieren (Gizmo)"
            }
            className={`ifcnative-thatopen-tool${cutPlane?.active ? (cutPlane.mode === "rotate" ? " is-active" : "") : moveGizmoActive && moveGizmoMode === "rotate" ? " is-active" : ""}`}
            disabled={
              !activeModelVisible ||
              (!cutPlane?.active && !editCapabilities.canRotate)
            }
            title={
              cutPlane?.active
                ? "Schnittebene rotieren · R"
                : editCapabilities.canRotate
                  ? "Rotieren (Gizmo) · R"
                  : (editCapabilities.transformDisabledReason ??
                    "Auswahl kann nicht rotiert werden")
            }
            type="button"
            onClick={() => {
              setPickerActive(false);
              if (cutPlane?.active) {
                onCutPlaneModeChange?.("rotate");
                return;
              }
              setMoveGizmoMode("rotate");
              setMoveGizmoActive((current) =>
                moveGizmoMode === "rotate" ? !current : true,
              );
            }}
          >
            <RotateCw aria-hidden size={16} />
          </button>
          <button
            aria-label="Schnittebene"
            className={`ifcnative-thatopen-tool${cutPlane?.active ? " is-active" : ""}`}
            disabled={!activeModelVisible}
            title={
              cutPlane?.active
                ? "Schnittebene ausblenden · Esc"
                : "Schnittebene auf der Auswahl einblenden"
            }
            type="button"
            onClick={() => {
              setMoveGizmoActive(false);
              setPickerActive(false);
              onCutPlaneActiveChange?.(!cutPlane?.active);
            }}
          >
            <Slice aria-hidden size={16} />
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
        {cutPlane?.active ? (
          <div className="ifcnative-thatopen-cut-plane-hint">
            Schnittebene ·{" "}
            {cutPlane.mode === "translate" ? "Verschieben" : "Rotieren"}
            <span>W / R · Esc beendet</span>
          </div>
        ) : null}
        {cutPlane?.active ? (
          <div className="ifcnative-thatopen-split-bar">
            <button
              title="Schnittachse zyklisch drehen (Y → X → Z)"
              type="button"
              onClick={() => onCutPlaneAxisCycle?.()}
            >
              <Rotate3d aria-hidden size={14} />
              Achse drehen
            </button>
            <button
              className="primary"
              title="Auswahl an der Schnittebene zerteilen"
              type="button"
              onClick={() => onSplitSelected?.()}
            >
              <Check aria-hidden size={14} />
              Zerteilen
            </button>
            <button
              aria-label="Zerteilen abbrechen"
              title="Abbrechen · Esc"
              type="button"
              onClick={() => onCutPlaneActiveChange?.(false)}
            >
              <X aria-hidden size={14} />
            </button>
          </div>
        ) : null}
        {contextTarget ? (
          <ViewerRotaryMenu
            ariaLabel="Körper-Aktionen"
            items={rotaryItems}
            x={contextTarget.clientX}
            y={contextTarget.clientY}
            onClose={() => setContextTarget(null)}
            onSelect={handleRotarySelect}
          />
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

function formatFragmentConversionProgress(
  progress: ConvertIfcToFragmentsProgress,
) {
  const percent = Math.round(progress.progress * 100);
  const process = progress.process ? ` ${progress.process}` : "";
  const state = progress.state ? ` ${progress.state}` : "";
  return `Converting ${progress.fileName}${process}${state} ${percent}%`;
}

async function createThatOpenRuntime(
  container: HTMLDivElement,
  callbacks: {
    getActiveDocumentId(): string;
    getSelectedId(documentId?: string): number;
    /** Vollständige Mehrfachauswahl des Dokuments (leer für inaktive Dokumente). */
    getSelectedIds(documentId: string): number[];
    isCoordinatePickerActive(): boolean;
    onError(message: string): void;
    onCoordinatePickerUsed(): void;
    onContextTarget(target: ViewerContextMenuTarget): void;
    onLog(line: string): void;
    onCutPlaneChange(change: ViewerCutPlaneChange): void;
    onMoveSelected(
      entityId: number,
      delta: ViewerMoveDelta,
    ): ViewerTransformCommitReceipt | null;
    onRotateSelected(
      entityId: number,
      rotation: ViewerRotationChange,
    ): ViewerTransformCommitReceipt | null;
    onTransformResult(result: ViewerMirrorResult): void;
    onPickCoordinates(pick: ViewerCoordinatePick): void;
    onProgress(progress: { fileName: string; percent: number } | null): void;
    onSelect(
      id: number,
      source?: string,
      globalId?: string,
      documentId?: string,
      additive?: boolean,
    ): void;
    onStatus(message: string): void;
  },
) {
  const [OBC, THREE, FRAGS, BUI, OBCUI, transformControlsModule] =
    await Promise.all([
      import("@thatopen/components"),
      import("three"),
      import("@thatopen/fragments"),
      import("@thatopen/ui"),
      import("@thatopen/ui-obc"),
      import("three/addons/controls/TransformControls.js"),
    ]);
  BUI.Manager.init();
  OBCUI.Manager.init();

  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  const world = worlds.create<
    import("@thatopen/components").SimpleScene,
    import("@thatopen/components").SimpleCamera,
    import("@thatopen/components").SimpleRenderer
  >();
  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.renderer = new OBC.SimpleRenderer(components, container, {
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  world.renderer.showLogo = false;
  world.camera = new OBC.SimpleCamera(components);

  components.init();
  const readViewerBackdrop = () => {
    const value = getComputedStyle(container)
      .getPropertyValue("--viewer-backdrop")
      .trim();
    return value || "#f8fafc";
  };
  world.scene.three.background = new THREE.Color(readViewerBackdrop());
  world.camera.three.near = 0.1;
  world.camera.three.far = 1_000_000;
  world.camera.three.updateProjectionMatrix();
  world.camera.controls.setLookAt(8, 6, 8, 0, 0, 0);

  const grids = components.get(OBC.Grids);
  const grid = grids.create(world);
  const readGridColor = () =>
    new THREE.Color(
      globalThis.document.documentElement.classList.contains("dark")
        ? 0x64748b
        : 0x94a3b8,
    );
  grid.setup({
    color: readGridColor(),
    distance: 1_000,
    primarySize: 1,
    secondarySize: 10,
  });
  // SimpleGrid.setup currently forces visibility to true internally; keep the
  // runtime setting explicit after setup as recommended by the component API.
  grid.config.visible = true;
  grid.fade = world.camera.three instanceof THREE.PerspectiveCamera;
  // Der InfiniteGrid-Shader wertet fract() auf ABSOLUTEN Weltkoordinaten aus
  // — weit vom Ursprung (georeferenzierte Modelle) flackern die Linien durch
  // float32-Rundung. Patch: Muster kamera-relativ rechnen; der Anker uCamRel
  // wird CPU-seitig in float64 gegen die auf ein Rasterperioden-Vielfaches
  // gesnappte Kameraposition bestimmt — das Muster bleibt exakt weltverankert,
  // die Shader-Werte bleiben klein.
  const gridMaterial = grid.material;
  gridMaterial.uniforms.uCamRel = { value: new THREE.Vector2() };
  gridMaterial.vertexShader = `
    varying vec2 relPosition;
    uniform float uDistance;
    uniform vec2 uCamRel;
    void main() {
      vec3 pos = position.xzy * uDistance;
      relPosition = pos.xz + uCamRel;
      pos.xz += cameraPosition.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;
  gridMaterial.fragmentShader = `
    varying vec2 relPosition;
    uniform float uZoom;
    uniform float uFade;
    uniform float uSize1;
    uniform float uSize2;
    uniform vec3 uColor;
    uniform float uDistance;
    uniform vec2 uCamRel;
    float getGrid(float size) {
      vec2 r = relPosition / size;
      vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
      float line = min(grid.x, grid.y);
      return 1.0 - min(line, 1.0);
    }
    void main() {
      float d = 1.0 - min(distance(uCamRel, relPosition) / uDistance, 1.0);
      float g1 = getGrid(uSize1);
      float g2 = getGrid(uSize2);
      // Ortho camera fades the grid away when zooming out
      float minZoom = step(0.2, uZoom);
      float zoomFactor = pow(min(uZoom, 1.), 2.) * minZoom;
      gl_FragColor = vec4(uColor.rgb, mix(g2, g1, g1) * pow(d, uFade));
      gl_FragColor.a = mix(0.5 * gl_FragColor.a, gl_FragColor.a, g2) * zoomFactor;
      if (gl_FragColor.a <= 0.0) discard;
    }
  `;
  gridMaterial.needsUpdate = true;
  const updateGridAnchor = () => {
    const size1 = Math.abs(Number(gridMaterial.uniforms.uSize1.value)) || 1;
    const size2 = Math.abs(Number(gridMaterial.uniforms.uSize2.value)) || 10;
    // Vielfaches beider Rastergrößen — Verschiebung darum ist musterinvariant.
    const period = Math.max(size1 * size2, 1);
    const camera = world.camera.three.position;
    (gridMaterial.uniforms.uCamRel.value as import("three").Vector2).set(
      camera.x - Math.round(camera.x / period) * period,
      camera.z - Math.round(camera.z / period) * period,
    );
  };
  updateGridAnchor();
  world.camera.controls.addEventListener("update", updateGridAnchor);
  const themeObserver = new MutationObserver(() => {
    world.scene.three.background = new THREE.Color(readViewerBackdrop());
    grid.config.color = readGridColor();
  });
  const fragments = components.get(OBC.FragmentsManager);
  // Official Fragments workflow: let the installed package resolve its
  // matching worker. Our postinstall patch keeps that worker available
  // locally for the desktop/offline build.
  const fragmentsWorkerUrl = await OBC.FragmentsManager.getWorker();
  fragments.init(fragmentsWorkerUrl);
  // Keep COORDINATE_TO_ORIGIN for float32 precision, but let Fragments place
  // every independently rebased IFC relative to the first loaded model. Picks
  // and native writes still use each model's own coordination matrix below.
  fragments.core.settings.autoCoordinate = true;
  const updateFragmentsOnCamera = () =>
    void fragments.core.update().catch(() => undefined);
  world.camera.controls.addEventListener("update", updateFragmentsOnCamera);
  const handleFragmentModelSet = ({
    value: model,
  }: {
    value: import("@thatopen/fragments").FragmentsModel;
  }) => {
    model.useCamera(world.camera.three);
    world.scene.three.add(model.object);
    void fragments.core.update(true).catch(() => undefined);
  };
  const handleFragmentMaterialSet = ({
    value: material,
  }: {
    value: import("@thatopen/fragments").BIMMaterial;
  }) => {
    if (!("isLodMaterial" in material && material.isLodMaterial)) {
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
      material.needsUpdate = true;
    }
  };
  fragments.list.onItemSet.add(handleFragmentModelSet);
  fragments.core.models.materials.list.onItemSet.add(handleFragmentMaterialSet);
  const viewCube = createThatOpenViewCube(THREE, container, world.camera);
  const moveGizmo = createMoveGizmo(
    THREE,
    transformControlsModule.TransformControls,
    fragments.core,
    world.scene.three,
    world.camera.three,
    world.camera.controls,
    canvasFromRenderer(world.renderer),
    async (change) => {
      const activeDocumentId = callbacks.getActiveDocumentId();
      const loaded = modelsByDocumentId.get(activeDocumentId);
      if (!loaded || !Number.isFinite(change.localId) || change.localId <= 0) {
        callbacks.onLog(
          `fragments.moveSkipped({ reason: 'no-active-selection' });`,
        );
        return null;
      }
      const entityId =
        loaded.mirrorEntityIdByLocalId.get(change.localId) ?? change.localId;
      if (callbacks.getSelectedId(activeDocumentId) !== entityId) {
        callbacks.onLog(
          `fragments.transformSkipped({ reason: 'selection-changed', id: ${entityId} });`,
        );
        return null;
      }
      let receipt: ViewerTransformCommitReceipt | null = null;
      if (change.mode === "translate" && change.delta) {
        const worldDelta = sceneToIfcWorldVector(loaded, change.delta);
        receipt = callbacks.onMoveSelected(entityId, {
          x: worldDelta.x,
          y: worldDelta.y,
          z: worldDelta.z,
        });
        callbacks.onLog(
          `fragments.moveCommitted({ file: '${loaded.fileName}', id: ${entityId}, dx: ${formatCoordinate(worldDelta.x)}, dy: ${formatCoordinate(worldDelta.y)}, dz: ${formatCoordinate(worldDelta.z)} });`,
        );
      } else if (change.rotationChange) {
        const worldAxis = sceneToIfcWorldVector(
          loaded,
          change.rotationChange.axis,
          true,
        );
        const worldRefDirection = sceneToIfcWorldVector(
          loaded,
          change.rotationChange.refDirection,
          true,
        );
        receipt = callbacks.onRotateSelected(entityId, {
          ...change.rotationChange,
          axis: { x: worldAxis.x, y: worldAxis.y, z: worldAxis.z },
          refDirection: {
            x: worldRefDirection.x,
            y: worldRefDirection.y,
            z: worldRefDirection.z,
          },
        });
        callbacks.onLog(
          `fragments.rotateCommitted({ file: '${loaded.fileName}', id: ${entityId}, rx: ${formatCoordinate(change.rotation?.x ?? 0)}, ry: ${formatCoordinate(change.rotation?.y ?? 0)}, rz: ${formatCoordinate(change.rotation?.z ?? 0)} });`,
        );
      }
      return receipt
        ? { ...receipt, documentId: activeDocumentId, entityId }
        : null;
    },
    async (change, receipt) => {
      callbacks.onTransformResult({
        documentId: receipt.documentId,
        label: receipt.label,
        ok: change.applied,
        pendingKey: receipt.pendingKey,
        reason: change.applied ? undefined : "fragments-edit-failed",
      });
      await highlight(receipt.documentId, receipt.entityId).catch(
        () => undefined,
      );
      callbacks.onLog(
        `fragments.transformFinished({ id: ${receipt.entityId}, mode: '${change.mode}', applied: ${change.applied} });`,
      );
    },
    (line) => callbacks.onLog(line),
    () => void fragments.core.update(true),
    isHiddenLocalId,
  );
  const coordinateCursor = createCoordinateCursor(THREE);
  world.scene.three.add(coordinateCursor.group, coordinateCursor.rayLine);

  const selectionMaterial = {
    color: new THREE.Color(0xffb703),
    customId: "ifcnative-selection",
    opacity: 0.95,
    renderedFaces: FRAGS.RenderedFaces.TWO,
    transparent: false,
  };

  type LoadedViewerModel = {
    documentId: string;
    fileName: string;
    fitItems?: Set<number>;
    /**
     * Per removeMirroredElement ausgeblendete (ersetzte/entfernte) Elemente je
     * Fragments-Modell. highlight/resetHighlight kann ihre Sichtbarkeit
     * zurücksetzen — nach jedem Highlight werden sie erneut ausgeblendet,
     * sonst bleibt z. B. nach Kombinieren + Verschieben ein Geist-Körper
     * stehen.
     */
    hiddenLocalIdsByModelId: Map<string, Set<number>>;
    loadKey: string;
    /**
     * Id-Mapping für per Mirror ERZEUGTE Elemente: createElements vergibt
     * eigene Fragments-localIds, die nicht der nativen Express-Id
     * entsprechen. Für alle konvertierten Elemente gilt localId == Express-Id.
     * Ein Eintrag bedeutet zugleich: das Element ist ein DELTA-Element der
     * Edit-API (eigenes Delta-Render-Modell, kein setVisible, keine
     * verlässlichen Editor-Klon-Meshes) — bis zur nächsten Rekonversion.
     */
    mirrorEntityIdByLocalId: Map<number, number>;
    mirrorLocalIdByEntityId: Map<number, number>;
    model: import("@thatopen/fragments").FragmentsModel;
    /**
     * Partiell rekonvertierte Teilmodelle (Mirror-Op "reconvert-subset"):
     * eigenständige Fragments-Modelle, die einzelne Produkte des Basismodells
     * ersetzen. entityIds = native Express-Ids, die das Subset rendert.
     */
    subsetModels: {
      entityIds: Set<number>;
      model: import("@thatopen/fragments").FragmentsModel;
    }[];
    /**
     * Rebase aus der Konvertierung (COORDINATE_TO_ORIGIN): lokaler Modellraum
     * → echte IFC-Welt (Viewer-Achsen, Meter) und Umkehrung. Die zusätzliche
     * model.object-Transformation koordiniert diesen Modellraum in der Szene.
     */
    modelToIfcWorld: import("three").Matrix4 | null;
    ifcWorldToModel: import("three").Matrix4 | null;
  };

  // Punkt aus dem zentrierten Szenenraum in echte IFC-Weltkoordinaten
  // (Viewer-Achsen, Meter) umrechnen.
  const sceneToIfcWorldPoint = (
    loaded: LoadedViewerModel,
    point: { x: number; y: number; z: number },
  ) => {
    const vector = new THREE.Vector3(point.x, point.y, point.z);
    return fragmentScenePointToIfcWorld(
      vector,
      loaded.model.object,
      loaded.modelToIfcWorld,
    );
  };

  const sceneToIfcWorldVector = (
    loaded: LoadedViewerModel,
    vector: { x?: number; y?: number; z?: number },
    normalize = false,
  ) => {
    const result = new THREE.Vector3(
      vector.x ?? 0,
      vector.y ?? 0,
      vector.z ?? 0,
    );
    if (loaded.modelToIfcWorld) {
      result.applyMatrix3(
        new THREE.Matrix3().setFromMatrix4(loaded.modelToIfcWorld),
      );
    }
    return normalize ? result.normalize() : result;
  };

  const ifcWorldToSceneVector = (
    loaded: LoadedViewerModel,
    vector: { x?: number; y?: number; z?: number },
  ) => {
    const result = new THREE.Vector3(
      vector.x ?? 0,
      vector.y ?? 0,
      vector.z ?? 0,
    );
    if (loaded.ifcWorldToModel) {
      result.applyMatrix3(
        new THREE.Matrix3().setFromMatrix4(loaded.ifcWorldToModel),
      );
    }
    return result;
  };

  const ifcWorldToScenePoint = (
    loaded: LoadedViewerModel,
    point: { x: number; y: number; z: number },
  ) => {
    const result = new THREE.Vector3(point.x, point.y, point.z);
    if (loaded.ifcWorldToModel) {
      result.applyMatrix4(loaded.ifcWorldToModel);
    }
    loaded.model.object.updateMatrixWorld(true);
    return result.applyMatrix4(loaded.model.object.matrixWorld);
  };

  const ifcWorldToSceneDirection = (
    loaded: LoadedViewerModel,
    direction: { x: number; y: number; z: number },
  ) => {
    const result = new THREE.Vector3(direction.x, direction.y, direction.z);
    if (loaded.ifcWorldToModel) {
      result.applyMatrix3(
        new THREE.Matrix3().setFromMatrix4(loaded.ifcWorldToModel),
      );
    }
    loaded.model.object.updateMatrixWorld(true);
    return result
      .applyMatrix3(
        new THREE.Matrix3().setFromMatrix4(loaded.model.object.matrixWorld),
      )
      .normalize();
  };

  const sceneToIfcWorldDirection = (
    loaded: LoadedViewerModel,
    direction: { x: number; y: number; z: number },
  ) => {
    loaded.model.object.updateMatrixWorld(true);
    const objectRotation = new THREE.Matrix3()
      .setFromMatrix4(loaded.model.object.matrixWorld)
      .invert();
    const result = new THREE.Vector3(
      direction.x,
      direction.y,
      direction.z,
    ).applyMatrix3(objectRotation);
    if (loaded.modelToIfcWorld) {
      result.applyMatrix3(
        new THREE.Matrix3().setFromMatrix4(loaded.modelToIfcWorld),
      );
    }
    return result.normalize();
  };

  const modelsByDocumentId = new Map<string, LoadedViewerModel>();
  const documentIdByModelId = new Map<string, string>();
  // Nach dispose() dürfen laufende Sync-/Mirror-Ops nichts mehr in die tote
  // Fragments-Instanz laden (Worker-/GPU-Leak).
  let runtimeDisposed = false;

  // Zentrale Auskunft für alle Restore-Pfade: ist dieses Element in diesem
  // Modell als ersetzt/entfernt ausgeblendet? Verhindert, dass Gizmo- oder
  // Mirror-Restores einen vorgemerkten Geist wieder sichtbar machen.
  function isHiddenLocalId(modelId: string, localId: number) {
    for (const loaded of modelsByDocumentId.values()) {
      if (loaded.hiddenLocalIdsByModelId.get(modelId)?.has(localId)) {
        return true;
      }
    }
    return false;
  }

  // Native Express-Id → Fragments-localId (nur für per Mirror erzeugte
  // Elemente verschieden; sonst identisch). Umkehrung direkt über
  // mirrorEntityIdByLocalId.
  const resolveLocalId = (loaded: LoadedViewerModel, entityId: number) =>
    loaded.mirrorLocalIdByEntityId.get(entityId) ?? entityId;

  // Besitzendes Fragments-Modell eines Elements: partiell rekonvertierte
  // Produkte rendern (und editieren) in ihrem Subset-Modell, alle anderen im
  // Basismodell. Rückwärts, damit das jüngste Subset gewinnt.
  const resolveElementModel = (loaded: LoadedViewerModel, entityId: number) => {
    for (let index = loaded.subsetModels.length - 1; index >= 0; index -= 1) {
      const subset = loaded.subsetModels[index];
      if (subset.entityIds.has(entityId)) {
        return subset.model;
      }
    }
    return loaded.model;
  };

  const cutPlaneGizmo = createCutPlaneGizmo(
    THREE,
    transformControlsModule.TransformControls,
    world.scene.three,
    world.camera.three,
    world.camera.controls,
    canvasFromRenderer(world.renderer),
    (change) => {
      const documentId = callbacks.getActiveDocumentId();
      const loaded = modelsByDocumentId.get(documentId);
      if (!loaded) {
        return;
      }
      const point = sceneToIfcWorldPoint(loaded, change.position);
      const normal = sceneToIfcWorldDirection(loaded, change.normal);
      callbacks.onCutPlaneChange({
        normal: { x: normal.x, y: normal.y, z: normal.z },
        position: { x: point.x, y: point.y, z: point.z },
      });
      callbacks.onLog(
        `viewer.cutPlane.changed({ position: { x: ${formatCoordinate(point.x)}, y: ${formatCoordinate(point.y)}, z: ${formatCoordinate(point.z)} }, normal: { x: ${formatCoordinate(normal.x)}, y: ${formatCoordinate(normal.y)}, z: ${formatCoordinate(normal.z)} } });`,
      );
    },
    () => void fragments.core.update(true),
  );
  let cutPlaneUpdateNonce = 0;

  // Bounding-Box der Auswahl im Szenenraum: erst das besitzende Modell,
  // dann Basis und übrige Subsets — je nachdem, wo die Geometrie rendert.
  const getElementSceneBounds = async (
    loaded: LoadedViewerModel,
    entityId: number,
  ) => {
    const owning = resolveElementModel(loaded, entityId);
    const candidates: {
      id: number;
      model: import("@thatopen/fragments").FragmentsModel;
    }[] = [
      {
        id:
          owning === loaded.model ? resolveLocalId(loaded, entityId) : entityId,
        model: owning,
      },
    ];
    if (owning !== loaded.model) {
      candidates.push({
        id: resolveLocalId(loaded, entityId),
        model: loaded.model,
      });
    }
    for (let index = loaded.subsetModels.length - 1; index >= 0; index -= 1) {
      const model = loaded.subsetModels[index].model;
      if (!candidates.some((candidate) => candidate.model === model)) {
        candidates.push({ id: entityId, model });
      }
    }
    for (const candidate of candidates) {
      const box = await candidate.model
        .getMergedBox([candidate.id])
        .catch(() => null);
      if (box && !box.isEmpty()) {
        return {
          center: fragmentModelPointToScene(
            box.getCenter(new THREE.Vector3()),
            candidate.model.object,
          ),
          size: box.getSize(new THREE.Vector3()).length(),
        };
      }
    }
    return null;
  };

  function setCutPlane(state: ViewerCutPlaneState | undefined) {
    if (!state?.active) {
      cutPlaneUpdateNonce += 1;
      cutPlaneGizmo.setState({ active: false });
      return Promise.resolve();
    }
    return setCutPlaneInternal(state).catch(() => undefined);
  }

  async function setCutPlaneInternal(state: ViewerCutPlaneState) {
    const updateNonce = ++cutPlaneUpdateNonce;
    const documentId = callbacks.getActiveDocumentId();
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded) {
      cutPlaneGizmo.setState({ active: false });
      return;
    }
    const entityId = callbacks.getSelectedId(documentId);
    let bounds = await getElementSceneBounds(loaded, entityId);
    if (updateNonce !== cutPlaneUpdateNonce) {
      return;
    }
    if (!bounds && !state.position) {
      // Direkt nach "Hinzufügen"/Split rendert die Auswahl in einem Subset,
      // das die laufende Rekonvertierung erst noch lädt: einmal (mit Timeout,
      // nur lesend) auf die Lade-/Mirror-Queue warten und erneut suchen.
      await Promise.race([
        syncQueue.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 2_500)),
      ]);
      if (updateNonce !== cutPlaneUpdateNonce) {
        return;
      }
      bounds = await getElementSceneBounds(loaded, entityId);
      if (updateNonce !== cutPlaneUpdateNonce) {
        return;
      }
    }
    // Ohne Geometrie-Box am sichtbaren Kamera-Ziel spawnen statt am Ursprung.
    const boxCenter =
      bounds?.center ?? world.camera.controls.getTarget(new THREE.Vector3());
    const boxSize = bounds?.size ?? 4;
    const position = state.position
      ? ifcWorldToScenePoint(loaded, state.position)
      : boxCenter;
    const normal = ifcWorldToSceneDirection(loaded, state.normal);
    cutPlaneGizmo.setState({
      active: true,
      mode: state.mode,
      normal,
      position,
      size: Math.min(100, Math.max(1, boxSize * 1.35)),
    });
    if (!state.position) {
      const initialPoint = sceneToIfcWorldPoint(loaded, position);
      const initialNormal = sceneToIfcWorldDirection(loaded, normal);
      callbacks.onCutPlaneChange({
        normal: {
          x: initialNormal.x,
          y: initialNormal.y,
          z: initialNormal.z,
        },
        position: {
          x: initialPoint.x,
          y: initialPoint.y,
          z: initialPoint.z,
        },
      });
    }
  }

  async function updateGrid(documentId: string) {
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded) {
      grid.three.position.y = 0;
      return;
    }
    const categories = await loaded.model
      .getItemsOfCategories([/BUILDINGSTOREY/])
      .catch(() => ({}));
    const storeyIds = Object.values(categories).flat();
    const storeys = storeyIds.length
      ? await loaded.model.getItemsData(storeyIds).catch(() => [])
      : [];
    const elevations = storeys
      .map((storey) => readNumericAttribute(storey, ["Elevation", "elevation"]))
      .filter((value): value is number => value !== undefined);
    const coordinates = await loaded.model.getCoordinates().catch(() => []);
    const coordinationHeight = Number(coordinates[1] ?? 0);
    const finiteCoordinationHeight = Number.isFinite(coordinationHeight)
      ? coordinationHeight
      : 0;
    let gridElevation: number;
    if (elevations.length) {
      // Elevation is expressed in IFC world coordinates. First convert it to
      // this model's rebased local frame, then include the model.object offset
      // that Fragments applied while coordinating all loaded IFCs.
      const localGridPoint = new THREE.Vector3(
        0,
        Math.min(...elevations) + finiteCoordinationHeight,
        0,
      );
      gridElevation = fragmentModelPointToScene(
        localGridPoint,
        loaded.model.object,
      ).y;
    } else {
      // Some infrastructure IFCs omit IfcBuildingStorey.Elevation. In that
      // case, anchor the grid to the visible model bounds instead of putting
      // it at an unrelated georeferencing origin.
      const gridItems = loaded.fitItems
        ? [...loaded.fitItems]
        : await loaded.model.getLocalIds().catch(() => []);
      const box = gridItems.length
        ? await loaded.model.getMergedBox(gridItems).catch(() => null)
        : null;
      gridElevation = box && !box.isEmpty() ? box.min.y : 0;
    }
    grid.three.position.y = gridElevation;
    callbacks.onLog(
      `viewer.grid({ file: '${loaded.fileName}', elevation: ${formatCoordinate(grid.three.position.y)}, storeys: ${storeyIds.length} });`,
    );
  }

  // Delta-Modelle der Edit-API hängen als eigene Modelle in der Registry und
  // überleben das Dispose ihres Elternmodells. Über die öffentliche
  // parentModelId-Beziehung lassen sie sich ohne Namenskonvention aufräumen.
  async function disposeDeltaModels(baseModelId: string) {
    for (const [modelId, model] of [...fragments.list.entries()]) {
      if (!model.isDeltaModel || model.parentModelId !== baseModelId) {
        continue;
      }
      await fragments.core.disposeModel(modelId).catch(() => undefined);
      callbacks.onLog(`viewer.disposeDeltaModel({ modelId: '${modelId}' });`);
    }
  }

  async function disposeSubsetModels(loaded: LoadedViewerModel) {
    for (const subset of loaded.subsetModels.splice(0)) {
      await disposeDeltaModels(subset.model.modelId);
      loaded.hiddenLocalIdsByModelId.delete(subset.model.modelId);
      documentIdByModelId.delete(subset.model.modelId);
      await fragments.core
        .disposeModel(subset.model.modelId)
        .catch(() => undefined);
      callbacks.onLog(
        `viewer.disposeSubsetModel({ modelId: '${subset.model.modelId}' });`,
      );
    }
  }

  let loadCounter = 0;
  const resizeObserver = new ResizeObserver(() => {
    world.renderer?.resize();
  });
  resizeObserver.observe(container);

  let pointerDown: { x: number; y: number } | null = null;

  const trackPointerDown = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  };

  const canvas = world.renderer.three.domElement;

  // Nach längerer Hintergrundlaufzeit kann Windows/WebView2 den GPU-Prozess
  // recyceln — der WebGL-Kontext geht verloren. three.js schluckt danach jeden
  // render()-Aufruf still: der Viewer bleibt eingefroren stehen, ohne dass
  // irgendwo ein Fehler auftaucht. Deshalb hier melden und beim Restore neu
  // zeichnen lassen.
  const handleContextLost = (event: Event) => {
    event.preventDefault();
    recordDiagnostic("webgl", "WebGL-Kontext verloren");
    callbacks.onError(
      "Die 3D-Ansicht hat den Grafikkontext verloren (z. B. nach längerer Hintergrundlaufzeit oder einem Grafiktreiber-Reset). Sie wird automatisch wiederhergestellt, sobald das Fenster wieder aktiv ist.",
    );
    callbacks.onStatus("3D-Kontext verloren");
  };
  const handleContextRestored = () => {
    recordDiagnostic("webgl", "WebGL-Kontext wiederhergestellt");
    callbacks.onError("");
    callbacks.onStatus("3D-Kontext wiederhergestellt");
    world.renderer?.resize();
    void fragments.core.update(true).catch(() => undefined);
  };
  canvas.addEventListener("webglcontextlost", handleContextLost);
  canvas.addEventListener("webglcontextrestored", handleContextRestored);

  const selectFromPointer = async (event: MouseEvent) => {
    if (!modelsByDocumentId.size || !world.renderer) {
      return;
    }
    if (moveGizmo.isDragging() || cutPlaneGizmo.isDragging()) {
      return;
    }
    if (pointerDown) {
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;
      pointerDown = null;
      if (Math.hypot(dx, dy) > 4) {
        return;
      }
    }
    const rect = canvas.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return;
    }
    const mouse = new THREE.Vector2(event.clientX, event.clientY);
    const result = await fragments.raycast({
      camera: world.camera.three,
      dom: canvas,
      mouse,
    });
    const localId = result?.localId;
    if (!localId || !Number.isFinite(localId)) {
      callbacks.onLog("viewer.selectMiss({ engine: 'thatopen' });");
      return;
    }
    // Per Edit-API erzeugte/bearbeitete Elemente rendern in einem separaten
    // Delta-Modell. Für Auswahl/Daten dessen öffentliche Elternbeziehung
    // verwenden.
    const hitModel = fragments.list.get(result.fragments.modelId);
    const modelId = hitModel?.parentModelId ?? result.fragments.modelId;
    const documentId = documentIdByModelId.get(modelId);
    const loadedModel = documentId
      ? modelsByDocumentId.get(documentId)
      : undefined;
    if (!documentId || !loadedModel) {
      callbacks.onLog(
        `viewer.selectUnknownModel({ engine: 'thatopen', modelId: '${modelId}' });`,
      );
      return;
    }
    const itemData = await readItemData(fragments, modelId, localId);
    const entityId = readNumericAttribute(itemData, [
      "expressID",
      "ExpressID",
      "expressId",
      "_localId",
      "localId",
    ]);
    const globalId = readStringAttribute(itemData, [
      "GlobalId",
      "GlobalID",
      "globalId",
      "guid",
    ]);
    // Per Mirror erzeugte Elemente tragen eine Fragments-eigene localId — das
    // Id-Mapping hat Vorrang: ihre Attribut-Ids (_localId) sind Fragments-Ids,
    // keine nativen Express-Ids.
    const mappedEntityId = loadedModel.mirrorEntityIdByLocalId.get(localId);
    const resolvedEntityId = mappedEntityId ?? entityId ?? localId;
    if (callbacks.isCoordinatePickerActive()) {
      coordinateCursor.show(
        result.point,
        result.ray?.origin ?? world.camera.three.position,
        world.camera.three.position.distanceTo(result.point),
      );
      callbacks.onCoordinatePickerUsed();
      // Der Szenenraum ist bei georeferenzierten Modellen zum Ursprung
      // rebased (float32-Präzision). Für Builder/Clipboard wird der Pick
      // explizit in echte IFC-Weltkoordinaten (Viewer-Achsen) umgerechnet.
      const ifcPoint = sceneToIfcWorldPoint(loadedModel, result.point);
      callbacks.onPickCoordinates({
        documentId,
        entityId: resolvedEntityId,
        fileName: loadedModel.fileName,
        globalId,
        localId,
        modelId,
        source: "thatopen",
        x: ifcPoint.x,
        y: ifcPoint.y,
        z: ifcPoint.z,
      });
      callbacks.onLog(
        `viewer.coordinates.pick({ file: '${loadedModel.fileName}', scene: { x: ${formatCoordinate(result.point.x)}, y: ${formatCoordinate(result.point.y)}, z: ${formatCoordinate(result.point.z)} }, ifcWorld: { x: ${formatCoordinate(ifcPoint.x)}, y: ${formatCoordinate(ifcPoint.y)}, z: ${formatCoordinate(ifcPoint.z)} }, localId: ${localId} });`,
      );
      await fragments.core.update(true);
    }
    // Strg-/Umschalt-Klick schaltet das Objekt in der Mehrfachauswahl um
    // (wie im Strukturbaum) statt die Auswahl zu ersetzen.
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    callbacks.onSelect(
      resolvedEntityId,
      "thatopen",
      globalId,
      documentId,
      additive,
    );
    callbacks.onLog(
      `viewer.select({ engine: 'thatopen', file: '${loadedModel.fileName}', localId: ${localId}, entityId: ${resolvedEntityId}${globalId ? `, globalId: '${globalId}'` : ""}${additive ? ", additive: true" : ""} });`,
    );
    if (documentId === callbacks.getActiveDocumentId()) {
      // Bei Normalklick kollabiert die Auswahl auf das Element — der noch
      // nicht geflushte React-State würde sonst kurz die alte Mehrfachauswahl
      // mit einfärben.
      await highlight(documentId, resolvedEntityId, { exclusive: !additive });
    }
  };

  canvas.addEventListener("pointerdown", trackPointerDown, { capture: true });
  // Async-Handler nie direkt registrieren: eine Rejection (z. B. Raycast
  // während eines Modell-Reloads) landete sonst als unhandled rejection
  // statt im Viewer-Log.
  const handleSelectClick = (event: MouseEvent) => {
    void selectFromPointer(event).catch((reason) => {
      callbacks.onLog(
        `viewer.selectError(${JSON.stringify(String(reason))});`,
      );
    });
  };
  canvas.addEventListener("click", handleSelectClick, { capture: true });

  // Rechtsklick: Körper unter dem Zeiger raycasten, auswählen (macht dessen
  // IFC aktiv) und das Rotary-Menü an der Zeigerposition öffnen.
  const openContextFromPointer = async (event: MouseEvent) => {
    if (!modelsByDocumentId.size || !world.renderer) {
      return;
    }
    event.preventDefault();
    if (moveGizmo.isDragging() || cutPlaneGizmo.isDragging()) {
      return;
    }
    // Wie beim Linksklick: nach einer Drag-Bewegung (Kamera-Pan mit rechter
    // Taste) kein Menü öffnen — contextmenu feuert unter Windows erst beim
    // Loslassen der Taste.
    if (pointerDown) {
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;
      pointerDown = null;
      if (Math.hypot(dx, dy) > 4) {
        return;
      }
    }
    const mouse = new THREE.Vector2(event.clientX, event.clientY);
    const result = await fragments.raycast({
      camera: world.camera.three,
      dom: canvas,
      mouse,
    });
    const localId = result?.localId;
    if (!localId || !Number.isFinite(localId)) {
      callbacks.onLog("viewer.contextMenuMiss({ engine: 'thatopen' });");
      return;
    }
    const hitModel = fragments.list.get(result.fragments.modelId);
    const modelId = hitModel?.parentModelId ?? result.fragments.modelId;
    const documentId = documentIdByModelId.get(modelId);
    const loadedModel = documentId
      ? modelsByDocumentId.get(documentId)
      : undefined;
    if (!documentId || !loadedModel) {
      return;
    }
    const itemData = await readItemData(fragments, modelId, localId);
    const entityId = readNumericAttribute(itemData, [
      "expressID",
      "ExpressID",
      "expressId",
      "_localId",
      "localId",
    ]);
    const globalId = readStringAttribute(itemData, [
      "GlobalId",
      "GlobalID",
      "globalId",
      "guid",
    ]);
    const mappedEntityId = loadedModel.mirrorEntityIdByLocalId.get(localId);
    const resolvedEntityId = mappedEntityId ?? entityId ?? localId;
    const ifcPoint = sceneToIfcWorldPoint(loadedModel, result.point);
    // "thatopen-context": eine bestehende Mehrfachauswahl bleibt erhalten,
    // wenn das Rechtsklick-Ziel dazugehört (sonst wäre "Kombinieren" im
    // Rotary-Menü nie erreichbar, weil der Rechtsklick sie auflösen würde).
    callbacks.onSelect(resolvedEntityId, "thatopen-context", globalId, documentId);
    callbacks.onContextTarget({
      clientX: event.clientX,
      clientY: event.clientY,
      documentId,
      entityId: resolvedEntityId,
      fileName: loadedModel.fileName,
      globalId,
      point: { x: ifcPoint.x, y: ifcPoint.y, z: ifcPoint.z },
    });
    callbacks.onLog(
      `viewer.contextMenu({ file: '${loadedModel.fileName}', id: ${resolvedEntityId}, point: { x: ${formatCoordinate(ifcPoint.x)}, y: ${formatCoordinate(ifcPoint.y)}, z: ${formatCoordinate(ifcPoint.z)} } });`,
    );
  };
  const handleContextMenu = (event: MouseEvent) => {
    void openContextFromPointer(event).catch((reason) => {
      callbacks.onLog(
        `viewer.contextMenuError(${JSON.stringify(String(reason))});`,
      );
    });
  };
  canvas.addEventListener("contextmenu", handleContextMenu);

  // Serialize reloads: two quick commits would otherwise run syncModels
  // concurrently and can leave an orphaned model instance in the scene.
  let syncQueue: Promise<unknown> = Promise.resolve();

  function syncModels(
    nextModels: ThatOpenViewerModel[],
    options?: { fitAfterLoad?: boolean },
  ) {
    const run = syncQueue.then(
      () => syncModelsInternal(nextModels, options),
      () => syncModelsInternal(nextModels, options),
    );
    syncQueue = run.catch(() => undefined);
    return run;
  }

  async function syncModelsInternal(
    nextModels: ThatOpenViewerModel[],
    options?: { fitAfterLoad?: boolean },
  ) {
    if (runtimeDisposed) {
      return;
    }
    const nextDocumentIds = new Set(
      nextModels.map((model) => model.documentId),
    );
    coordinateCursor.hide();
    // Release any gizmo preview clone before models are disposed/reloaded so
    // no hidden element or orphaned preview mesh survives the reload.
    await moveGizmo.updateSelection(0, null);
    for (const [documentId, loaded] of modelsByDocumentId) {
      if (!nextDocumentIds.has(documentId)) {
        await disposeSubsetModels(loaded);
        await disposeDeltaModels(loaded.model.modelId);
        await fragments.core
          .disposeModel(loaded.model.modelId)
          .catch(() => undefined);
        modelsByDocumentId.delete(documentId);
        documentIdByModelId.delete(loaded.model.modelId);
      }
    }
    await fragments.resetHighlight().catch(() => undefined);

    for (const nextModel of nextModels) {
      const loadKey = `${nextModel.documentId}:${nextModel.revision}:${nextModel.ifcBytes?.byteLength ?? nextModel.ifcText.length}`;
      const current = modelsByDocumentId.get(nextModel.documentId);
      if (current?.loadKey === loadKey) {
        continue;
      }
      if (current) {
        await disposeSubsetModels(current);
        await disposeDeltaModels(current.model.modelId);
        await fragments.core
          .disposeModel(current.model.modelId)
          .catch(() => undefined);
        modelsByDocumentId.delete(nextModel.documentId);
        documentIdByModelId.delete(current.model.modelId);
      }

      callbacks.onStatus(
        `Converting ${nextModel.fileName} to ThatOpen fragments in worker...`,
      );
      callbacks.onProgress({ fileName: nextModel.fileName, percent: 0 });
      const modelId = `${toModelId(nextModel.fileName)}-${++loadCounter}`;
      const converted = await convertIfcToFragmentsInWorker(
        {
          bytes: nextModel.ifcFile ? null : nextModel.ifcBytes,
          file: nextModel.ifcFile,
          fileName: nextModel.fileName,
          text:
            nextModel.ifcFile || nextModel.ifcBytes ? "" : nextModel.ifcText,
          wasmPath: resolvePublicAssetUrl("wasm/"),
        },
        (progress) => {
          callbacks.onStatus(formatFragmentConversionProgress(progress));
          callbacks.onProgress({
            fileName: nextModel.fileName,
            percent: Math.min(
              99,
              Math.max(0, Math.round(progress.progress * 100)),
            ),
          });
        },
      );
      callbacks.onLog(
        `viewer.convert({ engine: 'worker', file: '${nextModel.fileName}', ms: ${Math.round(converted.elapsedMs)} });`,
      );
      // Wurde die Runtime während der Worker-Konvertierung disposed (Pane
      // geschlossen), NICHT mehr in die tote Fragments-Instanz laden — das
      // Modell bliebe sonst bis zum App-Neustart im Speicher.
      if (runtimeDisposed) {
        return;
      }
      const model = await fragments.core.load(converted.fragments, {
        modelId,
        raw: true,
      });
      if (runtimeDisposed) {
        await fragments.core.disposeModel(model.modelId).catch(() => undefined);
        return;
      }
      // Die Geometrie jedes IFC bleibt für float32-Präzision lokal rebased.
      // Fragments positioniert model.object relativ zum ersten geladenen IFC;
      // die individuelle Welt→Modell-Matrix bleibt für Picks/Schreibpfade.
      const ifcWorldToModel = coordinationToMatrix(
        THREE,
        converted.coordination,
      );
      const modelToIfcWorld = ifcWorldToModel
        ? ifcWorldToModel.clone().invert()
        : null;
      if (modelToIfcWorld) {
        const offset = new THREE.Vector3().setFromMatrixPosition(
          modelToIfcWorld,
        );
        callbacks.onLog(
          `viewer.coordination.detected({ file: '${nextModel.fileName}', originToWorld: { x: ${formatCoordinate(offset.x)}, y: ${formatCoordinate(offset.y)}, z: ${formatCoordinate(offset.z)} } });`,
        );
      }
      const fitModelItems = await getCameraFitLocalIds(model);
      const fitItems =
        fitModelItems.ignored > 0 ? fitModelItems.localIds : undefined;
      if (fitModelItems.ignored > 0) {
        callbacks.onLog(
          `viewer.fit.ignoreOriginMarkers({ file: '${nextModel.fileName}', count: ${fitModelItems.ignored} });`,
        );
      }
      modelsByDocumentId.set(nextModel.documentId, {
        documentId: nextModel.documentId,
        fileName: nextModel.fileName,
        fitItems,
        hiddenLocalIdsByModelId: new Map(),
        ifcWorldToModel,
        loadKey,
        mirrorEntityIdByLocalId: new Map(),
        mirrorLocalIdByEntityId: new Map(),
        model,
        modelToIfcWorld,
        subsetModels: [],
      });
      documentIdByModelId.set(model.modelId, nextModel.documentId);
      callbacks.onLog(
        `viewer.load({ engine: 'thatopen', file: '${nextModel.fileName}', modelId: '${model.modelId}' });`,
      );
    }
    await fragments.core.update(true);
    await updateGrid(callbacks.getActiveDocumentId());
    callbacks.onProgress(null);
    if (options?.fitAfterLoad ?? true) {
      await fit();
    }
    callbacks.onStatus(
      `ThatOpen loaded ${nextModels.length.toLocaleString()} IFC model(s)`,
    );
    const activeDocumentId = callbacks.getActiveDocumentId();
    await highlight(
      activeDocumentId,
      callbacks.getSelectedId(activeDocumentId),
    );
  }

  let highlightRequest = 0;
  let highlightQueue: Promise<unknown> = Promise.resolve();

  function highlight(
    documentId: string,
    entityId: number,
    options?: { updateGizmo?: boolean; exclusive?: boolean },
  ) {
    const request = ++highlightRequest;
    const run = highlightQueue.then(async () => {
      if (request !== highlightRequest) {
        return;
      }
      await highlightInternal(documentId, entityId, options);
    });
    highlightQueue = run.catch(() => undefined);
    return run;
  }

  // resetHighlight wirkt global und kann die Sichtbarkeit ausgeblendeter
  // (ersetzter) Elemente zurücksetzen — nach jedem Reset alle vorgemerkten
  // Ausblendungen sämtlicher geladener Dokumente erneut anwenden, dazu die
  // Preview-Ausblendung eines aktiven Gizmos.
  async function reapplyHiddenLocalIds() {
    for (const anyLoaded of modelsByDocumentId.values()) {
      for (const [modelId, hidden] of anyLoaded.hiddenLocalIdsByModelId) {
        if (!hidden.size) {
          continue;
        }
        const target = fragments.list.get(modelId);
        if (target) {
          await target.setVisible([...hidden], false).catch(() => undefined);
        }
      }
    }
    const hiddenPreview = moveGizmo.getHiddenPreview();
    if (hiddenPreview) {
      const previewModel = fragments.list.get(hiddenPreview.modelId);
      if (previewModel) {
        await previewModel
          .setVisible([hiddenPreview.localId], false)
          .catch(() => undefined);
      }
    }
  }

  async function highlightInternal(
    documentId: string,
    entityId: number,
    options?: { updateGizmo?: boolean; exclusive?: boolean },
  ) {
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded || !Number.isFinite(entityId) || entityId <= 0) {
      // Auswahl nicht darstellbar (Dokument nicht geladen / leer): die alte
      // Färbung und das Gizmo aktiv lösen, statt sie über den Dokumentwechsel
      // hinweg stehen zu lassen.
      await fragments.resetHighlight().catch(() => undefined);
      if (options?.updateGizmo ?? true) {
        await moveGizmo.updateSelection(0, null).catch(() => undefined);
      }
      await reapplyHiddenLocalIds();
      await fragments.core.update(true).catch(() => undefined);
      return;
    }
    // Die komplette Mehrfachauswahl einfärben, nicht nur das primäre Element;
    // der Gizmo hängt weiterhin nur am primären. exclusive überspringt die
    // Erweiterung, wenn der Aufrufer weiß, dass die Auswahl gerade auf ein
    // Element kollabiert (der React-State hinkt dem Klick einen Tick nach).
    const entityIds = new Set([entityId]);
    if (!options?.exclusive) {
      for (const id of callbacks.getSelectedIds(documentId)) {
        if (Number.isFinite(id) && id > 0) {
          entityIds.add(id);
        }
      }
    }
    const localId = resolveLocalId(loaded, entityId);
    const localIds = new Set(
      [...entityIds].map((id) => resolveLocalId(loaded, id)),
    );
    // Auch die Subset- und Delta-Modelle des Elternmodells einfärben — per
    // Edit-API oder Rekonvertierung erzeugte Elemente rendern dort, nicht im
    // Basismodell.
    const subsetParentIds = new Set(
      loaded.subsetModels
        .filter((subset) =>
          [...localIds].some((candidate) => subset.entityIds.has(candidate)),
        )
        .map((subset) => subset.model.modelId),
    );
    const targets: Record<string, Set<number>> = {};
    for (const [modelId, model] of fragments.list) {
      const parentId = model.isDeltaModel ? model.parentModelId : undefined;
      if (
        modelId === loaded.model.modelId ||
        subsetParentIds.has(modelId) ||
        (parentId != null &&
          (parentId === loaded.model.modelId || subsetParentIds.has(parentId)))
      ) {
        const hidden = loaded.hiddenLocalIdsByModelId.get(modelId);
        targets[modelId] = new Set(
          hidden ? [...localIds].filter((id) => !hidden.has(id)) : localIds,
        );
      }
    }
    await fragments.resetHighlight();
    await fragments.highlight(selectionMaterial, targets);
    // resetHighlight/highlight kann die Sichtbarkeit zuvor ausgeblendeter
    // (ersetzter) Elemente zurücksetzen — z. B. blieb das kombinierte
    // Duplikat sonst als nicht anklickbarer Geist-Körper stehen.
    await reapplyHiddenLocalIds();
    await fragments.core.update(true);
    if (options?.updateGizmo ?? true) {
      await moveGizmo.updateSelection(
        localId,
        resolveElementModel(loaded, entityId),
      );
    }
  }

  async function fit() {
    if (!modelsByDocumentId.size) {
      return;
    }
    const activeDocumentId = callbacks.getActiveDocumentId();
    const activeModel = modelsByDocumentId.get(activeDocumentId);
    if (activeModel) {
      const selectedId = callbacks.getSelectedId(activeDocumentId);
      await moveGizmo.updateSelection(
        resolveLocalId(activeModel, selectedId),
        resolveElementModel(activeModel, selectedId),
      );
    }
    await world.camera.fitToItems(getFitItems());
  }

  async function focusSelected(documentId: string, entityId: number) {
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded || !Number.isFinite(entityId) || entityId <= 0) {
      return;
    }
    const localId = resolveLocalId(loaded, entityId);
    await highlight(documentId, entityId).catch(() => undefined);
    await world.camera
      .fitToItems({
        [resolveElementModel(loaded, entityId).modelId]: new Set([localId]),
      })
      .catch(() => fit());
    callbacks.onLog(
      `viewer.camera.center({ file: '${loaded.fileName}', id: ${entityId} });`,
    );
  }

  async function resetCamera() {
    await world.camera.controls.setLookAt(8, 6, 8, 0, 0, 0, true);
    if (modelsByDocumentId.size) {
      await fragments.core.update(true);
      const activeDocumentId = callbacks.getActiveDocumentId();
      await highlight(
        activeDocumentId,
        callbacks.getSelectedId(activeDocumentId),
      );
    }
  }

  function getFitItems() {
    const entries = [...modelsByDocumentId.values()].flatMap((loaded) =>
      loaded.fitItems ? [[loaded.model.modelId, loaded.fitItems] as const] : [],
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  // Mirror-Ops laufen durch dieselbe Queue wie die Modell-Reloads: ein Mirror
  // trifft so nie ein gerade neu konvertiertes Modell (das die Änderung schon
  // enthält) und nie ein halb geladenes Modell.
  function applyMirror(request: ViewerMirrorRequest) {
    const run = syncQueue.then(
      () => applyMirrorInternal(request),
      () => applyMirrorInternal(request),
    );
    syncQueue = run.catch(() => undefined);
    return run;
  }

  // Entfernt ein Element aus der Anzeige: konvertierte Elemente werden
  // ausgeblendet (setVisible); per Mirror erzeugte Delta-Elemente reagieren
  // darauf nicht und werden über die Elements-API wieder gelöscht.
  // Ausblendung eines ersetzten/entfernten Elements dauerhaft vormerken —
  // highlightInternal wendet sie nach jedem Highlight erneut an. Elemente,
  // die per Edit-API bearbeitet wurden, rendern im Delta-Modell: das muss
  // mit vorgemerkt werden, sonst kehrt die Delta-Kopie als Geist zurück.
  const rememberHiddenLocalId = (
    loaded: LoadedViewerModel,
    model: { deltaModelId?: string | null; modelId: string },
    localId: number,
  ) => {
    for (const modelId of [model.modelId, model.deltaModelId ?? undefined]) {
      if (!modelId) {
        continue;
      }
      const hidden = loaded.hiddenLocalIdsByModelId.get(modelId) ?? new Set();
      hidden.add(localId);
      loaded.hiddenLocalIdsByModelId.set(modelId, hidden);
    }
  };

  async function removeMirroredElement(
    loaded: LoadedViewerModel,
    entityId: number,
  ) {
    const localId = resolveLocalId(loaded, entityId);
    if (loaded.mirrorLocalIdByEntityId.has(entityId)) {
      const [element] = await fragments.core.editor.getElements(
        loaded.model.modelId,
        [localId],
      );
      if (element) {
        fragments.core.editor.deleteElements(loaded.model.modelId, [element]);
        await fragments.core.editor.applyChanges(loaded.model.modelId);
      }
    } else {
      const [element] = await fragments.core.editor.getElements(
        loaded.model.modelId,
        [localId],
      );
      if (element) {
        await setFragmentElementVisible(
          fragments.core,
          loaded.model,
          element,
          false,
        );
      } else {
        await loaded.model.setVisible([localId], false);
      }
      rememberHiddenLocalId(loaded, loaded.model, localId);
    }
    // Rendert ein Subset-Modell das Element (partielle Rekonvertierung),
    // dort ebenfalls ausblenden — das Basismodell kennt es ggf. gar nicht.
    // Wie im Basis-Zweig element-bewusst, damit auch ein Subset-DELTA (nach
    // Edit-API-Bearbeitung im Subset) mit ausgeblendet wird.
    for (const subset of loaded.subsetModels) {
      if (subset.entityIds.has(entityId)) {
        try {
          const [subsetElement] = await fragments.core.editor.getElements(
            subset.model.modelId,
            [entityId],
          );
          if (subsetElement) {
            await setFragmentElementVisible(
              fragments.core,
              subset.model,
              subsetElement,
              false,
            );
          } else {
            await subset.model.setVisible([entityId], false);
          }
          rememberHiddenLocalId(loaded, subset.model, entityId);
          subset.entityIds.delete(entityId);
        } catch (reason) {
          // Nicht schlucken: der Aufrufer meldet die Op als fehlgeschlagen,
          // damit der "Modell neu berechnen"-Fallback erhalten bleibt.
          callbacks.onLog(
            `viewer.hideSubsetElementFailed({ modelId: '${subset.model.modelId}', id: ${entityId}, reason: ${JSON.stringify(String(reason))} });`,
          );
          throw reason;
        }
      }
    }
    loaded.mirrorLocalIdByEntityId.delete(entityId);
    loaded.mirrorEntityIdByLocalId.delete(localId);
  }

  async function applyMirrorInternal(
    request: ViewerMirrorRequest,
  ): Promise<ViewerMirrorResult> {
    const finish = (ok: boolean, reason?: string): ViewerMirrorResult => ({
      documentId: request.documentId,
      label: request.label,
      nonce: request.nonce,
      ok,
      pendingKey: request.pendingKey,
      reason,
    });
    if (runtimeDisposed) {
      return finish(false, "runtime-disposed");
    }
    const loaded = modelsByDocumentId.get(request.documentId);
    if (!loaded) {
      return finish(false, "model-not-loaded");
    }
    const op = request.op;
    try {
      if (op.kind === "move") {
        const localId = resolveLocalId(loaded, op.entityId);
        const targetModel = resolveElementModel(loaded, op.entityId);
        const [element] = await fragments.core.editor.getElements(
          targetModel.modelId,
          [localId],
        );
        if (!element) {
          return finish(false, "no-editable-element");
        }
        const meshes = await element.getMeshes();
        let disposed = false;
        try {
          const sceneDelta = ifcWorldToSceneVector(loaded, op.delta);
          meshes.position.set(
            meshes.position.x + sceneDelta.x,
            meshes.position.y + sceneDelta.y,
            meshes.position.z + sceneDelta.z,
          );
          meshes.updateMatrixWorld(true);
          await element.setMeshes(meshes);
          element.disposeMeshes(meshes);
          disposed = true;
          const requests = element.getRequests();
          if (requests?.length) {
            await fragments.core.editor.edit(targetModel.modelId, requests);
          }
          // Per Mirror ersetzte Elemente bleiben ausgeblendet.
          if (!isHiddenLocalId(targetModel.modelId, localId)) {
            await setFragmentElementVisible(
              fragments.core,
              targetModel,
              element,
              true,
            );
          }
        } finally {
          if (!disposed) {
            element.disposeMeshes(meshes);
          }
        }
      } else if (op.kind === "remove") {
        await removeMirroredElement(loaded, op.entityId);
        for (const cascadeId of op.cascadeEntityIds ?? []) {
          await removeMirroredElement(loaded, cascadeId);
        }
      } else if (op.kind === "reconvert-subset") {
        callbacks.onStatus(
          `Rekonvertiere ${op.entityIds.length} Element(e) von ${loaded.fileName}…`,
        );
        const converted = await convertIfcToFragmentsInWorker({
          bytes: null,
          fileName: loaded.fileName,
          text: op.subsetIfcText,
          wasmPath: resolvePublicAssetUrl("wasm/"),
        });
        const subsetModel = await fragments.core.load(converted.fragments, {
          modelId: `${loaded.model.modelId}-subset-${++loadCounter}`,
          raw: true,
        });
        documentIdByModelId.set(subsetModel.modelId, request.documentId);
        // Ersetzte Produkte im Basismodell und in früheren Subsets ausblenden
        // — ihre neue Gestalt rendert ab jetzt das frische Teilmodell.
        // Fehler beim Ausblenden werden NICHT geschluckt: die Op meldet dann
        // Fehlschlag, damit der Pending-Eintrag (Recalc-Fallback) bestehen
        // bleibt — sonst stünde das alte Element dauerhaft doppelt im Bild.
        let hideFailure: unknown;
        for (const entityId of op.replacedEntityIds) {
          await removeMirroredElement(loaded, entityId).catch((reason) => {
            hideFailure = reason ?? "hide-failed";
            callbacks.onLog(
              `viewer.reconvertSubsetHideFailed({ id: ${entityId}, reason: ${JSON.stringify(String(reason))} });`,
            );
          });
        }
        loaded.subsetModels.push({
          entityIds: new Set(op.entityIds),
          model: subsetModel,
        });
        if (hideFailure !== undefined) {
          await fragments.core.update(true).catch(() => undefined);
          return finish(false, `hide-replaced-failed: ${String(hideFailure)}`);
        }
        callbacks.onLog(
          `viewer.reconvertSubset({ file: '${loaded.fileName}', modelId: '${subsetModel.modelId}', entities: [${op.entityIds.join(", ")}], replaced: [${op.replacedEntityIds.join(", ")}], ms: ${Math.round(converted.elapsedMs)} });`,
        );
        callbacks.onStatus(
          `Teilmodell aktualisiert (${op.entityIds.length} Element(e), ${Math.round(converted.elapsedMs)} ms).`,
        );
      } else if (op.kind === "replace-body") {
        const localId = resolveLocalId(loaded, op.entityId);
        const changed = await replaceFragmentElementGeometry(
          fragments.core,
          resolveElementModel(loaded, op.entityId),
          localId,
          op,
          THREE,
        );
        if (!changed) {
          if (!op.recreate) {
            return finish(false, "no-editable-meshes");
          }
          // Keine editierbaren Meshes (Element ohne Repräsentation oder
          // selbst per Mirror erzeugt): altes Element entfernen und mit den
          // neuen Maßen neu erzeugen.
          await removeMirroredElement(loaded, op.entityId).catch(
            () => undefined,
          );
          const created = await createFragmentBodyElement(
            fragments.core,
            loaded,
            {
              axes: op.recreate.axes,
              category: op.recreate.category,
              depth: op.depth,
              entityId: op.entityId,
              globalId: op.recreate.globalId,
              height: op.height,
              kind: "create-body",
              name: op.recreate.name ?? "",
              position: op.recreate.position,
              profile: op.profile,
              tag: op.recreate.tag,
              width: op.width,
            },
            THREE,
          );
          if (!created) {
            return finish(false, "no-created-element");
          }
          loaded.mirrorEntityIdByLocalId.delete(localId);
          loaded.mirrorLocalIdByEntityId.set(op.entityId, created.localId);
          loaded.mirrorEntityIdByLocalId.set(created.localId, op.entityId);
        }
      } else {
        const created = await createFragmentBodyElement(
          fragments.core,
          loaded,
          op,
          THREE,
        );
        if (!created) {
          return finish(false, "no-created-element");
        }
        // Mapping IMMER setzen — ein Eintrag markiert das Element zugleich
        // als Delta-Element (Sonderbehandlung in Gizmo/Remove/Highlight).
        loaded.mirrorLocalIdByEntityId.set(op.entityId, created.localId);
        loaded.mirrorEntityIdByLocalId.set(created.localId, op.entityId);
      }
      await fragments.core.update(true);
      const focusEntityId =
        op.kind === "reconvert-subset" ? op.entityIds[0] : op.entityId;
      if (
        request.documentId === callbacks.getActiveDocumentId() &&
        callbacks.getSelectedId(request.documentId) === focusEntityId
      ) {
        await highlight(request.documentId, focusEntityId).catch(
          () => undefined,
        );
      }
      callbacks.onLog(
        `viewer.mirror({ kind: '${op.kind}', file: '${loaded.fileName}', id: ${focusEntityId} });`,
      );
      return finish(true);
    } catch (reason) {
      return finish(false, stringifyError(reason));
    }
  }

  async function dispose() {
    runtimeDisposed = true;
    canvas.removeEventListener("pointerdown", trackPointerDown, {
      capture: true,
    });
    canvas.removeEventListener("click", handleSelectClick, { capture: true });
    canvas.removeEventListener("contextmenu", handleContextMenu);
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    canvas.removeEventListener("webglcontextrestored", handleContextRestored);
    resizeObserver.disconnect();
    themeObserver.disconnect();
    world.camera.controls.removeEventListener(
      "update",
      updateFragmentsOnCamera,
    );
    world.camera.controls.removeEventListener("update", updateGridAnchor);
    fragments.list.onItemSet.remove(handleFragmentModelSet);
    fragments.core.models.materials.list.onItemSet.remove(
      handleFragmentMaterialSet,
    );
    for (const loaded of modelsByDocumentId.values()) {
      await disposeSubsetModels(loaded).catch(() => undefined);
      await disposeDeltaModels(loaded.model.modelId).catch(() => undefined);
      await fragments.core
        .disposeModel(loaded.model.modelId)
        .catch(() => undefined);
    }
    modelsByDocumentId.clear();
    documentIdByModelId.clear();
    fragments.dispose();
    cutPlaneGizmo.dispose();
    moveGizmo.dispose();
    viewCube.dispose();
    coordinateCursor.dispose();
    components.dispose();
  }

  // Erst hier registrieren: wirft eine der Initialisierungen oben, gibt es
  // keinen Runtime-Rückgabewert und damit niemanden, der dispose() (und den
  // Observer-Disconnect) aufrufen könnte — der Observer würde world/GL-Kontext
  // dauerhaft am Leben halten.
  themeObserver.observe(globalThis.document.documentElement, {
    attributeFilter: ["class"],
    attributes: true,
  });

  return {
    dispose,
    applyMirror,
    fit,
    focusSelected,
    highlight,
    hideCoordinateCursor: coordinateCursor.hide,
    resetCamera,
    setCutPlane,
    setMoveGizmoEnabled: moveGizmo.setEnabled,
    setMoveGizmoMode: moveGizmo.setMode,
    syncModels,
    updateGrid,
  };
}

type TransformControlsConstructor =
  typeof import("three/addons/controls/TransformControls.js").TransformControls;

interface CameraControlsLike {
  enabled: boolean;
}

type MoveGizmoMode = "translate" | "rotate";

interface MoveGizmoChange {
  delta?: ViewerMoveDelta;
  localId: number;
  mode: MoveGizmoMode;
  rotation?: ViewerMoveDelta;
  rotationChange?: ViewerRotationChange;
}

interface MoveGizmoCommit extends MoveGizmoChange {
  /** Der Edit wurde vom Fragments-Worker erfolgreich angewendet. */
  applied: boolean;
}

interface MoveGizmoCommitReceipt extends ViewerTransformCommitReceipt {
  documentId: string;
  entityId: number;
}

type EditableFragmentElementLike = import("@thatopen/fragments").Element;
type EditableFragmentsLike = import("@thatopen/fragments").FragmentsModels;
type EditableFragmentModelLike = import("@thatopen/fragments").FragmentsModel;

/**
 * Synchronisiert die Sichtbarkeit des bearbeiteten Elements zwischen Basis-
 * und Delta-Modell nach dem offiziellen EditElements-Muster. Andere geladene
 * Dokumente bleiben unberührt, weil sich deren localIds überschneiden können.
 */
async function setFragmentElementVisible(
  fragments: EditableFragmentsLike,
  model: EditableFragmentModelLike,
  element: EditableFragmentElementLike,
  visible: boolean,
) {
  const relatedModelIds = new Set(
    [model.modelId, model.deltaModelId].filter((value): value is string =>
      Boolean(value),
    ),
  );
  const promises: Promise<void>[] = [];
  for (const [modelId, candidate] of fragments.models.list) {
    if (!relatedModelIds.has(modelId)) {
      continue;
    }
    if (visible && candidate.deltaModelId) {
      const editedElements = new Set(await candidate.getEditedElements());
      if (editedElements.has(element.localId)) {
        // Das veraltete Basiselement bleibt verborgen; sein Ersatz liegt im
        // Delta-Modell.
        continue;
      }
    }
    promises.push(candidate.setVisible([element.localId], visible));
  }
  await Promise.all(promises);
}

interface FitFragmentModelLike {
  getItemsData(
    ids: number[],
    config?: {
      attributesDefault?: boolean;
      relationsDefault?: { attributes: boolean; relations: boolean };
    },
  ): Promise<unknown[]>;
  getLocalIds(): Promise<number[]>;
}

function canvasFromRenderer(
  renderer: import("@thatopen/components").SimpleRenderer,
) {
  return renderer.three.domElement;
}

function createCutPlaneGizmo(
  THREE: typeof import("three"),
  TransformControls: TransformControlsConstructor,
  scene: import("three").Scene,
  camera: import("three").Camera,
  cameraControls: CameraControlsLike,
  canvas: HTMLCanvasElement,
  onCommit: (change: {
    normal: { x: number; y: number; z: number };
    position: { x: number; y: number; z: number };
  }) => void,
  onSceneChange: () => void,
) {
  const group = new THREE.Group();
  group.name = "IFCnativeCutPlane";
  group.visible = false;
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x06b6d4,
    depthTest: false,
    depthWrite: false,
    opacity: 0.22,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x0891b2,
    depthTest: false,
    transparent: true,
  });
  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  const edgeGeometry = new THREE.EdgesGeometry(planeGeometry);
  const fill = new THREE.Mesh(planeGeometry, fillMaterial);
  fill.renderOrder = 50;
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edges.renderOrder = 51;
  const normalArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, 0),
    0.35,
    0x0e7490,
    0.1,
    0.06,
  );
  normalArrow.renderOrder = 52;
  group.add(fill, edges, normalArrow);
  scene.add(group);

  const controls = new TransformControls(camera, canvas);
  controls.setMode("translate");
  controls.setSpace("world");
  controls.size = 0.78;
  const helper = controls.getHelper();
  helper.name = "IFCnativeCutPlaneGizmo";
  helper.visible = false;
  scene.add(helper);
  let active = false;
  let dragging = false;

  const emitChange = () => {
    if (!active) {
      return;
    }
    group.updateWorldMatrix(true, false);
    const position = group.getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    onCommit({
      normal: { x: normal.x, y: normal.y, z: normal.z },
      position: { x: position.x, y: position.y, z: position.z },
    });
  };
  const onDraggingChanged = (event: { value: unknown }) => {
    dragging = Boolean(event.value);
    cameraControls.enabled = !dragging;
  };
  const onChange = () => onSceneChange();
  const onMouseUp = () => emitChange();
  controls.addEventListener("dragging-changed", onDraggingChanged);
  controls.addEventListener("change", onChange);
  controls.addEventListener("mouseUp", onMouseUp);

  const setState = (
    state:
      | { active: false }
      | {
          active: true;
          mode: ViewerCutPlaneMode;
          normal: import("three").Vector3;
          position: import("three").Vector3;
          size: number;
        },
  ) => {
    active = state.active;
    group.visible = active;
    helper.visible = active;
    if (!state.active) {
      controls.detach();
      cameraControls.enabled = true;
      dragging = false;
      onSceneChange();
      return;
    }
    group.position.copy(state.position);
    group.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      state.normal.clone().normalize(),
    );
    group.scale.set(state.size, state.size, state.size);
    group.updateMatrixWorld(true);
    controls.setMode(state.mode);
    controls.attach(group);
    helper.visible = true;
    onSceneChange();
  };

  const dispose = () => {
    controls.removeEventListener("dragging-changed", onDraggingChanged);
    controls.removeEventListener("change", onChange);
    controls.removeEventListener("mouseUp", onMouseUp);
    controls.detach();
    controls.dispose();
    cameraControls.enabled = true;
    helper.removeFromParent();
    group.removeFromParent();
    planeGeometry.dispose();
    edgeGeometry.dispose();
    fillMaterial.dispose();
    edgeMaterial.dispose();
    normalArrow.dispose();
  };

  return { dispose, isDragging: () => dragging, setState };
}

function createMoveGizmo(
  THREE: typeof import("three"),
  TransformControls: TransformControlsConstructor,
  fragments: EditableFragmentsLike,
  scene: import("three").Scene,
  camera: import("three").Camera,
  cameraControls: CameraControlsLike,
  canvas: HTMLCanvasElement,
  onNativeSync: (
    change: MoveGizmoChange,
  ) => Promise<MoveGizmoCommitReceipt | null>,
  onTransformFinished: (
    change: MoveGizmoCommit,
    receipt: MoveGizmoCommitReceipt,
  ) => Promise<void>,
  onLog: (line: string) => void,
  onSceneChange: () => void,
  isHiddenLocalId: (modelId: string, localId: number) => boolean,
) {
  const controls = new TransformControls(camera, canvas);
  controls.setMode("translate");
  controls.setSpace("world");
  controls.size = 0.85;
  const helper = controls.getHelper();
  helper.name = "IFCnativeMoveGizmo";
  helper.visible = false;
  scene.add(helper);

  let enabled = false;
  let dragging = false;
  let mode: MoveGizmoMode = "translate";
  let selectedLocalId = 0;
  let selectedModel: EditableFragmentModelLike | null = null;
  let editElement: EditableFragmentElementLike | null = null;
  let editMeshes: import("three").Group | null = null;
  const dragStartWorldPosition = new THREE.Vector3();
  const dragStartWorldQuaternion = new THREE.Quaternion();
  const dragStartLocalRotation = new THREE.Euler();

  // Gizmo operations arrive concurrently (reload, fit, highlight, selection
  // effects). Serialize them so overlapping loadEditable/disposeEditable calls
  // cannot orphan a preview clone in the scene (invisible-ghost bug).
  let operationQueue: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = operationQueue.then(task, task);
    operationQueue = run.catch(() => undefined);
    return run;
  };

  const removeOrphanEditMeshes = () => {
    const sweep = (parent: import("three").Object3D | undefined) => {
      if (!parent) {
        return;
      }
      for (const child of [...parent.children]) {
        if (child.name === "IFCnativeEditableElement" && child !== editMeshes) {
          child.removeFromParent();
        }
      }
    };
    sweep(scene);
    sweep(selectedModel?.object);
  };

  const disposeEditable = async (restoreVisible: boolean) => {
    const model = selectedModel;
    const localId = selectedLocalId;
    const element = editElement;
    controls.detach();
    helper.visible = false;
    if (editMeshes) {
      editMeshes.removeFromParent();
      try {
        editElement?.disposeMeshes(editMeshes);
      } catch {
        // The owning model may already be disposed after a reload.
      }
      editMeshes = null;
      editElement = null;
    }
    removeOrphanEditMeshes();
    if (
      restoreVisible &&
      model &&
      element &&
      Number.isFinite(localId) &&
      localId > 0 &&
      // Ein inzwischen per Mirror ersetztes/entferntes Element bleibt
      // ausgeblendet — sonst stünde die alte Gestalt neben der neuen.
      !isHiddenLocalId(model.modelId, localId)
    ) {
      await setFragmentElementVisible(fragments, model, element, true).catch(
        () => undefined,
      );
      await fragments.update(true).catch(() => undefined);
    }
    onSceneChange();
  };

  const loadEditable = async (
    localId: number,
    model: EditableFragmentModelLike,
  ) => {
    await disposeEditable(false);
    const [element] = await fragments.editor.getElements(model.modelId, [
      localId,
    ]);
    if (!element) {
      onLog(
        `viewer.transformGizmo.selectionSkipped({ id: ${localId}, reason: 'no-editable-element' });`,
      );
      return;
    }
    editElement = element;
    try {
      await setFragmentElementVisible(fragments, model, element, false);
      editMeshes = await element.getMeshes();
      editMeshes.name = "IFCnativeEditableElement";
    } catch (reason) {
      await setFragmentElementVisible(fragments, model, element, true).catch(
        () => undefined,
      );
      editElement = null;
      editMeshes = null;
      throw reason;
    }
    // Parent the preview under the model object so any coordination
    // transform (georeferenced models) applies to the clone as well.
    const previewParent = model.object ?? scene;
    previewParent.add(editMeshes);
    editMeshes.updateWorldMatrix(true, true);
    removeOrphanEditMeshes();
    controls.setMode(mode);
    // Official EditElements workflow: TransformControls operate directly on
    // the group returned by element.getMeshes(). setMeshes() reads this
    // group's local matrix to generate UPDATE_GLOBAL_TRANSFORM requests.
    controls.attach(editMeshes);
    helper.visible = true;
    await fragments.update(true).catch(() => undefined);
    onSceneChange();
  };

  const updateSelectionInternal = async (
    localId: number,
    model: EditableFragmentModelLike | null,
  ) => {
    const selectionChanged =
      localId !== selectedLocalId || model !== selectedModel;
    if (selectionChanged) {
      await disposeEditable(true);
    }
    selectedLocalId = localId;
    selectedModel = model;
    if (!enabled || !model || !Number.isFinite(localId) || localId <= 0) {
      await disposeEditable(true);
      return;
    }
    if (!editMeshes || selectionChanged) {
      await loadEditable(localId, model);
    }
  };

  const updateSelection = (
    localId: number,
    model: EditableFragmentModelLike | null,
  ) => enqueue(() => updateSelectionInternal(localId, model));

  const setEnabled = (nextEnabled: boolean) =>
    enqueue(async () => {
      enabled = nextEnabled;
      if (!enabled) {
        await disposeEditable(true);
        return;
      }
      await updateSelectionInternal(selectedLocalId, selectedModel);
    });

  const setMode = (nextMode: MoveGizmoMode) => {
    mode = nextMode;
    controls.setMode(nextMode);
    onSceneChange();
  };

  const onDraggingChanged = (event: { value: unknown }) => {
    dragging = Boolean(event.value);
    cameraControls.enabled = !dragging;
  };
  const onMouseDown = () => {
    const target = editMeshes;
    if (!target) {
      return;
    }
    target.updateWorldMatrix(true, false);
    target.getWorldPosition(dragStartWorldPosition);
    target.getWorldQuaternion(dragStartWorldQuaternion);
    dragStartLocalRotation.copy(target.rotation);
    onSceneChange();
  };
  const onMouseUp = () => {
    void commitCurrentTransform();
  };

  const commitCurrentTransform = async () => {
    const result = await enqueue(
      async (): Promise<{
        commit: MoveGizmoCommit;
        receipt: MoveGizmoCommitReceipt;
      } | null> => {
        const target = editMeshes;
        const meshes = editMeshes;
        const element = editElement;
        if (
          !target ||
          !meshes ||
          !element ||
          !selectedModel ||
          selectedLocalId <= 0
        ) {
          onSceneChange();
          return null;
        }
        target.updateWorldMatrix(true, false);
        const endWorldPosition = target.getWorldPosition(new THREE.Vector3());
        const endWorldQuaternion = target.getWorldQuaternion(
          new THREE.Quaternion(),
        );
        const delta = endWorldPosition.sub(dragStartWorldPosition);
        const rotation = {
          x: target.rotation.x - dragStartLocalRotation.x,
          y: target.rotation.y - dragStartLocalRotation.y,
          z: target.rotation.z - dragStartLocalRotation.z,
        };
        const rotationChange = readRotationChange(THREE, target, rotation);
        const changed =
          mode === "translate"
            ? delta.lengthSq() >= 0.000001
            : dragStartWorldQuaternion.angleTo(endWorldQuaternion) >= 0.000001;
        if (!changed) {
          onSceneChange();
          return null;
        }

        const localId = selectedLocalId;
        const model = selectedModel;
        const change: MoveGizmoChange = {
          localId,
          mode,
          ...(mode === "translate"
            ? { delta: { x: delta.x, y: delta.y, z: delta.z } }
            : { rotation, rotationChange }),
        };
        // Erst das native STEP-Dokument schreiben — der Sync-Callback enthält
        // die Guards (Auswahl gewechselt, Modell entladen). Würde der
        // Fragments-Edit zuerst laufen, ließe er sich bei abgelehntem Sync
        // nicht zurückrollen: Anzeige und Dokument würden still divergieren.
        let receipt: MoveGizmoCommitReceipt | null = null;
        try {
          receipt = await onNativeSync(change);
        } catch (reason) {
          onLog(
            `viewer.transformGizmo.nativeSyncError(${JSON.stringify(String(reason))});`,
          );
        }
        if (!receipt) {
          // Preview verwerfen und das Original wieder zeigen — die Anzeige
          // fällt auf den unveränderten nativen Stand zurück.
          controls.detach();
          helper.visible = false;
          if (editMeshes) {
            editMeshes.removeFromParent();
            try {
              element.disposeMeshes(editMeshes);
            } catch {
              // The owning model may already be disposed after a reload.
            }
          }
          editElement = null;
          editMeshes = null;
          removeOrphanEditMeshes();
          if (!isHiddenLocalId(model.modelId, localId)) {
            await setFragmentElementVisible(
              fragments,
              model,
              element,
              true,
            ).catch(() => undefined);
          }
          await fragments.update(true).catch(() => undefined);
          onLog(
            `viewer.transformGizmo.nativeSyncRejected({ id: ${localId} });`,
          );
          return null;
        }
        let applied = false;
        try {
          // That Open EditElements commit order:
          // setMeshes -> dispose preview -> getRequests -> editor.edit -> update.
          await element.setMeshes(meshes);
          controls.detach();
          helper.visible = false;
          element.disposeMeshes(meshes);
          editMeshes = null;
          const requests = element.getRequests();
          if (requests?.length) {
            await fragments.editor.edit(model.modelId, requests);
            applied = true;
          }
        } catch (reason) {
          onLog(
            `viewer.transformGizmo.editError(${JSON.stringify(String(reason))});`,
          );
        }
        controls.detach();
        helper.visible = false;
        if (editMeshes) {
          editMeshes.removeFromParent();
          try {
            element.disposeMeshes(editMeshes);
          } catch {
            // The owning model may already be disposed after a reload.
          }
        }
        editElement = null;
        editMeshes = null;
        removeOrphanEditMeshes();
        // Restore visibility using the tutorial's base/delta rule. After a
        // successful edit the stale base item stays hidden and the delta item
        // becomes visible. Per Mirror ersetzte Elemente bleiben ausgeblendet.
        if (!isHiddenLocalId(model.modelId, localId)) {
          await setFragmentElementVisible(
            fragments,
            model,
            element,
            true,
          ).catch(() => undefined);
        }
        await fragments.update(true).catch(() => undefined);
        if (!applied) {
          // Natives Dokument ist bereits geändert: applied=false meldet den
          // Fehlschlag an onTransformFinished, der Pending-Eintrag (Fallback
          // "Modell neu berechnen") bleibt damit bestehen.
          onLog(
            `viewer.transformGizmo.reverted({ id: ${localId}, reason: 'fragments-edit-failed' });`,
          );
        }
        return { commit: { ...change, applied }, receipt };
      },
    );
    if (!result) {
      return;
    }
    await onTransformFinished(result.commit, result.receipt);
    onLog(
      result.commit.mode === "translate"
        ? `viewer.moveGizmo.delta({ dx: ${formatCoordinate(result.commit.delta?.x ?? 0)}, dy: ${formatCoordinate(result.commit.delta?.y ?? 0)}, dz: ${formatCoordinate(result.commit.delta?.z ?? 0)} });`
        : `viewer.rotateGizmo.delta({ rx: ${formatCoordinate(result.commit.rotation?.x ?? 0)}, ry: ${formatCoordinate(result.commit.rotation?.y ?? 0)}, rz: ${formatCoordinate(result.commit.rotation?.z ?? 0)} });`,
    );
    onSceneChange();
  };

  const readRotationChange = (
    THREE: typeof import("three"),
    meshes: import("three").Object3D,
    rotation: ViewerMoveDelta,
  ): ViewerRotationChange => {
    meshes.updateWorldMatrix(true, false);
    const worldQuaternion = meshes.getWorldQuaternion(new THREE.Quaternion());
    const axis = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(worldQuaternion)
      .normalize();
    const refDirection = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(worldQuaternion)
      .normalize();
    return {
      axis: { x: axis.x, y: axis.y, z: axis.z },
      refDirection: {
        x: refDirection.x,
        y: refDirection.y,
        z: refDirection.z,
      },
      rotation,
    };
  };

  const onChange = () => {
    onSceneChange();
  };

  controls.addEventListener("dragging-changed", onDraggingChanged);
  controls.addEventListener("mouseDown", onMouseDown);
  controls.addEventListener("mouseUp", onMouseUp);
  controls.addEventListener("change", onChange);

  const dispose = () => {
    controls.removeEventListener("dragging-changed", onDraggingChanged);
    controls.removeEventListener("mouseDown", onMouseDown);
    controls.removeEventListener("mouseUp", onMouseUp);
    controls.removeEventListener("change", onChange);
    controls.detach();
    controls.dispose();
    helper.removeFromParent();
    void enqueue(() => disposeEditable(true));
  };

  /** Aktuell vom Gizmo als Preview ausgeblendetes Original (falls aktiv). */
  const getHiddenPreview = () =>
    editMeshes && selectedModel && selectedLocalId > 0
      ? { localId: selectedLocalId, modelId: selectedModel.modelId }
      : null;

  return {
    dispose,
    getHiddenPreview,
    isDragging: () => dragging,
    setEnabled,
    setMode,
    updateSelection,
  };
}

async function createFragmentBodyElement(
  fragments: import("@thatopen/fragments").FragmentsModels,
  loaded: {
    model: import("@thatopen/fragments").FragmentsModel;
    ifcWorldToModel: import("three").Matrix4 | null;
  },
  op: Extract<ViewerMirrorOp, { kind: "create-body" }>,
  THREE: typeof import("three"),
) {
  const geometry = createBodyGeometry(THREE, op);
  // Neutrales Grau wie unstylte konvertierte Elemente — der Mirror soll
  // nicht wie eine Vorschau aussehen.
  const material = new THREE.MeshLambertMaterial({
    color: 0xc9cdd2,
    side: THREE.DoubleSide,
  });
  // GlobalTransform in IFC-Welt (Viewer-Achsen): geerbte Rotation der
  // Platzierungskette + Position — dann als Ganzes in den rebased
  // Modell-/Szenenraum (die Koordination kann selbst rotieren).
  const globalTransform = new THREE.Matrix4();
  if (op.axes) {
    globalTransform.makeBasis(
      new THREE.Vector3(op.axes.x.x, op.axes.x.y, op.axes.x.z),
      new THREE.Vector3(op.axes.y.x, op.axes.y.y, op.axes.y.z),
      new THREE.Vector3(op.axes.z.x, op.axes.z.y, op.axes.z.z),
    );
  }
  globalTransform.setPosition(op.position.x, op.position.y, op.position.z);
  if (loaded.ifcWorldToModel) {
    globalTransform.premultiply(loaded.ifcWorldToModel);
  }
  try {
    const created = await fragments.editor.createElements(
      loaded.model.modelId,
      [
        {
          attributes: {
            _category: { value: normalizeFragmentCategory(op.category) },
            // GlobalId der nativen Entität, damit die Identität eine
            // Rekonversion überlebt.
            _guid: { value: op.globalId || createFragmentGuid() },
            Name: { value: op.name || "IFCnative Body", type: "IFCLABEL" },
            ObjectType: {
              value: op.tag || "IFCnative Body",
              type: "IFCLABEL",
            },
          },
          globalTransform,
          samples: [
            {
              localTransform: new THREE.Matrix4(),
              material,
              representation: geometry,
            },
          ],
        },
      ],
    );
    return created?.[0] ?? null;
  } finally {
    geometry.dispose();
    material.dispose();
  }
}

async function replaceFragmentElementGeometry(
  fragments: import("@thatopen/fragments").FragmentsModels,
  model: import("@thatopen/fragments").FragmentsModel,
  localId: number,
  options: {
    profile?: string;
    width: string;
    depth: string;
    height: string;
  },
  THREE: typeof import("three"),
) {
  const [element] = await fragments.editor.getElements(model.modelId, [
    localId,
  ]);
  if (!element) {
    return false;
  }
  const meshes = await element.getMeshes();
  const replacement = createBodyGeometry(THREE, options);
  let changedMeshes = 0;
  let disposed = false;
  try {
    meshes.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      object.geometry.copy(replacement);
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
      object.geometry.computeVertexNormals();
      changedMeshes += 1;
    });
    if (!changedMeshes) {
      return false;
    }
    meshes.updateMatrixWorld(true);
    await element.setMeshes(meshes);
    element.disposeMeshes(meshes);
    disposed = true;
    const requests = element.getRequests();
    if (!requests?.length) {
      return false;
    }
    await fragments.editor.edit(model.modelId, requests);
    await setFragmentElementVisible(fragments, model, element, true);
    return true;
  } finally {
    replacement.dispose();
    if (!disposed) {
      element.disposeMeshes(meshes);
    }
  }
}

/**
 * Baut aus den 9 gespeicherten Koordinationswerten ([px,py,pz, xAchse, yAchse],
 * Welt → Ursprung in Viewer-Achsen) eine Matrix4. null bei fehlenden Werten
 * oder (näherungsweiser) Identität.
 */
function coordinationToMatrix(
  THREE: typeof import("three"),
  coordination: number[] | null | undefined,
): import("three").Matrix4 | null {
  if (!coordination || coordination.length < 9) {
    return null;
  }
  const [x, y, z, xx, xy, xz, yx, yy, yz] = coordination;
  const xDir = new THREE.Vector3(xx, xy, xz);
  const yDir = new THREE.Vector3(yx, yy, yz);
  if (xDir.lengthSq() < 0.5 || yDir.lengthSq() < 0.5) {
    return null;
  }
  const zDir = new THREE.Vector3().crossVectors(xDir, yDir);
  const matrix = new THREE.Matrix4();
  // Spalten = Achsen, Translation = Position (wie CoordinatesManager).
  matrix.set(
    xDir.x,
    yDir.x,
    zDir.x,
    x,
    xDir.y,
    yDir.y,
    zDir.y,
    y,
    xDir.z,
    yDir.z,
    zDir.z,
    z,
    0,
    0,
    0,
    1,
  );
  const isIdentity =
    Math.abs(x) < 1e-6 &&
    Math.abs(y) < 1e-6 &&
    Math.abs(z) < 1e-6 &&
    Math.abs(xx - 1) < 1e-9 &&
    Math.abs(yy - 1) < 1e-9 &&
    Math.abs(xy) < 1e-9 &&
    Math.abs(xz) < 1e-9 &&
    Math.abs(yx) < 1e-9 &&
    Math.abs(yz) < 1e-9;
  return isIdentity ? null : matrix;
}

function normalizeFragmentCategory(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return "IFCBUILDINGELEMENTPROXY";
  }
  return normalized.startsWith("IFC") ? normalized : `IFC${normalized}`;
}

function createFragmentGuid() {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `IFCnative-${uuid}`;
}

interface ThatOpenViewCubeElement extends HTMLElement {
  backText?: string;
  bottomText?: string;
  camera: import("three").Camera | null;
  frontText?: string;
  leftText?: string;
  rightText?: string;
  size?: number;
  topText?: string;
  updateOrientation(): void;
}

function createThatOpenViewCube(
  THREE: typeof import("three"),
  container: HTMLDivElement,
  camera: import("@thatopen/components").SimpleCamera,
) {
  const viewCube = document.createElement(
    "bim-view-cube",
  ) as ThatOpenViewCubeElement;
  viewCube.className = "ifcnative-thatopen-viewcube";
  viewCube.title = "ViewCube";
  viewCube.size = 64;
  viewCube.rightText = "+X";
  viewCube.leftText = "-X";
  viewCube.topText = "+Y";
  viewCube.bottomText = "-Y";
  viewCube.frontText = "+Z";
  viewCube.backText = "-Z";
  viewCube.camera = camera.three;
  container.append(viewCube);

  const updateOrientation = () => viewCube.updateOrientation();
  camera.controls.addEventListener("update", updateOrientation);

  const target = new THREE.Vector3();
  const currentPosition = new THREE.Vector3();
  const lookFrom = (direction: import("three").Vector3) => {
    camera.controls.getTarget(target, true);
    camera.controls.getPosition(currentPosition, true);
    const distance = Math.max(currentPosition.distanceTo(target), 6);
    const position = target
      .clone()
      .add(direction.normalize().multiplyScalar(distance));
    void camera.controls
      .setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        true,
      )
      .then(updateOrientation);
  };

  const listeners: Array<[string, EventListener]> = [
    ["rightclick", () => lookFrom(new THREE.Vector3(1, 0, 0))],
    ["leftclick", () => lookFrom(new THREE.Vector3(-1, 0, 0))],
    ["topclick", () => lookFrom(new THREE.Vector3(0, 1, 0))],
    ["bottomclick", () => lookFrom(new THREE.Vector3(0, -1, 0))],
    ["frontclick", () => lookFrom(new THREE.Vector3(0, 0, 1))],
    ["backclick", () => lookFrom(new THREE.Vector3(0, 0, -1))],
  ];
  for (const [type, listener] of listeners) {
    viewCube.addEventListener(type, listener);
  }
  updateOrientation();

  const dispose = () => {
    camera.controls.removeEventListener("update", updateOrientation);
    for (const [type, listener] of listeners) {
      viewCube.removeEventListener(type, listener);
    }
    viewCube.camera = null;
    viewCube.remove();
  };

  return { dispose };
}

function createCoordinateCursor(THREE: typeof import("three")) {
  const group = new THREE.Group();
  group.name = "IFCnativeCoordinateCursor";
  group.visible = false;

  const originMaterial = new THREE.MeshBasicMaterial({ color: 0xffc857 });
  const origin = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 24, 16),
    originMaterial,
  );
  group.add(origin);

  const xMaterial = new THREE.LineBasicMaterial({ color: 0xef4444 });
  const yMaterial = new THREE.LineBasicMaterial({ color: 0x16a34a });
  const zMaterial = new THREE.LineBasicMaterial({ color: 0x2563eb });
  group.add(createCursorAxis(THREE, "x", 0xef4444, xMaterial));
  group.add(createCursorAxis(THREE, "y", 0x16a34a, yMaterial));
  group.add(createCursorAxis(THREE, "z", 0x2563eb, zMaterial));

  group.add(
    createAxisLabel(THREE, "X", 0xef4444, new THREE.Vector3(0.82, 0, 0)),
  );
  group.add(
    createAxisLabel(THREE, "Y", 0x16a34a, new THREE.Vector3(0, 0.82, 0)),
  );
  group.add(
    createAxisLabel(THREE, "Z", 0x2563eb, new THREE.Vector3(0, 0, 0.82)),
  );

  const rayMaterial = new THREE.LineBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.85,
  });
  const rayGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const rayLine = new THREE.Line(rayGeometry, rayMaterial);
  rayLine.name = "IFCnativePickerRay";
  rayLine.visible = false;

  const show = (
    point: import("three").Vector3,
    rayOrigin: import("three").Vector3,
    cameraDistance: number,
  ) => {
    const scale = Math.min(Math.max(cameraDistance * 0.035, 0.35), 2.25);
    group.position.copy(point);
    group.scale.setScalar(scale);
    group.visible = true;
    rayGeometry.setFromPoints([rayOrigin, point]);
    rayGeometry.computeBoundingSphere();
    rayLine.visible = true;
  };

  const hide = () => {
    group.visible = false;
    rayLine.visible = false;
  };

  const dispose = () => {
    worldDispose(group);
    rayGeometry.dispose();
    rayMaterial.dispose();
  };

  return { dispose, group, hide, rayLine, show };
}

function createCursorAxis(
  THREE: typeof import("three"),
  axis: "x" | "y" | "z",
  color: number,
  lineMaterial: import("three").LineBasicMaterial,
) {
  const length = 0.72;
  const end =
    axis === "x"
      ? new THREE.Vector3(length, 0, 0)
      : axis === "y"
        ? new THREE.Vector3(0, length, 0)
        : new THREE.Vector3(0, 0, length);
  const group = new THREE.Group();
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), end]),
    lineMaterial,
  );
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.045, 0.14, 18),
    new THREE.MeshBasicMaterial({ color }),
  );
  cone.position.copy(end);
  if (axis === "x") {
    cone.rotation.z = -Math.PI / 2;
  } else if (axis === "z") {
    cone.rotation.x = Math.PI / 2;
  }
  group.add(line, cone);
  return group;
}

function createAxisLabel(
  THREE: typeof import("three"),
  label: string,
  color: number,
  position: import("three").Vector3,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.beginPath();
    context.arc(32, 32, 24, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "700 30px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 32, 33);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    depthTest: false,
    map: texture,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.setScalar(0.22);
  return sprite;
}

function worldDispose(object: import("three").Object3D) {
  object.traverse((child) => {
    const mesh = child as import("three").Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const item of material) {
        item.dispose();
      }
    } else {
      material?.dispose();
    }
  });
}

function toModelId(fileName: string) {
  return (
    fileName
      .replace(/\.ifc$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-|-$/g, "") || "ifcnative"
  );
}

function resolvePublicAssetUrl(assetPath: string) {
  const cleanPath = assetPath.replace(/^\/+/, "");
  if (globalThis.location.protocol === "file:") {
    return new URL(cleanPath, globalThis.location.href).toString();
  }
  return new URL(cleanPath, `${globalThis.location.origin}/`).toString();
}

function formatCoordinate(value: number) {
  return Number(value)
    .toFixed(4)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

function formatCoordinatePickLabel(pick: ViewerCoordinatePick) {
  const source = pick.fileName ? `${pick.fileName} · ` : "";
  return `${source}X ${formatCoordinate(pick.x)} · Y ${formatCoordinate(pick.y)} · Z ${formatCoordinate(pick.z)}`;
}

function formatCoordinatePickClipboard(pick: ViewerCoordinatePick) {
  return JSON.stringify({
    documentId: pick.documentId,
    entityId: pick.entityId,
    fileName: pick.fileName,
    localId: pick.localId,
    modelId: pick.modelId,
    source: pick.source,
    x: formatCoordinate(pick.x),
    y: formatCoordinate(pick.y),
    z: formatCoordinate(pick.z),
  });
}

function isViewerShortcutTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

async function writeClipboardText(text: string) {
  if (!globalThis.navigator?.clipboard?.writeText) {
    throw new Error("Clipboard API is not available.");
  }
  await globalThis.navigator.clipboard.writeText(text);
}

async function readItemData(
  fragments: {
    getData(
      items: Record<string, Set<number>>,
      config?: {
        attributesDefault?: boolean;
        relationsDefault?: { attributes: boolean; relations: boolean };
      },
    ): Promise<Record<string, unknown[]>>;
  },
  modelId: string,
  localId: number,
) {
  const dataByModel = await fragments
    .getData(
      { [modelId]: new Set([localId]) },
      {
        attributesDefault: true,
        relationsDefault: { attributes: false, relations: false },
      },
    )
    .catch(() => undefined);
  return dataByModel?.[modelId]?.[0];
}

async function getCameraFitLocalIds(model: FitFragmentModelLike) {
  const localIds = await model.getLocalIds().catch(() => []);
  // Scanning item attributes for origin markers requires fetching data for
  // every item; skip it for large models and fit to everything instead.
  if (localIds.length > 4000) {
    return { ignored: 0, localIds: new Set<number>() };
  }
  const fitLocalIds = new Set<number>();
  let ignored = 0;
  const chunkSize = 1500;
  for (let index = 0; index < localIds.length; index += chunkSize) {
    const chunk = localIds.slice(index, index + chunkSize);
    const data = await model
      .getItemsData(chunk, {
        attributesDefault: true,
        relationsDefault: { attributes: false, relations: false },
      })
      .catch(() => []);
    chunk.forEach((localId, chunkIndex) => {
      const item = data[chunkIndex];
      if (isOriginMarkerItem(item)) {
        ignored += 1;
      } else {
        fitLocalIds.add(localId);
      }
    });
  }
  return {
    ignored,
    localIds: fitLocalIds.size > 0 ? fitLocalIds : new Set(localIds),
  };
}

const ORIGIN_MARKER_TERMS = [
  "nullpunktobjekt",
  "nullpunkt",
  "origin marker",
  "survey point",
];

function isOriginMarkerItem(data: unknown) {
  const haystack = [
    readStringAttribute(data, ["Name", "name"]),
    readStringAttribute(data, ["ObjectType", "objectType"]),
    readStringAttribute(data, ["Tag", "tag"]),
    readStringAttribute(data, ["Description", "description"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return ORIGIN_MARKER_TERMS.some((term) => haystack.includes(term));
}

function readNumericAttribute(data: unknown, keys: string[]) {
  const value = readAttribute(data, keys);
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStringAttribute(data: unknown, keys: string[]) {
  const value = readAttribute(data, keys);
  return typeof value === "string" && value ? value : undefined;
}

function readAttribute(data: unknown, keys: string[]) {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (raw && typeof raw === "object" && "value" in raw) {
      return (raw as { value: unknown }).value;
    }
    if (raw !== undefined) {
      return raw;
    }
  }
  return undefined;
}

function stringifyError(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
