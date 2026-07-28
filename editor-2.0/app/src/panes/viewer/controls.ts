/**
 * Maus-/Zeigersteuerung des Viewer-Canvas. Der Renderer bringt keine
 * Kamerasteuerung mit — Orbit/Pan/Zoom laufen über den `ViewerHandle`.
 *
 * Links ziehen  = Orbit, Mitte/Rechts oder Shift+Links = Pan, Rad = Zoom.
 * Ein Klick ohne nennenswerte Bewegung löst Picking aus.
 */
import type { ViewerHandle } from "../../core/viewer";

/** Pixel-Toleranz, bis zu der ein Zeigerdruck noch als Klick zählt. */
const CLICK_SLOP = 4;

export interface ControlCallbacks {
  /** Klick auf Geometrie oder ins Leere (CSS-Pixel relativ zum Canvas). */
  onPick(x: number, y: number, additive: boolean): void;
}

export function attachViewerControls(
  canvas: HTMLCanvasElement,
  handle: ViewerHandle,
  callbacks: ControlCallbacks,
): () => void {
  let activePointer: number | null = null;
  let mode: "orbit" | "pan" | null = null;
  let lastX = 0;
  let lastY = 0;
  let travelled = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    mode = event.button === 0 && !event.shiftKey ? "orbit" : "pan";
    lastX = event.clientX;
    lastY = event.clientY;
    travelled = 0;
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (activePointer !== event.pointerId || !mode) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    travelled += Math.abs(dx) + Math.abs(dy);
    if (mode === "orbit") handle.orbit(dx, dy);
    else handle.pan(dx, dy);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (activePointer !== event.pointerId) return;
    const wasClick = travelled <= CLICK_SLOP && event.button === 0;
    activePointer = null;
    mode = null;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (!wasClick) return;
    const rect = canvas.getBoundingClientRect();
    callbacks.onPick(
      event.clientX - rect.left,
      event.clientY - rect.top,
      event.ctrlKey || event.metaKey,
    );
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    handle.zoom(event.deltaY, event.clientX - rect.left, event.clientY - rect.top);
  };

  const onContextMenu = (event: MouseEvent): void => event.preventDefault();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
  };
}
