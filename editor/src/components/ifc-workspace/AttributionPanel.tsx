import { useAttributionValidation } from "./useAttributionValidation";
import { ArrowRight, Box, ChevronDown, ChevronRight, Columns3, Crosshair, Download, FileUp, ListTree, LocateFixed, Plus, Rows3, Search, Settings2, ShieldCheck, Square, TriangleAlert } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ATTRIBUTION_ROW_HEIGHT as ROW_HEIGHT, virtualRowSlots } from "@/ifc/attribution/tableViewport";
import { AttributionColumnResize, useAttributionColumnWidths } from "./AttributionColumnResize";
import { useAttributionViewport } from "./useAttributionViewport";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { filterAttributionRows, planObjectNames, type CellChange, type ReferenceOption } from "@/ifc/attribution/editing";
import { bcfFileName, collectBcfTopics, createBcfArchive } from "@/ifc/attribution/bcf";

import { contextLines } from "@/ifc/attribution/messages";
import { buildBauwerksmodellIndex, isPortalCode, type PortalFinding, type PortalCheckResult } from "@/ifc/attribution/portalCheck";
import { findPset, psetMatches, stripPropertyPrefix, stripPsetPrefix } from "@/ifc/attribution/normalize";
import { addFachobjekt, FACHOBJEKTE } from "@/ifc/attribution/objects";
import { addMethodPset, addRepeatPset, attachPset, childId, nextRepeatIndex, REPEAT_GROUPS, writeCell } from "@/ifc/attribution/recipes";
import { IMPORTARTEN, importartLabel, isBuiltinSchemaActive, katalogFor, listMethodPsets, type Importart } from "@/ifc/attribution/schema";
import { applyImport, type ImportPlan } from "@/ifc/attribution/tableImport";
import { buildTable, collectRows, formatMeters, isTableKind, objektartenOf, type CellState, type TableColumn, type LoiLevel, type Scope, type TableCell, type TableGroup, type TableModel, type TableRow, type ReferenceKind } from "@/ifc/attribution/table";
import { buildFachmodellTree, detectImportart, type TreeNode, type TreeNodeKind } from "@/ifc/attribution/tree";
import type { IdsValidationSummary } from "@/ifc/ids";
import { viewerWorldPointToIfcPlacementPoint } from "@/ifc/coordinateMapping";
import { getNativeLengthUnitScale, type NativeIfcDocument } from "@/ifc/nativeDocument";
import { cn } from "@/lib/utils";

import type { AttributionStatus } from "./AttributionOverlay";
import { AttributionBatchBar } from "./AttributionBatchBar";
import { AttributionCellEditor } from "./AttributionCellEditor";
import { TableImportDialog } from "./TableImportDialog";
import type { CoordinateClipboard } from "./types";
import { Badge, Button, DropdownField, EmptyState, PanelShell, SegmentedControl, type BadgeTone } from "./ui";

export interface AttributionSession {
  id: string;
  fileName: string;
  document: NativeIfcDocument;
}

/** Laufender „Bauteil wählen"-Modus: der nächste Viewer-Klick in einer der Bauwerksmodell-Sessions schreibt die BauteilID. */
export interface AttributionPick {
  sessionIds: string[];
  entityId: number;
  importart: Importart;
}

/**
 * Importart je Dokument, einmal je Dokumentobjekt — die Session-Liste wird
 * bei jedem Render neu aufgebaut, die Dokumente selbst bleiben stabil.
 */
const importartByDocument = new WeakMap<NativeIfcDocument, Importart>();
function importartOf(document: NativeIfcDocument): Importart {
  let importart = importartByDocument.get(document);
  if (!importart) {
    importart = detectImportart(document);
    importartByDocument.set(document, importart);
  }
  return importart;
}

/** Laufende Nummer je Dokumentobjekt, damit Memo-Schlüssel Änderungen an fremden Sessions bemerken. */
const documentTokens = new WeakMap<NativeIfcDocument, number>();
let nextDocumentToken = 1;
function documentToken(document: NativeIfcDocument): number {
  let token = documentTokens.get(document);
  if (!token) {
    token = nextDocumentToken++;
    documentTokens.set(document, token);
  }
  return token;
}

import type { DocumentMutation } from "@/ifc/attribution/mutations";

const VIEWS = [
  { label: "Attribuieren", value: "table" },
  { label: "Prüfung", value: "findings" },
];

const LOI_OPTIONS = ["100", "200", "300", "400", "500"].map((value) => ({ label: value, value }));

const KIND_LABELS: Record<TreeNode["kind"], string> = {
  projekt: "Projekt",
  gruppe: "",
  untersuchungsziel: "Ziel",
  untersuchungsbereich: "Bereich",
  untersuchungsstelle: "Stelle",
  probe: "Probe",
  ergebnis: "Ergebnis",
  massnahme: "Maßnahme",
  messanlage: "Messanlage",
  sensor: "Sensor",
  kanal: "Kanal",
  bauteilgruppe: "Gruppe",
  bauteiltyp: "Typ",
  bauteilvariante: "Variante",
  bauteil: "Bauteil",
  eimer: "",
};

/** Was sich direkt unter einem Baumknoten anlegen lässt: Bereich → Stelle, Stelle → Probe, Messanlage → Sensor, Sensor → Kanal. */
const CHILD_KINDS: Partial<Record<TreeNode["kind"], TreeNode["kind"]>> = {
  untersuchungsbereich: "untersuchungsstelle",
  untersuchungsstelle: "probe",
  messanlage: "sensor",
  sensor: "kanal",
};

function childKindFor(node: TreeNode, importart: Importart): TreeNode["kind"] | null {
  if (node.creates) return node.creates;
  const child = CHILD_KINDS[node.kind] ?? null;
  if (child === "probe" && importart !== "einzelergebnisse") return null;
  if (child && (importart === "bauwerksmodell" || importart === "ergebnisse")) return null;
  return child;
}

type InspectorScope = "cell" | "row" | "column";

const GAP_STATES = new Set<CellState>(["import", "leer", "typ", "unbekannt"]);

interface GroupSummary {
  required: number;
  ok: number;
  filled: number;
  total: number;
  state: CellState;
  missing: string[];
  missingCount: number;
}

/** Eine zugeklappte Gruppe je Zeile: erfüllte Pflichtfelder, schlimmster Zustand, offene Felder. */
function summarizeGroup(cells: TableCell[]): GroupSummary {
  const attached = cells.some((cell) => cell.state !== "fehlt");
  if (cells.length && !attached) return { required: 0, ok: 0, filled: 0, total: 0, state: "fehlt", missing: [], missingCount: 0 };
  const relevant = cells.filter((cell) => cell.state !== "na" && cell.state !== "abgeleitet" && cell.state !== "fehlt");
  const required = relevant.filter((cell) => cell.column.hard || cell.column.soft);
  const missing = required.filter((cell) => cell.state !== "ok").map((cell) => cell.column.property);
  const states = new Set(relevant.map((cell) => cell.state));
  const state: CellState = states.has("import") ? "import" : states.has("typ") ? "typ" : states.has("unbekannt") ? "unbekannt" : states.has("leer") ? "leer" : "ok";
  return {
    required: required.length,
    ok: required.filter((cell) => cell.state === "ok").length,
    filled: relevant.filter((cell) => cell.value).length,
    total: relevant.length,
    state,
    missing: missing.slice(0, 6),
    missingCount: missing.length,
  };
}

const STATE_META: Record<CellState, { label: string; tone: BadgeTone | null; className: string }> = {
  ok: { label: "", tone: null, className: "" },
  neutral: { label: "", tone: null, className: "text-muted-foreground" },
  import: { label: "Import", tone: "danger", className: "bg-destructive/10 shadow-[inset_2px_0_0_var(--destructive)]" },
  leer: { label: "leer", tone: null, className: "bg-destructive/5 shadow-[inset_2px_0_0_var(--destructive)]" },
  typ: { label: "Typ", tone: "warning", className: "bg-warning/10 shadow-[inset_2px_0_0_var(--warning)]" },
  abgeleitet: { label: "", tone: null, className: "bg-muted/60 text-muted-foreground" },
  na: { label: "", tone: null, className: "bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--muted)_6px_8px)] text-muted-foreground" },
  // ungeprüft: nur Farbe und Tooltip, kein Badge — Information, kein Handlungsbedarf in der Datei.
  unbekannt: { label: "", tone: null, className: "bg-warning/5 shadow-[inset_2px_0_0_var(--warning)]" },
  fehlt: { label: "", tone: null, className: "bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-[length:6px_6px] text-muted-foreground" },
};

/**
 * IFC-Attribuierung: Importart, Kontext, Fachmodell-Baum, Tabelle mit zwei
 * Pflichtstufen, Inspektor und die Importvorschau mit den Befunden des
 * Portals (Importer-Regeln + IDS). Schreiben läuft sofort über onCommit.
 */
