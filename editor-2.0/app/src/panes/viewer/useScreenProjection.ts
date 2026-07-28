/**
 * Welt→Bildschirm-Projektion für die Canvas-Overlays (M9).
 *
 * Der Renderer hat keine Overlay-/Gizmo-API — Gizmo und Pick-Markierung
 * zeichnen deshalb in einem absolut positionierten SVG ÜBER dem
 * WebGPU-Canvas. Dieser Hook projiziert Renderer-Weltpunkte pro Frame über
 * `Camera.projectToScreen` in CSS-Pixel. Eine eigene rAF-Schleife ist nötig,
 * weil Kamerabewegungen (Orbit/Pan/Zoom/Animation) keinen React-State
 * berühren; aktualisiert wird nur bei sichtbarer Änderung (> 0.4 px).
 *
 * `projectToScreen`/`unprojectToRay` rechnen rein verhältnisbasiert
 * (screen/width), daher dürfen CSS-Maße (clientWidth/Height) direkt als
 * Canvas-Maße übergeben werden — das Ergebnis ist dann bereits in CSS-Pixeln.
 */
import { useEffect, useState } from "react";
import type { ViewerOverlayAccess } from "../../core/viewer";
import type { WorldVec3 } from "./worldCoords";

export type ScreenPoint = { x: number; y: number } | null;

const MOVED = 0.4;

function changed(a: ScreenPoint[], b: ScreenPoint[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if ((p === null) !== (q === null)) return true;
    if (p && q && (Math.abs(p.x - q.x) > MOVED || Math.abs(p.y - q.y) > MOVED))
      return true;
  }
  return false;
}

/**
 * Projiziert `points` (Renderer-Rahmen, Y-up, Meter) fortlaufend auf den
 * Canvas. `points` muss referenzstabil gememot sein, sonst startet die
 * Schleife jeden Render neu.
 */
export function useScreenProjection(
  access: ViewerOverlayAccess | null,
  canvas: HTMLCanvasElement | null,
  points: readonly WorldVec3[],
): ScreenPoint[] {
  const [screen, setScreen] = useState<ScreenPoint[]>([]);

  useEffect(() => {
    if (!access || !canvas || points.length === 0) {
      setScreen([]);
      return;
    }
    const camera = access.renderer.getCamera();
    let frame = 0;
    let current: ScreenPoint[] = [];
    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const next = points.map((p) => camera.projectToScreen(p, width, height));
      if (changed(current, next)) {
        current = next;
        setScreen(next);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [access, canvas, points]);

  return screen;
}
