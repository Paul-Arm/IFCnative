/**
 * Bausteine des Ressourcen-Modus (M9): kompakte Formularfelder, das
 * Formular-Gerüst mit Commit-Button und der Command-Runner. Bewusst eigene
 * (schlanke) Kopien statt Import aus panes/builder — dort arbeitet parallel
 * ein anderer Agent. Nur Klassen/Token aus global.css.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { useCommands } from "../../commands/pipeline";
import type { EditorCommand } from "../../commands/pipeline";

export interface FormStatus {
  text: string;
  error?: boolean;
}

/**
 * Command bauen und über die Pipeline ausführen; Fehler landen als
 * Statuszeile im Formular statt in der Konsole.
 */
export function runResourceCommand(
  docId: string,
  build: () => EditorCommand,
  setStatus: (status: FormStatus) => void,
  successText = 'Zugewiesen — sichtbar als „Overlay"-Zeile.',
): void {
  try {
    useCommands.getState().execute(docId, build());
    setStatus({ text: successText });
  } catch (error) {
    setStatus({ text: (error as Error).message, error: true });
  }
}

export function useFormStatus(): [FormStatus, (status: FormStatus) => void] {
  const [status, setStatus] = useState<FormStatus>({ text: "" });
  return [status, setStatus];
}

/** Beschriftete Zeile: schmales Label links, Feld rechts. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function TextRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
}) {
  return (
    <Row label={label}>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </Row>
  );
}

export function NumberRow({
  label,
  value,
  onChange,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  step?: number;
}) {
  return (
    <Row label={label}>
      <input
        className="input"
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => {
          const parsed = Number.parseFloat(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
      />
    </Row>
  );
}

export function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange(value: string): void;
}) {
  return (
    <Row label={label}>
      <select
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

/**
 * Kompaktes Anlegen-Formular als zuklappbarer Block mit eigenem
 * Commit-Button (je Formular genau ein Command).
 */
export function ResourceForm({
  title,
  submitLabel,
  status,
  onSubmit,
  children,
  disabled,
}: {
  title: string;
  submitLabel: string;
  status: FormStatus;
  onSubmit(): void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <details className="form-details" style={{ margin: "0 8px 8px" }}>
      <summary>{title}</summary>
      <form className="form-card" onSubmit={submit}>
        {children}
        <div className="form-actions">
          <button className="btn btn-sm" type="submit" disabled={disabled}>
            {submitLabel}
          </button>
          {status.text && (
            <span
              className="form-status"
              data-error={status.error ? true : undefined}
            >
              {status.text}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}
