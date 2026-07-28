/**
 * Auswahl der Beziehungsart beim Verbinden zweier Knoten. Angeboten werden
 * nur Klassen, die für das Typenpaar zulässig sind (`allowedRelationClasses`).
 */
import { useEffect, useState } from "react";
import type { PendingConnect } from "./useGraphEditing";
import type { RelationClassRule } from "../../core/model/relationshipRules";

export interface RelationDialogProps {
  pending: PendingConnect;
  onConfirm(rule: RelationClassRule): void;
  onCancel(): void;
}

export default function RelationDialog({
  pending,
  onConfirm,
  onCancel,
}: RelationDialogProps) {
  const first = pending.rules[0]?.ifcClass ?? "";
  const [selected, setSelected] = useState(first);

  useEffect(() => setSelected(first), [first]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const rule = pending.rules.find((r) => r.ifcClass === selected) ?? null;

  return (
    <div className="graph-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="graph-modal"
        role="dialog"
        aria-label="Beziehung anlegen"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="graph-modal-title">Beziehung anlegen</h3>
        <p className="graph-modal-text">
          <strong>Von:</strong> {pending.sourceLabel}
          <br />
          <strong>Nach:</strong> {pending.targetLabel}
        </p>

        {pending.rules.length === 0 ? (
          <p className="graph-modal-text text-dim">
            Zwischen diesen beiden IFC-Klassen ist keine der unterstützten
            Beziehungsarten zulässig.
          </p>
        ) : (
          <div className="graph-modal-list">
            {pending.rules.map((option) => (
              <label className="graph-modal-item" key={option.ifcClass}>
                <input
                  type="radio"
                  name="relation-class"
                  value={option.ifcClass}
                  checked={selected === option.ifcClass}
                  onChange={() => setSelected(option.ifcClass)}
                />
                <span>
                  {option.label}
                  <span className="text-dim"> · {option.entityName}</span>
                  <br />
                  <span className="text-dim">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="graph-modal-actions">
          <button className="btn" onClick={onCancel}>
            Abbrechen
          </button>
          <button
            className="btn"
            data-active={rule !== null}
            disabled={rule === null}
            onClick={() => rule && onConfirm(rule)}
          >
            Anlegen
          </button>
        </div>
      </div>
    </div>
  );
}
