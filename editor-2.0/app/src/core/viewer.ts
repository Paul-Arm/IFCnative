/**
 * 3D-Viewer-Anbindung (WebGPU über @ifc-lite/renderer, Streaming-Geometrie).
 * Fällt sauber auf eine Statusmeldung zurück, wenn WebGPU fehlt (Risiko R1) —
 * der Editor bleibt ohne 3D voll funktionsfähig.
 *
 * Der Renderer besitzt KEINE eigene Render-/Kameraschleife: `requestRender()`
 * setzt nur ein Dirty-Flag. Diese Datei betreibt daher die rAF-Schleife,
 * hält den Zustand der Pro-Frame-Render-Optionen und stellt dem Pane eine
 * schmale, typisierte Fassade (`ViewerHandle`) zur Verfügung.
 */
import type { CoordinateInfo, GeometryProcessor } from "@ifc-lite/geometry";
import type { RenderOptions, Renderer, SectionPlane } from "@ifc-lite/renderer";

export type ViewerColor = [number, number, number, number];

/** Benannte Ansichten der Toolbar. */
export type PresetView = "iso" | "top" | "front" | "left";

/** Alles, was pro Frame in `renderer.render()` fließt. */
export interface ViewerViewState {
  selectedIds: ReadonlySet<number>;
  hiddenIds: ReadonlySet<number>;
  isolatedIds: ReadonlySet<number> | null;
  sectionPlane: SectionPlane | null;
  xray: boolean;
}

/**
 * Roh-Zugriff der Overlay-Werkzeuge (M9: Verschiebe-Gizmo, Koordinaten-Pick)
 * auf Renderer-APIs (raycastScene, Camera.projectToScreen/unprojectToRay,
 * Scene.getEntityBoundingBox). Bewusst roh statt einzeln gespiegelt, damit
 * diese Fassade schlank bleibt — die Overlay-Logik lebt in panes/viewer/**.
 */
export interface ViewerOverlayAccess {
  renderer: Renderer;
  /** true, solange noch Streaming-Fragmente gezeichnet werden. */
  isStreaming(): boolean;
  /** RTC-Ursprungsverschiebung (IFC Z-up, Meter); 0/0/0 ohne Großkoordinaten. */
  originShift(): { x: number; y: number; z: number };
}

export interface ViewerHandle {
  dispose(): void;
  /** Render-Optionen teilweise setzen; löst genau einen Frame aus. */
  apply(patch: Partial<ViewerViewState>): void;
  /** Farb-Overrides der Lens (null = zurücksetzen). */
  setColorOverrides(overrides: ReadonlyMap<number, ViewerColor> | null): void;
  /** Klick-Picking in CSS-Pixeln relativ zum Canvas. */
  pick(x: number, y: number): Promise<number | null>;
  zoomToModel(): void;
  /** true, wenn eine Bounding-Box gefunden und die Kamera bewegt wurde. */
  focusEntity(expressId: number): boolean;
  presetView(view: PresetView): void;
  orbit(dx: number, dy: number): void;
  pan(dx: number, dy: number): void;
  zoom(delta: number, x: number, y: number): void;
  resize(width: number, height: number): void;
  /** Overlay-Zugriff (M9); null ohne laufenden Renderer (IDLE-Handle). */
  overlay(): ViewerOverlayAccess | null;
}

export type ViewerStatus =
  | { kind: "loading"; meshCount: number }
  | { kind: "ready"; meshCount: number }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; reason: string };

const IDLE: ViewerHandle = {
  dispose() {},
  apply() {},
  setColorOverrides() {},
  async pick() {
    return null;
  },
  zoomToModel() {},
  focusEntity() {
    return false;
  },
  presetView() {},
  orbit() {},
  pan() {},
  zoom() {},
  resize() {},
  overlay() {
    return null;
  },
};

export async function startViewer(
  canvas: HTMLCanvasElement,
  ifcBytes: Uint8Array,
  onStatus: (status: ViewerStatus) => void,
): Promise<ViewerHandle> {
  if (!("gpu" in navigator)) {
    onStatus({
      kind: "unavailable",
      reason:
        "WebGPU ist in dieser Umgebung nicht verfügbar (R1) — 3D-Ansicht deaktiviert.",
    });
    return IDLE;
  }
  try {
    const [{ Renderer }, { GeometryProcessor }] = await Promise.all([
      import("@ifc-lite/renderer"),
      import("@ifc-lite/geometry"),
    ]);
    const renderer = new Renderer(canvas);
    const geometry = new GeometryProcessor();
    await Promise.all([renderer.init(), geometry.init()]);
    return createSession(renderer, geometry, canvas, ifcBytes, onStatus);
  } catch (error) {
    onStatus({ kind: "error", reason: String(error) });
    return IDLE;
  }
}

function buildOptions(
  view: ViewerViewState,
  streaming: boolean,
): RenderOptions {
  const options: RenderOptions = {
    selectedIds: new Set(view.selectedIds),
    hiddenIds: new Set(view.hiddenIds),
    isolatedIds: view.isolatedIds ? new Set(view.isolatedIds) : null,
    isStreaming: streaming,
  };
  if (view.sectionPlane) options.sectionPlane = view.sectionPlane;
  if (view.xray) {
    // Ghost-Kontext: alles außer der Auswahl wird transparent (Auswahl ist
    // laut Renderer-Vertrag immer von ghostAlpha ausgenommen).
    options.ghostExceptIds = new Set();
    options.ghostAlpha = 0.12;
  }
  return options;
}

