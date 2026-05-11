import { useEffect, useRef, useState } from "react";

import type { ThatOpenViewerProps } from "./that-open-viewer";

type ViewerRuntime = Awaited<ReturnType<typeof createThatOpenRuntime>>;

export default function ThatOpenViewer({
  fileName,
  ifcBytes,
  ifcText,
  selectedId,
  selectedName,
  onLog,
  onMoveSelected,
  onSelect,
}: ThatOpenViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const selectedRef = useRef(selectedId);
  const onLogRef = useRef(onLog);
  const onSelectRef = useRef(onSelect);
  const [runtimeReady, setRuntimeReady] = useState(0);
  const [modelReady, setModelReady] = useState(0);
  const [status, setStatus] = useState("Starting ThatOpen viewer...");
  const [error, setError] = useState("");

  selectedRef.current = selectedId;
  onLogRef.current = onLog;
  onSelectRef.current = onSelect;

  useEffect(() => {
    let disposed = false;

    async function init() {
      if (!containerRef.current) {
        return;
      }
      setStatus("Initializing ThatOpen Components...");
      const runtime = await createThatOpenRuntime(containerRef.current, {
        getSelectedId: () => selectedRef.current,
        onError: (message) => {
          setError(message);
          setStatus("ThatOpen viewer error");
        },
        onLog: (line) => onLogRef.current?.(line),
        onSelect: (id, source) => onSelectRef.current(id, source),
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
    void runtime
      .load(ifcText, fileName, ifcBytes)
      .then(async () => {
        if (cancelled) {
          return;
        }
        setModelReady((value) => value + 1);
        await runtime.highlight(selectedRef.current);
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

    return () => {
      cancelled = true;
    };
  }, [fileName, ifcBytes, ifcText, runtimeReady]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !modelReady) {
      return;
    }
    void runtime.highlight(selectedId);
  }, [modelReady, selectedId]);

  return (
    <div className="ifcnative-thatopen-shell">
      <div className="ifcnative-thatopen-toolbar">
        <div className="ifcnative-thatopen-actions">
          <button
            className="ifcnative-thatopen-button"
            type="button"
            onClick={() => void runtimeRef.current?.fit()}
          >
            Fit
          </button>
          <button
            className="ifcnative-thatopen-button"
            type="button"
            onClick={() => void runtimeRef.current?.resetCamera()}
          >
            Reset
          </button>
        </div>
        <div
          className="ifcnative-thatopen-nudge-panel"
          title={`Draft placement nudges for #${selectedId}${selectedName ? ` ${selectedName}` : ""}`}
        >
          <span className="ifcnative-thatopen-nudge-label">
            Move #{selectedId}
          </span>
          <button
            className="ifcnative-thatopen-button"
            type="button"
            onClick={() => onMoveSelected?.({ x: -0.25 })}
          >
            −X
          </button>
          <button
            className="ifcnative-thatopen-button"
            type="button"
            onClick={() => onMoveSelected?.({ x: 0.25 })}
          >
            +X
          </button>
          <button
            className="ifcnative-thatopen-button"
            type="button"
            onClick={() => onMoveSelected?.({ y: -0.25 })}
          >
            −Y
          </button>
          <button
            className="ifcnative-thatopen-button"
            type="button"
            onClick={() => onMoveSelected?.({ y: 0.25 })}
          >
            +Y
          </button>
          <button
            className="ifcnative-thatopen-button"
            type="button"
            onClick={() => onMoveSelected?.({ z: -0.25 })}
          >
            −Z
          </button>
          <button
            className="ifcnative-thatopen-button"
            type="button"
            onClick={() => onMoveSelected?.({ z: 0.25 })}
          >
            +Z
          </button>
        </div>
      </div>
      <div ref={containerRef} className="ifcnative-thatopen-viewport">
        <div className="ifcnative-thatopen-status">{status}</div>
        {error ? <div className="ifcnative-thatopen-error">{error}</div> : null}
      </div>
    </div>
  );
}

async function createThatOpenRuntime(
  container: HTMLDivElement,
  callbacks: {
    getSelectedId(): number;
    onError(message: string): void;
    onLog(line: string): void;
    onSelect(id: number, source?: string): void;
    onStatus(message: string): void;
  },
) {
  const [OBC, THREE, FRAGS] = await Promise.all([
    import("@thatopen/components"),
    import("three"),
    import("@thatopen/fragments"),
  ]);

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
  world.camera = new OBC.SimpleCamera(components);

  components.init();
  world.scene.setup();
  world.scene.three.background = new THREE.Color(0xf8fafc);
  world.camera.controls.setLookAt(8, 6, 8, 0, 0, 0);

  const grids = components.get(OBC.Grids);
  grids.create(world);

  const fragments = components.get(OBC.FragmentsManager);
  const fragmentsWorkerUrl = `${globalThis.location.origin}/fragments/worker.mjs`;
  fragments.init(fragmentsWorkerUrl);

  const ifcLoader = components.get(OBC.IfcLoader);
  await ifcLoader.setup({
    autoSetWasm: false,
    wasm: {
      absolute: true,
      path: "/wasm/",
    },
  });

  const selectionMaterial = {
    color: new THREE.Color(0xffb703),
    customId: "ifcnative-selection",
    opacity: 0.95,
    renderedFaces: FRAGS.RenderedFaces.TWO,
    transparent: false,
  };

  let model: Awaited<ReturnType<typeof ifcLoader.load>> | null = null;
  let currentLoadKey = "";
  let loadCounter = 0;
  const encoder = new TextEncoder();
  const resizeObserver = new ResizeObserver(() => {
    world.renderer?.resize();
  });
  resizeObserver.observe(container);

  const selectFromPointer = async (event: PointerEvent) => {
    if (!model || !world.renderer) {
      return;
    }
    const canvas = world.renderer.three.domElement;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const result = await fragments.raycast({
      camera: world.camera.three,
      dom: canvas,
      mouse,
    });
    const localId = result?.localId;
    if (!localId || !Number.isFinite(localId)) {
      return;
    }
    callbacks.onSelect(localId, "thatopen");
    callbacks.onLog(
      `viewer.select({ engine: 'thatopen', localId: ${localId} });`,
    );
    await highlight(localId);
  };

  container.addEventListener("pointerup", selectFromPointer);

  async function load(
    ifcText: string,
    fileName: string,
    ifcBytes?: ArrayBuffer | null,
  ) {
    const loadKey = `${fileName}:${ifcText.length}:${ifcText.slice(0, 256)}:${ifcText.slice(-256)}`;
    if (currentLoadKey === loadKey) {
      callbacks.onStatus("ThatOpen model already loaded");
      return;
    }
    currentLoadKey = loadKey;

    callbacks.onStatus("Disposing previous ThatOpen model...");
    if (model) {
      model.object.removeFromParent();
      await model.dispose();
      model = null;
    }
    await fragments.resetHighlight().catch(() => undefined);

    callbacks.onStatus("Converting IFC to ThatOpen fragments...");
    const modelId = `${toModelId(fileName)}-${++loadCounter}`;
    const source = ifcBytes
      ? new Uint8Array(ifcBytes)
      : encoder.encode(ifcText);
    model = await ifcLoader.load(source, true, modelId, {
      instanceCallback: (importer) => {
        importer.addAllAttributes();
        importer.addAllRelations();
      },
    });
    model.useCamera(world.camera.three);
    world.scene.three.add(model.object);
    await fragments.core.update(true);
    await fit();
    callbacks.onStatus(`ThatOpen loaded ${fileName}`);
    callbacks.onLog(
      `viewer.load({ engine: 'thatopen', modelId: '${model.modelId}' });`,
    );
  }

  async function highlight(localId: number) {
    if (!model || !Number.isFinite(localId) || localId <= 0) {
      return;
    }
    await fragments.resetHighlight();
    await fragments.highlight(selectionMaterial, {
      [model.modelId]: new Set([localId]),
    });
    await fragments.core.update(true);
  }

  async function fit() {
    if (!model) {
      return;
    }
    await world.camera.fitToItems();
  }

  async function resetCamera() {
    await world.camera.controls.setLookAt(8, 6, 8, 0, 0, 0, true);
    if (model) {
      await fragments.core.update(true);
      await highlight(callbacks.getSelectedId());
    }
  }

  async function dispose() {
    container.removeEventListener("pointerup", selectFromPointer);
    resizeObserver.disconnect();
    if (model) {
      model.object.removeFromParent();
      await model.dispose().catch(() => undefined);
      model = null;
    }
    fragments.dispose();
    ifcLoader.dispose();
    components.dispose();
  }

  return {
    dispose,
    fit,
    highlight,
    load,
    resetCamera,
  };
}

function toModelId(fileName: string) {
  return (
    fileName
      .replace(/\.ifc$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-|-$/g, "") || "ifcnative"
  );
}

function stringifyError(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
