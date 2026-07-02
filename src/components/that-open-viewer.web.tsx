import {
    Box,
    Copy,
    LocateFixed,
    Maximize,
    MousePointer2,
    Move,
    RotateCw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
    convertIfcToFragmentsInWorker,
    type ConvertIfcToFragmentsProgress,
} from "../ifc/fragmentConversionWorker";
import { buildNativeDocumentFromFragments } from "../ifc/fragmentDocument";
import type {
    ThatOpenViewerModel,
    ThatOpenViewerProps,
    ViewerCoordinatePick,
    ViewerCreateBodyRequest,
    ViewerEditBodyRequest,
    ViewerMoveDelta,
    ViewerRotationChange,
} from "./that-open-viewer";

type ViewerRuntime = Awaited<ReturnType<typeof createThatOpenRuntime>>;

export default function ThatOpenViewer({
  activeDocumentId,
  activeModelDeferredReason,
  activeModelFileName,
  activeModelLoaded = true,
  createBodyRequest,
  editBodyRequest,
  focusRequest,
  models,
  onLoadActiveModel,
  onFragmentsModelChanged,
  onLog,
  onMoveSelected,
  onRotateSelected,
  onPickCoordinates,
  onSelect,
}: ThatOpenViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const modelsRef = useRef(models);
  const selectedByDocumentIdRef = useRef(new Map<string, number>());
  const onLogRef = useRef(onLog);
  const onFragmentsModelChangedRef = useRef(onFragmentsModelChanged);
  const onMoveSelectedRef = useRef(onMoveSelected);
  const onRotateSelectedRef = useRef(onRotateSelected);
  const onPickCoordinatesRef = useRef(onPickCoordinates);
  const onSelectRef = useRef(onSelect);
  const handledFocusNonceRef = useRef<number | undefined>(undefined);
  const handledCreateBodyNonceRef = useRef<number | undefined>(undefined);
  const handledEditBodyNonceRef = useRef<number | undefined>(undefined);
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
  onFragmentsModelChangedRef.current = onFragmentsModelChanged;
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
        onFragmentsModelChanged: (change) =>
          onFragmentsModelChangedRef.current?.(change),
        onMoveSelected: (delta) => onMoveSelectedRef.current?.(delta),
        onRotateSelected: (rotation) => onRotateSelectedRef.current?.(rotation),
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

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      !modelReady ||
      !createBodyRequest ||
      createBodyRequest.documentId !== activeDocumentId ||
      handledCreateBodyNonceRef.current === createBodyRequest.nonce
    ) {
      return;
    }
    handledCreateBodyNonceRef.current = createBodyRequest.nonce;
    void runtime.createBodyElement(createBodyRequest).catch((reason) => {
      const message = stringifyError(reason);
      setError(message);
      onLogRef.current?.(
        `fragments.createBodyError(${JSON.stringify(message)});`,
      );
    });
  }, [activeDocumentId, createBodyRequest, modelReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      !modelReady ||
      !editBodyRequest ||
      editBodyRequest.documentId !== activeDocumentId ||
      handledEditBodyNonceRef.current === editBodyRequest.nonce
    ) {
      return;
    }
    handledEditBodyNonceRef.current = editBodyRequest.nonce;
    void runtime.editBodyElement(editBodyRequest).catch((reason) => {
      const message = stringifyError(reason);
      setError(message);
      onLogRef.current?.(
        `fragments.editBodyError(${JSON.stringify(message)});`,
      );
    });
  }, [activeDocumentId, editBodyRequest, modelReady]);

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
            disabled={!activeModelVisible}
            title="Verschieben (Gizmo)"
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
            disabled={!activeModelVisible}
            title="Rotieren (Gizmo)"
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
    isCoordinatePickerActive(): boolean;
    onError(message: string): void;
    onCoordinatePickerUsed(): void;
    onFragmentsModelChanged(
      change: Parameters<
        NonNullable<ThatOpenViewerProps["onFragmentsModelChanged"]>
      >[0],
    ): void;
    onLog(line: string): void;
    onMoveSelected(delta: ViewerMoveDelta): void;
    onRotateSelected(rotation: ViewerRotationChange): void;
    onPickCoordinates(pick: ViewerCoordinatePick): void;
    onProgress(progress: { fileName: string; percent: number } | null): void;
    onSelect(
      id: number,
      source?: string,
      globalId?: string,
      documentId?: string,
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
  world.renderer = new OBC.SimpleRenderer(components, container, {
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  world.renderer.showLogo = false;
  world.camera = new OBC.SimpleCamera(components);

  components.init();
  world.scene.setup();
  world.scene.three.background = new THREE.Color(0xf8fafc);
  world.camera.three.near = 0.1;
  world.camera.three.far = 1_000_000;
  world.camera.three.updateProjectionMatrix();
  world.camera.controls.setLookAt(8, 6, 8, 0, 0, 0);

  const grids = components.get(OBC.Grids);
  grids.create(world);
  const fragments = components.get(OBC.FragmentsManager);
  const fragmentsWorkerUrl = resolvePublicAssetUrl("fragments/worker.mjs");
  fragments.init(fragmentsWorkerUrl);
  const coreWithSettings = fragments.core as typeof fragments.core & {
    settings?: { autoCoordinate?: boolean };
  };
  if (coreWithSettings.settings) {
    // We apply each model's own coordination matrix explicitly on load so
    // scene coordinates equal IFC world coordinates. The built-in
    // autoCoordinate (align to first loaded model) would fight with that.
    coreWithSettings.settings.autoCoordinate = false;
  }
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
        return;
      }
      await highlight(activeDocumentId, change.localId);
      if (change.mode === "translate" && change.delta) {
        callbacks.onMoveSelected(change.delta);
        callbacks.onLog(
          `fragments.move({ file: '${loaded.fileName}', id: ${change.localId}, dx: ${formatCoordinate(change.delta.x ?? 0)}, dy: ${formatCoordinate(change.delta.y ?? 0)}, dz: ${formatCoordinate(change.delta.z ?? 0)} });`,
        );
        return;
      }
      if (change.rotationChange) {
        callbacks.onRotateSelected(change.rotationChange);
      }
      callbacks.onLog(
        `fragments.rotate({ file: '${loaded.fileName}', id: ${change.localId}, rx: ${formatCoordinate(change.rotation?.x ?? 0)}, ry: ${formatCoordinate(change.rotation?.y ?? 0)}, rz: ${formatCoordinate(change.rotation?.z ?? 0)} });`,
      );
    },
    (line) => callbacks.onLog(line),
    () => void fragments.core.update(true),
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
    loadKey: string;
    model: import("@thatopen/fragments").FragmentsModel;
  };

  const modelsByDocumentId = new Map<string, LoadedViewerModel>();
  const documentIdByModelId = new Map<string, string>();
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

  const selectFromPointer = async (event: MouseEvent) => {
    if (!modelsByDocumentId.size || !world.renderer) {
      return;
    }
    if (moveGizmo.isDragging()) {
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
    const modelId = result.fragments.modelId;
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
    if (callbacks.isCoordinatePickerActive()) {
      coordinateCursor.show(
        result.point,
        result.ray?.origin ?? world.camera.three.position,
        world.camera.three.position.distanceTo(result.point),
      );
      callbacks.onCoordinatePickerUsed();
      callbacks.onPickCoordinates({
        documentId,
        entityId: entityId ?? localId,
        fileName: loadedModel.fileName,
        globalId,
        localId,
        modelId,
        source: "thatopen",
        x: result.point.x,
        y: result.point.y,
        z: result.point.z,
      });
      callbacks.onLog(
        `viewer.coordinates.pick({ file: '${loadedModel.fileName}', x: ${formatCoordinate(result.point.x)}, y: ${formatCoordinate(result.point.y)}, z: ${formatCoordinate(result.point.z)}, localId: ${localId} });`,
      );
      await fragments.core.update(true);
    }
    callbacks.onSelect(entityId ?? localId, "thatopen", globalId, documentId);
    callbacks.onLog(
      `viewer.select({ engine: 'thatopen', file: '${loadedModel.fileName}', localId: ${localId}, entityId: ${entityId ?? localId}${globalId ? `, globalId: '${globalId}'` : ""} });`,
    );
    if (documentId === callbacks.getActiveDocumentId()) {
      await highlight(documentId, localId);
    }
  };

  canvas.addEventListener("pointerdown", trackPointerDown, { capture: true });
  canvas.addEventListener("click", selectFromPointer, { capture: true });

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
    const nextDocumentIds = new Set(
      nextModels.map((model) => model.documentId),
    );
    coordinateCursor.hide();
    // Release any gizmo preview clone before models are disposed/reloaded so
    // no hidden element or orphaned preview mesh survives the reload.
    await moveGizmo.updateSelection(0, null);
    for (const [documentId, loaded] of modelsByDocumentId) {
      if (!nextDocumentIds.has(documentId)) {
        loaded.model.object.removeFromParent();
        await loaded.model.dispose().catch(() => undefined);
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
        current.model.object.removeFromParent();
        await current.model.dispose().catch(() => undefined);
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
      const model = await fragments.core.load(converted.fragments, {
        camera: world.camera.three,
        modelId,
      });
      // Re-apply the coordination matrix stored during import so scene
      // coordinates equal IFC world coordinates even when the vertex data
      // was rebased to the origin (georeferenced models).
      const coordinationMatrix = await model
        .getCoordinationMatrix()
        .catch(() => null);
      if (coordinationMatrix) {
        model.object.applyMatrix4(coordinationMatrix);
        model.object.updateMatrixWorld(true);
        const offset = new THREE.Vector3().setFromMatrixPosition(
          coordinationMatrix,
        );
        if (offset.lengthSq() > 0.000001) {
          callbacks.onLog(
            `viewer.coordination.applied({ file: '${nextModel.fileName}', x: ${formatCoordinate(offset.x)}, y: ${formatCoordinate(offset.y)}, z: ${formatCoordinate(offset.z)} });`,
          );
        }
      }
      const fitModelItems = await getCameraFitLocalIds(model);
      const fitItems =
        fitModelItems.ignored > 0 ? fitModelItems.localIds : undefined;
      if (fitModelItems.ignored > 0) {
        callbacks.onLog(
          `viewer.fit.ignoreOriginMarkers({ file: '${nextModel.fileName}', count: ${fitModelItems.ignored} });`,
        );
      }
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);
      modelsByDocumentId.set(nextModel.documentId, {
        documentId: nextModel.documentId,
        fileName: nextModel.fileName,
        fitItems,
        loadKey,
        model,
      });
      documentIdByModelId.set(model.modelId, nextModel.documentId);
      callbacks.onLog(
        `viewer.load({ engine: 'thatopen', file: '${nextModel.fileName}', modelId: '${model.modelId}' });`,
      );
    }
    await fragments.core.update(true);
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

  async function highlight(
    documentId: string,
    localId: number,
    options?: { updateGizmo?: boolean },
  ) {
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded || !Number.isFinite(localId) || localId <= 0) {
      return;
    }
    await fragments.resetHighlight();
    await fragments.highlight(selectionMaterial, {
      [loaded.model.modelId]: new Set([localId]),
    });
    await fragments.core.update(true);
    if (options?.updateGizmo ?? true) {
      await moveGizmo.updateSelection(localId, loaded.model);
    }
  }

  async function fit() {
    if (!modelsByDocumentId.size) {
      return;
    }
    const activeDocumentId = callbacks.getActiveDocumentId();
    const activeModel = modelsByDocumentId.get(activeDocumentId);
    if (activeModel) {
      await moveGizmo.updateSelection(
        callbacks.getSelectedId(activeDocumentId),
        activeModel.model,
      );
    }
    await world.camera.fitToItems(getFitItems());
  }

  async function focusSelected(documentId: string, localId: number) {
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded || !Number.isFinite(localId) || localId <= 0) {
      return;
    }
    await highlight(documentId, localId).catch(() => undefined);
    await world.camera
      .fitToItems({
        [loaded.model.modelId]: new Set([localId]),
      })
      .catch(() => fit());
    callbacks.onLog(
      `viewer.camera.center({ file: '${loaded.fileName}', id: ${localId} });`,
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

  async function emitFragmentsDocumentChanged(
    loaded: LoadedViewerModel,
    selectedId: number,
    summary: string,
  ) {
    const document = await buildNativeDocumentFromFragments(loaded.model, {
      fileName: loaded.fileName,
    });
    callbacks.onFragmentsModelChanged({
      document,
      documentId: loaded.documentId,
      selectedId,
      summary,
    });
  }

  async function createBodyElement(request: ViewerCreateBodyRequest) {
    const loaded = modelsByDocumentId.get(request.documentId);
    if (!loaded) {
      callbacks.onLog(
        `fragments.createBodySkipped({ reason: 'model-not-loaded', documentId: '${request.documentId}' });`,
      );
      return;
    }
    const element = await createFragmentBodyElement(
      fragments.core,
      loaded.model,
      toTargetModelBodyOptions(loaded.model, request.options, THREE),
      THREE,
    );
    if (!element) {
      callbacks.onLog(
        `fragments.createBodySkipped({ file: '${loaded.fileName}', reason: 'no-created-element' });`,
      );
      return;
    }
    await fragments.core.update(true);
    await highlight(request.documentId, element.localId);
    await emitFragmentsDocumentChanged(
      loaded,
      element.localId,
      `Create ${request.options.type} '${request.options.name}' with Fragments Elements API`,
    );
    callbacks.onSelect(
      element.localId,
      "fragments",
      undefined,
      request.documentId,
    );
    callbacks.onLog(
      `fragments.createBody({ file: '${loaded.fileName}', id: ${element.localId}, class: '${request.options.type}', name: ${JSON.stringify(request.options.name)} });`,
    );
  }

  async function editBodyElement(request: ViewerEditBodyRequest) {
    const loaded = modelsByDocumentId.get(request.documentId);
    if (!loaded) {
      callbacks.onLog(
        `fragments.editBodySkipped({ reason: 'model-not-loaded', documentId: '${request.documentId}' });`,
      );
      return;
    }
    const changed = await replaceFragmentElementGeometry(
      fragments.core,
      loaded.model,
      request.selectedId,
      toTargetModelBodyOptions(loaded.model, request.options, THREE),
      THREE,
    );
    if (!changed) {
      callbacks.onLog(
        `fragments.editBodySkipped({ file: '${loaded.fileName}', id: ${request.selectedId}, reason: 'no-editable-meshes' });`,
      );
      return;
    }
    await fragments.core.update(true);
    await highlight(request.documentId, request.selectedId);
    await emitFragmentsDocumentChanged(
      loaded,
      request.selectedId,
      `Edit #${request.selectedId} geometry with Fragments Elements API`,
    );
    callbacks.onLog(
      `fragments.editBody({ file: '${loaded.fileName}', id: ${request.selectedId}, profile: '${request.options.profile ?? "rectangle"}', width: ${request.options.width}, depth: ${request.options.depth}, height: ${request.options.height} });`,
    );
  }

  async function dispose() {
    canvas.removeEventListener("pointerdown", trackPointerDown, {
      capture: true,
    });
    canvas.removeEventListener("click", selectFromPointer, { capture: true });
    resizeObserver.disconnect();
    for (const loaded of modelsByDocumentId.values()) {
      loaded.model.object.removeFromParent();
      await loaded.model.dispose().catch(() => undefined);
    }
    modelsByDocumentId.clear();
    documentIdByModelId.clear();
    fragments.dispose();
    moveGizmo.dispose();
    viewCube.dispose();
    coordinateCursor.dispose();
    components.dispose();
  }

  return {
    dispose,
    createBodyElement,
    editBodyElement,
    fit,
    focusSelected,
    highlight,
    hideCoordinateCursor: coordinateCursor.hide,
    resetCamera,
    setMoveGizmoEnabled: moveGizmo.setEnabled,
    setMoveGizmoMode: moveGizmo.setMode,
    syncModels,
  };
}

