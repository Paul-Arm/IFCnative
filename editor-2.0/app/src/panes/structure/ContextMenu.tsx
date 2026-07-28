/**
 * Eigenes Kontextmenü des Strukturbaums (M9) — kein natives contextmenu.
 * Nutzt die Menü-Klassen aus global.css (.ribbon-menu/.ribbon-menu-item);
 * „Kind anlegen →" klappt die legalen Kindklassen je Parent-Typ inline auf.
 * Schließt bei Klick auf den transparenten Backdrop und bei Escape.
 */
import { useEffect, useState } from "react";
import { childGroupsForParent, isDeleteProtected, type ChildOption } from "./contextModel";

export interface MenuTarget {
  x: number;
  y: number;
  expressId: number;
  type: string;
  label: string;
}

export interface ContextMenuProps {
  target: MenuTarget;
  onFocus(expressId: number): void;
  onDelete(expressId: number): void;
  onCreateChild(parentId: number, option: ChildOption): void;
  onClose(): void;
}

export default function ContextMenu({
  target,
  onFocus,
  onDelete,
  onCreateChild,
  onClose,
}: ContextMenuProps) {
  const [childrenOpen, setChildrenOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = childGroupsForParent(target.type);
  const deleteProtected = isDeleteProtected(target.type);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 50 }}
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="ribbon-menu"
        role="menu"
        aria-label={`Aktionen für ${target.label}`}
        style={{
          position: "fixed",
          top: Math.min(target.y, window.innerHeight - 160),
          left: Math.min(target.x, window.innerWidth - 240),
          maxHeight: "60vh",
          overflowY: "auto",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="text-dim"
          style={{
            padding: "0.25rem 0.625rem 0.375rem",
            fontSize: "0.7rem",
            borderBottom: "1px solid var(--border)",
            marginBottom: 2,
            whiteSpace: "nowrap",
          }}
        >
          {target.label}
        </div>

        <button
          className="ribbon-menu-item"
          onClick={() => {
            onFocus(target.expressId);
            onClose();
          }}
        >
          Kamera zentrieren
        </button>

        {groups.length > 0 && (
          <button
            className="ribbon-menu-item"
            aria-expanded={childrenOpen}
            onClick={() => setChildrenOpen((open) => !open)}
          >
            Kind anlegen {childrenOpen ? "▾" : "→"}
          </button>
        )}
        {childrenOpen &&
          groups.map((group) => (
            <div key={group.label}>
              <div
                className="text-dim"
                style={{ padding: "0.25rem 0.625rem 0.125rem", fontSize: "0.7rem" }}
              >
                {group.label}
              </div>
              {group.options.map((option) => (
                <button
                  key={option.ifcClass}
                  className="ribbon-menu-item"
                  style={{ paddingLeft: "1.25rem" }}
                  onClick={() => {
                    onCreateChild(target.expressId, option);
                    onClose();
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ))}

        <button
          className="ribbon-menu-item"
          disabled={deleteProtected}
          title={deleteProtected ? "IfcProject ist löschgeschützt." : undefined}
          style={deleteProtected ? { opacity: 0.45, cursor: "default" } : undefined}
          onClick={() => {
            if (deleteProtected) return;
            onDelete(target.expressId);
            onClose();
          }}
        >
          Löschen …
        </button>
      </div>
    </div>
  );
}
