/**
 * Ein Pset-Block der Batch-Matrix: Kopfzeile mit Abdeckungs-Badge, Tabelle
 * (Zeilen = Properties, Spalten = Objekte) und Fußzeile zum Anlegen einer
 * neuen Property auf allen Objekten.
 *
 * Der Block schreibt nichts selbst — jede Aktion geht als Rückruf an die Pane,
 * die daraus Vorschau und Command baut.
 */
import { useState } from "react";
import type { PropertyValueType } from "@ifc-lite/data";
import ValueEditor from "../inspector/ValueEditor";
import {
  PROPERTY_TYPES,
  isValidDraft,
  kindOf,
  parseDraft,
} from "../inspector/values";
import type { MatrixBlock, MatrixColumn, MatrixRow } from "./matrix";

interface PsetMatrixProps {
  block: MatrixBlock;
  columns: readonly MatrixColumn[];
  /** Gesamtzahl ausgewählter Objekte (n im Badge „k/n"). */
  total: number;
  onCellCommit(row: MatrixRow, expressId: number, draft: string): void;
  onSetForAll(row: MatrixRow, draft: string): void;
  onDeleteRow(row: MatrixRow): void;
  onAddProperty(
    propName: string,
    type: PropertyValueType,
    draft: string,
  ): void;
}

export default function PsetMatrix({
  block,
  columns,
  total,
  onCellCommit,
  onSetForAll,
  onDeleteRow,
  onAddProperty,
}: PsetMatrixProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const incomplete = block.coverage < total;

  function startAll(row: MatrixRow): void {
    setEditing(row.propName);
    setDraft(row.cells.find((cell) => cell.present)?.draft ?? "");
  }

  function commitAll(row: MatrixRow): void {
    setEditing(null);
    if (isValidDraft(draft, row.kind)) onSetForAll(row, draft);
  }

  return (
    <div className="batch-block">
      <div className="batch-block-head">
        <span className="card-head-label">{block.psetName}</span>
        <span
          className="batch-badge"
          data-warn={incomplete}
          title={`In ${block.coverage} von ${total} ausgewählten Objekten vorhanden`}
        >
          {block.coverage}/{total}
        </span>
      </div>

      <div className="batch-scroll">
        <table className="kv-table">
          <thead>
            <tr>
              <th className="batch-sticky text-dim">Property</th>
              <th className="text-dim" style={{ width: 64 }} />
              {columns.map((column) => (
                <th key={column.expressId} className="text-dim" title={column.title}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.length === 0 && (
              <tr>
                <td className="text-dim" colSpan={columns.length + 2}>
                  Noch keine Properties in diesem Satz.
                </td>
              </tr>
            )}
            {block.rows.map((row) => (
              <tr key={row.propName} data-divergent={row.divergent}>
                <td className="batch-sticky dim" title={row.propName}>
                  {row.propName}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="row-actions">
                    <button
                      className="icon-btn"
                      title={`Wert für alle ${total} Objekte setzen`}
                      onClick={() => startAll(row)}
                    >
                      ✎
                    </button>
                    <button
                      className="icon-btn"
                      title={`Property „${row.propName}" auf allen Objekten löschen`}
                      onClick={() => onDeleteRow(row)}
                    >
                      ×
                    </button>
                  </span>
                </td>
                {editing === row.propName ? (
                  <td colSpan={columns.length}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        className="input"
                        autoFocus
                        style={{ flex: 1 }}
                        data-invalid={
                          isValidDraft(draft, row.kind) ? undefined : true
                        }
                        placeholder={`Wert für alle ${total} Objekte`}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitAll(row);
                          } else if (event.key === "Escape") {
                            setEditing(null);
                          }
                        }}
                      />
                      <button
                        className="btn btn-sm"
                        disabled={!isValidDraft(draft, row.kind)}
                        onClick={() => commitAll(row)}
                      >
                        Vorschau
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setEditing(null)}
                      >
                        Abbrechen
                      </button>
                    </div>
                  </td>
                ) : (
                  row.cells.map((cell) => (
                    <td key={cell.expressId} className="batch-cell">
                      <ValueEditor
                        key={`${block.psetName}|${row.propName}|${cell.expressId}|${row.type}`}
                        value={cell.draft}
                        kind={row.kind}
                        title={
                          cell.present
                            ? undefined
                            : "Property fehlt hier — Eingabe legt sie an"
                        }
                        onCommit={(next) => onCellCommit(row, cell.expressId, next)}
                      />
                    </td>
                  ))
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewPropertyRow psetName={block.psetName} total={total} onAdd={onAddProperty} />
    </div>
  );
}

interface NewPropertyRowProps {
  psetName: string;
  total: number;
  onAdd(propName: string, type: PropertyValueType, draft: string): void;
}

function NewPropertyRow({ psetName, total, onAdd }: NewPropertyRowProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyValueType>(PROPERTY_TYPES[0].type);
  const [draft, setDraft] = useState("");

  const kind = kindOf(type);
  const value = kind === "boolean" ? draft || "nein" : draft;
  const ready = name.trim().length > 0 && parseDraft(value, kind).ok;

  function add(): void {
    if (!ready) return;
    onAdd(name.trim(), type, value);
    setName("");
    setDraft("");
  }

  return (
    <div className="batch-block-foot">
      <span className="field-label">Neue Property in „{psetName}"</span>
      <input
        className="input"
        style={{ flex: "1 1 120px", minWidth: 90 }}
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        className="input"
        value={type}
        onChange={(event) =>
          setType(Number(event.target.value) as PropertyValueType)
        }
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
          value={value}
          onChange={(event) => setDraft(event.target.value)}
        >
          <option value="ja">ja</option>
          <option value="nein">nein</option>
        </select>
      ) : (
        <input
          className="input"
          style={{ flex: "1 1 120px", minWidth: 90 }}
          data-invalid={parseDraft(value, kind).ok ? undefined : true}
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
      <button
        className="btn btn-sm"
        disabled={!ready}
        title={`Property auf allen ${total} Objekten anlegen`}
        onClick={add}
      >
        Auf alle {total}
      </button>
    </div>
  );
}
