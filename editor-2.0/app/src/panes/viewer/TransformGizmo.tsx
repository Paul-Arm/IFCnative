/**
 * Transform-Gizmo (M10): Verschieben (W), Rotieren (R, Yaw um IFC-Z) und
 * Skalieren (S) mit ECHTER Live-Vorschau — beim Drag hängt der Viewer eine
 * frei transformierbare Kopie der Entity-Geometrie ein
 * (`access.startTransformPreview`) und blendet das Original aus; beim
 * Loslassen läuft die Änderung als EditorCommand durch die Pipeline
 * (cmdMoveElement / cmdRotateElement / cmdScaleElement) und „Modell neu
 * berechnen" zeigt den echten Stand.
 *
 * Gezeichnet als SVG-Overlay ÜBER dem WebGPU-Canvas (der Renderer hat keine
 * Gizmo-API): drei Achsenpfeile (Move), Ring in der XY-Ebene (Rotate) bzw.
 * Quadrat-Griffe (Scale). Esc bricht den Drag ab.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewerOverlayAccess } from "../../core/viewer";
import type { ModelSession } from "../../core/session";
import { useCommands } from "../../commands/pipeline";
import {
  cmdMoveElement,
  cmdRotateElement,
  cmdScaleElement,
} from "../../commands/geometryCommands";
import { findExtrusion, findPlacementPoint } from "../../domain/geometry";
import {
  GIZMO_AXES,
  ROTATE_EPSILON_RAD,
  SCALE_EPSILON,
  angleDelta,
  axisRayParam,
  dragDeltaIfc,
  gizmoArmLength,
  ifcYawAround,
  isNoticeableDelta,
  rayPlaneY,
  scaleFactorFrom,
} from "./gizmoMath";
import {
  ifcToRendererDelta,
  ifcToRendererPoint,
  roundMm,
  type WorldVec3,
} from "./worldCoords";
import { useScreenProjection } from "./useScreenProjection";

export type TransformMode = "move" | "rotate" | "scale";

const RING_SEGMENTS = 32;
const IDENTITY: WorldVec3 = { x: 1, y: 1, z: 1 };
const ZERO: WorldVec3 = { x: 0, y: 0, z: 0 };

interface DragState {
  pointerId: number;
  /** move/scale: Achsindex; rotate: -1 */
  axisIndex: number;
  startParam: number;
  /** rotate: Start-Yaw (IFC, rad) unter dem Zeiger */
  startYaw: number;
  uniform: boolean;
  /** Live-Werte (IFC-Rahmen) */
  delta: WorldVec3;
  yawRad: number;
  factors: WorldVec3;
  /** Live-Vorschau im Renderer aktiv (Cache vorhanden)? */
  preview: boolean;
}

