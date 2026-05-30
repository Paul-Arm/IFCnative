import { useEffect, useMemo, useRef, useState } from "react";

import {
    convertIfcToFragmentsInWorker,
    type ConvertIfcToFragmentsProgress,
} from "../ifc/fragmentConversionWorker";
import type {
    ThatOpenViewerModel,
    ThatOpenViewerProps,
    ViewerCoordinatePick,
    ViewerMoveDelta,
} from "./that-open-viewer";

type ViewerRuntime = Awaited<ReturnType<typeof createThatOpenRuntime>>;

export default function ThatOpenViewer({
  activeDocumentId,
  activeModelDeferredReason,
  activeModelFileName,
  activeModelLoaded = true,
  models,
  onLoadActiveModel,
  onLog,
  onMoveSelected,
  onPickCoordinates,
  onSelect,
}: ThatOpenViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const activeDocumentIdRef = useRef(activeDocumentId);
  const modelsRef = useRef(models);
  const selectedByDocumentIdRef = useRef(new Map<string, number>());
  const onLogRef = useRef(onLog);
  const onMoveSelectedRef = useRef(onMoveSelected);
  const onPickCoordinatesRef = useRef(onPickCoordinates);
  const onSelectRef = useRef(onSelect);
  const pickerActiveRef = useRef(false);
  const [runtimeReady, setRuntimeReady] = useState(0);
  const [modelReady, setModelReady] = useState(0);
  const [, setStatus] = useState("Starting ThatOpen viewer...");
  const [error, setError] = useState("");
  const [moveGizmoActive, setMoveGizmoActive] = useState(false);
  const [pickerActive, setPickerActive] = useState(false);
  const [lastPick, setLastPick] = useState<ViewerCoordinatePick | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const activeModel = useMemo(
    () => models.find((model) => model.documentId === activeDocumentId),
    [activeDocumentId, models],
  );
  const activeSelectedId = activeModel?.selectedId ?? 0;
  const activeModelVisible = Boolean(activeModel);
  const hasVisibleModels = models.length > 0;
  const showDeferredActiveModel =
    !activeModelLoaded && Boolean(activeModelDeferredReason);
  const largeLoadWarning = useMemo(
    () => describeLargeIfcWarning(models),
    [models],
  );
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
  const lastWarningRef = useRef("");

  activeDocumentIdRef.current = activeDocumentId;
  modelsRef.current = models;
  selectedByDocumentIdRef.current = new Map(
    models.map((model) => [model.documentId, model.selectedId]),
  );
  onLogRef.current = onLog;
  onMoveSelectedRef.current = onMoveSelected;
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
        onMoveSelected: (delta) => onMoveSelectedRef.current?.(delta),
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
    if (largeLoadWarning && lastWarningRef.current !== largeLoadWarning) {
      lastWarningRef.current = largeLoadWarning;
      onLogRef.current?.(
        `viewer.largeFileWarning(${JSON.stringify(largeLoadWarning)});`,
      );
    }
    const frameId = requestAnimationFrame(() => {
      void runtime
        .syncModels(modelsRef.current, { fitAfterLoad: true })
        .then(async () => {
          if (cancelled) {
            return;
          }
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
  }, [largeLoadWarning, modelLoadSignature, runtimeReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !modelReady) {
      return;
    }
    void runtime.highlight(activeDocumentId, activeSelectedId);
  }, [activeDocumentId, activeSelectedId, modelReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtimeReady) {
      return;
    }
    void runtime.setMoveGizmoEnabled(moveGizmoActive);
  }, [moveGizmoActive, runtimeReady]);

  return (
    <div className="ifcnative-thatopen-shell">
      <div className="ifcnative-thatopen-toolbar">
        <div className="ifcnative-thatopen-actions">
          <button
            className="ifcnative-thatopen-button"
            disabled={!hasVisibleModels}
            type="button"
            onClick={() => void runtimeRef.current?.fit()}
          >
            Fit
          </button>
          <button
            className="ifcnative-thatopen-button"
            disabled={!hasVisibleModels}
            type="button"
            onClick={() => void runtimeRef.current?.resetCamera()}
          >
            Reset
          </button>
          <button
            className={`ifcnative-thatopen-button${pickerActive ? " is-active" : ""}`}
            disabled={!hasVisibleModels}
            type="button"
            onClick={() => {
              setCopyStatus("");
              setPickerActive((current) => !current);
            }}
          >
            {pickerActive ? "Picker aktiv" : "Koordinaten wählen"}
          </button>
          <button
            className={`ifcnative-thatopen-button${moveGizmoActive ? " is-active" : ""}`}
            disabled={!activeModelVisible}
            type="button"
            onClick={() => setMoveGizmoActive((current) => !current)}
          >
            {moveGizmoActive ? "Move-Gizmo aktiv" : "Move-Gizmo"}
          </button>
          {showDeferredActiveModel ? (
            <button
              className="ifcnative-thatopen-button is-primary"
              type="button"
              onClick={onLoadActiveModel}
            >
              3D laden
            </button>
          ) : null}
          <button
            className="ifcnative-thatopen-button"
            disabled={!lastPick}
            type="button"
            onClick={() => lastPick && void copyPick(lastPick)}
          >
            Koordinaten kopieren
          </button>
        </div>
        {lastPick ? (
          <div className="ifcnative-thatopen-coordinate-readout">
            <span>{formatCoordinatePickLabel(lastPick)}</span>
            {copyStatus ? <strong>{copyStatus}</strong> : null}
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
        {largeLoadWarning ? (
          <div className="ifcnative-thatopen-warning">{largeLoadWarning}</div>
        ) : null}
      </div>
      <div
        ref={containerRef}
        className={`ifcnative-thatopen-viewport${pickerActive ? " is-picking" : ""}`}
      >
        {pickerActive ? (
          <div className="ifcnative-thatopen-picker-hint">
            Punkt im Modell anklicken
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

const LARGE_IFC_WARNING_BYTES = 120 * 1024 * 1024;

function describeLargeIfcWarning(models: ThatOpenViewerModel[]) {
  const estimatedBytes = models.reduce(
    (total, model) =>
      total + (model.ifcBytes?.byteLength ?? model.ifcText.length),
    0,
  );
  if (estimatedBytes < LARGE_IFC_WARNING_BYTES) {
    return "";
  }
  return `Große IFC-Auswahl (${formatByteSize(estimatedBytes)}): Viewer lädt alle sichtbaren Modelle vollständig; Konvertierung kann spürbar dauern.`;
}

function formatByteSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
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
    onLog(line: string): void;
    onMoveSelected(delta: ViewerMoveDelta): void;
    onPickCoordinates(pick: ViewerCoordinatePick): void;
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
  const viewCube = createThatOpenViewCube(THREE, container, world.camera);
  const moveGizmo = createMoveGizmo(
    THREE,
    transformControlsModule.TransformControls,
    world.scene.three,
    world.camera.three,
    world.camera.controls,
    canvasFromRenderer(world.renderer),
    callbacks.onMoveSelected,
    (line) => callbacks.onLog(line),
    () => void fragments.core.update(true),
  );
  const coordinateCursor = createCoordinateCursor(THREE);
  world.scene.three.add(coordinateCursor.group, coordinateCursor.rayLine);

  const fragments = components.get(OBC.FragmentsManager);
  const fragmentsWorkerUrl = resolvePublicAssetUrl("fragments/worker.mjs");
  fragments.init(fragmentsWorkerUrl);
  const coreWithSettings = fragments.core as typeof fragments.core & {
    settings?: { autoCoordinate?: boolean };
  };
  if (coreWithSettings.settings) {
    coreWithSettings.settings.autoCoordinate = true;
  }

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

  async function syncModels(
    nextModels: ThatOpenViewerModel[],
    options?: { fitAfterLoad?: boolean },
  ) {
    const nextDocumentIds = new Set(
      nextModels.map((model) => model.documentId),
    );
    coordinateCursor.hide();
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
        (progress) =>
          callbacks.onStatus(formatFragmentConversionProgress(progress)),
      );
      callbacks.onLog(
        `viewer.convert({ engine: 'worker', file: '${nextModel.fileName}', ms: ${Math.round(converted.elapsedMs)} });`,
      );
      const model = await fragments.core.load(converted.fragments, {
        camera: world.camera.three,
        modelId,
      });
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

  async function highlight(documentId: string, localId: number) {
    const loaded = modelsByDocumentId.get(documentId);
    if (!loaded || !Number.isFinite(localId) || localId <= 0) {
      return;
    }
    await fragments.resetHighlight();
    await fragments.highlight(selectionMaterial, {
      [loaded.model.modelId]: new Set([localId]),
    });
    await fragments.core.update(true);
    await moveGizmo.updateSelection(localId, loaded.model);
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
    fit,
    highlight,
    hideCoordinateCursor: coordinateCursor.hide,
    resetCamera,
    setMoveGizmoEnabled: moveGizmo.setEnabled,
    syncModels,
  };
}

type TransformControlsConstructor =
  typeof import("three/addons/controls/TransformControls.js").TransformControls;

interface CameraControlsLike {
  enabled: boolean;
}

interface FragmentModelLike {
  getMergedBox(localIds: number[]): Promise<import("three").Box3>;
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
  scene: import("three").Scene,
  camera: import("three").Camera,
  cameraControls: CameraControlsLike,
  canvas: HTMLCanvasElement,
  onMoveSelected: (delta: ViewerMoveDelta) => void,
  onLog: (line: string) => void,
  onSceneChange: () => void,
) {
  const anchor = new THREE.Object3D();
  anchor.name = "IFCnativeMoveGizmoAnchor";
  scene.add(anchor);

  const controls = new TransformControls(camera, canvas);
  controls.setMode("translate");
  controls.setSpace("world");
  controls.size = 0.85;
  controls.showXY = false;
  controls.showYZ = false;
  controls.showXZ = false;
  const helper = controls.getHelper();
  helper.name = "IFCnativeMoveGizmo";
  helper.visible = false;
  scene.add(helper);
  const previewBox = new THREE.Box3Helper(
    new THREE.Box3(),
    new THREE.Color(0xf59e0b),
  );
  previewBox.name = "IFCnativeMovePreviewBox";
  previewBox.visible = false;
  scene.add(previewBox);

  let enabled = false;
  let dragging = false;
  let selectedLocalId = 0;
  let selectedModel: FragmentModelLike | null = null;
  const dragStart = new THREE.Vector3();
  const selectedBox = new THREE.Box3();

  const updateSelection = async (
    localId: number,
    model: FragmentModelLike | null,
  ) => {
    selectedLocalId = localId;
    selectedModel = model;
    if (!enabled || !model || !Number.isFinite(localId) || localId <= 0) {
      controls.detach();
      helper.visible = false;
      previewBox.visible = false;
      return;
    }
    const box = await model.getMergedBox([localId]).catch(() => undefined);
    if (!box || box.isEmpty()) {
      controls.detach();
      helper.visible = false;
      previewBox.visible = false;
      return;
    }
    selectedBox.copy(box);
    previewBox.box.copy(selectedBox);
    previewBox.visible = false;
    box.getCenter(anchor.position);
    controls.attach(anchor);
    helper.visible = true;
    onSceneChange();
  };

  const setEnabled = async (nextEnabled: boolean) => {
    enabled = nextEnabled;
    if (!enabled) {
      controls.detach();
      helper.visible = false;
      previewBox.visible = false;
      onSceneChange();
      return;
    }
    await updateSelection(selectedLocalId, selectedModel);
  };

  const onDraggingChanged = (event: { value: unknown }) => {
    dragging = Boolean(event.value);
    cameraControls.enabled = !dragging;
  };
  const onMouseDown = () => {
    dragStart.copy(anchor.position);
    previewBox.box.copy(selectedBox);
    previewBox.visible = true;
    onSceneChange();
  };
  const onMouseUp = () => {
    const delta = anchor.position.clone().sub(dragStart);
    previewBox.visible = false;
    if (delta.lengthSq() < 0.000001) {
      onSceneChange();
      return;
    }
    onMoveSelected({ x: delta.x, y: delta.y, z: delta.z });
    onLog(
      `viewer.moveGizmo.delta({ dx: ${formatCoordinate(delta.x)}, dy: ${formatCoordinate(delta.y)}, dz: ${formatCoordinate(delta.z)} });`,
    );
    onSceneChange();
  };
  const onChange = () => {
    if (dragging) {
      previewBox.box
        .copy(selectedBox)
        .translate(anchor.position.clone().sub(dragStart));
      previewBox.visible = true;
    }
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
    worldDispose(previewBox);
    previewBox.removeFromParent();
    helper.removeFromParent();
    anchor.removeFromParent();
  };

  return {
    dispose,
    isDragging: () => dragging,
    setEnabled,
    updateSelection,
  };
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
