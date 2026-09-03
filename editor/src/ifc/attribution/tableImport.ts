/**
 * Tabellenimport: CSV/Excel-Zeilen auf die Spalten der aktuellen Tabelle
 * abbilden, per Schlüssel (ID oder Bezeichnung) bestehende Zeilen treffen,
 * fehlende Zeilen optional anlegen — erst als Plan (Dry-Run), dann als eine
 * Änderung. Reines Modell ohne React.
 */
import type { NativeIfcDocument } from "../nativeDocument";

import { stripPropertyPrefix } from "./normalize";
import { writeCell } from "./recipes";
import type { Importart } from "./schema";
import { parseMeters, type TableColumn, type TableModel, type TableRow } from "./table";

export interface ImportTable {
  headers: string[];
  rows: string[][];
}

export type ImportTarget = { kind: "column"; columnKey: string } | { kind: "ignore" };

export interface ImportMapping {
  targets: Record<string, ImportTarget>;
  /** Kopfzeile, deren Werte bestehende Zeilen treffen (ID oder Bezeichnung). */
  keyHeader: string | null;
}

export interface ImportOptions {
  createMissing: boolean;
  overwriteWithEmpty: boolean;
}

export interface ImportChange {
  column: TableColumn;
  from: string;
  to: string;
}

export interface ImportPlanRow {
  index: number;
  key: string;
  row?: TableRow;
  action: "update" | "create" | "skip" | "unchanged";
  bezeichnung: string;
  changes: ImportChange[];
  reason?: string;
}

export interface ImportPlan {
  rows: ImportPlanRow[];
  updates: number;
  creates: number;
  unchanged: number;
  skipped: number;
  changedCells: number;
}

/* ---------------- Parsen ---------------- */

