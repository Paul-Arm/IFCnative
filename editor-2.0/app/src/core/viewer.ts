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
import type {
  CoordinateInfo,
  GeometryProcessor,
  MeshData,
} from "@ifc-lite/geometry";
import type {
  ClipBox,
  RenderOptions,
  Renderer,
  SectionPlane,
} from "@ifc-lite/renderer";

export type ViewerColor = [number, number, number, number];

/** Benannte Ansichten der Toolbar. */
export type PresetView = "iso" | "top" | "front" | "left";

/** Alles, was pro Frame in `renderer.render()` fließt. */
export interface ViewerViewState {
  selectedIds: ReadonlySet<number>;
  hiddenIds: ReadonlySet<number>;
  isolatedIds: ReadonlySet<number> | null;
  sectionPlane: SectionPlane | null;
  /** Achsparallele Clip-Box (Renderer-Weltraum); null = aus. Unabhängig von
   *  der Schnittebene — der Renderer erlaubt beide gleichzeitig (M9). */
  clipBox: ClipBox | null;
  xray: boolean;
  /** Himmels-Gradient des Renderers (statt flacher clearColor). */
  sky: boolean;
  /** Bodenraster unterhalb des Modells. */
  grid: boolean;
  /**
   * Objekte, die während einer Transform-Vorschau VERSTECKT werden (die
   * Vorschau-Kopie übernimmt die Darstellung). Bewusst über hiddenIds statt
   * transparencyOverrides gelöst: Der Renderer nimmt AUSGEWÄHLTE Objekte von
   * Alpha-Overrides aus (alphaForMesh/alphaForBatch) — und das Gizmo-Ziel ist
   * per Definition ausgewählt, das Original bliebe also voll sichtbar stehen
   * und die Vorschau wirkte „kaputt". Der hiddenIds-Pfad deckt dagegen
   * Batches, Instanzen UND die Selektions-Highlight-Meshes ab (Hide-Werkzeug).
   */
  previewHidden: ReadonlySet<number> | null;
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
  /**
   * Bounding-Box einer Entity im Renderer-Rahmen aus dem Geometrie-Cache —
   * Fallback für Fälle, in denen die Szene (farb-gemergte Batches) keine
   * per-Entity-Bounds liefert. null ohne gecachte Geometrie.
   */
  entityBounds(expressId: number): {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } | null;
  /**
   * Live-Vorschau (M10): Kopie der Entity-Geometrie als frei transformierbare
   * Meshes einhängen. Liefert false, wenn keine gecachte Geometrie vorliegt
   * (Cache-Deckel bei sehr großen Modellen) — dann bleibt nur die Δ-Anzeige.
   */
  startTransformPreview(expressId: number): boolean;
  /**
   * Vorschau-Transform um den Pivot (Renderer-Rahmen, Meter): erst Skalierung,
   * dann Yaw um die Renderer-Y-Achse, dann Translation.
   */
  updateTransformPreview(transform: {
    pivot: { x: number; y: number; z: number };
    delta?: { x: number; y: number; z: number };
    yawRad?: number;
    scale?: { x: number; y: number; z: number };
  }): void;
  /** Vorschau-Meshes entfernen (Commit oder Abbruch). */
  endTransformPreview(): void;
  /**
   * Committete VERSCHIEBUNG direkt in die Szene spiegeln (Renderer-Delta,
   * Meter) — das Objekt bleibt nach dem Loslassen an der neuen Stelle,
   * ohne teuren Voll-Rebuild. false, wenn die Szene das für diese Entity
   * nicht kann (farb-gemergte Batches) — dann zeigt erst „Neu berechnen"
   * den Stand. Aufrufer ist der Szene-Spiegel (panes/viewer/sceneMirror):
   * er ruft die Inverse bei Undo, damit kein Geister-Offset zurückbleibt.
   */
  applyCommittedDelta(
    expressId: number,
    delta: { x: number; y: number; z: number },
  ): boolean;
  /**
   * Committete ROTATION (Yaw, rad — Renderer-Y entspricht IFC-Z, Herleitung
   * gizmoMath) um den Pivot (Renderer-Rahmen, Meter) in die Szene spiegeln.
   * false bei farb-gemergten Batches und GPU-Instanzen (die Szene rotiert
   * nur flache Meshes) — dann zeigt erst „Neu berechnen" den Stand.
   */
  applyCommittedRotation(
    expressId: number,
    yawRad: number,
    pivot: { x: number; y: number; z: number },
  ): boolean;
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
  /** Modell-Bounds im Renderer-Rahmen (Y-up, Meter); null ohne Geometrie. */
  modelBounds(): {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } | null;
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
  modelBounds() {
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
  if (view.sky) {
    // Heller, freundlicher Himmel passend zur App (die Standardwerte des
    // Renderers sind deutlich dunkler): sanftes Blau oben, fast weißer
    // Horizont, heller Boden — entspricht dem hellen Viewer-Backdrop der
    // ersten React-App.
    options.environment = {
      skyEnabled: true,
      sky: {
        zenith: [0.62, 0.74, 0.88],
        horizon: [0.93, 0.95, 0.97],
        ground: [0.84, 0.85, 0.87],
      },
      ambientIntensity: 0.32,
    };
  }
  if (view.sectionPlane) options.sectionPlane = view.sectionPlane;
  if (view.clipBox?.enabled) options.clipBox = view.clipBox;
  if (view.xray) {
    // Ghost-Kontext: alles außer der Auswahl wird transparent (Auswahl ist
    // laut Renderer-Vertrag immer von ghostAlpha ausgenommen).
    options.ghostExceptIds = new Set();
    options.ghostAlpha = 0.12;
  }
  if (view.previewHidden && view.previewHidden.size > 0) {
    // Original während der Vorschau ausblenden (Begründung am Feld).
    for (const id of view.previewHidden) options.hiddenIds!.add(id);
  }
  return options;
}

/**
 * Bodenraster als Line-List (Renderer-Rahmen, Y-up) knapp unter dem Modell —
 * zweistufig wie in DCC-Tools: feines Raster um das Modell, grobes Raster
 * (10× Schritt) weit darüber hinaus. Der Teppich reicht mindestens 500 m,
 * bei großen Modellen das 20-fache der Modellgröße (gedeckelt) — aus
 * üblichen Kamerapositionen wirkt er damit unendlich; die Kante liegt
 * außer Sicht. Ein echtes Shader-Grid mit Distanz-Fade gibt der Renderer
 * nicht her (nur Line-Lists mit EINER Overlay-Farbe).
 */
function buildGridLines(bounds: {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}): Float32Array {
  const sizeX = bounds.max.x - bounds.min.x;
  const sizeZ = bounds.max.z - bounds.min.z;
  const size = Math.max(sizeX, sizeZ, 1);
  const step =
    [0.5, 1, 2, 5, 10, 20, 50, 100].find((s) => size / s <= 40) ?? 200;
  const y = bounds.min.y - 0.02;
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;
  const points: number[] = [];
  const push = (
    from: number,
    to: number,
    s: number,
    minA: number,
    maxA: number,
    xDir: boolean,
  ): void => {
    for (let v = Math.ceil(from / s) * s; v <= to + 1e-6; v += s) {
      if (xDir) points.push(v, y, minA, v, y, maxA);
      else points.push(minA, y, v, maxA, y, v);
    }
  };

  // Feines Raster: Modell + großzügiger Rand.
  const margin = Math.max(size * 0.75, step * 6);
  const fMinX = bounds.min.x - margin;
  const fMaxX = bounds.max.x + margin;
  const fMinZ = bounds.min.z - margin;
  const fMaxZ = bounds.max.z + margin;
  push(fMinX, fMaxX, step, fMinZ, fMaxZ, true);
  push(fMinZ, fMaxZ, step, fMinX, fMaxX, false);

  // Grobes Raster (10× Schritt) über den großen Teppich.
  const half = Math.min(Math.max(size * 20, 500), 4000);
  const coarse = step * 10;
  push(cx - half, cx + half, coarse, cz - half, cz + half, true);
  push(cz - half, cz + half, coarse, cx - half, cx + half, false);

  return new Float32Array(points);
}

/** Vorschau-Meshes tragen eine Sentinel-Id fern aller echten expressIds. */
const PREVIEW_EXPRESS_ID = 2_147_480_000;

/**
 * Cache-Deckel: oberhalb dieser Vertexzahl wird nicht mehr gecacht. Der
 * Cache hält nur REFERENZEN auf die ohnehin gestreamten MeshData-Arrays
 * (kein Kopieren) — die Grenze verhindert lediglich, dass sehr große
 * Modelle dauerhaft doppelt im Speicher bleiben.
 */
const PREVIEW_CACHE_VERTEX_LIMIT = 16_000_000;

/**
 * Spaltenmajor-4×4: T(pivot+delta) · R_y(yaw) · S · T(−pivot).
 * Exportiert für die Logiktests (tests/m10-preview) — WebGPU-frei.
 */
export function composePreviewMatrix(
  out: Float32Array,
  pivot: { x: number; y: number; z: number },
  delta: { x: number; y: number; z: number },
  yawRad: number,
  scale: { x: number; y: number; z: number },
): void {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  // Linearteil L = R_y(yaw) · S  (Y-up: Yaw dreht in der XZ-Ebene)
  const l00 = c * scale.x;
  const l02 = s * scale.z;
  const l11 = scale.y;
  const l20 = -s * scale.x;
  const l22 = c * scale.z;
  // Translation t = pivot + delta − L·pivot
  const tx = pivot.x + delta.x - (l00 * pivot.x + l02 * pivot.z);
  const ty = pivot.y + delta.y - l11 * pivot.y;
  const tz = pivot.z + delta.z - (l20 * pivot.x + l22 * pivot.z);
  out.set([l00, 0, l20, 0, 0, l11, 0, 0, l02, 0, l22, 0, tx, ty, tz, 1]);
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
    clipBox: null,
    xray: false,
    sky: true,
    grid: true,
    previewHidden: null,
  };
  let options = buildOptions(view, true);
  let disposed = false;
  let streaming = true;
  // Geometrie-Cache für die Live-Vorschau (M10): MeshData je Entity, bis der
  // Vertex-Deckel erreicht ist — dann fällt die Vorschau auf die Δ-Anzeige
  // zurück, statt den Speicher großer Modelle zu verdoppeln.
  const meshCache = new Map<number, MeshData[]>();
  let cachedVertices = 0;
  let cacheFull = false;
  /** true, solange Vorschau-Meshes in der Szene hängen. */
  let previewActive = false;

