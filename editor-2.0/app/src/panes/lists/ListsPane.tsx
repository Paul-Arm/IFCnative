/**
 * Listen-Pane: Bauteillisten/Schedules über @ifc-lite/lists. Die eingebauten
 * Presets des Pakets liefern Startdefinitionen; Spalten kommen aus der
 * Discovery-API, Gruppierung/Summen aus `summariseListRows` (Teil von
 * `executeList`), der Export aus `listResultToCSV`.
 *
 * Der Motor selbst kennt kein Zeilenlimit — die Tabelle rendert deshalb
 * höchstens MAX_ROWS Datenzeilen und blendet die Gesamtzahl ein.
 */
import { useMemo, useState } from "react";
import {
  LIST_PRESETS,
  discoverColumns,
  executeList,
  type ColumnDefinition,
  type ListDefinition,
} from "@ifc-lite/lists";
import { useDocRevision } from "../../commands/pipeline";
import { useActiveDocument } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import ColumnPicker from "./ColumnPicker";
import ListTable from "./ListTable";
import { createListProvider } from "./provider";
import {
  buildDisplayLines,
  columnLabel,
  downloadListCsv,
  nextSort,
  numericColumnIds,
} from "./table";

/** Höchstzahl gerenderter Datenzeilen (reine Anzeigegrenze). */
const MAX_ROWS = 500;

/** Deutsche Beschriftung der Paket-Presets (IDs aus LIST_PRESETS). */
const PRESET_LABELS: Record<string, string> = {
  "preset-wall-schedule": "Wände",
  "preset-door-schedule": "Türen",
  "preset-window-schedule": "Fenster",
  "preset-space-areas": "Räume",
  "preset-zones-&-systems": "Zonen & Systeme",
  "preset-all-elements": "Übersicht (alle Bauteile)",
};

function presetLabel(preset: ListDefinition): string {
  return PRESET_LABELS[preset.id] ?? preset.name;
}

function clonePreset(preset: ListDefinition): ListDefinition {
  return {
    ...preset,
    entityTypes: [...preset.entityTypes],
    conditions: [...preset.conditions],
    columns: preset.columns.map((column) => ({ ...column })),
    sortBy: undefined,
    grouping: undefined,
  };
}

