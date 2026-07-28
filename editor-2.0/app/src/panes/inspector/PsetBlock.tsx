/**
 * Ein Eigenschaftssatz im Modus „Eigenschaften": Kopfzeile mit
 * Umbenennen/Duplizieren/Löschen, Tabelle mit Werteingabe und Lösch-Knopf je
 * Zeile sowie Fußzeile zum Anlegen einer neuen Property.
 * Der Block hält nur UI-Zustand — geschrieben wird ausschließlich über die
 * Rückrufe, die der Abschnitt in Pipeline-Commands übersetzt.
 */
import { useState } from "react";
import type { PropertyValueType } from "@ifc-lite/data";
import ValueEditor from "./ValueEditor";
import type { EditablePset } from "./overlay";
import {
  PROPERTY_TYPES,
  isValidDraft,
  kindOf,
  parseDraft,
  toBooleanDraft,
  toDraft,
} from "./values";

export type PropertyCommit = string | number | boolean;

interface PsetBlockProps {
  pset: EditablePset;
  /** Alle Pset-Namen des Objekts — verhindert ein Umbenennen auf einen belegten Namen. */
  takenNames: readonly string[];
  onSetProperty(name: string, type: PropertyValueType, value: PropertyCommit): void;
  onDeleteProperty(name: string, type: PropertyValueType): void;
  onRename(newName: string): void;
  onDuplicate(): void;
  onDelete(): void;
}

export default function PsetBlock({
  pset,
  takenNames,
  onSetProperty,
  onDeleteProperty,
  onRename,
  onDuplicate,
  onDelete,
}: PsetBlockProps) {
  const [renaming, setRenaming] = useState<string | null>(null);

  const draftName = renaming?.trim() ?? "";
  const renameOk =
    draftName.length > 0 &&
    draftName !== pset.name &&
    !takenNames.includes(draftName);

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 8px 4px",
        }}
      >
        {renaming === null ? (
          <>
            <span style={{ fontWeight: 600, fontSize: "0.8125rem", flex: 1 }}>
              {pset.name}
            </span>
            <button className="btn" onClick={() => setRenaming(pset.name)}>
              Umbenennen
            </button>
            <button className="btn" onClick={onDuplicate}>
              Duplizieren
            </button>
            <button className="btn" onClick={onDelete}>
              Löschen
            </button>
          </>
        ) : (
          <>
            <input
              className="input"
              autoFocus
              style={{
                flex: 1,
                borderColor:
                  draftName && !renameOk && draftName !== pset.name
                    ? "var(--error)"
                    : undefined,
              }}
              value={renaming}
              title={
                takenNames.includes(draftName)
                  ? "Dieser Name ist bereits vergeben"
                  : undefined
              }
              onChange={(event) => setRenaming(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenaming(null);
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (renameOk) onRename(draftName);
                setRenaming(null);
              }}
            />
            <button
              className="btn"
              disabled={!renameOk}
              onClick={() => {
                onRename(draftName);
                setRenaming(null);
              }}
            >
              Übernehmen
            </button>
            <button className="btn" onClick={() => setRenaming(null)}>
              Abbrechen
            </button>
          </>
        )}
      </div>

      <table className="kv-table">
        <thead>
          <tr>
            <th className="text-dim" style={{ width: "40%" }}>
              Property
            </th>
            <th className="text-dim">Wert</th>
            <th style={{ width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {pset.properties.length === 0 && (
            <tr>
              <td className="text-dim" colSpan={3}>
                Noch keine Properties.
              </td>
            </tr>
          )}
          {pset.properties.map((property) => {
            const kind = kindOf(property.type);
            const shown =
              kind === "boolean"
                ? toBooleanDraft(property.value)
                : toDraft(property.value);
            return (
              <tr key={property.name}>
                <td className="dim" title={property.unit}>
                  {property.name}
                </td>
                <td>
                  <ValueEditor
                    key={`${pset.name}|${property.name}|${property.type}`}
                    value={shown}
                    kind={kind}
                    onCommit={(draft) => {
                      const parsed = parseDraft(draft, kind);
                      if (parsed.ok) {
                        onSetProperty(property.name, property.type, parsed.value);
                      }
                    }}
                  />
                </td>
                <td>
                  <button
                    className="btn"
                    title={`Property „${property.name}" löschen`}
                    onClick={() => onDeleteProperty(property.name, property.type)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <NewPropertyForm
        onAdd={(name, type, value) => onSetProperty(name, type, value)}
      />
    </div>
  );
}

interface NewPropertyFormProps {
  onAdd(name: string, type: PropertyValueType, value: PropertyCommit): void;
}

function NewPropertyForm({ onAdd }: NewPropertyFormProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyValueType>(PROPERTY_TYPES[0].type);
  const [draft, setDraft] = useState("");

  const kind = kindOf(type);
  const valueDraft = kind === "boolean" ? draft || "nein" : draft;
  const ready = name.trim().length > 0 && isValidDraft(valueDraft, kind);

  function add(): void {
    const parsed = parseDraft(valueDraft, kind);
    if (!ready || !parsed.ok) return;
    onAdd(name.trim(), type, parsed.value);
    setName("");
    setDraft("");
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: "6px 8px 10px",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <span className="text-dim" style={{ fontSize: "0.75rem" }}>
        Neue Property
      </span>
      <input
        className="input"
        style={{ flex: "1 1 110px", minWidth: 90 }}
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        className="input"
        value={type}
        onChange={(event) => setType(Number(event.target.value) as PropertyValueType)}
      >
        {PROPERTY_TYPES.map((entry) => (
          <option key={entry.type} value={entry.type}>
            {entry.label}
          </option>
        ))}
      </select>
      {kind === "boolean" ? (
        <select
          className="input"
          value={valueDraft}
          onChange={(event) => setDraft(event.target.value)}
        >
          <option value="ja">ja</option>
          <option value="nein">nein</option>
        </select>
      ) : (
        <input
          className="input"
          style={{
            flex: "1 1 110px",
            minWidth: 90,
            borderColor: isValidDraft(valueDraft, kind) ? undefined : "var(--error)",
          }}
          placeholder="Wert"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
      )}
      <button className="btn" disabled={!ready} onClick={add}>
        Hinzufügen
      </button>
    </div>
  );
}