  /** Bodenraster hochladen bzw. entfernen (Renderer hält die Linien). */
  const syncGrid = (): void => {
    if (!view.grid) {
      renderer.clearGridLines3D();
      return;
    }
    const bounds = renderer.getModelBounds();
    if (!bounds) return;
    // Dezent: halbtransparentes Grau — auf dem hellen Boden des neuen
    // Himmels braucht es etwas mehr Kontrast als auf dunklem Grund; die
    // Overlay-Linien blenden mit src-alpha, MSAA glättet die Kanten.
    renderer.setOverlayLineColor([0.42, 0.44, 0.48, 0.32]);
    renderer.uploadGridLines3D(buildGridLines(bounds));
  };
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
        // MeshData für die Live-Vorschau merken (bis zum Vertex-Deckel).
        if (!cacheFull) {
          for (const mesh of event.meshes) {
            cachedVertices += mesh.positions.length / 3;
            if (cachedVertices > PREVIEW_CACHE_VERTEX_LIMIT) {
              meshCache.clear();
              cacheFull = true;
              break;
            }
            const list = meshCache.get(mesh.expressId) ?? [];
            list.push(mesh);
            meshCache.set(mesh.expressId, list);
          }
        }
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
      syncGrid();
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
      const gridChanged =
        "grid" in patch && patch.grid !== view.grid;
      Object.assign(view, patch);
      if (gridChanged) syncGrid();
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

