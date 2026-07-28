/**
 * Vorschau vor jeder Massenänderung: Tabelle „Objekt | (Property) | alt | neu"
 * mit Bestätigen/Abbrechen. Erst der Klick auf „Übernehmen" erzeugt den
 * Command — abgebrochene Vorschauen hinterlassen keine Spur im Undo-Stapel.
 */
import { useEffect } from "react";

export interface PreviewRow {
  key: string;
  object: string;
  /** Optional — nur beim CSV-Import unterscheiden sich die Properties je Zeile. */
  property?: string;
  before: string;
  after: string;
}

interface PreviewDialogProps {
  title: string;
  /** Erläuterung über der Tabelle (z. B. Zeilen-/Trefferzahlen). */
  note?: string;
  rows: readonly PreviewRow[];
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
}

const ROW_LIMIT = 200;
const EMPTY = "—";

export default function PreviewDialog({
  title,
  note,
  rows,
  confirmLabel,
  onConfirm,
  onCancel,
}: PreviewDialogProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const shown = rows.slice(0, ROW_LIMIT);
  const withProperty = rows.some((row) => row.property);

  return (
    <div className="batch-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="batch-modal"
        role="dialog"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3 className="batch-modal-title">{title}</h3>
        <p className="batch-modal-text">
          {rows.length === 0
            ? "Keine Änderung — die Werte stimmen bereits überein."
            : `${rows.length} Änderung(en).`}
          {note ? ` ${note}` : ""}
        </p>

        {rows.length > 0 && (
          <div className="batch-modal-plan">
            <table className="kv-table">
              <thead>
                <tr>
                  <th className="text-dim">Objekt</th>
                  {withProperty && <th className="text-dim">Property</th>}
                  <th className="text-dim">alt</th>
                  <th className="text-dim">neu</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.key}>
                    <td className="dim">{row.object}</td>
                    {withProperty && <td className="dim">{row.property ?? ""}</td>}
                    <td className="text-dim">{row.before || EMPTY}</td>
                    <td>{row.after || EMPTY}</td>
                  </tr>
                ))}
                {rows.length > shown.length && (
                  <tr>
                    <td className="text-dim" colSpan={withProperty ? 4 : 3}>
                      … und {rows.length - shown.length} weitere
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="batch-modal-actions">
          <button className="btn" onClick={onCancel}>
            Abbrechen
          </button>
          <button
            className="btn"
            data-active
            disabled={rows.length === 0}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