function createSession(
  renderer: Renderer,
  geometry: GeometryProcessor,
  canvas: HTMLCanvasElement,
  ifcBytes: Uint8Array,
  onStatus: (status: ViewerStatus) => void,
): ViewerHandle {
  const camera = renderer.getCamera();
  const view: ViewerViewState = {
    selectedIds: new Set<number>(),
    hiddenIds: new Set<number>(),
    isolatedIds: null,
    sectionPlane: null,
    xray: false,
  };
  let options = buildOptions(view, true);
  let disposed = false;
  let streaming = true;
  /** Koordinaten-Kontext des Geometrie-Laufs (originShift bei Großkoordinaten). */
  let coordInfo: CoordinateInfo | null = null;
  let cameraTouched = false;
  let frame = 0;
  let last = performance.now();

  const tick = (): void => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    const animating = camera.update(dt);
    if (animating || renderer.consumeRenderRequest()) renderer.render(options);
  };
  frame = requestAnimationFrame(tick);

  const unsubscribeLost = renderer.onDeviceLost((info) => {
    if (!disposed) onStatus({ kind: "error", reason: `GPU verloren: ${info.message}` });
  });

  const refresh = (): void => {
    options = buildOptions(view, streaming);
    renderer.requestRender();
  };

  void (async () => {
    let meshCount = 0;
    try {
      // Streaming-First: Batches laden, während der Rest noch tesselliert wird.
      for await (const event of geometry.processAdaptive(ifcBytes)) {
        if (disposed) return;
        // originShift für die Pick-/Gizmo-Overlays merken (M9): Batch-Events
        // tragen sie optional, das complete-Event verbindlich.
        if (event.type === "complete") coordInfo = event.coordinateInfo;
        if (event.type !== "batch") continue;
        if (event.coordinateInfo) coordInfo = event.coordinateInfo;
        meshCount += event.meshes.length;
        // isStreaming = true: nur Fragment-Batches statt O(N²)-Rebatching.
        renderer.addMeshes(event.meshes, true);
        if (meshCount > 0 && !cameraTouched) renderer.fitToView();
        renderer.requestRender();
        onStatus({ kind: "loading", meshCount });
      }
      if (disposed) return;
      streaming = false;
      // Fragmente zu kompakten Batches verschmelzen (Pflicht nach Streaming).
      const device = renderer.getGPUDevice();
      const pipeline = renderer.getPipeline();
      if (device && pipeline)
        await renderer.getScene().finalizeStreamingAsync(device, pipeline);
      if (disposed) return;
      if (!cameraTouched) renderer.fitToView();
      refresh();
      onStatus({ kind: "ready", meshCount });
    } catch (error) {
      if (!disposed) onStatus({ kind: "error", reason: String(error) });
    }
  })();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribeLost();
      renderer.destroy();
      geometry.dispose();
    },

    apply(patch) {
      Object.assign(view, patch);
      refresh();
    },

    setColorOverrides(overrides) {
      const scene = renderer.getScene();
      const device = renderer.getGPUDevice();
      const pipeline = renderer.getPipeline();
      if (!overrides || overrides.size === 0) {
        scene.clearColorOverrides();
      } else if (device && pipeline) {
        scene.setColorOverrides(new Map(overrides), device, pipeline);
      } else {
        return;
      }
      // GPU-instanzierte Vorkommen liegen außerhalb der Batch-Overrides.
      scene.setInstancedColorOverrides(overrides && overrides.size > 0 ? overrides : null);
      renderer.requestRender();
    },

    async pick(x, y) {
      const hit = await renderer.pick(x, y, {
        hiddenIds: options.hiddenIds,
        isolatedIds: options.isolatedIds,
        isStreaming: streaming,
      });
      return hit ? hit.expressId : null;
    },

    zoomToModel() {
      const box = renderer.getModelBounds();
      cameraTouched = true;
      if (box) void camera.zoomExtent(box.min, box.max, 300);
      else renderer.fitToView();
      renderer.requestRender();
    },

    focusEntity(expressId) {
      const scene = renderer.getScene();
      const box =
        scene.getEntityBoundingBox(expressId) ??
        scene.getInstancedEntityBounds(expressId);
      if (!box) return false;
      cameraTouched = true;
      camera.setOrbitCenter({
        x: (box.min.x + box.max.x) / 2,
        y: (box.min.y + box.max.y) / 2,
        z: (box.min.z + box.max.z) / 2,
      });
      void camera.frameBounds(box.min, box.max, 300);
      renderer.requestRender();
      return true;
    },

    presetView(preset) {
      const box = renderer.getModelBounds();
      cameraTouched = true;
      if (preset === "iso") {
        if (box) camera.fitToBounds(box.min, box.max);
        else renderer.fitToView();
      } else {
        camera.setPresetView(preset, box ?? undefined);
      }
      renderer.requestRender();
    },

    orbit(dx, dy) {
      cameraTouched = true;
      camera.orbit(dx, dy);
      renderer.requestRender();
    },

    pan(dx, dy) {
      cameraTouched = true;
      camera.pan(dx, dy);
      renderer.requestRender();
    },

    zoom(delta, x, y) {
      cameraTouched = true;
      const scale = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
      camera.zoom(delta, false, x * scale, y * scale, canvas.width, canvas.height);
      renderer.requestRender();
    },

    resize(width, height) {
      renderer.resize(width, height);
      renderer.requestRender();
    },

    overlay() {
      return {
        renderer,
        isStreaming: () => streaming,
        originShift: () => coordInfo?.originShift ?? { x: 0, y: 0, z: 0 },
      };
    },
  };
}
