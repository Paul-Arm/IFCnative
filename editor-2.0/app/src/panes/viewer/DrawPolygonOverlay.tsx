/**
 * Polygon-Zeichenwerkzeug (M10, Taste P): Klicks setzen Eckpunkte auf einer
 * horizontalen Zeichenebene — deren Höhe kommt vom ersten Klick (Raycast auf
 * Geometrie, sonst Z = 0). Doppelklick oder Enter schließt den Umriss und
 * legt ihn im DrawStore ab; der Baukasten übernimmt ihn als Polygon-Profil
 * für die Extrusion (das Baukasten-Fenster öffnet dazu in der Sidebar).
 *
 * Das Overlay fängt Pointer-Events ab — die Kamera steht während des
 * Zeichnens still (Esc beendet das Werkzeug). Backspace löscht den letzten
 * Punkt.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewerOverlayAccess } from "../../core/viewer";
import { showPane } from "../../shell/ribbon/panes";
import { useDrawStore } from "./drawStore";
import { rayPlaneY } from "./gizmoMath";
import { useScreenProjection } from "./useScreenProjection";
import {
  ifcToRendererPoint,
  rendererToIfcPoint,
  roundMm,
  type WorldVec3,
} from "./worldCoords";

export default function DrawPolygonOverlay({
  access,
  canvas,
  docId,
  onDone,
}: {
  access: ViewerOverlayAccess;
  canvas: HTMLCanvasElement;
  docId: string;
  /** Meldung + Werkzeug beenden (fertig oder abgebrochen). */
  onDone(text: string | null, finished: boolean): void;
}) {
  /** Gesetzte Punkte in IFC-Koordinaten (Meter). */
  const [points, setPoints] = useState<WorldVec3[]>([]);
  /** Aktuelle Mausposition auf der Zeichenebene (Vorschau-Segment). */
  const [cursor, setCursor] = useState<WorldVec3 | null>(null);
  const stateRef = useRef({ points, cursor });
  stateRef.current = { points, cursor };

  const shift = access.originShift();

  /** Zeichenebene: IFC-Z des ersten Punkts (null = noch keine). */
  const planeZ = points.length > 0 ? points[0].z : null;

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

  /** Klick/Zeiger → Punkt auf der Zeichenebene (IFC, Meter). */
  const pointAt = (clientX: number, clientY: number): WorldVec3 | null => {
    const ray = rayAt(clientX, clientY);
    if (planeZ === null) {
      // Erster Punkt: bevorzugt echter Geometrie-Treffer, sonst Ebene Z = 0.
      const rect = canvas.getBoundingClientRect();
      const hit = access.renderer.raycastScene(
        clientX - rect.left,
        clientY - rect.top,
        { isStreaming: access.isStreaming() },
      );
      if (hit) {
        const p = rendererToIfcPoint(hit.intersection.point, shift);
        return { x: roundMm(p.x), y: roundMm(p.y), z: roundMm(p.z) };
      }
      const onZero = rayPlaneY(ray, ifcToRendererPoint({ x: 0, y: 0, z: 0 }, shift).y);
      if (!onZero) return null;
      const p = rendererToIfcPoint(onZero, shift);
      return { x: roundMm(p.x), y: roundMm(p.y), z: 0 };
    }
    const planeY = ifcToRendererPoint({ x: 0, y: 0, z: planeZ }, shift).y;
    const hit = rayPlaneY(ray, planeY);
    if (!hit) return null;
    const p = rendererToIfcPoint(hit, shift);
    return { x: roundMm(p.x), y: roundMm(p.y), z: planeZ };
  };

  const finish = (): void => {
    const current = stateRef.current.points;
    if (current.length < 3) {
      onDone("Polygon braucht mindestens 3 Punkte — abgebrochen.", false);
      return;
    }
    useDrawStore.getState().setPolygon({
      docId,
      points: current.map((p) => [p.x, p.y] as const),
      z: current[0].z,
    });
    // Baukasten in der Sidebar öffnen — dort wird extrudiert.
    showPane("builder");
    onDone(
      `Polygon mit ${current.length} Punkten übernommen — im Baukasten als Profil „Polygon" verfügbar.`,
      true,
    );
  };

  // Enter schließt, Backspace löscht den letzten Punkt, Esc bricht ab.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Enter") {
        event.stopPropagation();
        finish();
      } else if (event.key === "Backspace") {
        event.stopPropagation();
        setPoints((current) => current.slice(0, -1));
      } else if (event.key === "Escape") {
        event.stopPropagation();
        onDone("Zeichnen abgebrochen (Esc).", false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // — Projektion für die SVG-Vorschau —
  const rendererPoints = useMemo(() => {
    const list = points.map((p) => ifcToRendererPoint(p, shift));
    if (cursor) list.push(ifcToRendererPoint(cursor, shift));
    return list;
  }, [points, cursor]);
  const screen = useScreenProjection(access, canvas, rendererPoints);

  const committed = screen.slice(0, points.length).filter(Boolean) as Array<{
    x: number;
    y: number;
  }>;
  const preview = cursor ? screen[points.length] : null;

  return (
    <div
      style={{ position: "absolute", inset: 0, cursor: "crosshair" }}
      onPointerMove={(event) => setCursor(pointAt(event.clientX, event.clientY))}
      onPointerLeave={() => setCursor(null)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const p = pointAt(event.clientX, event.clientY);
        if (p) setPoints((current) => [...current, p]);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        finish();
      }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ display: "block", width: "100%", height: "100%", pointerEvents: "none" }}
        aria-label="Polygon-Zeichnung"
      >
        {committed.length > 1 && (
          <polyline
            points={committed.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="var(--accent, #4da3ff)"
            strokeWidth={2}
          />
        )}
        {committed.length > 2 && (
          <line
            x1={committed[committed.length - 1].x}
            y1={committed[committed.length - 1].y}
            x2={committed[0].x}
            y2={committed[0].y}
            stroke="var(--accent, #4da3ff)"
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.7}
          />
        )}
        {committed.length > 0 && preview && (
          <line
            x1={committed[committed.length - 1].x}
            y1={committed[committed.length - 1].y}
            x2={preview.x}
            y2={preview.y}
            stroke="var(--accent, #4da3ff)"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        )}
        {committed.map((p, index) => (
          <circle
            key={index}
            cx={p.x}
            cy={p.y}
            r={index === 0 ? 5 : 4}
            fill={index === 0 ? "var(--accent, #4da3ff)" : "var(--bg-panel, #fff)"}
            stroke="var(--accent, #4da3ff)"
            strokeWidth={1.5}
          />
        ))}
      </svg>
    </div>
  );
}
