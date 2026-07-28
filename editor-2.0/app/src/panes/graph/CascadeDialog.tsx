/**
 * Bestätigung vor dem Löschen eines Objekts: zeigt den Kaskadenplan aus
 * `planEntityRemoval` — betroffene Objekte (Aggregations-Kinder) und alle
 * Beziehungen, die dabei entfallen.
 */
import { useEffect } from "react";
import type { PendingRemoval } from "./useGraphEditing";

export interface CascadeDialogProps {
  pending: PendingRemoval;
  onConfirm(): void;
  onCancel(): void;
}

const PREVIEW_LIMIT = 40;

export default function CascadeDialog({
  pending,
  onConfirm,
  onCancel,
}: CascadeDialogProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const { entities, relations } = pending.plan;

  return (
    <div className="graph-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="graph-modal"
        role="dialog"
        aria-label="Objekt löschen"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="graph-modal-title">Objekt löschen</h3>
        <p className="graph-modal-text">
          {pending.label} wird gelöscht. Betroffen sind {entities.length}{" "}
          Objekt(e) und {relations.length} Beziehung(en).
        </p>

        <Section title="Objekte" items={entities} />
        <Section title="Beziehungen" items={relations} />

        <div className="graph-modal-actions">
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

function Section({
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
      <h4 className="graph-modal-subtitle">
        {title} <span className="text-dim">({items.length})</span>
      </h4>
      <ul className="graph-modal-list graph-modal-plan">
        {shown.map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
        {items.length > shown.length && (
          <li className="text-dim">
            … und {items.length - shown.length} weitere
          </li>
        )}
      </ul>
    </div>
  );
}