type TransformControlsConstructor =
  typeof import("three/addons/controls/TransformControls.js").TransformControls;

interface CameraControlsLike {
  enabled: boolean;
}

type MoveGizmoMode = "translate" | "rotate";

interface MoveGizmoCommit {
  delta?: ViewerMoveDelta;
  localId: number;
  mode: MoveGizmoMode;
  rotation?: ViewerMoveDelta;
  rotationChange?: ViewerRotationChange;
}

interface EditableFragmentElementLike {
  disposeMeshes(meshes: import("three").Group): void;
  getMeshes(): Promise<import("three").Group>;
  getRequests(): unknown[] | undefined;
  setMeshes(meshes: import("three").Group): Promise<void>;
}

interface EditableFragmentsLike {
  editor: {
    edit(
      modelId: string,
      requests: unknown[],
      options?: unknown,
    ): Promise<void>;
    getElements(
      modelId: string,
      localIds: number[],
    ): Promise<EditableFragmentElementLike[]>;
  };
  update(force?: boolean): Promise<void>;
}

interface EditableFragmentModelLike {
  modelId: string;
  object?: import("three").Object3D;
  setVisible?(localIds: number[] | undefined, visible: boolean): Promise<void>;
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

function createMoveGizmo(
  THREE: typeof import("three"),
  TransformControls: TransformControlsConstructor,
  fragments: EditableFragmentsLike,
  scene: import("three").Scene,
  camera: import("three").Camera,
  cameraControls: CameraControlsLike,
  canvas: HTMLCanvasElement,
  onTransformCommitted: (change: MoveGizmoCommit) => Promise<void>,
  onLog: (line: string) => void,
  onSceneChange: () => void,
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
  const dragStart = new THREE.Vector3();
  const dragStartRotation = new THREE.Euler();

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
    if (restoreVisible && model && Number.isFinite(localId) && localId > 0) {
      await model.setVisible?.([localId], true).catch(() => undefined);
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
    await model.setVisible?.([localId], false).catch(() => undefined);
    editElement = element;
    editMeshes = await element.getMeshes();
    editMeshes.name = "IFCnativeEditableElement";
    // Parent the preview under the model object so any coordination
    // transform (georeferenced models) applies to the clone as well.
    (model.object ?? scene).add(editMeshes);
    removeOrphanEditMeshes();
    controls.setMode(mode);
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
    if (!editMeshes) {
      return;
    }
    dragStart.copy(editMeshes.position);
    dragStartRotation.copy(editMeshes.rotation);
    onSceneChange();
  };
  const onMouseUp = () => {
    void commitCurrentTransform();
  };

  const commitCurrentTransform = async () => {
    const commit = await enqueue(async (): Promise<MoveGizmoCommit | null> => {
      if (
        !editElement ||
        !editMeshes ||
        !selectedModel ||
        selectedLocalId <= 0
      ) {
        onSceneChange();
        return null;
      }
      const delta = editMeshes.position.clone().sub(dragStart);
      const rotation = {
        x: editMeshes.rotation.x - dragStartRotation.x,
        y: editMeshes.rotation.y - dragStartRotation.y,
        z: editMeshes.rotation.z - dragStartRotation.z,
      };
      const rotationChange = readRotationChange(THREE, editMeshes, rotation);
      const changed =
        mode === "translate"
          ? delta.lengthSq() >= 0.000001
          : Math.abs(rotation.x) +
              Math.abs(rotation.y) +
              Math.abs(rotation.z) >=
            0.000001;
      if (!changed) {
        onSceneChange();
        return null;
      }

      const element = editElement;
      const meshes = editMeshes;
      const model = selectedModel;
      const localId = selectedLocalId;
      controls.detach();
      helper.visible = false;
      meshes.removeFromParent();
      element.disposeMeshes(meshes);
      editElement = null;
      editMeshes = null;
      removeOrphanEditMeshes();
      await model.setVisible?.([localId], true).catch(() => undefined);
      await fragments.update(true).catch(() => undefined);
      return {
        localId,
        mode,
        ...(mode === "translate"
          ? { delta: { x: delta.x, y: delta.y, z: delta.z } }
          : { rotation, rotationChange }),
      };
    });
    if (!commit) {
      return;
    }
    await onTransformCommitted(commit);
    onLog(
      commit.mode === "translate"
        ? `viewer.moveGizmo.delta({ dx: ${formatCoordinate(commit.delta?.x ?? 0)}, dy: ${formatCoordinate(commit.delta?.y ?? 0)}, dz: ${formatCoordinate(commit.delta?.z ?? 0)} });`
        : `viewer.rotateGizmo.delta({ rx: ${formatCoordinate(commit.rotation?.x ?? 0)}, ry: ${formatCoordinate(commit.rotation?.y ?? 0)}, rz: ${formatCoordinate(commit.rotation?.z ?? 0)} });`,
    );
    onSceneChange();
  };

  const readRotationChange = (
    THREE: typeof import("three"),
    meshes: import("three").Group,
    rotation: ViewerMoveDelta,
  ): ViewerRotationChange => {
    const axis = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(meshes.quaternion)
      .normalize();
    const refDirection = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(meshes.quaternion)
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

  return {
    dispose,
    isDragging: () => dragging,
    setEnabled,
    setMode,
    updateSelection,
  };
}

async function createFragmentBodyElement(
  fragments: import("@thatopen/fragments").FragmentsModels,
  model: import("@thatopen/fragments").FragmentsModel,
  options: ViewerCreateBodyRequest["options"],
  THREE: typeof import("three"),
) {
  const width = readPositiveDraftNumber(options.width, 1);
  const depth = readPositiveDraftNumber(options.depth, width);
  const height = readPositiveDraftNumber(options.height, 1);
  const x = readDraftNumber(options.x, 0);
  const y = readDraftNumber(options.y, 0);
  const z = readDraftNumber(options.z, 0);
  const geometry = createDraftBodyGeometry(
    THREE,
    options,
    width,
    depth,
    height,
  );
  const material = new THREE.MeshLambertMaterial({
    color: 0x8ea7c2,
    side: THREE.DoubleSide,
  });
  try {
    const created = await fragments.editor.createElements(model.modelId, [
      {
        attributes: {
          _category: { value: normalizeFragmentCategory(options.type) },
          _guid: { value: createFragmentGuid() },
          Name: { value: options.name || "Fragment Body", type: "IFCLABEL" },
          ObjectType: {
            value: options.tag || "IFCnative Fragment Body",
            type: "IFCLABEL",
          },
        },
        globalTransform: new THREE.Matrix4().makeTranslation(x, y, z),
        samples: [
          {
            localTransform: new THREE.Matrix4(),
            material,
            representation: geometry,
          },
        ],
      },
    ]);
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
  options: ViewerEditBodyRequest["options"],
  THREE: typeof import("three"),
) {
  const [element] = await fragments.editor.getElements(model.modelId, [
    localId,
  ]);
  if (!element) {
    return false;
  }
  const meshes = await element.getMeshes();
  const replacement = createDraftBodyGeometry(THREE, options);
  let changedMeshes = 0;
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
    if (options.placementMode === "world") {
      meshes.position.set(
        readDraftNumber(options.x, 0),
        readDraftNumber(options.y, 0),
        readDraftNumber(options.z, 0),
      );
    }
    meshes.updateMatrixWorld(true);
    await element.setMeshes(meshes);
    const requests = element.getRequests();
    if (!requests?.length) {
      return false;
    }
    await fragments.editor.edit(model.modelId, requests);
    return true;
  } finally {
    replacement.dispose();
    element.disposeMeshes(meshes);
  }
}

function toTargetModelBodyOptions(
  model: import("@thatopen/fragments").FragmentsModel,
  options: ViewerCreateBodyRequest["options"],
  THREE: typeof import("three"),
): ViewerCreateBodyRequest["options"] {
  if (options.placementMode !== "world") {
    return options;
  }
  const worldPoint = new THREE.Vector3(
    readDraftNumber(options.x, 0),
    readDraftNumber(options.y, 0),
    readDraftNumber(options.z, 0),
  );
  model.object.updateWorldMatrix(true, false);
  const targetPoint = model.object.worldToLocal(worldPoint.clone());
  return {
    ...options,
    x: formatDraftNumber(targetPoint.x),
    y: formatDraftNumber(targetPoint.y),
    z: formatDraftNumber(targetPoint.z),
  };
}

function createDraftBodyGeometry(
  THREE: typeof import("three"),
  options: Pick<
    ViewerCreateBodyRequest["options"],
    "depth" | "height" | "profile" | "width"
  >,
  width = readPositiveDraftNumber(options.width, 1),
  depth = readPositiveDraftNumber(options.depth, width),
  height = readPositiveDraftNumber(options.height, 1),
) {
  const geometry =
    options.profile === "cylinder"
      ? new THREE.CylinderGeometry(
          Math.max(width, depth) / 2,
          Math.max(width, depth) / 2,
          height,
          32,
        ).rotateX(Math.PI / 2)
      : new THREE.BoxGeometry(width, depth, height);
  geometry.computeVertexNormals();
  return geometry;
}

function normalizeFragmentCategory(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return "IFCBUILDINGELEMENTPROXY";
  }
  return normalized.startsWith("IFC") ? normalized : `IFC${normalized}`;
}

function readDraftNumber(value: string | number | undefined, fallback: number) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const numeric = Number(
    String(value ?? "")
      .trim()
      .replace(",", "."),
  );
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readPositiveDraftNumber(
  value: string | number | undefined,
  fallback: number,
) {
  const numeric = readDraftNumber(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function formatDraftNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
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
