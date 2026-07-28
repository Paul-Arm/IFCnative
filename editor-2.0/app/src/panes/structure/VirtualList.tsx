/**
 * Schlichte Fenster-Virtualisierung: rendert nur den sichtbaren Ausschnitt
 * einer Liste fester Zeilenhöhe (plus Puffer). Reicht für 100k+ Zeilen und
 * kommt ohne zusätzliche Abhängigkeit aus.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface VirtualListProps {
  count: number;
  rowHeight: number;
  renderRow(index: number): ReactNode;
  /** Zeilen über und unter dem Sichtfenster */
  overscan?: number;
  className?: string;
  /** Änderung setzt die Scrollposition zurück (z. B. neue Suche) */
  resetKey?: string | number;
}

export default function VirtualList({
  count,
  rowHeight,
  renderRow,
  overscan = 8,
  className,
  resetKey,
}: VirtualListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setViewport(element.clientHeight);
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (resetKey === undefined) return;
    if (ref.current) ref.current.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  // Beim Schrumpfen der Liste kann `scrollTop` kurz veraltet sein.
  const height = Math.max(viewport, rowHeight);
  const top = Math.max(0, Math.min(scrollTop, count * rowHeight - height));
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(count, Math.ceil((top + height) / rowHeight) + overscan);

  const rows: ReactNode[] = [];
  for (let i = first; i < last; i++) rows.push(renderRow(i));

  return (
    <div
      ref={ref}
      className={className}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: count * rowHeight, position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: first * rowHeight,
            left: 0,
            right: 0,
          }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}
