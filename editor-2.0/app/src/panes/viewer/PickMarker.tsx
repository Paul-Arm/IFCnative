/**
 * 3D-Markierung des zuletzt gepickten Punkts (M9, Werkzeug „Koordinaten
 * picken"): ein Fadenkreuz am projizierten Weltpunkt, als SVG-Overlay über
 * dem WebGPU-Canvas (der Renderer hat keine Marker-API). Der Punkt liegt im
 * Store in IFC-Koordinaten (Z-up, Meter) und wird hier zurück in den
 * Renderer-Rahmen übersetzt, bevor er projiziert wird.
 */
import { useMemo } from "react";
import type { ViewerOverlayAccess } from "../../core/viewer";
import { ifcToRendererPoint, type WorldVec3 } from "./worldCoords";
import { useScreenProjection } from "./useScreenProjection";

const ARM = 9;

export default function PickMarker({
  access,
  canvas,
  point,
}: {
  access: ViewerOverlayAccess;
  canvas: HTMLCanvasElement;
  /** Gepickter Punkt in IFC-Koordinaten (Z-up, Meter). */
  point: WorldVec3;
}) {
  const points = useMemo(
    () => [ifcToRendererPoint(point, access.originShift())],
    [point, access],
  );
  const [screen] = useScreenProjection(access, canvas, points);
  if (!screen) return null;

  const { x, y } = screen;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <svg
        width="100%"
        height="100%"
        style={{ display: "block", width: "100%", height: "100%" }}
        aria-label="Gepickter Punkt"
      >
        <circle
          cx={x}
          cy={y}
          r={5}
          fill="none"
          stroke="var(--accent, #ffb224)"
          strokeWidth={1.5}
        />
        <line x1={x - ARM} y1={y} x2={x + ARM} y2={y} stroke="var(--accent, #ffb224)" strokeWidth={1.5} />
        <line x1={x} y1={y - ARM} x2={x} y2={y + ARM} stroke="var(--accent, #ffb224)" strokeWidth={1.5} />
      </svg>
    </div>
  );
}