        entityBounds(expressId) {
          const cached = meshCache.get(expressId);
          if (!cached || cached.length === 0) return null;
          const min = { x: Infinity, y: Infinity, z: Infinity };
          const max = { x: -Infinity, y: -Infinity, z: -Infinity };
          for (const mesh of cached) {
            const [ox, oy, oz] = mesh.origin ?? [0, 0, 0];
            const p = mesh.positions;
            for (let i = 0; i < p.length; i += 3) {
              const x = p[i] + ox;
              const y = p[i + 1] + oy;
              const z = p[i + 2] + oz;
              if (x < min.x) min.x = x;
              if (y < min.y) min.y = y;
              if (z < min.z) min.z = z;
              if (x > max.x) max.x = x;
              if (y > max.y) max.y = y;
              if (z > max.z) max.z = z;
            }
          }
          return Number.isFinite(min.x) ? { min, max } : null;
        },

        startTransformPreview(expressId) {
          const cached = meshCache.get(expressId);
          if (!cached || cached.length === 0) return false;
          if (previewActive) return true;
          // Kopien mit Sentinel-Id einhängen; `hydrated` zurücksetzen, damit
          // `disposeHydratedMeshesExcept` sie nicht beim nächsten Frame frisst.
          for (const mesh of cached) {
            renderer.createMeshFromData({
              ...mesh,
              expressId: PREVIEW_EXPRESS_ID,
            });
          }
          for (const mesh of renderer.getScene().getMeshes()) {
            if (mesh.expressId === PREVIEW_EXPRESS_ID) mesh.hydrated = false;
          }
          // GPU-Ressourcen sofort anlegen (render() täte es erst im nächsten
          // Frame — so ist die Vorschau garantiert ab dem ersten Drag-Tick da).
          renderer.ensureMeshResources();
          previewActive = true;
          // Original ausblenden — die Vorschau übernimmt die Darstellung.
          view.previewHidden = new Set([expressId]);
          refresh();
          return true;
        },