function detectDelimiter(line: string): string {
  const candidates = [";", "\t", ",", "|"];
  let best = ";";
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = line.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** CSV/TSV mit Anführungszeichen; Trenner wird aus der Kopfzeile erkannt (; Tab , |). */
export function parseDelimited(text: string, delimiter?: string): ImportTable {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLine = normalized.split("\n").find((line) => line.trim()) ?? "";
  const delim = delimiter ?? detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    if (quoted) {
      if (char === '"') {
        if (normalized[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delim) {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return fromRows(rows);
}

/** Zeilen aus einem Arbeitsblatt (erste nicht leere Zeile = Kopf). */
export function fromRows(rows: ReadonlyArray<ReadonlyArray<unknown>>): ImportTable {
  const cleaned = rows.map((entries) => entries.map((entry) => (entry == null ? "" : String(entry).trim()))).filter((entries) => entries.some((entry) => entry));
  const headers = (cleaned[0] ?? []).map((header, index) => header || `Spalte ${index + 1}`);
  return { headers, rows: cleaned.slice(1).map((entries) => headers.map((_, index) => entries[index] ?? "")) };
}

/* ---------------- Zuordnung ---------------- */

export function normalizeHeader(header: string): string {
  return stripPropertyPrefix(header)
    .replace(/^(?:ePset_|Pset_|ePSet_)?[^.]+\./, "")
    .replace(/_[A-Z0-9ß]{1,6}$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]/g, "");
}

function columnMatches(column: TableColumn, normalized: string): boolean {
  if (normalizeHeader(column.property) === normalized) return true;
  if (column.aliase.some((alias) => normalizeHeader(alias) === normalized)) return true;
  return normalizeHeader(`${column.psetLabel}.${column.property}`) === normalized || `${normalizeHeader(column.psetLabel)}${normalizeHeader(column.property)}` === normalized;
}

/** Kopfzeilen automatisch den Spalten zuordnen; Schlüssel = Spalte ID, sonst Bezeichnung. */
export function autoMap(headers: string[], model: TableModel): ImportMapping {
  const targets: Record<string, ImportTarget> = {};
  const used = new Set<string>();
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    const column = model.columns.find((entry) => !used.has(entry.key) && columnMatches(entry, normalized)) ?? model.columns.find((entry) => columnMatches(entry, normalized));
    if (column) {
      targets[header] = { kind: "column", columnKey: column.key };
      used.add(column.key);
    } else {
      targets[header] = { kind: "ignore" };
    }
  }
  const headerFor = (property: string) =>
    headers.find((header) => {
      const target = targets[header];
      return target?.kind === "column" && model.columns.find((column) => column.key === target.columnKey)?.property.toLowerCase() === property.toLowerCase();
    }) ?? null;
  return { targets, keyHeader: headerFor("ID") ?? headerFor("Bezeichnung") };
}

/* ---------------- Plan ---------------- */

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function rowKeys(row: TableRow): string[] {
  const keys = new Set<string>();
  if (row.id) keys.add(normalizeKey(row.id));
  if (row.label) keys.add(normalizeKey(row.label));
  for (const cell of row.cells) {
    if ((cell.column.property === "ID" || cell.column.property === "Bezeichnung") && cell.value) keys.add(normalizeKey(cell.value));
  }
  return [...keys].filter(Boolean);
}

export function planImport(table: ImportTable, mapping: ImportMapping, model: TableModel, options: ImportOptions): ImportPlan {
  const columnsByKey = new Map(model.columns.map((column) => [column.key, column]));
  const index = new Map<string, TableRow>();
  for (const row of model.rows) {
    for (const key of rowKeys(row)) if (!index.has(key)) index.set(key, row);
  }
  const mapped = table.headers
    .map((header, position) => ({ header, position, target: mapping.targets[header] }))
    .filter((entry): entry is { header: string; position: number; target: { kind: "column"; columnKey: string } } => entry.target?.kind === "column" && columnsByKey.has(entry.target.columnKey));
  const keyPosition = mapping.keyHeader ? table.headers.indexOf(mapping.keyHeader) : -1;
  const bezeichnungPosition = mapped.find((entry) => columnsByKey.get(entry.target.columnKey)?.property === "Bezeichnung")?.position ?? -1;

  const plan: ImportPlan = { rows: [], updates: 0, creates: 0, unchanged: 0, skipped: 0, changedCells: 0 };
  table.rows.forEach((values, rowIndex) => {
    const key = keyPosition >= 0 ? (values[keyPosition] ?? "") : "";
    const row = key ? index.get(normalizeKey(key)) : undefined;
    const bezeichnung = (bezeichnungPosition >= 0 ? values[bezeichnungPosition] : "") || (key.includes(".") ? key.split(".").pop() ?? key : key);
    const collect = (existing?: TableRow): ImportChange[] => {
      const changes: ImportChange[] = [];
      for (const entry of mapped) {
        const column = columnsByKey.get(entry.target.columnKey)!;
        const to = values[entry.position] ?? "";
        const cell = existing?.cells.find((candidate) => candidate.column.key === column.key);
        if (cell && (cell.state === "abgeleitet" || cell.state === "na")) continue;
        const from = cell?.value ?? "";
        if (!to && !options.overwriteWithEmpty) continue;
        if (column.position) {
          const target = parseMeters(to);
          if (target == null) continue;
          const current = parseMeters(from);
          if (current != null && Math.abs(target - current) < 0.0005) continue;
          changes.push({ column, from, to });
          continue;
        }
        if (to === from) continue;
        changes.push({ column, from, to });
      }
      return changes;
    };
    if (row) {
      const changes = collect(row);
      const action = changes.length ? "update" : "unchanged";
      plan.rows.push({ index: rowIndex, key, row, action, bezeichnung, changes });
      if (action === "update") {
        plan.updates += 1;
        plan.changedCells += changes.length;
      } else {
        plan.unchanged += 1;
      }
      return;
    }
    if (!key) {
      plan.rows.push({ index: rowIndex, key, action: "skip", bezeichnung, changes: [], reason: "kein Schlüssel" });
      plan.skipped += 1;
      return;
    }
    if (!options.createMissing) {
      plan.rows.push({ index: rowIndex, key, action: "skip", bezeichnung, changes: [], reason: "kein Treffer" });
      plan.skipped += 1;
      return;
    }
    const changes = collect(undefined).filter((change) => change.column.property !== "ID" && change.column.property !== "Bezeichnung");
    plan.rows.push({ index: rowIndex, key, action: "create", bezeichnung, changes });
    plan.creates += 1;
    plan.changedCells += changes.length;
  });
  return plan;
}

/* ---------------- Anwenden ---------------- */

export type CreateRow = (document: NativeIfcDocument, bezeichnung: string, ordinal: number) => { document: NativeIfcDocument; entityId: number; psetId?: number } | null;

export interface ApplyResult {
  document: NativeIfcDocument;
  updated: number;
  created: number;
  createdEntityIds: number[];
  /** Bestehende Objekte, deren Platzierung sich geändert hat (Viewer lädt sie nach). */
  movedEntityIds: number[];
}

/** Plan in einem Durchgang schreiben; `create` legt eine fehlende Zeile an (Wiederholgruppe oder Fachobjekt). */
export function applyImport(document: NativeIfcDocument, plan: ImportPlan, importart: Importart, create?: CreateRow): ApplyResult {
  let next = document;
  let updated = 0;
  let created = 0;
  const createdEntityIds: number[] = [];
  const movedEntityIds: number[] = [];
  for (const entry of plan.rows) {
    if (entry.action === "update" && entry.row) {
      const before = next;
      for (const change of entry.changes) next = writeCell(next, entry.row, change.column, change.to, importart);
      if (next !== before) updated += 1;
      if (next !== before && entry.row.psetId == null && entry.changes.some((change) => change.column.position)) movedEntityIds.push(entry.row.entityId);
      continue;
    }
    if (entry.action === "create" && create) {
      const result = create(next, entry.bezeichnung, created);
      if (!result) continue;
      next = result.document;
      created += 1;
      createdEntityIds.push(result.entityId);
      for (const change of entry.changes) next = writeCell(next, { entityId: result.entityId, psetId: result.psetId }, change.column, change.to, importart);
    }
  }
  return { document: next, updated, created, createdEntityIds, movedEntityIds };
}
