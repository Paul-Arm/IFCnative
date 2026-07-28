/**
 * Spalten-Picker: bietet über die Discovery-API des Listen-Pakets
 * (`discoverColumns`) alle im Modell tatsächlich vorhandenen Attribute,
 * Eigenschaften und Mengen zum Hinzufügen an. Aktive Spalten stehen als Chips
 * mit „×" darunter.
 */
import type { ReactNode } from "react";
import type { ColumnDefinition, DiscoveredColumns } from "@ifc-lite/lists";
import { attributeColumn, columnLabel, propertyColumn, quantityColumn } from "./table";

interface ColumnPickerProps {
  discovered: DiscoveredColumns;
  columns: readonly ColumnDefinition[];
  onAdd(column: ColumnDefinition): void;
  onRemove(columnId: string): void;
}

/** Kodierung der Auswahl: Quelle + Set + Name, „|" trennt (IFC-Namen haben keins). */
function decode(token: string): ColumnDefinition | null {
  const [source, first, second] = token.split("|");
  if (source === "a" && first) return attributeColumn(first);
  if (source === "p" && first && second) return propertyColumn(first, second);
  if (source === "q" && first && second) return quantityColumn(first, second);
  return null;
}

function setOptions(
  prefix: "p" | "q",
  sets: ReadonlyMap<string, string[]>,
): ReactNode[] {
  return [...sets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([setName, names]) => (
      <optgroup key={`${prefix}-${setName}`} label={setName}>
        {names.map((name) => (
          <option key={name} value={`${prefix}|${setName}|${name}`}>
            {name}
          </option>
        ))}
      </optgroup>
    ));
}

export default function ColumnPicker({
  discovered,
  columns,
  onAdd,
  onRemove,
}: ColumnPickerProps) {
  const active = new Set(columns.map((column) => column.id));

  function handleAdd(token: string): void {
    const column = decode(token);
    if (column && !active.has(column.id)) onAdd(column);
  }

  return (
    <>
      <div className="pane-toolbar">
        <span className="text-dim">Spalten</span>
        <select
          className="input"
          value=""
          onChange={(event) => handleAdd(event.target.value)}
          aria-label="Spalte hinzufügen"
        >
          <option value="">+ Spalte hinzufügen …</option>
          <optgroup label="Attribute">
            {discovered.attributes.map((name) => (
              <option key={name} value={`a|${name}`}>
                {name}
              </option>
            ))}
          </optgroup>
          {setOptions("p", discovered.properties)}
          {setOptions("q", discovered.quantities)}
        </select>
        <span className="text-dim">{columns.length} aktiv</span>
      </div>

      <div className="pane-toolbar" style={{ gap: 4 }}>
        {columns.length === 0 ? (
          <span className="text-dim">Keine Spalten — bitte hinzufügen.</span>
        ) : (
          columns.map((column) => (
            <button
              key={column.id}
              className="chip"
              title={`${columnLabel(column)} entfernen`}
              onClick={() => onRemove(column.id)}
            >
              {columnLabel(column)} <span aria-hidden="true">×</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
