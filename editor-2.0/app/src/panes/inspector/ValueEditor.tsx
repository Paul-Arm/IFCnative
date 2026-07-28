/**
 * Wert-Eingabe für eine bereits bestehende Property/Menge.
 * Commit bei Blur oder Enter, Escape verwirft. BOOLEAN erscheint als
 * ja/nein-Auswahl, REAL/INTEGER werden geprüft: ungültige Entwürfe werden
 * nicht committet und rot markiert.
 */
import { useEffect, useState } from "react";
import { isValidDraft, type ValueKind } from "./values";

interface ValueEditorProps {
  /** Aktueller Wert als Text (bei BOOLEAN „ja"/„nein"). */
  value: string;
  kind: ValueKind;
  /** Erhält den Entwurfstext; nur bei gültigem und geändertem Wert. */
  onCommit(draft: string): void;
  title?: string;
}

export default function ValueEditor({
  value,
  kind,
  onCommit,
  title,
}: ValueEditorProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (kind === "boolean") {
    return (
      <select
        className="input"
        style={{ width: "100%" }}
        value={value}
        title={title}
        onChange={(event) => {
          if (event.target.value !== value) onCommit(event.target.value);
        }}
      >
        <option value="ja">ja</option>
        <option value="nein">nein</option>
      </select>
    );
  }

  const valid = isValidDraft(draft, kind);

  function commit(): void {
    if (draft === value) return;
    if (!isValidDraft(draft, kind)) return;
    onCommit(draft);
  }

  return (
    <input
      className="input"
      style={{ width: "100%" }}
      data-invalid={valid ? undefined : true}
      value={draft}
      title={
        valid
          ? title
          : kind === "integer"
            ? "Ganze Zahl erwartet — wird nicht übernommen"
            : "Zahl erwartet — wird nicht übernommen"
      }
      inputMode={kind === "text" ? undefined : "decimal"}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(value);
        }
      }}
    />
  );
}
