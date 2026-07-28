/**
 * Datenmodell der Batch-Matrix: aus der aktuellen Auswahl wird je Pset ein
 * Block gebaut (Zeilen = Properties, Spalten = Objekte).
 *
 * Gelesen wird ausschließlich über `readPsets()` des Inspectors, also über
 * `MutablePropertyView.getForEntity()` — Basiswerte aus der On-Demand-
 * Extraktion plus alle Overlay-Änderungen. Damit zeigt die Matrix exakt das,
 * was auch Inspector und STEP-Export sehen.
 */
import type { PropertyValue, PropertyValueType } from "@ifc-lite/data";
import { PropertyValueType as ValueTypeEnum } from "@ifc-lite/data";
import type { ModelSession } from "../../core/session";
import { readPsets } from "../inspector/overlay";
import { kindOf, toBooleanDraft, toDraft, type ValueKind } from "../inspector/values";

export interface MatrixColumn {
  expressId: number;
  /** Gekürzter Spaltenkopf. */
  label: string;
  /** Vollständige Bezeichnung für `title`. */
  title: string;
  globalId: string;
  name: string;
}

export interface MatrixCell {
  expressId: number;
  /** Hat dieses Objekt die Property überhaupt? */
  present: boolean;
  /** Anzeigetext (bei BOOLEAN „ja"/„nein"). */
  draft: string;
}

export interface MatrixRow {
  propName: string;
  type: PropertyValueType;
  kind: ValueKind;
  cells: MatrixCell[];
  /** Mehr als ein unterschiedlicher Wert unter den vorhandenen Zellen. */
  divergent: boolean;
}

export interface MatrixBlock {
  psetName: string;
  /** Anzahl Objekte mit diesem Pset (k aus dem Badge „k/n"). */
  coverage: number;
  rows: MatrixRow[];
}

export interface Matrix {
  columns: MatrixColumn[];
  blocks: MatrixBlock[];
}

const MAX_LABEL = 22;

function shorten(text: string): string {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

/** Anzeigetext einer Zelle — BOOLEAN als ja/nein, damit der ValueEditor passt. */
export function cellDraft(value: PropertyValue, kind: ValueKind): string {
  return kind === "boolean" ? toBooleanDraft(value) : toDraft(value);
}

export function buildMatrix(
  session: ModelSession,
  expressIds: readonly number[],
): Matrix {
  const columns: MatrixColumn[] = expressIds.map((expressId) => {
    const identity = session.identityOf(expressId);
    const label = identity.name || `${identity.type} #${expressId}`;
    return {
      expressId,
      label: shorten(label),
      title: session.labelOf(expressId),
      globalId: identity.globalId,
      name: identity.name,
    };
  });

  // pset → prop → expressId → { value, type }
  const psets = new Map<
    string,
    Map<string, Map<number, { value: PropertyValue; type: PropertyValueType }>>
  >();
  const coverage = new Map<string, Set<number>>();

  for (const expressId of expressIds) {
    for (const pset of readPsets(session, expressId)) {
      let rows = psets.get(pset.name);
      if (!rows) {
        rows = new Map();
        psets.set(pset.name, rows);
      }
      let owners = coverage.get(pset.name);
      if (!owners) {
        owners = new Set();
        coverage.set(pset.name, owners);
      }
      owners.add(expressId);
      for (const property of pset.properties) {
        let byObject = rows.get(property.name);
        if (!byObject) {
          byObject = new Map();
          rows.set(property.name, byObject);
        }
        byObject.set(expressId, { value: property.value, type: property.type });
      }
    }
  }

  const blocks: MatrixBlock[] = [...psets.entries()]
    .map(([psetName, rows]) => ({
      psetName,
      coverage: coverage.get(psetName)?.size ?? 0,
      rows: [...rows.entries()]
        .map(([propName, byObject]) => buildRow(propName, byObject, columns))
        .sort((a, b) => a.propName.localeCompare(b.propName, "de")),
    }))
    .sort((a, b) => a.psetName.localeCompare(b.psetName, "de"));

  return { columns, blocks };
}

function buildRow(
  propName: string,
  byObject: Map<number, { value: PropertyValue; type: PropertyValueType }>,
  columns: readonly MatrixColumn[],
): MatrixRow {
  // Gemeinsamer Werttyp; bei gemischten Typen gewinnt LABEL als sicherer Rückfall.
  const types = new Set([...byObject.values()].map((entry) => entry.type));
  const type = types.size === 1 ? [...types][0] : ValueTypeEnum.Label;
  const kind = kindOf(type);

  const cells: MatrixCell[] = columns.map((column) => {
    const entry = byObject.get(column.expressId);
    return {
      expressId: column.expressId,
      present: entry !== undefined,
      draft: entry ? cellDraft(entry.value, kind) : "",
    };
  });

  const distinct = new Set(
    cells.filter((cell) => cell.present).map((cell) => cell.draft),
  );
  return { propName, type, kind, cells, divergent: distinct.size > 1 };
}

/** Werttyp einer Spalte „Pset.Property" — für den CSV-Import. */
export function typeIndex(matrix: Matrix): Map<string, PropertyValueType> {
  const index = new Map<string, PropertyValueType>();
  for (const block of matrix.blocks) {
    for (const row of block.rows) {
      index.set(`${block.psetName}.${row.propName}`, row.type);
    }
  }
  return index;
}
