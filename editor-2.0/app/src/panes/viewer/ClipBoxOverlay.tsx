/**
 * Clip-Box-Overlay (M9): zeichnet die 12 Kanten der aktiven Clip-Box als
 * projizierte Linien in das SVG-Overlay ÜBER dem WebGPU-Canvas — gleiches
 * Muster wie MoveGizmo/PickMarker (useScreenProjection, der Renderer hat
 * keine Overlay-API). Kanten, deren Endpunkt hinter der Kamera liegt bzw.
 * nicht projizierbar ist, werden schlicht weggelassen.
 *
 * `ClipBoxLayer` bündelt Overlay + Regler-Panel für den ViewerPane.
 */
import { useMemo } from "react";
import type { ViewerOverlayAccess } from "../../core/viewer";
import ClipBoxPanel from "./ClipBoxPanel";
import { useSectionStore } from "./sectionStore";
import { BOX_EDGES, boxCorners, ifcBoxToRenderer, type AxisBox } from "./sliceMath";
import type { ClipBoxWiring } from "./useClipBox";
import { useScreenProjection } from "./useScreenProjection";

/** Kanten-Overlay + Panel, sichtbar solange die Clip-Box aktiv ist. */
export function ClipBoxLayer({
  access,
  canvas,
  clip,
}: {
  access: ViewerOverlayAccess;
  canvas: HTMLCanvasElement;
  clip: ClipBoxWiring;
}) {
  const boxEnabled = useSectionStore((s) => s.boxEnabled);
  if (!boxEnabled || !clip.boxIfc) return null;
  return (
    <>
      <ClipBoxOverlay access={access} canvas={canvas} boxIfc={clip.boxIfc} />
      {clip.rangeIfc && (
        <ClipBoxPanel
          boxIfc={clip.boxIfc}
          rangeIfc={clip.rangeIfc}
          onReset={clip.resetToModel}
        />
      )}
    </>
  );
}

export default function ClipBoxOverlay({
  access,
  canvas,
  boxIfc,
}: {
  access: ViewerOverlayAccess;
  canvas: HTMLCanvasElement;
  /** Aktive Clip-Box in IFC-Koordinaten (Meter). */
  boxIfc: AxisBox;
}) {
  // Ecken im Renderer-Rahmen; originShift ist je Viewer-Instanz konstant.
  const corners = useMemo(() => {
    const rendererBox = ifcBoxToRenderer(boxIfc, access.originShift());
    return boxCorners(rendererBox);
  }, [access, boxIfc]);

  const screen = useScreenProjection(access, canvas, corners);
  if (screen.length !== corners.length) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <svg
        width="100%"
        height="100%"
        style={{ display: "block", width: "100%", height: "100%" }}
        aria-label="Clip-Box-Kanten"
      >
        {BOX_EDGES.map(([a, b]) => {
          const p = screen[a];
          const q = screen[b];
          if (!p || !q) return null;
          return (
            <line
              key={`${a}-${b}`}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke="var(--accent, #4da3ff)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.9}
            />
          );
        })}
      </svg>
    </div>
  );
}
