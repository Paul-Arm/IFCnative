/**
 * Dropdown der Kopfleiste als Portal am <body>: die Befehlsleiste clippt mit
 * `overflow-x: auto; overflow-y: hidden` — ein absolut positioniertes Menü
 * darunter wäre unsichtbar. Die Position wird beim Öffnen aus dem Anker-Rect
 * berechnet (fixed); Klick außerhalb von Anker UND Menü schließt.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export function DropMenu({
  anchorRef,
  open,
  align = "start",
  onDismiss,
  children,
}: {
  /** Element, unter dem das Menü aufklappt (der Trigger-Container). */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /** "start" = linksbündig zum Anker, "end" = rechtsbündig. */
  align?: "start" | "end";
  onDismiss(): void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left?: number;
    right?: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(
      align === "end"
        ? { top: rect.bottom + 4, right: window.innerWidth - rect.right }
        : { top: rect.bottom + 4, left: rect.left },
    );
  }, [open, align, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onDismiss();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onDismiss, anchorRef]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="tb-menu"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        right: pos.right,
        zIndex: 60,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
