/**
 * Bestätigung vor dem Löschen aus dem Strukturbaum (M9): zeigt den
 * Kaskadenplan aus `planEntityRemoval` — kompakter Nachbau des
 * CascadeDialog aus panes/graph (dessen CSS lädt nur mit dem Graph-Pane,
 * deshalb hier Inline-Styles auf global.css-Token).
 */
import { useEffect, type CSSProperties } from "react";
import type { RemovalPlan } from "../../commands/entityCommands";

export interface PendingTreeRemoval {
  expressId: number;
  label: string;
  plan: RemovalPlan;
}

const BACKDROP: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--bg) 60%, transparent)",
};

const PANEL: CSSProperties = {
  width: "min(440px, 90%)",
  maxHeight: "80%",
  overflow: "auto",
  padding: "14px 16px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-panel)",
  color: "var(--text)",
  boxShadow: "0 10px 30px rgb(0 0 0 / 35%)",
};

const PREVIEW_LIMIT = 40;

export default function ConfirmDeleteDialog({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingTreeRemoval;
  onConfirm(): void;
  onCancel(): void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const { entities, relations } = pending.plan;

  return (
    <div style={BACKDROP} onMouseDown={onCancel}>
      <div
        style={PANEL}
        role="dialog"
        aria-label="Objekt löschen"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>Objekt löschen</h3>
        <p style={{ margin: "0 0 10px", fontSize: "0.8125rem", lineHeight: 1.45 }}>
          {pending.label} wird gelöscht. Betroffen sind {entities.length}{" "}
          Objekt(e) und {relations.length} Beziehung(en).
        </p>

        <PlanList title="Objekte" items={entities} />
        <PlanList title="Beziehungen" items={relations} />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onCancel}>
            Abbrechen
          </button>
          <button className="btn" data-active onClick={onConfirm}>
            Löschen
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanList({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<{ id: number; label: string }>;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, PREVIEW_LIMIT);
  return (
    <div>
      <h4 style={{ margin: "10px 0 4px", fontSize: "0.8125rem" }}>
        {title} <span className="text-dim">({items.length})</span>
      </h4>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          maxHeight: 160,
          overflow: "auto",
          fontSize: "0.8125rem",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {shown.map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
        {items.length > shown.length && (
          <li className="text-dim">… und {items.length - shown.length} weitere</li>
        )}
      </ul>
    </div>
  );
}
