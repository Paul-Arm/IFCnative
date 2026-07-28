/** Kleine Formularbausteine des Baukastens (deutsche Beschriftungen). */
import type { ReactNode } from "react";

export function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "8.5rem 1fr",
        alignItems: "center",
        gap: 6,
        marginBottom: 4,
      }}
    >
      <span style={{ fontSize: "0.8rem" }} title={hint}>
        {label}
      </span>
      {children}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 0.05,
  hint,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  step?: number;
  hint?: string;
}) {
  return (
    <FieldRow label={label} hint={hint}>
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
    </FieldRow>
  );
}

export function TextField({
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
    <FieldRow label={label}>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </FieldRow>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
  hint?: string;
}) {
  return (
    <FieldRow label={label} hint={hint}>
      <select
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}

/** Abschnittsüberschrift mit optionalem Zusatz. */
export function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ margin: "10px 0 6px" }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      {note && (
        <div className="text-dim" style={{ fontSize: "0.75rem" }}>
          {note}
        </div>
      )}
    </div>
  );
}

/** Fehler- bzw. Erfolgsmeldung unterhalb eines Formulars. */
export function StatusLine({ text, error }: { text: string; error?: boolean }) {
  if (!text) return null;
  return (
    <p
      style={{
        fontSize: "0.75rem",
        margin: "6px 0 0",
        color: error ? "var(--danger, #c0392b)" : "var(--fg-dim, inherit)",
      }}
    >
      {text}
    </p>
  );
}
