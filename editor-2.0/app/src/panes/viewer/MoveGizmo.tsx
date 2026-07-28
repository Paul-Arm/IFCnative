/**
 * Verschiebe-Gizmo (M9, Werkzeug „Verschieben", Taste W).
 *
 * Drei Achsenpfeile (IFC-X/Y/Z) am projizierten Bounding-Box-Zentrum des
 * ausgewählten Bauteils, gezeichnet als SVG-Overlay ÜBER dem WebGPU-Canvas
 * (der Renderer hat keine Gizmo-API). Drag auf einem Pfeil verschiebt
 * achsgebunden: Mausstrahl (Camera.unprojectToRay) gegen die Achsengerade,
 * Delta = Parameterdifferenz (gizmoMath.axisRayParam).
 *
 * Live-Vorschau NUR als Δ-Anzeige in der Statuszeile (onLiveDelta) — die
 * Szene stammt aus einem festen Byte-Stand; erst „Modell neu berechnen"
 * zeigt die neue Lage. Beim Loslassen läuft die Änderung als EditorCommand
 * (cmdMoveElement) durch die Pipeline; Esc bricht den Drag ab.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewerOverlayAccess } from "../../core/viewer";
import type { ModelSession } from "../../core/session";
import { useCommands } from "../../commands/pipeline";
import { cmdMoveElement } from "../../commands/geometryCommands";
import {
  GIZMO_AXES,
  axisRayParam,
  dragDeltaIfc,
  gizmoArmLength,
  isNoticeableDelta,
} from "./gizmoMath";
import { roundMm, type WorldVec3 } from "./worldCoords";
import { useScreenProjection } from "./useScreenProjection";

interface DragState {
  axisIndex: number;
  pointerId: number;
  startParam: number;
  delta: WorldVec3;
}

export default function MoveGizmo({
  access,
  canvas,
  docId,
  session,
  elementId,
  onLiveDelta,
  onDone,
  onBoundsMissing,
}: {
  access: ViewerOverlayAccess;
  canvas: HTMLCanvasElement;
  docId: string;
  session: ModelSession;
  elementId: number;
  /** Live-Δ (IFC-Meter) während des Drags; null = kein Drag. */
  onLiveDelta(delta: WorldVec3 | null): void;
  /** Ergebnis-/Fehlermeldung nach Commit bzw. Abbruch. */
  onDone(text: string, error?: boolean): void;
  /** Auswahl hat keine Bounding-Box in der Szene — Gizmo nicht darstellbar. */
  onBoundsMissing(): void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // — Geometrie-Anker: Bounding-Box-Zentrum + Pfeilenden (Renderer-Rahmen) —
  const anchor = useMemo(() => {
    const scene = access.renderer.getScene();
    const box =
      scene.getEntityBoundingBox(elementId) ??
      scene.getInstancedEntityBounds(elementId);
    if (!box) return null;
    const center: WorldVec3 = {
      x: (box.min.x + box.max.x) / 2,
      y: (box.min.y + box.max.y) / 2,
      z: (box.min.z + box.max.z) / 2,
    };
    const arm = gizmoArmLength(
      Math.hypot(
        box.max.x - box.min.x,
        box.max.y - box.min.y,
        box.max.z - box.min.z,
      ),
    );
    const ends = GIZMO_AXES.map((axis) => ({
      x: center.x + axis.rendererDir.x * arm,
      y: center.y + axis.rendererDir.y * arm,
      z: center.z + axis.rendererDir.z * arm,
    }));
    return { center, ends };
  }, [access, elementId]);

  useEffect(() => {
    if (!anchor) onBoundsMissing();
  }, [anchor, onBoundsMissing]);

  const points = useMemo(
    () => (anchor ? [anchor.center, ...anchor.ends] : []),
    [anchor],
  );
  const screen = useScreenProjection(access, canvas, points);

  // — Esc bricht einen laufenden Drag ab —
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setDrag(null);
      onLiveDelta(null);
      onDone("Verschieben abgebrochen (Esc).");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragging, onLiveDelta, onDone]);

  if (!anchor) return null;

  /** Mausstrahl im Renderer-Rahmen aus CSS-Koordinaten relativ zum Canvas. */
  const rayAt = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return access.renderer
      .getCamera()
      .unprojectToRay(
        clientX - rect.left,
        clientY - rect.top,
        canvas.clientWidth,
        canvas.clientHeight,
      );
  };

  const paramAt = (axisIndex: number, clientX: number, clientY: number) =>
    axisRayParam(
      rayAt(clientX, clientY),
      anchor.center,
      GIZMO_AXES[axisIndex].rendererDir,
    );

  const beginDrag = (
    axisIndex: number,
    event: React.PointerEvent<SVGLineElement>,
  ): void => {
    if (event.button !== 0 || dragRef.current) return;
    const start = paramAt(axisIndex, event.clientX, event.clientY);
    if (start === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    const next: DragState = {
      axisIndex,
      pointerId: event.pointerId,
      startParam: start,
      delta: { x: 0, y: 0, z: 0 },
    };
    setDrag(next);
    onLiveDelta(next.delta);
  };

  const moveDrag = (event: React.PointerEvent<SVGLineElement>): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const param = paramAt(current.axisIndex, event.clientX, event.clientY);
    if (param === null) return;
    const delta = dragDeltaIfc(
      GIZMO_AXES[current.axisIndex],
      param - current.startParam,
    );
    setDrag({ ...current, delta });
    onLiveDelta(delta);
  };

  /** pointercancel (z. B. Fokusverlust): Drag verwerfen statt committen. */
  const cancelDrag = (event: React.PointerEvent<SVGLineElement>): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    setDrag(null);
    onLiveDelta(null);
  };

  const endDrag = (event: React.PointerEvent<SVGLineElement>): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    setDrag(null);
    onLiveDelta(null);
    const delta: WorldVec3 = {
      x: roundMm(current.delta.x),
      y: roundMm(current.delta.y),
      z: roundMm(current.delta.z),
    };
    if (!isNoticeableDelta(delta)) return;
    try {
      const command = cmdMoveElement(
        session,
        elementId,
        delta.x,
        delta.y,
        delta.z,
      );
      useCommands.getState().execute(docId, command);
      onDone(`${command.label} — in 3D nach „Modell neu berechnen" sichtbar.`);
    } catch (error) {
      onDone(error instanceof Error ? error.message : String(error), true);
    }
  };

  const center = screen[0] ?? null;
  if (!center) return null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <svg
        width="100%"
        height="100%"
        style={{ display: "block", width: "100%", height: "100%" }}
        aria-label="Verschiebe-Gizmo"
      >
        {GIZMO_AXES.map((axis, index) => {
          const end = screen[index + 1] ?? null;
          if (!end) return null;
          const active = drag?.axisIndex === index;
          return (
            <g key={axis.id}>
              <line
                x1={center.x}
                y1={center.y}
                x2={end.x}
                y2={end.y}
                stroke={axis.color}
                strokeWidth={active ? 4 : 2.5}
                strokeLinecap="round"
              />
              <circle cx={end.x} cy={end.y} r={active ? 7 : 5} fill={axis.color} />
              <text
                x={end.x + 8}
                y={end.y - 8}
                fill={axis.color}
                fontSize={12}
                fontWeight={700}
                style={{ userSelect: "none" }}
              >
                {axis.label}
              </text>
              {/* Unsichtbare, breite Trefferlinie — nur sie nimmt Pointer an. */}
              <line
                x1={center.x}
                y1={center.y}
                x2={end.x}
                y2={end.y}
                stroke="transparent"
                strokeWidth={16}
                strokeLinecap="round"
                style={{
                  pointerEvents: "stroke",
                  cursor: active ? "grabbing" : "grab",
                }}
                onPointerDown={(event) => beginDrag(index, event)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={cancelDrag}
              />
            </g>
          );
        })}
        <circle cx={center.x} cy={center.y} r={3.5} fill="var(--accent, #fff)" />
      </svg>
    </div>
  );
}