export default function TransformGizmo({
  access,
  canvas,
  docId,
  session,
  elementId,
  mode,
  onLiveDelta,
  onDone,
  onBoundsMissing,
}: {
  access: ViewerOverlayAccess;
  canvas: HTMLCanvasElement;
  docId: string;
  session: ModelSession;
  elementId: number;
  mode: TransformMode;
  /** Live-Anzeige (IFC-Meter bzw. Grad/Faktor als Text); null = kein Drag. */
  onLiveDelta(delta: WorldVec3 | null): void;
  onDone(text: string, error?: boolean): void;
  onBoundsMissing(): void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  // — Fähigkeiten des Ziels: Drehen braucht die Platzierung, Skalieren die
  //   parametrische Extrusion (Rechteck/Kreis) —
  const capability = useMemo(() => {
    const source = { store: session.store, view: session.view };
    const placement = findPlacementPoint(source, elementId);
    const extrusion =
      mode === "scale" ? findExtrusion(source, elementId) : null;
    const scalable =
      extrusion !== null &&
      (extrusion.xDim !== null ||
        extrusion.yDim !== null ||
        extrusion.radius !== null ||
        extrusion.depth !== null);
    return { placement, scalable };
  }, [session, elementId, mode]);

  // — Geometrie-Anker (Renderer-Rahmen): Bounding-Box + Pivot —
  const anchor = useMemo(() => {
    const scene = access.renderer.getScene();
    // Szene-Bounds zuerst; bei farb-gemergten Batches liefert die Szene für
    // viele Entities nichts — dann greifen die Bounds aus dem Geometrie-Cache.
    const box =
      scene.getEntityBoundingBox(elementId) ??
      scene.getInstancedEntityBounds(elementId) ??
      access.entityBounds(elementId);
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
    // Pivot für Rotation/Skalierung = Platzierungsursprung (dort greifen die
    // Commands an); Annahme wie beim Pick-Übernehmen: Elternknoten im Ursprung.
    const shift = access.originShift();
    const pivot = capability.placement
      ? ifcToRendererPoint(
          {
            x: capability.placement.coords[0],
            y: capability.placement.coords[1],
            z: capability.placement.coords[2],
          },
          shift,
        )
      : center;
    const ends = GIZMO_AXES.map((axis) => ({
      x: center.x + axis.rendererDir.x * arm,
      y: center.y + axis.rendererDir.y * arm,
      z: center.z + axis.rendererDir.z * arm,
    }));
    const ring = Array.from({ length: RING_SEGMENTS }, (_, i) => {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      return {
        x: pivot.x + Math.cos(a) * arm,
        y: pivot.y,
        z: pivot.z + Math.sin(a) * arm,
      };
    });
    return { center, pivot, arm, ends, ring };
  }, [access, elementId, capability]);

  useEffect(() => {
    if (!anchor) onBoundsMissing();
  }, [anchor, onBoundsMissing]);

  // Vorschau beim Unmount immer abräumen (Werkzeug-/Auswahlwechsel im Drag).
  useEffect(() => () => access.endTransformPreview(), [access]);

  const points = useMemo(() => {
    if (!anchor) return [];
    return [anchor.center, anchor.pivot, ...anchor.ends, ...anchor.ring];
  }, [anchor]);
  const screen = useScreenProjection(access, canvas, points);

  // — Esc bricht einen laufenden Drag ab —
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      access.endTransformPreview();
      setDrag(null);
      onLiveDelta(null);
      onDone("Transformation abgebrochen (Esc).");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragging, access, onLiveDelta, onDone]);

  if (!anchor) return null;

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
      mode === "scale" ? anchor.pivot : anchor.center,
      GIZMO_AXES[axisIndex].rendererDir,
    );

  const yawAt = (clientX: number, clientY: number): number | null => {
    const hit = rayPlaneY(rayAt(clientX, clientY), anchor.pivot.y);
    return hit ? ifcYawAround(hit, anchor.pivot) : null;
  };

  /** Vorschau-Matrix aus dem Live-Zustand an den Renderer geben. */
  const pushPreview = (state: DragState): void => {
    if (!state.preview) return;
    access.updateTransformPreview({
      pivot: mode === "move" ? anchor.center : anchor.pivot,
      delta: ifcToRendererDelta(state.delta),
      // Renderer-Yaw um Y entspricht dem IFC-Yaw um Z (Herleitung gizmoMath).
      yawRad: state.yawRad,
      // IFC (x,y,z) → Renderer (x,z,y): Faktoren entsprechend tauschen.
      scale: {
        x: state.factors.x,
        y: state.factors.z,
        z: state.factors.y,
      },
    });
  };

  const beginDrag = (
    axisIndex: number,
    event: React.PointerEvent<SVGElement>,
  ): void => {
    if (event.button !== 0 || dragRef.current) return;
    let startParam = 0;
    let startYaw = 0;
    if (mode === "rotate") {
      const yaw = yawAt(event.clientX, event.clientY);
      if (yaw === null) return;
      startYaw = yaw;
    } else {
      const param = paramAt(axisIndex, event.clientX, event.clientY);
      if (param === null) return;
      startParam = param;
    }
    // Fehlertolerant: synthetische/bereits beendete Pointer haben keine
    // Capture — der Drag funktioniert auch ohne (SVG-Handler bleiben dran).
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ohne Capture weiter */
    }
    event.stopPropagation();
    const preview = access.startTransformPreview(elementId);
    const next: DragState = {
      pointerId: event.pointerId,
      axisIndex,
      startParam,
      startYaw,
      uniform: event.shiftKey,
      delta: ZERO,
      yawRad: 0,
      factors: IDENTITY,
      preview,
    };
    setDrag(next);
    onLiveDelta(ZERO);
  };

  const moveDrag = (event: React.PointerEvent<SVGElement>): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    let next = current;
    if (mode === "move") {
      const param = paramAt(current.axisIndex, event.clientX, event.clientY);
      if (param === null) return;
      next = {
        ...current,
        delta: dragDeltaIfc(
          GIZMO_AXES[current.axisIndex],
          param - current.startParam,
        ),
      };
      onLiveDelta(next.delta);
    } else if (mode === "rotate") {
      const yaw = yawAt(event.clientX, event.clientY);
      if (yaw === null) return;
      const deltaRad = angleDelta(yaw, current.startYaw);
      next = { ...current, yawRad: deltaRad };
      onLiveDelta({ x: (deltaRad * 180) / Math.PI, y: 0, z: 0 });
    } else {
      const param = paramAt(current.axisIndex, event.clientX, event.clientY);
      if (param === null) return;
      const factor = scaleFactorFrom(param - current.startParam, anchor.arm);
      const axisId = GIZMO_AXES[current.axisIndex].id;
      const factors: WorldVec3 = current.uniform
        ? { x: factor, y: factor, z: factor }
        : {
            x: axisId === "x" ? factor : 1,
            y: axisId === "y" ? factor : 1,
            z: axisId === "z" ? factor : 1,
          };
      next = { ...current, factors };
      onLiveDelta(factors);
    }
    setDrag(next);
    pushPreview(next);
  };

  const cancelDrag = (event: React.PointerEvent<SVGElement>): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    access.endTransformPreview();
    setDrag(null);
    onLiveDelta(null);
  };

  const endDrag = (event: React.PointerEvent<SVGElement>): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    access.endTransformPreview();
    setDrag(null);
    onLiveDelta(null);
    try {
      if (mode === "move") {
        const delta: WorldVec3 = {
          x: roundMm(current.delta.x),
          y: roundMm(current.delta.y),
          z: roundMm(current.delta.z),
        };
        if (!isNoticeableDelta(delta)) return;
        const command = cmdMoveElement(
          session,
          elementId,
          delta.x,
          delta.y,
          delta.z,
        );
        useCommands.getState().execute(docId, command);
        // Verschiebung direkt in die Szene spiegeln — kein Zurückspringen
        // bis zum nächsten Voll-Rebuild.
        const mirrored = access.applyCommittedDelta(
          elementId,
          ifcToRendererDelta(delta),
        );
        onDone(
          mirrored
            ? command.label
            : `${command.label} — „Modell neu berechnen" zeigt den Stand.`,
        );
      } else if (mode === "rotate") {
        if (Math.abs(current.yawRad) < ROTATE_EPSILON_RAD) return;
        const command = cmdRotateElement(session, elementId, current.yawRad);
        useCommands.getState().execute(docId, command);
        onDone(`${command.label} — „Modell neu berechnen" zeigt den Stand.`);
      } else {
        const f = current.factors;
        if (
          Math.abs(f.x - 1) < SCALE_EPSILON &&
          Math.abs(f.y - 1) < SCALE_EPSILON &&
          Math.abs(f.z - 1) < SCALE_EPSILON
        )
          return;
        const command = cmdScaleElement(session, elementId, f);
        useCommands.getState().execute(docId, command);
        onDone(`${command.label} — „Modell neu berechnen" zeigt den Stand.`);
      }
    } catch (error) {
      onDone(error instanceof Error ? error.message : String(error), true);
    }
  };

  const center = screen[0] ?? null;
  const pivot = screen[1] ?? null;
  if (!center) return null;

  // Nicht skalierbar (Polygon/B-Rep/Mesh): Hinweis statt Griffe.
  if (mode === "scale" && !capability.scalable) {
    return (
      <GizmoNote
        x={center.x}
        y={center.y}
        text="Nicht parametrisch — Skalieren nur für Rechteck-/Kreisprofile."
      />
    );
  }
  if (mode === "rotate" && !capability.placement) {
    return (
      <GizmoNote
        x={center.x}
        y={center.y}
        text="Keine drehbare Platzierung (IfcLocalPlacement fehlt)."
      />
    );
  }

  const ringScreen = screen.slice(5).filter((p) => p !== null) as Array<{
    x: number;
    y: number;
  }>;
  const ringPath =
    ringScreen.length > 2
      ? `M ${ringScreen.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`
      : null;

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <svg
        width="100%"
        height="100%"
        style={{ display: "block", width: "100%", height: "100%" }}
        aria-label="Transform-Gizmo"
      >
        {mode === "rotate" && ringPath ? (
          <g>
            <path
              d={ringPath}
              fill="none"
              stroke="#0090ff"
              strokeWidth={drag ? 3.5 : 2}
            />
            <path
              d={ringPath}
              fill="none"
              stroke="transparent"
              strokeWidth={18}
              style={{
                pointerEvents: "stroke",
                cursor: drag ? "grabbing" : "grab",
              }}
              onPointerDown={(event) => beginDrag(-1, event)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
            />
            {drag && (
              <text
                x={(pivot ?? center).x + 12}
                y={(pivot ?? center).y - 12}
                fill="#0090ff"
                fontSize={12}
                fontWeight={700}
                style={{ userSelect: "none" }}
              >
                {`${((drag.yawRad * 180) / Math.PI).toFixed(1)}°`}
              </text>
            )}
          </g>
        ) : null}

        {mode !== "rotate" &&
          GIZMO_AXES.map((axis, index) => {
            const end = screen[index + 2] ?? null;
            if (!end) return null;
            const origin = mode === "scale" ? (pivot ?? center) : center;
            const active = drag?.axisIndex === index;
            return (
              <g key={axis.id}>
                <line
                  x1={origin.x}
                  y1={origin.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={axis.color}
                  strokeWidth={active ? 4 : 2.5}
                  strokeLinecap="round"
                />
                {mode === "move" ? (
                  <circle
                    cx={end.x}
                    cy={end.y}
                    r={active ? 7 : 5}
                    fill={axis.color}
                  />
                ) : (
                  <rect
                    x={end.x - (active ? 7 : 5)}
                    y={end.y - (active ? 7 : 5)}
                    width={active ? 14 : 10}
                    height={active ? 14 : 10}
                    fill={axis.color}
                  />
                )}
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
                <line
                  x1={origin.x}
                  y1={origin.y}
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

function GizmoNote({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x + 10,
        top: y - 10,
        maxWidth: 260,
        padding: "4px 8px",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-popover)",
        border: "1px solid var(--border)",
        color: "var(--text-dim)",
        fontSize: "0.6875rem",
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}
