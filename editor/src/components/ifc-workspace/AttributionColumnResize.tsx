import { useRef, useState } from "react";
import { clampColumnWidth, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "@/ifc/attribution/tableViewport";

const STORAGE_KEY = "ifcnative.attribution.column-widths.v1";
export function useAttributionColumnWidths() {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "number" && Number.isFinite(value)).map(([key, value]) => [key, clampColumnWidth(value as number)])) : {};
    } catch { return {}; }
  });
  const latest = useRef(widths);
  const resize = (key: string, width: number, save: boolean) => {
    const next = { ...latest.current, [key]: clampColumnWidth(width) };
    latest.current = next;
    setWidths(next);
    if (save) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Session-local widths still work when storage is unavailable. */ } }
  };
  return { widths, resize };
}

export function AttributionColumnResize({ label, width, defaultWidth, onResize }: {
  label: string;
  width: number;
  defaultWidth: number;
  onResize(width: number, save: boolean): void;
}) {
  const drag = useRef<{ x: number; width: number; next: number; scale: number } | null>(null);
  return <span
    role="separator" tabIndex={0} aria-label={`Spaltenbreite ${label}`} aria-orientation="vertical"
    aria-valuemin={MIN_COLUMN_WIDTH} aria-valuemax={MAX_COLUMN_WIDTH} aria-valuenow={width}
    title="Ziehen: Breite ändern · Doppelklick: Standardbreite · Pfeiltasten: schrittweise ändern"
    className="absolute inset-y-0 right-0 z-30 w-2 touch-none cursor-col-resize select-none border-r-2 border-transparent hover:border-primary focus:border-primary focus:outline-none"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const header = event.currentTarget.parentElement!;
      drag.current = { x: event.clientX, width, next: width, scale: header.getBoundingClientRect().width / header.offsetWidth || 1 };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (!drag.current) return;
      drag.current.next = clampColumnWidth(drag.current.width + (event.clientX - drag.current.x) / drag.current.scale);
      onResize(drag.current.next, false);
    }}
    onPointerUp={(event) => {
      if (!drag.current) return;
      onResize(drag.current.next, true); drag.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { if (drag.current) onResize(drag.current.width, false); drag.current = null; }}
    onLostPointerCapture={() => { if (drag.current) onResize(drag.current.next, true); drag.current = null; }}
    onClick={(event) => event.stopPropagation()}
    onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onResize(defaultWidth, true); }}
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      onResize(event.key === "Home" ? defaultWidth : clampColumnWidth(width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 40 : 10)), true);
    }}
  />;
}