export default function ListsPane() {
  const doc = useActiveDocument();
  const selection = useSelectionOf(doc?.id ?? null);
  const setSelection = useSelection((s) => s.setSelection);
  const requestFocus = useSelection((s) => s.requestFocus);

  const [presetId, setPresetId] = useState(LIST_PRESETS[0].id);
  const [definition, setDefinition] = useState<ListDefinition>(() =>
    clonePreset(LIST_PRESETS[0]),
  );
  const [groupColumnIds, setGroupColumnIds] = useState<string[]>([]);

  // Der Provider cached Psets/Mengen; nach jedem do/undo/redo wird er neu
  // gebaut (Befund 5), damit die Liste bearbeitete Werte zeigt. `changeCount`
  // taugt dafür nicht — er ist append-only und schrumpft beim Undo nicht.
  const session = doc?.session ?? null;
  const revision = useDocRevision(doc?.id ?? null);
  const provider = useMemo(
    () => (session ? createListProvider(session) : null),
    [session, revision],
  );

  const discovered = useMemo(
    () => (provider ? discoverColumns(provider, definition.entityTypes) : null),
    [provider, definition.entityTypes],
  );

  /** Summiert werden alle Spalten — der Motor ignoriert nicht-numerische Werte. */
  const effective = useMemo<ListDefinition>(() => {
    const active = groupColumnIds.filter((id) =>
      definition.columns.some((column) => column.id === id),
    );
    if (active.length === 0) return { ...definition, grouping: undefined };
    return {
      ...definition,
      grouping: {
        columnId: active[0],
        columnIds: active,
        sumColumnIds: definition.columns.map((column) => column.id),
      },
    };
  }, [definition, groupColumnIds]);

  const result = useMemo(
    () => (provider && doc ? executeList(effective, provider, doc.id) : null),
    [provider, effective, doc],
  );

  const numericIds = useMemo(
    () => (result ? numericColumnIds(result) : new Set<string>()),
    [result],
  );
  const display = useMemo(
    () =>
      result
        ? buildDisplayLines(result, effective.grouping, MAX_ROWS)
        : { lines: [], shown: 0 },
    [result, effective.grouping],
  );
  const selected = useMemo(() => new Set(selection), [selection]);

  function choosePreset(id: string): void {
    const preset = LIST_PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    setPresetId(id);
    setDefinition(clonePreset(preset));
    setGroupColumnIds([]);
  }

  function addColumn(column: ColumnDefinition): void {
    setDefinition((current) => ({
      ...current,
      columns: [...current.columns, column],
    }));
  }

  function removeColumn(columnId: string): void {
    setDefinition((current) => ({
      ...current,
      columns: current.columns.filter((column) => column.id !== columnId),
      sortBy: current.sortBy?.columnId === columnId ? undefined : current.sortBy,
    }));
    setGroupColumnIds((current) => current.filter((id) => id !== columnId));
  }

  function toggleSort(columnId: string): void {
    setDefinition((current) => ({
      ...current,
      sortBy: nextSort(current.sortBy, columnId),
    }));
  }

  function pickRow(entityId: number, focus: boolean): void {
    if (!doc) return;
    setSelection(doc.id, [entityId]);
    if (focus) requestFocus(doc.id, entityId);
  }

  if (!doc || !result || !discovered) {
    return <p className="pane-empty">Kein Dokument geöffnet.</p>;
  }

  const columns = result.columns;
  const summary = result.summary;
  const groupable = definition.columns.filter(
    (column) => !groupColumnIds.includes(column.id),
  );

  return (
    <div className="pane">
      <div className="pane-toolbar">
        <select
          className="input"
          value={presetId}
          onChange={(event) => choosePreset(event.target.value)}
          aria-label="Vorlage"
        >
          {LIST_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {presetLabel(preset)}
            </option>
          ))}
        </select>
        <span className="text-dim">
          {result.totalCount} Zeilen
          {display.shown < result.totalCount
            ? ` (${display.shown} angezeigt)`
            : ""}
        </span>
        <button
          className="btn"
          style={{ marginLeft: "auto" }}
          disabled={columns.length === 0}
          onClick={() => downloadListCsv(result)}
          title="CSV mit Semikolon-Trennung (deutsches Excel)"
        >
          CSV exportieren
        </button>
      </div>

      <div className="pane-toolbar" style={{ gap: 4 }}>
        <span className="text-dim">Gruppieren nach</span>
        <select
          className="input"
          value=""
          onChange={(event) => {
            const id = event.target.value;
            if (id) setGroupColumnIds((current) => [...current, id]);
          }}
          disabled={groupable.length === 0}
          aria-label="Gruppierungsspalte hinzufügen"
        >
          <option value="">+ Spalte …</option>
          {groupable.map((column) => (
            <option key={column.id} value={column.id}>
              {columnLabel(column)}
            </option>
          ))}
        </select>
        {groupColumnIds.map((id) => {
          const column = definition.columns.find((entry) => entry.id === id);
          return (
            <button
              key={id}
              className="chip"
              data-active="true"
              title="Gruppierung entfernen"
              onClick={() =>
                setGroupColumnIds((current) =>
                  current.filter((entry) => entry !== id),
                )
              }
            >
              {column ? columnLabel(column) : id} <span aria-hidden="true">×</span>
            </button>
          );
        })}
      </div>

      <ColumnPicker
        discovered={discovered}
        columns={definition.columns}
        onAdd={addColumn}
        onRemove={removeColumn}
      />

      <div className="pane-body">
        {columns.length === 0 || result.totalCount === 0 ? (
          <p className="pane-empty">
            {columns.length === 0
              ? "Keine Spalten gewählt."
              : "Keine Objekte für diese Vorlage im Modell."}
          </p>
        ) : (
          <ListTable
            columns={columns}
            lines={display.lines}
            numericIds={numericIds}
            sortBy={definition.sortBy}
            summary={summary}
            selected={selected}
            onSort={toggleSort}
            onPick={pickRow}
          />
        )}
      </div>
    </div>
  );
}