export function AttributionPanel({
  activeSessionId,
  bauteilPick,
  coordinateClipboard,
  document,
  selectedId,
  sessions,
  onCommit,
  onSelectEntity,
  onShowInViewer,
  onStartBauteilPick,
  onStatus,
  onOpenSchemaSettings,
  schemaFileName = null,
  schemaRevision = 0,
}: {
  activeSessionId: string;
  bauteilPick: AttributionPick | null;
  /** Letzter Klickpunkt aus dem Viewer („Koordinaten picken“), Viewer-Achsen in Metern. */
  coordinateClipboard?: CoordinateClipboard | null;
  document: NativeIfcDocument;
  selectedId: number;
  sessions: AttributionSession[];
  onCommit(mutate: DocumentMutation, summary: string, log?: string): void;
  onSelectEntity(id: number): void;
  /** „Im 3D-Modell anzeigen“: auswählen und das Fenster einklappen, damit der Viewer frei ist. */
  onShowInViewer(id: number): void;
  onStartBauteilPick(pick: AttributionPick | null): void;
  /** Kurzstatus für Kopfzeile/Chip, wenn das Panel eingeklappt ist. */
  onStatus?(status: AttributionStatus): void;
  /** Öffnet die zentralen Einstellungen im Abschnitt „Fachmodell-Schema“. */
  onOpenSchemaSettings?(): void;
  /** Name der gewählten Schemadatei; `null` = eingebautes Schema. */
  schemaFileName?: string | null;
  /** Zählt bei jedem Schemawechsel hoch — Prüfung und Tabelle rechnen dann neu. */
  schemaRevision?: number;
}) {
  const detected = useMemo(() => detectImportart(document), [document]);
  const [importartOverride, setImportartOverride] = useState<Importart | null>(null);
  // Bauwerksmodelle: `null` = automatisch alle anderen Sessions, die als Bauwerksmodell erkannt sind; sonst die Auswahl des Nutzers.
  const [bauwerksmodellIds, setBauwerksmodellIds] = useState<string[] | null>(null);
  const [view, setView] = useState("table");
  const [showContext, setShowContext] = useState(false);
  const [showTree, setShowTree] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [rowQuery, setRowQuery] = useState("");
  const [fieldQuery, setFieldQuery] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (!feedback) return;
    const timer = globalThis.setTimeout(() => setFeedback(""), 6000);
    return () => globalThis.clearTimeout(timer);
  }, [feedback]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>({ loi: 300, gewerke: [] });
  const [focusedCell, setFocusedCell] = useState<{ rowKey: string; columnKey: string } | null>(null);
  const [editing, setEditing] = useState<{ rowKey: string; columnKey: string; draft: string } | null>(null);
  const [objektartOverride, setObjektartOverride] = useState<TreeNodeKind | null>(null);
  const [newDraft, setNewDraft] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [useClickPoint, setUseClickPoint] = useState(true);
  const [focusCreate, setFocusCreate] = useState(0);
  // Spaltengruppen: nur die Portal-Pflicht ist offen, jede andere Gruppe ist eine Statuszelle je Zeile, bis man sie aufklappt.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [pendingJump, setPendingJump] = useState<{ rowKey: string; psetName?: string; propertyName?: string } | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  // Maus über „Zelle / Zeile / Spalte“ im Inspektor hebt den passenden Bereich der Tabelle hervor.
  const [hoverScope, setHoverScope] = useState<InspectorScope | null>(null);
  const createInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusCreate) createInput.current?.focus();
  }, [focusCreate, createOpen]);
  const [methodDraft, setMethodDraft] = useState("");
  const [showOptional, setShowOptional] = useState(false);

  useEffect(() => {
    setImportartOverride(null);
    setFocusKey(null);
    setFocusedCell(null);
    setEditing(null);
    setObjektartOverride(null);
    setNewDraft("");
    setSelectedRows(new Set());
    setRowQuery("");
    setFieldQuery("");
    setCreateOpen(false);
    setFeedback("");
  }, [activeSessionId]);

  const importart = importartOverride ?? detected;
  const otherSessions = sessions.filter((session) => session.id !== activeSessionId);
  const detectedModelIds = new Set(otherSessions.filter((session) => importartOf(session.document) === "bauwerksmodell").map((session) => session.id));
  const selectedModelIds = bauwerksmodellIds ? bauwerksmodellIds.filter((id) => otherSessions.some((session) => session.id === id)) : [...detectedModelIds];
  // Stabile Liste der Bauwerksmodell-Dokumente: Schlüssel aus Auswahl und Dokument-Token, weil `sessions` je Render neu entsteht.
  const modelsKey = selectedModelIds.map((id) => `${id}:${documentToken(otherSessions.find((session) => session.id === id)!.document)}`).join("|");
  const bauwerksmodelle = useMemo(
    () => selectedModelIds.map((id) => otherSessions.find((session) => session.id === id)!.document),
    [modelsKey], // fasst Auswahl und Dokumentidentität zusammen
  );
  const katalog = katalogFor(importart);

  const validation = useAttributionValidation(document, bauwerksmodelle, importart, schemaRevision);
  const check = useMemo<PortalCheckResult>(() => validation.check ?? { importart, findings: [], errorCount: 0, warningCount: 0, stats: {} }, [validation.check, importart]);
  const ids = validation.ids;
  const tree = useMemo(() => buildFachmodellTree(document, importart, check.findings), [check.findings, document, importart]);
  const bauwerksmodellIndex = useMemo(() => (bauwerksmodelle.length ? buildBauwerksmodellIndex(bauwerksmodelle) : null), [bauwerksmodelle]);
  const referenceOptions = useMemo(() => {
    const result: Partial<Record<ReferenceKind, ReferenceOption[]>> = {};
    const kinds: Partial<Record<TreeNodeKind, ReferenceKind>> = { untersuchungsbereich: "Untersuchungsbereich", untersuchungsziel: "Untersuchungsziel", untersuchungsstelle: "Untersuchungsstelle", messanlage: "Messanlage", massnahme: "Maßnahme", bauteil: "Bauteil" };
    const nodes = [...(tree.root ? collectRows(tree.root) : []), ...collectRows(tree.eimer)];
    for (const node of nodes) {
      const kind = kinds[node.kind];
      if (kind && node.id) (result[kind] ??= []).push({ value: node.id, label: node.label });
    }
    if (bauwerksmodellIndex) result.Bauteil = [...bauwerksmodellIndex.components].map(([id, entry]) => ({ value: id, label: bauwerksmodelle[entry.model]?.entityById.get(entry.entityId)?.name ?? id }));
    for (const kind of Object.keys(result) as ReferenceKind[]) result[kind] = [...new Map(result[kind]!.map((entry) => [entry.value, entry])).values()];
    return result;
  }, [tree, bauwerksmodellIndex, bauwerksmodelle]);

  const focusNode = useMemo(() => (focusKey ? findNode(tree.root, focusKey) ?? findNode(tree.eimer, focusKey) : null) ?? tree.root, [focusKey, tree]);
  const focusRows = useMemo(() => (focusNode ? collectRows(focusNode) : []), [focusNode]);
  // Objektarten unter dem Ast; Container-Arten, die sich hier anlegen lassen, erscheinen auch mit 0 Zeilen.
  const objektarten = useMemo(() => {
    const present = objektartenOf(focusRows);
    if (!focusNode) return present;
    const creatable = new Set<TreeNodeKind>();
    if (focusNode.kind === "projekt" || focusNode.kind === "gruppe") {
      for (const kind of importart === "monitoring" ? ["messanlage", "massnahme"] : importart === "bauwerksmodell" || importart === "ergebnisse" ? [] : ["untersuchungsziel", "untersuchungsbereich"]) creatable.add(kind as TreeNodeKind);
    }
    const child = childKindFor(focusNode, importart);
    if (child) creatable.add(child);
    const missing = [...creatable].filter((kind) => !present.some((entry) => entry.kind === kind)).map((kind) => ({ kind, count: 0 }));
    return [...missing, ...present];
  }, [focusNode, focusRows, importart]);
  const objektart: TreeNodeKind | undefined =
    objektartOverride && objektarten.some((entry) => entry.kind === objektartOverride) ? objektartOverride : focusNode && isTableKind(focusNode.kind) ? focusNode.kind : objektarten.find((entry) => entry.count > 0)?.kind ?? objektarten[0]?.kind;
  const fullTable = useMemo<TableModel>(
    () => buildTable(document, focusRows, { importart, scope, katalog, bauwerksmodell: bauwerksmodellIndex, findings: check.findings, objektart }),
    [bauwerksmodellIndex, check.findings, document, focusRows, importart, katalog, objektart, scope, schemaRevision],
  );
  const filledByColumn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of fullTable.rows) for (const cell of row.cells) {
      if (cell.value) counts.set(cell.column.key, (counts.get(cell.column.key) ?? 0) + 1);
    }
    return counts;
  }, [fullTable]);
  // Ohne „Optionale Spalten" bleiben Portal-Pflicht, Katalog-Pflicht, abgeleitete und gefüllte Spalten — leere optionale verschwinden.
  const table = useMemo<TableModel>(() => {
    const query = fieldQuery.trim().toLocaleLowerCase("de-DE");
    const keep = new Set(
      fullTable.columns
        .filter((column) => query ? query.split(/\s+/).every((term) => `${column.property} ${column.psetLabel} ${column.catalog?.name ?? ""}`.toLocaleLowerCase("de-DE").includes(term)) : showOptional || column.hard || column.soft || column.derived || filledByColumn.has(column.key))
        .map((column) => column.key),
    );
    const groups = fullTable.groups.map((group) => ({ ...group, columns: group.columns.filter((column) => keep.has(column.key)) })).filter((group) => group.columns.length);
    return { ...fullTable, groups, columns: groups.flatMap((group) => group.columns), rows: filterAttributionRows(fullTable.rows, rowQuery).map((row) => ({ ...row, cells: row.cells.filter((cell) => keep.has(cell.column.key)) })) };
  }, [fullTable, showOptional, filledByColumn, fieldQuery, rowQuery]);
  const batchRows = useMemo(() => {
    const visible = new Set(table.rows.map((row) => row.key));
    return fullTable.rows.filter((row) => visible.has(row.key) && selectedRows.has(row.key));
  }, [fullTable, table, selectedRows]);
  const visibleFilledByColumn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of table.rows) for (const cell of row.cells) if (cell.value) counts.set(cell.column.key, (counts.get(cell.column.key) ?? 0) + 1);
    return counts;
  }, [table]);
  useEffect(() => {
    setSelectedRows(new Set());
    setFocusedCell(null);
    setEditing(null);
    setFeedback("");
  }, [focusKey, objektart, importart, schemaRevision]);

  const { scrollRef: tableScroll, range, revealRow } = useAttributionViewport(table.rows.length, view, JSON.stringify([activeSessionId, focusKey, objektart, rowQuery]));
  const rowIndices = useMemo(() => new Map(table.rows.map((row, index) => [row.key, index])), [table.rows]);
  const rowSlots = virtualRowSlots(table.rows.length, range.start, Math.min(range.end, table.rows.length), editing ? rowIndices.get(editing.rowKey) ?? -1 : -1);
  const { widths: columnWidths, resize: resizeColumn } = useAttributionColumnWidths();
  const columnDefault = (column: TableColumn) => column.reference ? 280 : column.property === "ID" ? 260 : column.position ? 140 : 180;
  const columnWidth = (key: string, fallback: number) => columnWidths[key] ?? fallback;
  const resizeHandle = (key: string, label: string, fallback: number) => <AttributionColumnResize label={label} width={columnWidth(key, fallback)} defaultWidth={fallback} onResize={(width, save) => resizeColumn(key, width, save)} />;

  const fullCells = useMemo(() => new Map(fullTable.rows.map((row) => [row.key, row.cells])), [fullTable]);
  const fullGroups = useMemo(() => new Map(fullTable.groups.map((group) => [group.key, group])), [fullTable]);
  const gapColumns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of table.rows) for (const cell of row.cells) if (GAP_STATES.has(cell.state)) keys.add(cell.column.key);
    return keys;
  }, [table]);
  const columnsOf = (group: TableGroup) => (onlyGaps ? group.columns.filter((column) => gapColumns.has(column.key)) : group.columns);
  const visibleGroups = table.groups.filter((group) => columnsOf(group).length > 0);
  const isGroupOpen = (group: TableGroup) => (fieldQuery.trim() || onlyGaps || (group.hard ? !expandedGroups.has(`^${group.key}`) : expandedGroups.has(group.key))) && columnsOf(group).length > 0;
  const toggleGroup = (group: TableGroup) =>
    setExpandedGroups((current) => {
      const next = new Set(current);
      const key = group.hard ? `^${group.key}` : group.key;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const cellsOf = (row: TableRow, group: TableGroup) => {
    const allowed = new Set(columnsOf(group).map((column) => column.key));
    return row.cells.filter((cell) => allowed.has(cell.column.key));
  };
  const cellsOfFull = (row: TableRow, group: TableGroup) => {
    const allowed = new Set((fullGroups.get(group.key)?.columns ?? group.columns).map((column) => column.key));
    return (fullCells.get(row.key) ?? []).filter((cell) => allowed.has(cell.column.key));
  };
  const groupTotals = useMemo(() => new Map(table.groups.map((group) => {
    const totals = { required: 0, ok: 0, filled: 0, total: 0 };
    const allowed = new Set((fullGroups.get(group.key)?.columns ?? group.columns).map((column) => column.key));
    for (const row of table.rows) {
      const summary = summarizeGroup((fullCells.get(row.key) ?? []).filter((cell) => allowed.has(cell.column.key)));
      totals.required += summary.required;
      totals.ok += summary.ok;
      totals.filled += summary.filled;
      totals.total += summary.total;
    }
    return [group.key, totals] as const;
  })), [table, fullGroups, fullCells]);

  /** Befund → Tabelle: Ast des Objekts fokussieren, Objektart setzen, Zelle der Property fokussieren und hinscrollen. */
  const jumpTo = (entityId: number, psetName?: string, propertyName?: string) => {
    let node: TreeNode | null = tree.byEntity.get(entityId) ?? null;
    let psetId: number | undefined;
    if (psetName) {
      const set = (document.propertySetsByEntity.get(entityId) ?? []).find((entry) => stripPsetPrefix(entry.name) === stripPsetPrefix(psetName));
      const psetNode = set ? (findPsetNode(tree.root, entityId, set.id) ?? findPsetNode(tree.eimer, entityId, set.id)) : null;
      if (psetNode && set) {
        node = psetNode;
        psetId = set.id;
      }
    }
    if (!node) {
      onSelectEntity(entityId);
      return;
    }
    const path = findPath(tree.root, node.key) ?? findPath(tree.eimer, node.key) ?? [];
    const parent = path.length >= 2 ? path[path.length - 2]! : (path[0] ?? tree.root);
    setFocusKey(parent?.key ?? null);
    setObjektartOverride(node.kind);
    setRowQuery("");
    setFieldQuery("");
    setOnlyGaps(false);
    setView("table");
    setPendingJump({ rowKey: psetId != null ? `${entityId}:${psetId}` : String(entityId), psetName, propertyName });
  };
  useEffect(() => {
    if (!pendingJump) return;
    const row = fullTable.rows.find((entry) => entry.key === pendingJump.rowKey);
    if (!row) return;
    const wanted = pendingJump.propertyName ? stripPropertyPrefix(pendingJump.propertyName).replace(/_[A-Z0-9ß]{1,6}$/, "").toLowerCase() : "";
    const column = wanted
      ? fullTable.columns.find((entry) => (!pendingJump.psetName || psetMatches(pendingJump.psetName, entry.psetPattern)) && (entry.property.toLowerCase() === wanted || entry.aliase.some((alias) => alias.toLowerCase() === wanted)))
      : undefined;
    const target = column ?? row.cells[0]?.column;
    if (!target) return;
    const group = fullTable.groups.find((entry) => entry.columns.some((candidate) => candidate.key === target.key));
    if (group) setExpandedGroups((current) => {
      const next = new Set(current);
      if (group.hard) next.delete(`^${group.key}`);
      else next.add(group.key);
      return next;
    });
    if (column && !column.hard && !column.soft && !column.derived) setShowOptional(true);
    setFocusedCell({ rowKey: row.key, columnKey: target.key });
    setPendingJump(null);
    setScrollNonce((count) => count + 1);
  }, [fullTable, pendingJump]);
  const lastScrollNonce = useRef(0);
  useEffect(() => {
    if (!scrollNonce || lastScrollNonce.current === scrollNonce || !focusedCell) return;
    const index = rowIndices.get(focusedCell.rowKey) ?? -1;
    const scroller = tableScroll.current;
    if (index < 0 || !scroller) return;
    lastScrollNonce.current = scrollNonce;
    revealRow(index);
    const frame = requestAnimationFrame(() => {
      const element = scroller.querySelector(`[data-cell="${CSS.escape(`${focusedCell.rowKey}|${focusedCell.columnKey}`)}"]`);
      element?.scrollIntoView({ block: "nearest", inline: "center" });
      if (element instanceof HTMLElement) element.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedCell, scrollNonce, table]);

  const idsFailures = ids?.results.filter((result) => result.status === "fail") ?? [];
  const importErrors = check.errorCount + idsFailures.reduce((count, result) => count + Math.max(1, result.failures.length), 0);
  const building = document.entitiesByType.get("IFCBUILDING")?.[0];
  // Nicht angehängte Psets zählen nicht als Lücke: Vollständig misst nur, was das Objekt trägt.
  const [softTotal, softFilled] = useMemo(() => {
    let total = 0;
    let filled = 0;
    for (const row of fullTable.rows) for (const cell of row.cells) {
      if (cell.column.soft && cell.state !== "fehlt") total++;
      if (cell.column.soft && cell.state === "ok") filled++;
    }
    return [total, filled];
  }, [fullTable]);
  const completePercent = softTotal ? Math.round((softFilled / softTotal) * 100) : null;
  useEffect(() => {
    onStatus?.({ importart: describeStats(importart, check.stats), importErrors, complete: completePercent, document, pending: validation.pending, error: validation.error });
    // onStatus ist ein stabiler Setter des Workspace; nur Inhalte lösen aus.
  }, [completePercent, importErrors, importart, check.stats, validation.pending, validation.error, document]);

  const isExpanded = useCallback((node: TreeNode, depth: number) => expanded.has(node.key) || (!expanded.has(`^${node.key}`) && depth < 2), [expanded]);
  const toggle = useCallback((node: TreeNode, depth: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (isExpanded(node, depth)) {
        next.delete(node.key);
        next.add(`^${node.key}`);
      } else {
        next.add(node.key);
        next.delete(`^${node.key}`);
      }
      return next;
    });
  }, [isExpanded]);

  const focusedRow = focusedCell ? table.rows.find((row) => row.key === focusedCell.rowKey) : undefined;
  const focusedTableCell = focusedRow?.cells.find((cell) => cell.column.key === focusedCell?.columnKey);

  const commitCell = (row: TableRow, cell: TableCell, value: string) => {
    const column = cell.column;
    onCommit(
      (current) => {
        const next = writeCell(current, row, column, value, importart);
        return column.position && next !== current ? { document: next, movedEntityIds: [row.entityId] } : next;
      },
      `${column.property} auf ${row.psetName ?? `#${row.entityId}`}`,
      `attribution.set({ id: ${row.entityId}, pset: ${JSON.stringify(row.psetName ?? column.psetLabel)}, property: ${JSON.stringify(column.property)} });`,
    );
    setEditing(null);
  };

  // Anlegen: Wiederholgruppen (Ziel, Bereich, Messanlage, Maßnahme, Kanal) als Pset am Träger, Fachobjekte (Stelle, Probe, Sensor)
  // als IfcBuildingElementProxy mit Marker-Körper. Träger und ID-Präfix kommen aus dem fokussierten Ast.
  const activeKind: TreeNodeKind | undefined = table.objektart ?? objektart;
  const createKind: TreeNodeKind | null =
    activeKind && (REPEAT_GROUPS[activeKind] || FACHOBJEKTE[activeKind]) ? activeKind : focusNode?.kind === "sensor" ? "kanal" : focusNode?.kind === "untersuchungsstelle" ? "probe" : null;
  const repeat = createKind ? REPEAT_GROUPS[createKind] : undefined;
  const fachobjekt = createKind ? FACHOBJEKTE[createKind] : undefined;
  const createLabel = repeat?.label ?? fachobjekt?.label ?? "";
  const projektId = tree.root?.id ?? "";
  const focusEntity = (kind: TreeNodeKind) => (focusNode?.kind === kind && focusNode.entityId != null && focusNode.psetId == null ? focusNode : null);
  const createTarget: { entityId: number; parentId: string; placementRelativeToId?: number; values?: Record<string, Record<string, string>> } | null = (() => {
    if (repeat) {
      if (repeat.parent === "sensor") {
        const sensor = focusEntity("sensor");
        return sensor ? { entityId: sensor.entityId!, parentId: sensor.id ?? "" } : null;
      }
      return building ? { entityId: building.id, parentId: projektId } : null;
    }
    if (fachobjekt) {
      const storey = document.entitiesByType.get("IFCBUILDINGSTOREY")?.[0] ?? building;
      if (!storey) return null;
      if (fachobjekt.parent === "untersuchungsstelle") {
        const stelle = focusEntity("untersuchungsstelle");
        return stelle ? { entityId: storey.id, parentId: stelle.id ?? "", placementRelativeToId: stelle.entityId } : null;
      }
      const values: Record<string, Record<string, string>> = {};
      if (fachobjekt.context && focusNode?.kind === fachobjekt.context.kind && focusNode.id) values[fachobjekt.context.pset] = { [fachobjekt.context.property]: focusNode.id };
      const reference = selectedId && document.entityById.get(selectedId)?.type === "IFCBUILDINGELEMENTPROXY" ? selectedId : undefined;
      return { entityId: storey.id, parentId: projektId, placementRelativeToId: reference, values };
    }
    return null;
  })();
  // Klickpunkt aus dem Viewer (Viewer-Achsen, m) → IFC-Welt in Modelleinheiten; nur Picks in dieser Datei zählen.
  const clickPoint = useMemo(() => {
    if (!coordinateClipboard || (coordinateClipboard.documentId && coordinateClipboard.documentId !== activeSessionId)) return null;
    const x = Number(coordinateClipboard.x);
    const y = Number(coordinateClipboard.y);
    const z = Number(coordinateClipboard.z);
    if (![x, y, z].every(Number.isFinite)) return null;
    return { viewer: { x, y, z }, ifc: viewerWorldPointToIfcPlacementPoint({ x, y, z }, getNativeLengthUnitScale(document)), copiedAt: coordinateClipboard.copiedAt };
  }, [activeSessionId, coordinateClipboard, document]);
  const placeAtClickPoint = Boolean(fachobjekt && clickPoint && useClickPoint);
  const createHint = repeat?.parent === "sensor" ? "Links einen Sensor wählen, um seine Kanäle anzulegen." : fachobjekt?.parent === "untersuchungsstelle" ? "Links eine Untersuchungsstelle wählen, um ihre Proben anzulegen." : "Zum Anlegen wird ein Gebäude mit Geschoss benötigt.";
  const createPlacementHint = fachobjekt
    ? placeAtClickPoint && clickPoint
      ? `Marker am Klickpunkt ${formatMeters(clickPoint.ifc.x)} / ${formatMeters(clickPoint.ifc.y)} / ${formatMeters(clickPoint.ifc.z)}`
      : createTarget?.placementRelativeToId != null
        ? `Marker an der Platzierung von #${createTarget.placementRelativeToId}`
        : "Marker am Ursprung des Geschosses; später im Viewer verschieben"
    : "";
  // Eine Zeile anlegen — auch der Tabellenimport nutzt das; ordinal versetzt Marker, damit sie nicht übereinander liegen.
  const createRow = (current: NativeIfcDocument, bezeichnung: string, ordinal: number): { document: NativeIfcDocument; entityId: number; psetId?: number } | null => {
    if (!createKind || !createTarget) return null;
    if (repeat) {
      const index = nextRepeatIndex(current, createTarget.entityId, repeat.familie);
      const next = addRepeatPset(current, createTarget.entityId, createKind, importart, { ID: childId(createTarget.parentId, bezeichnung), Bezeichnung: bezeichnung });
      const set = findPset(next, createTarget.entityId, `${repeat.base}${index}`);
      return next === current || !set ? null : { document: next, entityId: createTarget.entityId, psetId: set.id };
    }
    const result = addFachobjekt(current, {
      kind: createKind,
      importart,
      bezeichnung,
      parentId: createTarget.parentId,
      storeyId: createTarget.entityId,
      placementRelativeToId: createTarget.placementRelativeToId,
      offset: { x: 0.5 * ordinal },
      // Mehrere neue Marker stehen nebeneinander; Import-Koordinaten überschreiben die Vorbelegung.
      worldPosition: placeAtClickPoint && clickPoint ? { ...clickPoint.ifc, x: clickPoint.ifc.x + 0.5 * ordinal / getNativeLengthUnitScale(current) } : undefined,
      values: createTarget.values,
    });
    return result.entityId < 0 ? null : { document: result.document, entityId: result.entityId };
  };
  const existingIds = useMemo(() => new Set([...(tree.root ? collectRows(tree.root) : []), ...collectRows(tree.eimer)].flatMap((node) => node.id ? [node.id] : [])), [tree]);
  const creationPlan = useMemo(() => planObjectNames(newDraft, createTarget?.parentId ?? "", existingIds), [newDraft, createTarget?.parentId, existingIds]);
  const createOne = () => {
    if (!createKind || !createTarget || !creationPlan.entries.length || creationPlan.duplicates.length) return;
    onCommit(
      (current) => {
        let next = current;
        const createdEntityIds: number[] = [];
        for (const [index, entry] of creationPlan.entries.entries()) {
          const result = createRow(next, entry.name, index);
          if (!result) return current;
          next = result.document;
          if (fachobjekt) createdEntityIds.push(result.entityId);
        }
        return { document: next, createdEntityIds };
      },
      `${creationPlan.entries.length} × ${createLabel} anlegen`,
      `attribution.add({ kind: ${JSON.stringify(createKind)}, count: ${creationPlan.entries.length}, parent: ${JSON.stringify(createTarget.parentId)} });`,
    );
    setNewDraft("");
    setRowQuery("");
    setFeedback(`${creationPlan.entries.length} × ${createLabel} angelegt. Weitere Bezeichnungen eingeben oder Eigenschaften in der Tabelle ergänzen.`);
    setObjektartOverride(createKind);
    createInput.current?.focus();
  };
  const canImportCreate = Boolean(createKind && createTarget && createKind === activeKind);

  const attachToRow = (row: TableRow, group: TableGroup) => {
    if (row.psetId != null) return;
    onCommit((current) => attachPset(current, row.entityId, group.psetPattern, group.label, importart), `${group.label} an #${row.entityId}`, `attribution.attach({ id: ${row.entityId}, pset: ${JSON.stringify(group.label)} });`);
  };
  /** Spaltenaktion: Wert in alle leeren (oder alle) Zellen der Spalte schreiben; nicht anwendbare und abgeleitete bleiben aus. */
  const applyColumnChanges = (column: TableColumn, changes: CellChange[]) => {
    if (!changes.length) return;
    onCommit(
      (current) => {
        let next = current;
        for (const change of changes) next = writeCell(next, change.row, column, change.after, importart);
        return next;
      },
      `${column.property} an ${changes.length} ausgewählten Objekten`,
      `attribution.fillColumn({ pset: ${JSON.stringify(column.psetLabel)}, property: ${JSON.stringify(column.property)}, count: ${changes.length} });`,
    );
    setFeedback(`${changes.length} Werte für ${column.property} übernommen.`);
  };

  const highlightRow = (row: TableRow) => hoverScope === "row" && focusedCell?.rowKey === row.key;
  const highlightColumn = (columnKey: string) => hoverScope === "column" && focusedCell?.columnKey === columnKey;

  const navigateNode = useCallback((node: TreeNode, create = false) => {
    setFocusKey(node.key);
    setObjektartOverride(create ? childKindFor(node, importart) : null);
    setRowQuery("");
    setFieldQuery("");
    setOnlyGaps(false);
    setView("table");
    setCreateOpen(create);
    setNewDraft("");
    if (create) setFocusCreate((count) => count + 1);
  }, [importart]);
  // Scrolling and dragging table columns must not rerender thousands of unrelated tree nodes.
  const structureRows = useMemo(() => [tree.root, tree.eimer.children.length ? tree.eimer : null].map((node) => node ? <TreeRows key={node.key} node={node} depth={0} selectedId={selectedId} focusKey={focusNode?.key ?? null} isExpanded={isExpanded} onToggle={toggle} onSelect={onSelectEntity} onFocus={(entry) => navigateNode(entry)} createLabel={(entry) => { const kind = childKindFor(entry, importart); return kind ? KIND_LABELS[kind] || kind : null; }} onShow={onShowInViewer} onCreate={(entry) => navigateNode(entry, true)} /> : null), [tree, selectedId, focusNode?.key, isExpanded, toggle, onSelectEntity, navigateNode, importart, onShowInViewer]);
  const visibleColumns = visibleGroups.flatMap((group) => isGroupOpen(group) ? columnsOf(group) : []);
  const layoutColumns = [{ key: "@object", width: columnWidth("@object", 240) }, ...visibleGroups.flatMap((group) => isGroupOpen(group) ? columnsOf(group).map((column) => ({ key: column.key, width: columnWidth(column.key, columnDefault(column)) })) : [{ key: `group:${group.key}`, width: columnWidth(`group:${group.key}`, 160) }])];
  const tableWidth = layoutColumns.reduce((sum, column) => sum + column.width, 0);
  const moveCellFocus = (row: TableRow, cell: TableCell, direction: "next" | "previous" | "down" | "up") => {
    let rowIndex = table.rows.findIndex((entry) => entry.key === row.key);
    let columnIndex = visibleColumns.findIndex((column) => column.key === cell.column.key);
    if (direction === "down" || direction === "up") rowIndex += direction === "down" ? 1 : -1;
    else {
      columnIndex += direction === "next" ? 1 : -1;
      if (columnIndex >= visibleColumns.length) { columnIndex = 0; rowIndex++; }
      if (columnIndex < 0) { columnIndex = visibleColumns.length - 1; rowIndex--; }
    }
    const targetRow = table.rows[rowIndex];
    const targetColumn = visibleColumns[columnIndex];
    if (targetRow && targetColumn) {
      setFocusedCell({ rowKey: targetRow.key, columnKey: targetColumn.key });
      setScrollNonce((count) => count + 1);
    }
  };
  const nextGap = () => {
    const gaps = fullTable.rows.flatMap((row) => row.cells.filter((cell) => GAP_STATES.has(cell.state)).map((cell) => ({ row, cell })));
    if (!gaps.length) return;
    const index = gaps.findIndex(({ row, cell }) => row.key === focusedCell?.rowKey && cell.column.key === focusedCell.columnKey);
    const next = gaps[(index + 1) % gaps.length]!;
    jumpTo(next.row.entityId, next.row.psetName ?? next.cell.column.psetLabel, next.cell.column.property);
  };

  const renderCell = (row: TableRow, cell: TableCell) => {
    const meta = STATE_META[cell.state];
    const isEditing = editing?.rowKey === row.key && editing.columnKey === cell.column.key;
    const isFocused = focusedCell?.rowKey === row.key && focusedCell.columnKey === cell.column.key;
    const editable = cell.state !== "na" && cell.state !== "abgeleitet";
    return (
      <td
        key={cell.column.key}
        data-cell={`${row.key}|${cell.column.key}`}
        tabIndex={isFocused || (!focusedCell && row === table.rows[0] && cell.column === visibleColumns[0]) ? 0 : -1}
        aria-label={`${row.label}: ${cell.column.property}, ${cell.value || "leer"}`}
        onKeyDown={(event) => {
          if (isEditing) return;
          if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            moveCellFocus(row, cell, event.key === "ArrowRight" ? "next" : event.key === "ArrowLeft" ? "previous" : event.key === "ArrowDown" ? "down" : "up");
          } else if (editable && (event.key === "Enter" || event.key === "F2" || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey))) {
            event.preventDefault();
            setEditing({ rowKey: row.key, columnKey: cell.column.key, draft: event.key.length === 1 ? event.key : cell.value });
          }
        }}
        title={editable && cell.column.reference ? `${cell.column.reference} auswählen · nach ID oder Bezeichnung suchen` : cell.state === "fehlt" ? "Pset nicht am Objekt — Doppelklick und Eingabe legen es an" : cell.note ? `${cell.note}${cell.value ? "" : " — leer, Doppelklick zum Ausfüllen"}` : undefined}
        className={cn(
          "h-8 overflow-hidden border-b border-r border-border/50 px-2 py-0 font-mono text-[11px] whitespace-nowrap transition-colors",
          meta.className,
          editable && cell.column.reference && "cursor-pointer",
          isFocused && "outline outline-2 -outline-offset-2 outline-primary",
          highlightRow(row) && "bg-accent/60",
          highlightColumn(cell.column.key) && "bg-accent/60",
          hoverScope === "cell" && isFocused && "bg-accent",
        )}
        onClick={() => {
          setFocusedCell({ rowKey: row.key, columnKey: cell.column.key });
          if (!isEditing && editable && cell.column.reference) setEditing({ rowKey: row.key, columnKey: cell.column.key, draft: cell.value });
        }}
        onDoubleClick={() => editable && setEditing({ rowKey: row.key, columnKey: cell.column.key, draft: cell.value })}
      >
        {isEditing ? (
          <AttributionCellEditor
            label={`${cell.column.property} für ${row.label}`}
            initialValue={editing.draft}
            position={Boolean(cell.column.position)}
            reference={cell.column.reference}
            suggestions={cell.column.reference ? referenceOptions[cell.column.reference] : undefined}
            onCommit={(value) => commitCell(row, cell, value)}
            onCancel={() => { setEditing(null); setScrollNonce((count) => count + 1); }}
            onNavigate={(direction) => moveCellFocus(row, cell, direction)}
          />
        ) : (
          <span className="flex h-[31px] min-w-0 items-center gap-1.5 overflow-hidden">
            <span className="min-w-0 truncate">{cell.value}</span>
            {cell.target ? <span className="truncate text-muted-foreground">→ {cell.target}</span> : null}
            {meta.tone && meta.label && cell.value ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
            {editable && cell.column.reference ? <ChevronDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" /> : null}
          </span>
        )}
      </td>
    );
  };

  const availableMethods = focusedRow && focusedRow.psetId == null
    ? listMethodPsets().filter((pattern) => !document.propertySetsByEntity.get(focusedRow.entityId)?.some((set) => new RegExp(`^(?:ePset_|Pset_|ePSet_)?(?:${pattern})$`).test(set.name)))
    : [];

  return (
    <div className="attribution-workbench flex h-full min-h-0 flex-col gap-3">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/70 pb-3">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Columns3 className="size-4" /></span><h2 className="text-base font-semibold tracking-tight">Objekte attribuieren</h2></div>
          <p className="mt-1 max-w-96 truncate text-xs text-muted-foreground" title={document.fileName}>{document.fileName} · {importartLabel(importart)}</p>
        </div>
        <SegmentedControl options={VIEWS.map((entry) => entry.value === "findings" ? { ...entry, label: `Prüfung${validation.pending ? " …" : importErrors ? ` (${importErrors})` : ""}` } : entry)} value={view} onChange={setView} />
        <button type="button" aria-expanded={showContext} onClick={() => setShowContext(!showContext)} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-2 text-xs hover:bg-muted"><Settings2 className="size-3.5" />Schema & Kontext</button>
      </header>
      {showContext ? <div className="shrink-0 space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="grid shrink-0 gap-2 sm:grid-cols-2">
        <DropdownField
          label="Importart"
          options={IMPORTARTEN.map((art) => ({ label: importartLabel(art), value: art, detail: art === detected ? "erkannt" : undefined }))}
          value={importart}
          onChange={(value) => setImportartOverride(value as Importart)}
        />
        <div className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
          <span>
            Bauwerksmodelle
            {otherSessions.length ? <span className="ml-1 text-muted-foreground/80">{selectedModelIds.length} von {otherSessions.length} geladenen Dateien</span> : null}
          </span>
          {otherSessions.length ? (
            <div className="flex min-h-7 flex-wrap items-center gap-1" role="group" aria-label="Bauwerksmodelle für Bauteil-Referenzen">
              {otherSessions.map((session) => {
                const on = selectedModelIds.includes(session.id);
                const detected = detectedModelIds.has(session.id);
                return (
                  <button
                    key={session.id}
                    type="button"
                    aria-pressed={on}
                    title={
                      on
                        ? `${session.fileName}: Bauteil-Referenzen werden gegen diese Datei aufgelöst — Klick nimmt sie heraus`
                        : `${session.fileName}${detected ? " (als Bauwerksmodell erkannt)" : " (nicht als Bauwerksmodell erkannt)"} — Klick nimmt sie in die Prüfung auf`
                    }
                    className={cn(
                      "max-w-full truncate rounded border px-1.5 py-0.5 text-[10.5px] font-medium",
                      on ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() =>
                      setBauwerksmodellIds(on ? selectedModelIds.filter((id) => id !== session.id) : [...selectedModelIds, session.id])
                    }
                  >
                    {session.fileName}
                  </button>
                );
              })}
              {bauwerksmodellIds && detectedModelIds.size ? (
                <button type="button" className="text-[10.5px] text-muted-foreground underline-offset-2 hover:underline" title="Wieder alle erkannten Bauwerksmodelle verwenden" onClick={() => setBauwerksmodellIds(null)}>
                  automatisch
                </button>
              ) : null}
            </div>
          ) : (
            <span className="min-h-7 leading-7 text-[11px]">Keins geladen — Bauteil-Referenzen bleiben ungeprüft. Weitere IFCs über „Datei → IFC hinzufügen…“ öffnen.</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {tree.root?.id ? (
          <>
            <span className="font-medium text-foreground">Kontext</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{tree.root.id}</code>
          </>
        ) : null}
        {ids ? <Badge tone={idsFailures.length ? "warning" : "success"}>IDS {ids.results.length - idsFailures.length}/{ids.results.length}</Badge> : <Badge tone="neutral">keine IDS</Badge>}
        <button
          type="button"
          className="rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          title={`${isBuiltinSchemaActive() ? "Eingebautes Fachmodell-Schema" : `Schemadatei ${schemaFileName ?? ""}`} — Klick öffnet die Einstellungen`}
          onClick={onOpenSchemaSettings}
        >
          <Badge tone={isBuiltinSchemaActive() ? "neutral" : "info"}>Schema: {isBuiltinSchemaActive() ? "eingebaut" : schemaFileName ?? "Datei"}</Badge>
        </button>
        {bauteilPick ? <Badge tone="info">Bauteil wählen: Klick im Viewer auf eines der Bauwerksmodelle …</Badge> : null}
        {katalog ? (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="font-mono text-[9.5px] uppercase tracking-wide">LoI</span>
            <SegmentedControl options={LOI_OPTIONS} value={String(scope.loi)} onChange={(value) => setScope((current) => ({ ...current, loi: Number(value) as LoiLevel }))} />
            {katalog.gewerke.map((gewerk) => (
              <button
                key={gewerk}
                type="button"
                className={cn("rounded border px-1.5 py-0.5 text-[10.5px] font-medium", scope.gewerke.includes(gewerk) ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground")}
                onClick={() => setScope((current) => ({ ...current, gewerke: current.gewerke.includes(gewerk) ? current.gewerke.filter((entry) => entry !== gewerk) : [...current.gewerke, gewerk] }))}
              >
                {gewerk}
              </button>
            ))}
          </span>
        ) : null}
      </div>

      </div> : null}
      <div className={cn("grid min-h-0 flex-1 gap-3", showTree && view === "table" ? "grid-cols-[minmax(180px,240px)_minmax(0,1fr)] max-[760px]:grid-cols-1" : "grid-cols-1")}>
        {showTree && view === "table" ? (
          <aside aria-label="Fachmodell-Struktur" className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-muted/15 max-[760px]:max-h-44">
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-3 text-xs font-semibold"><ListTree className="size-4 text-primary" />Fachmodell<span className="ml-auto text-[10px] font-normal text-muted-foreground">Objekte wählen</span></div>
            <div className="min-h-0 flex-1 overflow-auto py-2">
              {structureRows}
            </div>
            <p className="border-t border-border/60 p-3 text-[11px] leading-relaxed text-muted-foreground">Ein Klick zeigt die Objekte des Bereichs. Mit + direkt darunter anlegen.</p>
          </aside>
        ) : null}
        <div className="min-h-0 min-w-0">
      {!building ? (
        <EmptyState title="Kein Gebäude vorhanden" description="Zum Attribuieren braucht die Datei ein Gebäude. Dieses zuerst im Baukasten anlegen oder ein Fachmodell öffnen." />
      ) : view === "table" ? (
        <PanelShell>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
            <button type="button" aria-label="Fachmodell-Struktur ein- oder ausblenden" aria-expanded={showTree} onClick={() => setShowTree(!showTree)} className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"><ListTree className="size-4" /></button>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => { setFocusKey(null); setObjektartOverride(null); setRowQuery(""); setNewDraft(""); setCreateOpen(false); }}>Fachmodell</button>
            <ChevronRight className="size-3 text-muted-foreground" />
            <span className="max-w-64 truncate font-medium" title={focusNode?.id}>{focusNode?.label ?? "Alle Objekte"}</span>
            <span className="text-muted-foreground">{fullTable.rows.length} Objekte</span>
            <div className="ml-auto flex gap-2">
              <Button disabled={!fullTable.columns.length} onClick={() => setImportOpen(true)}><FileUp className="size-3.5" />Excel / CSV</Button>
              {createKind ? <Button variant="default" onClick={() => { setCreateOpen(!createOpen); setFocusCreate((count) => count + 1); }}><Plus className="size-3.5" />{createLabel} anlegen</Button> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1 border-b border-border/60 pb-2" role="group" aria-label="Objektart">
            {objektarten.map((entry) => <button key={entry.kind} type="button" aria-pressed={activeKind === entry.kind} className={cn("flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", activeKind === entry.kind ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted")} onClick={() => { setObjektartOverride(entry.kind); setFocusedCell(null); setEditing(null); setRowQuery(""); setFieldQuery(""); setOnlyGaps(false); setNewDraft(""); }}><span>{KIND_LABELS[entry.kind] || entry.kind}</span><span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] tabular-nums">{entry.count}</span></button>)}
          </div>
          {createOpen && createKind ? (
            <section aria-label="Fachobjekte anlegen" className="grid shrink-0 gap-3 rounded-lg border border-primary/25 bg-accent/15 p-3 md:grid-cols-[minmax(180px,1fr)_minmax(200px,1.2fr)]">
              <div>
                <label htmlFor="attribution-create-names" className="mb-1.5 block text-xs font-semibold">{createLabel} anlegen · eine Bezeichnung je Zeile</label>
                <Textarea id="attribution-create-names" ref={createInput} className="min-h-16 text-xs" placeholder="Bezeichnung eingeben …" value={newDraft} onChange={(event) => setNewDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); createOne(); } }} />
                <p className="mt-1 text-[11px] text-muted-foreground">Mehrere Namen aus Excel einfügen. Strg+Enter legt sie gemeinsam an.</p>
              </div>
              <div className="flex min-w-0 flex-col gap-2 text-xs">
                <p><span className="text-muted-foreground">Zuordnung:</span> <strong>{focusNode?.label}</strong></p>
                {creationPlan.entries.length ? <p className="truncate font-mono text-[11px] text-muted-foreground" title={creationPlan.entries.map((entry) => entry.id).join("\n")}>ID: {creationPlan.entries[0]?.id}{creationPlan.entries.length > 1 ? ` · +${creationPlan.entries.length - 1} weitere` : ""}</p> : <p className="text-muted-foreground">IDs und Schemafelder werden automatisch vorbereitet.</p>}
                {creationPlan.duplicates.length ? <p role="alert" className="break-all text-destructive">ID bereits vergeben: {creationPlan.duplicates.slice(0, 3).join(", ")}. Bitte eindeutige Bezeichnungen verwenden.</p> : null}
                {!createTarget ? <p className="text-warning">{createHint}</p> : null}
                {fachobjekt ? <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span>{createPlacementHint}</span>{clickPoint ? <button type="button" aria-pressed={placeAtClickPoint} className="flex items-center gap-1 text-primary" onClick={() => setUseClickPoint(!useClickPoint)}><LocateFixed className="size-3" />{placeAtClickPoint ? "Klickpunkt verwenden ✓" : "Klickpunkt verwenden"}</button> : null}</div> : null}
                <div className="mt-auto flex items-center gap-2"><Button variant="default" disabled={!creationPlan.entries.length || !!creationPlan.duplicates.length || !createTarget} onClick={createOne}><Plus className="size-3.5" />{creationPlan.entries.length > 1 ? `${creationPlan.entries.length} Objekte anlegen` : "Anlegen"}</Button><Button variant="ghost" onClick={() => setCreateOpen(false)}>Schließen</Button></div>
              </div>
            </section>
          ) : null}
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
            <label className="relative min-w-40 flex-1"><Search className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-muted-foreground" /><Input aria-label="Objekte durchsuchen" placeholder="Objekt, ID oder Wert suchen …" className="h-8 pl-7 text-xs" value={rowQuery} onChange={(event) => { setRowQuery(event.target.value); setSelectedRows(new Set()); }} /></label>
            <label className="relative min-w-36 flex-1"><Search className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-muted-foreground" /><Input aria-label="Schemafelder durchsuchen" placeholder="Eigenschaft oder Pset suchen …" className="h-8 pl-7 text-xs" value={fieldQuery} onChange={(event) => { setFieldQuery(event.target.value); setOnlyGaps(false); }} /></label>
            <button type="button" aria-pressed={onlyGaps} className={cn("h-8 rounded-md border px-2.5", onlyGaps ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground")} onClick={() => { setOnlyGaps(!onlyGaps); setFieldQuery(""); }}>Nur Lücken{gapColumns.size ? ` (${gapColumns.size})` : ""}</button>
            <button type="button" aria-pressed={showOptional} className={cn("h-8 rounded-md border px-2.5", showOptional ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground")} onClick={() => setShowOptional(!showOptional)}>Optionale Felder</button>
            <Button disabled={!gapColumns.size} onClick={nextGap}>Nächste Lücke<ArrowRight className="size-3.5" /></Button>
          </div>
          {batchRows.length ? <AttributionBatchBar key={`${activeSessionId}:${focusNode?.key}:${activeKind}:${schemaRevision}`} rows={batchRows} columns={fullTable.columns} references={referenceOptions} onApply={applyColumnChanges} onClear={() => setSelectedRows(new Set())} /> : null}
          {feedback ? <p role="status" className="shrink-0 rounded-md bg-success/10 px-3 py-2 text-xs text-success">{feedback}</p> : null}
          {table.rows.length > 0 && !visibleGroups.length ? <p role="status" className="shrink-0 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{onlyGaps ? "Keine Lücken in den angezeigten Feldern." : "Keine passenden Schemafelder. Suche ändern oder entfernen."}</p> : null}
          {table.rows.length ? (
            <div ref={tableScroll} className="min-h-0 flex-1 overflow-auto rounded-md border border-border/60 bg-card [overflow-anchor:none]">
              <table aria-label="Eigenschaften der Fachobjekte" aria-rowcount={table.rows.length + 2} aria-colcount={layoutColumns.length} style={{ width: tableWidth }} className="attribution-virtual-table table-fixed border-separate border-spacing-0 text-xs">
                <colgroup>{layoutColumns.map((column) => <col key={column.key} style={{ width: column.width }} />)}</colgroup>
                <thead className="sticky top-0 z-20 bg-muted/80 backdrop-blur">
                  <tr>
                    <th className="sticky left-0 z-20 overflow-hidden border-b border-r border-border/60 bg-muted px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground">{KIND_LABELS[table.objektart!] || "Objekt"}</th>
                    {visibleGroups.map((group) => {
                      const open = isGroupOpen(group);
                      return (
                        <th key={group.key} colSpan={open ? columnsOf(group).length : 1} className={cn("overflow-hidden border-b border-r border-border/60 px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-wider", group.hard ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
                          <button type="button" className="flex w-full min-w-0 items-center gap-1" title={open ? "Gruppe zuklappen" : `Gruppe aufklappen · ${group.columns.length} Spalten`} onClick={() => toggleGroup(group)}>
                            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            <span className="truncate">{group.label}{group.hard ? " · Portal-Pflicht" : ""}</span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    <th className="sticky left-0 z-20 overflow-hidden border-b border-r border-border/60 bg-muted px-2 py-1 text-left text-[11px] font-normal text-muted-foreground"><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" aria-label="Alle sichtbaren Objekte auswählen" checked={batchRows.length === table.rows.length} ref={(input) => { if (input) input.indeterminate = batchRows.length > 0 && batchRows.length < table.rows.length; }} onChange={(event) => setSelectedRows(event.target.checked ? new Set(table.rows.map((row) => row.key)) : new Set())} className="size-3.5 shrink-0 accent-primary" /><span className="truncate">{table.rows.length} von {fullTable.rows.length}</span></label>{resizeHandle("@object", "Objekt", 240)}</th>
                    {visibleGroups.map((group) => {
                      if (isGroupOpen(group)) {
                        return columnsOf(group).map((column) => {
                          const filled = visibleFilledByColumn.get(column.key) ?? 0;
                          return (
                            <th key={column.key} className={cn("relative overflow-hidden border-b border-r border-border/60 px-2 py-1 text-left align-bottom font-medium text-foreground transition-colors", highlightColumn(column.key) && "bg-accent")} title={column.catalog ? `${column.catalog.typ} · ${column.catalog.format ?? ""} · LoI ${column.catalog.loi.join("/")} · ${column.catalog.gewerk.join(" ")} · Zeile ${column.catalog.zeile}` : column.property}>
                              <span className="flex items-center gap-1">
                                <span className="truncate">{column.property}</span>
                                {column.derived ? <Badge tone="neutral">abgel.</Badge> : column.soft ? <Badge tone="info">LoI</Badge> : null}
                              </span>
                              <span className="mt-0.5 block h-0.5 w-full overflow-hidden rounded bg-border">
                                <span className={cn("block h-full", filled === table.rows.length ? "bg-success" : filled ? "bg-warning" : "bg-destructive")} style={{ width: `${(filled / table.rows.length) * 100}%` }} />
                              </span>
                              <span className="font-mono text-[9px] text-muted-foreground">{filled}/{table.rows.length}</span>
                              {resizeHandle(column.key, `${column.psetLabel} · ${column.property}`, columnDefault(column))}
                            </th>
                          );
                        });
                      }
                      const stats = groupTotals.get(group.key)!;
                      const denominator = stats.required || stats.total || 1;
                      const numerator = stats.required ? stats.ok : stats.filled;
                      return (
                        <th key={group.key} className="relative overflow-hidden border-b border-r border-border/60 px-2 py-1 text-left align-bottom font-normal text-muted-foreground" title={stats.required ? "Erfüllte Pflichtfelder / Pflichtfelder in dieser Gruppe über alle Zeilen" : "Gefüllte Felder / Felder in dieser Gruppe über alle Zeilen"}>
                          <span className="block truncate font-mono text-[10px]">{numerator}/{denominator} {stats.required ? "Pflicht" : "gefüllt"}</span>
                          <span className="mt-0.5 block h-0.5 w-full overflow-hidden rounded bg-border">
                            <span className={cn("block h-full", numerator === denominator ? "bg-success" : numerator ? "bg-warning" : "bg-destructive")} style={{ width: `${(numerator / denominator) * 100}%` }} />
                          </span>
                          {resizeHandle(`group:${group.key}`, group.label, 160)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rowSlots.map(({ index, gap }) => { const row = table.rows[index]!; return (
                    <Fragment key={row.key}>
                    {gap > 0 ? <tr aria-hidden="true"><td colSpan={layoutColumns.length} style={{ height: gap * ROW_HEIGHT, padding: 0, border: 0 }} /></tr> : null}
                    <tr aria-rowindex={index + 3} style={{ height: ROW_HEIGHT }} className={cn((selectedRows.has(row.key) || row.psetId == null && row.entityId === selectedId) && "bg-accent/40")}>
                      <td className={cn("sticky left-0 z-10 overflow-hidden border-b border-r border-border/50 bg-card px-2 py-0 transition-colors", (highlightRow(row) || selectedRows.has(row.key)) && "bg-accent")} title={row.id}>
                        <span className="flex h-[31px] w-full items-center gap-2 overflow-hidden">
                          <input type="checkbox" aria-label={`${row.label} auswählen`} checked={selectedRows.has(row.key)} onChange={(event) => { const checked = event.target.checked; setSelectedRows((current) => { const next = new Set(current); if (checked) next.add(row.key); else next.delete(row.key); return next; }); }} className="size-3.5 shrink-0 accent-primary" />
                          <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => onSelectEntity(row.entityId)}>
                            <span className="truncate font-medium">{row.label}</span>
                            {row.importErrors ? <Badge tone="danger">{row.importErrors}</Badge> : null}
                          </button>
                          {row.psetId == null ? (
                            <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Im 3D-Modell anzeigen (Fenster klappt ein)" aria-label="Im 3D-Modell anzeigen" onClick={() => onShowInViewer(row.entityId)}>
                              <Box className="size-3.5" />
                            </button>
                          ) : null}
                        </span>
                      </td>
                      {visibleGroups.map((group) => {
                        if (isGroupOpen(group)) return cellsOf(row, group).map((cell) => renderCell(row, cell));
                        const summary = summarizeGroup(cellsOfFull(row, group));
                        const meta = STATE_META[summary.state];
                        if (summary.state === "fehlt") {
                          return (
                            <td key={group.key} className={cn("h-7 border-b border-r border-border/50 px-2 py-0 font-mono text-[11px] whitespace-nowrap", meta.className, highlightRow(row) && "bg-accent/60")} title={`${group.label} liegt nicht an diesem Objekt`}>
                              <span className="flex h-[31px] items-center gap-1.5 overflow-hidden">
                                <span>—</span>
                                {row.psetId == null ? (
                                  <button type="button" className="rounded px-1 text-[10px] text-primary hover:bg-muted" title={`${group.label} mit leeren Katalogfeldern anlegen`} onClick={() => attachToRow(row, group)}>
                                    + anhängen
                                  </button>
                                ) : null}
                              </span>
                            </td>
                          );
                        }
                        return (
                          <td
                            key={group.key}
                            className={cn("h-7 cursor-pointer border-b border-r border-border/50 px-2 py-0 font-mono text-[11px] whitespace-nowrap", meta.className, highlightRow(row) && "bg-accent/60")}
                            title={summary.missing.length ? `Offen: ${summary.missing.join(", ")}${summary.missing.length < summary.missingCount ? " …" : ""} — Klick klappt die Gruppe auf` : "Klick klappt die Gruppe auf"}
                            onClick={() => toggleGroup(group)}
                          >
                            <span className="flex h-[31px] items-center gap-1.5 overflow-hidden">
                              <span>{summary.required ? `${summary.ok}/${summary.required}` : `${summary.filled}/${summary.total}`}</span>
                              {summary.state === "import" ? <Badge tone="danger">Import</Badge> : summary.state === "typ" ? <Badge tone="warning">Typ</Badge> : summary.state === "leer" ? <Badge tone="neutral">leer</Badge> : null}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                    </Fragment>
                  ); })}
                  {(rowSlots.at(-1)?.index ?? -1) + 1 < table.rows.length ? <tr aria-hidden="true"><td colSpan={layoutColumns.length} style={{ height: (table.rows.length - (rowSlots.at(-1)?.index ?? -1) - 1) * ROW_HEIGHT, padding: 0, border: 0 }} /></tr> : null}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={rowQuery ? "Keine passenden Objekte" : createLabel ? `${createLabel}: noch keine Objekte` : "Keine Objekte in diesem Bereich"}
              description={
                rowQuery ? "Suchbegriff ändern oder entfernen, um wieder alle Objekte zu sehen." : createLabel ? createTarget ? `Über „${createLabel} anlegen“ einen oder mehrere Namen eingeben. Die Zuordnung und die Schemafelder werden vorbereitet. Alternativ eine Tabelle mit Excel / CSV importieren.` : createHint : "Links einen Bereich oder oben eine Objektart wählen."
              }
            />
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground"><span>Referenz: Klick zum Auswählen · Text: Doppelklick oder Enter · Tab: nächstes Feld</span><span className="ml-auto">Esc: Eingabe verwerfen · Strg+Z: rückgängig</span></div>

          <TableImportDialog
            open={importOpen}
            model={fullTable}
            objektartLabel={activeKind ? KIND_LABELS[activeKind] || activeKind : ""}
            canCreate={canImportCreate}
            createHint={createHint}
            onClose={() => setImportOpen(false)}
            onApply={(plan: ImportPlan) => {
              onCommit(
                (current) => {
                  const result = applyImport(current, plan, importart, canImportCreate ? createRow : undefined);
                  return result.createdEntityIds.length || result.movedEntityIds.length ? { document: result.document, createdEntityIds: result.createdEntityIds, movedEntityIds: result.movedEntityIds } : result.document;
                },
                `Tabellenimport: ${plan.updates} aktualisiert, ${plan.creates} angelegt`,
                `attribution.import({ updates: ${plan.updates}, creates: ${plan.creates}, cells: ${plan.changedCells} });`,
              );
              setImportOpen(false);
            }}
          />

          {focusedRow && focusedTableCell && !batchRows.length && !createOpen ? (
            <div className="max-h-52 shrink-0 overflow-auto rounded-lg border border-border/60 bg-card">

              <Inspector
                cell={focusedTableCell}
                row={focusedRow}
                onAttachRow={() => { const group = table.groups.find((entry) => entry.columns.some((column) => column.key === focusedTableCell.column.key)); if (group) attachToRow(focusedRow, group); }}
                canPick={selectedModelIds.length > 0}
                picking={bauteilPick?.entityId === focusedRow.entityId}
                availableMethods={availableMethods}
                methodDraft={methodDraft}
                onMethodDraft={setMethodDraft}
                onAddMethod={(pattern) => {
                  onCommit((current) => addMethodPset(current, focusedRow.entityId, pattern, importart), `Verfahren ${pattern} an #${focusedRow.entityId}`, `attribution.addMethod({ id: ${focusedRow.entityId}, pset: ${JSON.stringify(pattern)} });`);
                  setMethodDraft("");
                }}
                onPick={() => onStartBauteilPick(bauteilPick ? null : { sessionIds: selectedModelIds, entityId: focusedRow.entityId, importart })}
                onEdit={() => setEditing({ rowKey: focusedRow.key, columnKey: focusedTableCell.column.key, draft: focusedTableCell.value })}
                onShow={() => onShowInViewer(focusedRow.entityId)}
                onHover={setHoverScope}
              />
            </div>
          ) : null}
        </PanelShell>
      ) : (
        <PanelShell>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Importvorschau</span>
            <span>· {check.findings.length.toLocaleString("de-DE")} Befunde · {idsFailures.length.toLocaleString("de-DE")} IDS-Verstöße</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-6 px-2 text-xs"
              disabled={validation.pending || !!validation.error || (!check.findings.length && !idsFailures.length)}
              title="BCF 2.1: ein Thema je Befund mit dem betroffenen Objekt als Auswahl — für Allplan, BIMcollab, Solibri"
              onClick={() => {
                const topics = collectBcfTopics(document, check.findings, ids, { fileName: document.fileName, importart });
                downloadBytes(bcfFileName(document.fileName), createBcfArchive(document, topics, { fileName: document.fileName, importart }), "application/zip");
              }}
            >
              <Download className="size-3.5" />
              BCF exportieren
            </Button>
          </div>
          {validation.pending ? <EmptyState title="Prüfung läuft …" description="Importregeln und Schema werden für den aktuellen Modellstand geprüft." /> : validation.error ? <EmptyState title="Prüfung fehlgeschlagen" description={validation.error} /> : <FindingsList findings={check.findings} ids={ids} selectedId={selectedId} onJump={jumpTo} onShow={onShowInViewer} />}
        </PanelShell>
      )}
        </div>
      </div>
    </div>
  );
}


function Inspector({
  availableMethods,
  canPick,
  cell,
  methodDraft,
  onAddMethod,
  onAttachRow,
  onEdit,
  onHover,
  onMethodDraft,
  onPick,
  onShow,
  picking,
  row,
}: {
  availableMethods: string[];
  canPick: boolean;
  cell: TableCell;
  methodDraft: string;
  onAddMethod(pattern: string): void;
  onAttachRow(): void;
  onEdit(): void;
  onHover(scope: InspectorScope | null): void;
  onMethodDraft(value: string): void;
  onPick(): void;
  onShow(): void;
  picking: boolean;
  row: TableRow;
}) {
  const column = cell.column;
  const meta = STATE_META[cell.state];
  const editable = cell.state !== "na" && cell.state !== "abgeleitet";
  const rule = column.hard
    ? "Portal-Pflicht"
    : column.soft
      ? `Katalog-Pflicht ab LoI ${column.catalog?.loi[0] ?? "–"}${column.catalog?.gewerk.length ? ` · ${column.catalog.gewerk.join(" ")}` : ""}`
      : column.derived
        ? "abgeleitet aus der ID"
        : column.position
          ? "Weltkoordinate in m"
          : "optional";
  const type = column.position ? "Platzierung" : column.catalog ? `${column.catalog.typ}${column.catalog.format ? ` · ${column.catalog.format}` : ""}${column.catalog.einheit && column.catalog.einheit !== "ohne" ? ` · ${column.catalog.einheit}` : ""}` : "IFCLABEL";
  const section = "group/scope flex min-w-0 flex-col gap-1.5 px-3 py-2 transition-colors hover:bg-accent/40";
  const head = "flex min-h-4 items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground group-hover/scope:text-foreground";
  const actions = "flex flex-wrap items-center gap-1";
  return (
    <div className="grid divide-y divide-border/60 text-xs md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] md:divide-x md:divide-y-0">
      <div className={section} onMouseEnter={() => onHover("cell")} onMouseLeave={() => onHover(null)}>
        <div className={head}><Square className="size-3" />Zelle{meta.tone && meta.label ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}{cell.state === "fehlt" ? <Badge tone="neutral">Pset fehlt</Badge> : null}</div>
        <div className="text-[12.5px] font-medium text-foreground">{column.property}<span className="ml-1.5 font-normal text-muted-foreground">in {column.psetLabel}</span></div>
        <div className="break-all font-mono text-[12px] text-foreground">{cell.value || <span className="text-muted-foreground">leer</span>}{cell.target ? <span className="text-muted-foreground"> → {cell.target}</span> : null}</div>
        {cell.note && cell.state !== "fehlt" ? <div className="text-muted-foreground">{cell.note}</div> : null}
        <div className={cn(actions, "mt-auto")}>
          {editable ? <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onEdit}>Bearbeiten</Button> : null}
          {cell.state === "fehlt" && row.psetId == null ? <Button size="sm" variant="outline" className="h-6 px-2 text-xs" title={`${column.psetLabel} mit leeren Katalogfeldern an dieses Objekt anlegen`} onClick={onAttachRow}><Plus className="size-3.5" />{column.psetLabel} anlegen</Button> : null}
          {column.reference === "Bauteil" ? (
            <Button size="sm" variant={picking ? "default" : "outline"} className="h-6 px-2 text-xs" disabled={!canPick} title={canPick ? "Nächster Klick im Viewer auf eines der Bauwerksmodelle setzt die BauteilID" : "Erst ein Bauwerksmodell wählen"} onClick={onPick}>
              <Crosshair className="size-3.5" />
              {picking ? "Warte auf Klick …" : "Bauteil im Viewer wählen"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className={section} onMouseEnter={() => onHover("row")} onMouseLeave={() => onHover(null)}>
        <div className={head}><Rows3 className="size-3" />Zeile{row.importErrors ? <Badge tone="danger">{row.importErrors} Befund{row.importErrors === 1 ? "" : "e"}</Badge> : null}</div>
        <div className="text-[12.5px] font-medium text-foreground">{row.label}</div>
        <div className="font-mono text-muted-foreground">{row.psetName ?? `#${row.entityId}`}{KIND_LABELS[row.kind] ? ` · ${KIND_LABELS[row.kind]}` : ""}</div>
        <div className={cn(actions, "mt-auto")}>
          {row.psetId == null ? (
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" title="Objekt im Viewer auswählen; das Fenster klappt ein" onClick={onShow}>
              <Box className="size-3.5" />
              Im 3D-Modell anzeigen
            </Button>
          ) : null}
          {availableMethods.length && row.psetId == null && row.kind !== "bauteil" && row.kind !== "sensor" ? (
            <span className="flex items-center gap-1">
              <select className="h-6 rounded-md border border-input bg-background px-1.5 text-xs" value={methodDraft} onChange={(event) => onMethodDraft(event.currentTarget.value)}>
                <option value="">Verfahren anhängen …</option>
                {availableMethods.map((pattern) => (
                  <option key={pattern} value={pattern}>{pattern.replace(/\\d[*+]$/, "")}</option>
                ))}
              </select>
              <Button size="sm" variant="outline" className="h-6 px-1.5 text-xs" disabled={!methodDraft} onClick={() => methodDraft && onAddMethod(methodDraft)}>
                <Plus className="size-3.5" />
              </Button>
            </span>
          ) : null}
        </div>
      </div>
      <div className={section} onMouseEnter={() => onHover("column")} onMouseLeave={() => onHover(null)}>
        <div className={head}><Columns3 className="size-3" />Eigenschaft im Schema</div>
        <div className="text-[12.5px] font-medium text-foreground">{column.property}<span className="ml-1.5 font-normal text-muted-foreground">{column.psetLabel}</span></div>
        <div className="text-muted-foreground">{rule} · <span className="font-mono">{type}</span></div>
        <p className="text-muted-foreground">Für Sammeländerungen die gewünschten Objekte über die Kästchen auswählen.</p>
      </div>
    </div>
  );
}

function downloadBytes(name: string, bytes: Uint8Array, type: string): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  globalThis.document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

function findPath(root: TreeNode | null, key: string): TreeNode[] | null {
  if (!root) return null;
  if (root.key === key) return [root];
  for (const child of root.children) {
    const path = findPath(child, key);
    if (path) return [root, ...path];
  }
  return null;
}

function findPsetNode(root: TreeNode | null, entityId: number, psetId: number): TreeNode | null {
  if (!root) return null;
  if (root.entityId === entityId && root.psetId === psetId) return root;
  for (const child of root.children) {
    const hit = findPsetNode(child, entityId, psetId);
    if (hit) return hit;
  }
  return null;
}

function findNode(root: TreeNode | null, key: string): TreeNode | null {
  if (!root) return null;
  if (root.key === key) return root;
  for (const child of root.children) {
    const hit = findNode(child, key);
    if (hit) return hit;
  }
  return null;
}

function TreeRows({
  createLabel,
  depth,
  focusKey,
  isExpanded,
  node,
  onCreate,
  onFocus,
  onSelect,
  onShow,
  onToggle,
  selectedId,
}: {
  /** Beschriftung des Anlegen-Knopfs („Stelle“), wenn sich unter dem Knoten etwas anlegen lässt. */
  createLabel(node: TreeNode): string | null;
  depth: number;
  focusKey: string | null;
  isExpanded(node: TreeNode, depth: number): boolean;
  node: TreeNode;
  onCreate(node: TreeNode): void;
  onFocus(node: TreeNode): void;
  onShow(id: number): void;
  onSelect(id: number): void;
  onToggle(node: TreeNode, depth: number): void;
  selectedId: number;
}) {
  const open = isExpanded(node, depth);
  const hasChildren = node.children.length > 0;
  const selected = node.entityId != null && node.psetId == null && node.entityId === selectedId;
  const create = createLabel(node);
  return (
    <>
      <div className={cn("flex min-w-0 items-center gap-1.5 border-l-2 border-l-transparent py-1 pr-2 text-xs transition-colors hover:bg-muted/45", selected && "border-l-primary bg-accent", focusKey === node.key && "bg-muted/60")} style={{ paddingLeft: 6 + depth * 14 }}>
        <button type="button" className={cn("grid size-4 shrink-0 place-items-center text-muted-foreground", !hasChildren && "invisible")} onClick={() => onToggle(node, depth)} aria-label={open ? "Zuklappen" : "Aufklappen"}>
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => {
            onFocus(node);
            if (node.entityId != null && node.psetId == null) onSelect(node.entityId);
          }}
          title={node.id ? `${node.id} · Objekte anzeigen` : "Objekte anzeigen"}
        >
          <span className={cn("truncate", node.kind === "gruppe" || node.kind === "eimer" ? "font-medium text-foreground" : "text-foreground")}>{node.label}</span>

        </button>
        {node.objectCount > 1 || node.kind === "gruppe" || node.kind === "eimer" ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{(node.kind === "gruppe" ? node.children.length : node.objectCount).toLocaleString("de-DE")}</span> : null}
        {node.errorCount ? <Badge tone="danger">{node.errorCount}</Badge> : null}
        {create ? (
          <button type="button" className="flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground" title={`${create} hier anlegen`} aria-label={`${create} unter ${node.label} anlegen`} onClick={() => onCreate(node)}>
            <Plus className="size-3" />
          </button>
        ) : null}
      </div>
      {open && hasChildren ? node.children.map((child) => <TreeRows key={child.key} node={child} depth={depth + 1} selectedId={selectedId} focusKey={focusKey} isExpanded={isExpanded} onToggle={onToggle} onSelect={onSelect} onFocus={onFocus} createLabel={createLabel} onCreate={onCreate} onShow={onShow} />) : null}
    </>
  );
}

function FindingsList({ findings, ids, onJump, onShow, selectedId }: { findings: PortalFinding[]; ids: IdsValidationSummary | null; onJump(entityId: number, psetName?: string, propertyName?: string): void; onShow(id: number): void; selectedId: number }) {
  const sorted = [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const idsFailures = ids?.results.filter((result) => result.status === "fail") ?? [];
  if (!sorted.length && !idsFailures.length) {
    return <EmptyState title="Keine Befunde" description="Importer-Regeln und IDS des Portals sind erfüllt. Bauteil-Referenzen sind nur mit geladenen Bauwerksmodellen geprüft." />;
  }
  return (
    <PanelShell scroll>
      <div className="divide-y divide-border/50 overflow-hidden rounded-md border border-border/60 bg-card">
        {idsFailures.map((result) => (
          <div key={result.specification.identifier ?? result.specification.name} className="grid gap-1 px-2.5 py-2">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground">IDS {result.specification.identifier ? `${result.specification.identifier} · ` : ""}{result.specification.name}</div>
                <p className="text-[11px] text-muted-foreground">{result.failures.length ? `${result.failures.length.toLocaleString("de-DE")} Objekte verletzen die Spezifikation.` : result.messages.join(" ")}</p>
              </div>
            </div>
            {result.failures.slice(0, 5).map((failure) => (
              <button key={failure.entityId} type="button" className={cn("ml-5 truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground", failure.entityId === selectedId && "text-primary")} onClick={() => onJump(failure.entityId)}>
                #{failure.entityId} {failure.entityName || failure.entityType} · {failure.messages.map((message) => message.text).join("; ")}
              </button>
            ))}
            {result.failures.length > 5 ? <span className="ml-5 text-[11px] text-muted-foreground">… {result.failures.length - 5} weitere</span> : null}
          </div>
        ))}
        {sorted.map((finding, index) => (
          <div key={`${finding.code}-${finding.entityId ?? ""}-${index}`} className={cn("flex items-start gap-2 px-2.5 py-2", finding.entityId != null && "cursor-pointer hover:bg-muted/45", finding.entityId === selectedId && "bg-accent")} onClick={() => finding.entityId != null && onJump(finding.entityId, finding.pset_name, finding.property_name)}>
            <TriangleAlert className={cn("mt-0.5 size-3.5 shrink-0", finding.severity === "error" ? "text-destructive" : "text-warning")} />
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-snug text-foreground">{finding.message}</p>
              {contextLines(finding).map((line) => (
                <p key={line} className="truncate font-mono text-[10.5px] text-muted-foreground" title={line}>{line}</p>
              ))}
            </div>
            {finding.entityId != null ? (
              <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Im 3D-Modell anzeigen (Fenster klappt ein)" aria-label="Im 3D-Modell anzeigen" onClick={(event) => { event.stopPropagation(); onShow(finding.entityId!); }}>
                <Box className="size-3.5" />
              </button>
            ) : null}
            <Badge tone={codeTone(finding)}>{isPortalCode(finding.code) ? finding.code : "Editor"}</Badge>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

function codeTone(finding: PortalFinding): BadgeTone {
  if (!isPortalCode(finding.code)) return "neutral";
  return finding.severity === "error" ? "danger" : "warning";
}

function describeStats(importart: Importart, stats: Record<string, number>): string {
  const parts: string[] = [importartLabel(importart)];
  const labels: Array<[string, string]> = [
    ["untersuchungsstellen", "Untersuchungsstellen"],
    ["proben", "Proben"],
    ["ergebnisse", "Ergebnisse"],
    ["sensoren", "Sensoren"],
    ["kanaele", "Kanäle"],
    ["bauteile", "Bauteile"],
    ["nichtZuordenbar", "nicht zuordenbar"],
  ];
  for (const [key, label] of labels) {
    const value = stats[key];
    if (value) parts.push(`${value.toLocaleString("de-DE")} ${label}`);
  }
  return parts.join(" · ");
}
