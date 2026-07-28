/**
 * Anzeige der abgeleiteten Zeichnung als SVG im Pane.
 *
 * Gezeichnet wird direkt aus `Drawing2D` (nicht aus `exportToSVG`), weil nur so
 * zwei Dinge gehen: Zoom/Pan über eine eigene viewBox und Klick-Auswahl je
 * Entity — jede Linie des Pakets trägt ihre `entityId`, die Pfade sind danach
 * gruppiert. Strichstärken hängen an `vector-effect: non-scaling-stroke`, damit
 * das Plan-Bild in jeder Zoomstufe lesbar bleibt.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawingResult, ViewBox } from "./drawing";

interface DrawingViewProps {
  result: DrawingResult;
  selected: ReadonlySet<number>;
  /** Zählt hoch, wenn die Ansicht zurückgesetzt werden soll. */
  resetToken: number;
  onPick(entityId: number, additive: boolean): void;
}

/**
 * Auswahl- und Füllfarben kommen als CSS-Custom-Properties von `.drawing-svg`
 * (panels.css) — dort zentral je Theme pflegbar. SVG-Attribute können kein
 * var(), deshalb laufen sie über das style-Property.
 */
const SELECTED = "var(--draw-selected)";
const FILL = "var(--draw-fill)";
const FILL_SELECTED = "var(--draw-fill-selected)";
/** Ab dieser Mausbewegung gilt eine Geste als Verschieben, nicht als Klick. */
const DRAG_THRESHOLD_PX = 3;

function scaleOf(rect: DOMRect, box: ViewBox): number {
  return Math.min(rect.width / box.width, rect.height / box.height);
}

export default function DrawingView({
  result,
  selected,
  resetToken,
  onPick,
}: DrawingViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [box, setBox] = useState<ViewBox>(result.viewBox);
  const boxRef = useRef(box);
  boxRef.current = box;
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    setBox(result.viewBox);
  }, [result, resetToken]);

  // Mausrad: React liefert nur passive wheel-Listener, preventDefault braucht
  // deshalb einen eigenen, nicht-passiven Listener am Element.
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const current = boxRef.current;
      const rect = element.getBoundingClientRect();
      const scale = scaleOf(rect, current);
      if (!Number.isFinite(scale) || scale <= 0) return;
      const offsetX = (rect.width - current.width * scale) / 2;
      const offsetY = (rect.height - current.height * scale) / 2;
      const worldX = current.x + (event.clientX - rect.left - offsetX) / scale;
      const worldY = current.y + (event.clientY - rect.top - offsetY) / scale;
      const factor = Math.exp(event.deltaY * 0.0015);
      const width = Math.min(1e6, Math.max(1e-3, current.width * factor));
      const applied = width / current.width;
      setBox({
        x: worldX - (worldX - current.x) * applied,
        y: worldY - (worldY - current.y) * applied,
        width: current.width * applied,
        height: current.height * applied,
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setPanning(true);
    drag.x = event.clientX;
    drag.y = event.clientY;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = scaleOf(rect, boxRef.current);
    if (!Number.isFinite(scale) || scale <= 0) return;
    setBox((current) => ({
      ...current,
      x: current.x - dx / scale,
      y: current.y - dy / scale,
    }));
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanning(false);
  }, []);

  function pick(entityId: number, event: React.MouseEvent): void {
    if (dragRef.current?.moved) return;
    onPick(entityId, event.shiftKey || event.ctrlKey || event.metaKey);
  }

  return (
    <svg
      ref={svgRef}
      className="drawing-svg"
      data-panning={panning || undefined}
      viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {result.fills.map((fill) => (
        <path
          key={`f-${fill.key}`}
          d={fill.d}
          fillRule="evenodd"
          style={{
            fill: selected.has(fill.entityId) ? FILL_SELECTED : FILL,
          }}
          onClick={(event) => pick(fill.entityId, event)}
        >
          <title>{`${fill.ifcType} #${fill.entityId}`}</title>
        </path>
      ))}
      {result.paths.map((path) => {
        const isSelected = selected.has(path.entityId);
        return (
          <path
            key={path.key}
            d={path.d}
            fill="none"
            style={{ stroke: isSelected ? SELECTED : path.color }}
            strokeWidth={isSelected ? path.width * 2 : path.width}
            strokeDasharray={path.dash}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            onClick={(event) => pick(path.entityId, event)}
          >
            <title>{`${path.ifcType} #${path.entityId}`}</title>
          </path>
        );
      })}
    </svg>
  );
}