        updateTransformPreview({ pivot, delta, yawRad, scale }) {
          if (!previewActive) return;
          for (const mesh of renderer.getScene().getMeshes()) {
            if (mesh.expressId !== PREVIEW_EXPRESS_ID) continue;
            composePreviewMatrix(
              mesh.transform.m as Float32Array,
              pivot,
              delta ?? { x: 0, y: 0, z: 0 },
              yawRad ?? 0,
              scale ?? { x: 1, y: 1, z: 1 },
            );
          }
          renderer.requestRender();
        },

        endTransformPreview() {
          if (!previewActive) return;
          previewActive = false;
          renderer.getScene().removeMeshesForEntity(PREVIEW_EXPRESS_ID);
          view.previewHidden = null;
          refresh();
        },

        applyCommittedDelta(expressId, delta) {
          const scene = renderer.getScene();
          const vec: [number, number, number] = [delta.x, delta.y, delta.z];
          // translateMeshesForEntity mutiert `MeshData.positions` IN PLACE —
          // und der meshCache hält REFERENZEN auf genau diese Arrays. Der
          // Cache zieht also automatisch mit; eine zusätzliche origin-
          // Verschiebung würde Bounds und spätere Vorschauen DOPPELT
          // versetzen (Geister-Offset nach dem ersten Commit).
          const moved =
            scene.translateMeshesForEntity(expressId, vec) ||
            scene.translateInstancedEntity(expressId, vec);
          if (!moved) return false;
          const device = renderer.getGPUDevice();
          const pipeline = renderer.getPipeline();
          if (device && pipeline) scene.rebuildPendingBatches(device, pipeline);
          renderer.requestRender();
          return true;
        },

        applyCommittedRotation(expressId, yawRad, pivot) {
          const scene = renderer.getScene();
          // Rotiert nur flache Meshes (Szene-Vertrag); positions/normals
          // werden in place mutiert — der meshCache (geteilte Arrays) zieht
          // wie beim Verschieben automatisch mit.
          const rotated = scene.rotateMeshesForEntity(expressId, yawRad, [
            pivot.x,
            pivot.y,
            pivot.z,
          ]);
          if (!rotated) return false;
          const device = renderer.getGPUDevice();
          const pipeline = renderer.getPipeline();
          if (device && pipeline) scene.rebuildPendingBatches(device, pipeline);
          renderer.requestRender();
          return true;
        },
      };
    },

    modelBounds() {
      return renderer.getModelBounds();
    },
  };
}
