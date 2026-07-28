/**
 * 3D-Viewer-Anbindung (WebGPU über @ifc-lite/renderer, Streaming-Geometrie).
 * Fällt sauber auf eine Statusmeldung zurück, wenn WebGPU fehlt (Risiko R1) —
 * der Editor bleibt ohne 3D voll funktionsfähig.
 */

export interface ViewerHandle {
  dispose(): void;
}

export type ViewerStatus =
  | { kind: "loading"; meshCount: number }
  | { kind: "ready"; meshCount: number }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; reason: string };

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
    return { dispose() {} };
  }
  try {
    const [{ Renderer }, { GeometryProcessor }] = await Promise.all([
      import("@ifc-lite/renderer"),
      import("@ifc-lite/geometry"),
    ]);
    const renderer = new Renderer(canvas);
    const geometry = new GeometryProcessor();
    await Promise.all([renderer.init(), geometry.init()]);

    let meshCount = 0;
    let disposed = false;
    (async () => {
      // Streaming-First: Batches laden, während der Rest noch tesselliert wird.
      for await (const event of geometry.processAdaptive(ifcBytes)) {
        if (disposed) return;
        if (event.type === "batch") {
          meshCount += event.meshes.length;
          renderer.loadGeometry(event.meshes);
          renderer.requestRender();
          onStatus({ kind: "loading", meshCount });
        }
      }
      if (!disposed) onStatus({ kind: "ready", meshCount });
    })().catch((error: unknown) => {
      if (!disposed)
        onStatus({ kind: "error", reason: String(error) });
    });

    return {
      dispose() {
        disposed = true;
      },
    };
  } catch (error) {
    onStatus({ kind: "error", reason: String(error) });
    return { dispose() {} };
  }
}
