import { Box, ChevronDown, ChevronRight, Columns3, Crosshair, Download, FileUp, LocateFixed, Plus, Rows3, ShieldCheck, Square, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { bcfFileName, collectBcfTopics, createBcfArchive } from "@/ifc/attribution/bcf";
import { runPortalIds } from "@/ifc/attribution/idsBundle";
import { contextLines } from "@/ifc/attribution/messages";
import { buildBauwerksmodellIndex, isPortalCode, runPortalCheck, type PortalFinding } from "@/ifc/attribution/portalCheck";
import { findPset, psetMatches, stripPropertyPrefix, stripPsetPrefix } from "@/ifc/attribution/normalize";
import { addFachobjekt, FACHOBJEKTE } from "@/ifc/attribution/objects";
import { addMethodPset, addRepeatPset, attachPset, childId, nextRepeatIndex, REPEAT_GROUPS, writeCell } from "@/ifc/attribution/recipes";
import { IMPORTARTEN, importartLabel, katalogFor, listMethodPsets, type Importart } from "@/ifc/attribution/schema";
import { applyImport, type ImportPlan } from "@/ifc/attribution/tableImport";
import { buildTable, collectRows, formatMeters, isTableKind, objektartenOf, type CellState, type TableColumn, type LoiLevel, type Scope, type TableCell, type TableGroup, type TableModel, type TableRow } from "@/ifc/attribution/table";
import { buildFachmodellTree, detectImportart, type TreeNode, type TreeNodeKind } from "@/ifc/attribution/tree";
import type { IdsValidationSummary } from "@/ifc/ids";
import { viewerWorldPointToIfcPlacementPoint } from "@/ifc/coordinateMapping";
import { getNativeLengthUnitScale, type NativeIfcDocument } from "@/ifc/nativeDocument";
import { cn } from "@/lib/utils";

import type { AttributionStatus } from "./AttributionOverlay";
import { TableImportDialog } from "./TableImportDialog";
import type { CoordinateClipboard } from "./types";
import { Badge, Button, DropdownField, EmptyState, PanelShell, SegmentedControl, type BadgeTone } from "./ui";

export interface AttributionSession {
  id: string;
  fileName: string;
  document: NativeIfcDocument;
}

/** Laufender „Bauteil wählen"-Modus: der nächste Viewer-Klick in der Bauwerksmodell-Session schreibt die BauteilID. */
export interface AttributionPick {
  sessionId: string;
  entityId: number;
  importart: Importart;
}

/** Ergebnis einer Änderung; mit `createdEntityIds`/`movedEntityIds`, wenn 3D-Objekte entstanden oder verschoben sind (Viewer lädt sie nach). */
export interface MutationEffects {
  document: NativeIfcDocument;
  createdEntityIds?: number[];
  movedEntityIds?: number[];
}
export type MutationResult = NativeIfcDocument | MutationEffects;
export type DocumentMutation = (document: NativeIfcDocument) => MutationResult;

export function unwrapMutation(result: MutationResult): Required<MutationEffects> {
  if ("entityById" in result) return { document: result, createdEntityIds: [], movedEntityIds: [] };
  return { document: result.document, createdEntityIds: result.createdEntityIds ?? [], movedEntityIds: result.movedEntityIds ?? [] };
}

const VIEWS = [
  { label: "Baum", value: "tree" },
  { label: "Tabelle", value: "table" },
  { label: "Befunde", value: "findings" },
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
}) {
  const detected = useMemo(() => detectImportart(document), [document]);
  const [importartOverride, setImportartOverride] = useState<Importart | null>(null);
  const [bauwerksmodellId, setBauwerksmodellId] = useState("");
  const [view, setView] = useState("tree");
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
  const createInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusCreate) createInput.current?.focus();
  }, [focusCreate]);
  const [methodDraft, setMethodDraft] = useState("");
  const [showOptional, setShowOptional] = useState(false);

  useEffect(() => {
    setImportartOverride(null);
    setFocusKey(null);
    setFocusedCell(null);
    setEditing(null);
  }, [document.fileName]);

  const importart = importartOverride ?? detected;
  const otherSessions = sessions.filter((session) => session.id !== activeSessionId);
  const bauwerksmodell = otherSessions.find((session) => session.id === bauwerksmodellId)?.document ?? null;
  const katalog = katalogFor(importart);

  const check = useMemo(() => runPortalCheck(document, { importart, bauwerksmodell }), [bauwerksmodell, document, importart]);
  const ids = useMemo<IdsValidationSummary | null>(() => {
    try {
      return runPortalIds(document, importart);
    } catch {
      return null;
    }
  }, [document, importart]);
  const tree = useMemo(() => buildFachmodellTree(document, importart, check.findings), [check.findings, document, importart]);
  const bauwerksmodellIndex = useMemo(() => (bauwerksmodell ? buildBauwerksmodellIndex(bauwerksmodell) : null), [bauwerksmodell]);

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
    objektartOverride && objektarten.some((entry) => entry.kind === objektartOverride) ? objektartOverride : focusNode && isTableKind(focusNode.kind) ? focusNode.kind : undefined;
  const fullTable = useMemo<TableModel>(
    () => (focusRows.length ? buildTable(document, focusRows, { importart, scope, katalog, bauwerksmodell: bauwerksmodellIndex, findings: check.findings, objektart }) : { objektart: null, groups: [], columns: [], rows: [] }),
    [bauwerksmodellIndex, check.findings, document, focusRows, importart, katalog, objektart, scope],
  );
  // Ohne „Optionale Spalten" bleiben Portal-Pflicht, Katalog-Pflicht, abgeleitete und gefüllte Spalten — leere optionale verschwinden.
  const table = useMemo<TableModel>(() => {
    if (showOptional) return fullTable;
    const keep = new Set(
      fullTable.columns
        .filter((column) => column.hard || column.soft || column.derived || fullTable.rows.some((row) => row.cells.find((cell) => cell.column.key === column.key)?.value))
        .map((column) => column.key),
    );
    const groups = fullTable.groups.map((group) => ({ ...group, columns: group.columns.filter((column) => keep.has(column.key)) })).filter((group) => group.columns.length);
    return { ...fullTable, groups, columns: groups.flatMap((group) => group.columns), rows: fullTable.rows.map((row) => ({ ...row, cells: row.cells.filter((cell) => keep.has(cell.column.key)) })) };
  }, [fullTable, showOptional]);

  const fullCells = useMemo(() => new Map(fullTable.rows.map((row) => [row.key, row.cells])), [fullTable]);
  const fullGroups = useMemo(() => new Map(fullTable.groups.map((group) => [group.key, group])), [fullTable]);
  const gapColumns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of table.rows) for (const cell of row.cells) if (GAP_STATES.has(cell.state)) keys.add(cell.column.key);
    return keys;
  }, [table]);
  const columnsOf = (group: TableGroup) => (onlyGaps ? group.columns.filter((column) => gapColumns.has(column.key)) : group.columns);
  const isGroupOpen = (group: TableGroup) => (group.hard || expandedGroups.has(group.key)) && columnsOf(group).length > 0;
  const toggleGroup = (group: TableGroup) =>
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group.key)) next.delete(group.key);
      else next.add(group.key);
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
  const groupStats = (group: TableGroup) => {
    const totals = { required: 0, ok: 0, filled: 0, total: 0 };
    for (const row of table.rows) {
      const summary = summarizeGroup(cellsOfFull(row, group));
      totals.required += summary.required;
      totals.ok += summary.ok;
      totals.filled += summary.filled;
      totals.total += summary.total;
    }
    return totals;
  };

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
    if (group && !group.hard) setExpandedGroups((current) => new Set(current).add(group.key));
    if (column && !column.hard && !column.soft && !column.derived) setShowOptional(true);
    setFocusedCell({ rowKey: row.key, columnKey: target.key });
    setPendingJump(null);
    setScrollNonce((count) => count + 1);
  }, [fullTable, pendingJump]);
  useEffect(() => {
    if (!scrollNonce || !focusedCell) return;
    const element = globalThis.document.querySelector(`[data-cell="${CSS.escape(`${focusedCell.rowKey}|${focusedCell.columnKey}`)}"]`);
    element?.scrollIntoView({ block: "center", inline: "center" });
  }, [focusedCell, scrollNonce, table]);

  const idsFailures = ids?.results.filter((result) => result.status === "fail") ?? [];
  const importErrors = check.errorCount + idsFailures.reduce((count, result) => count + Math.max(1, result.failures.length), 0);
  const building = document.entitiesByType.get("IFCBUILDING")?.[0];
  // Nicht angehängte Psets zählen nicht als Lücke: Vollständig misst nur, was das Objekt trägt.
  const softTotal = table.rows.reduce((n, row) => n + row.cells.filter((cell) => cell.column.soft && cell.state !== "fehlt").length, 0);
  const softFilled = table.rows.reduce((n, row) => n + row.cells.filter((cell) => cell.column.soft && cell.state === "ok").length, 0);
  const completePercent = softTotal ? Math.round((softFilled / softTotal) * 100) : null;
  useEffect(() => {
    onStatus?.({ importart: describeStats(importart, check.stats), importErrors, complete: completePercent });
    // onStatus ist ein stabiler Setter des Workspace; nur Inhalte lösen aus.
  }, [completePercent, importErrors, importart, check.stats]);

  const isExpanded = (node: TreeNode, depth: number) => expanded.has(node.key) || (!expanded.has(`^${node.key}`) && depth < 2);
  const toggle = (node: TreeNode, depth: number) => {
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
  };

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
  const createHint = repeat?.parent === "sensor" ? "Für Kanäle im Baum einen Sensor doppelklicken." : fachobjekt?.parent === "untersuchungsstelle" ? "Für Proben im Baum eine Untersuchungsstelle doppelklicken." : "";
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
      // Beim Einzel-Anlegen sitzt der Marker am Klickpunkt; Import-Zeilen bringen ihre Koordinaten selbst mit.
      worldPosition: placeAtClickPoint && clickPoint && ordinal === 0 ? clickPoint.ifc : undefined,
      values: createTarget.values,
    });
    return result.entityId < 0 ? null : { document: result.document, entityId: result.entityId };
  };
  const createOne = () => {
    const bezeichnung = newDraft.trim();
    if (!createKind || !createTarget || !bezeichnung) return;
    onCommit(
      (current) => {
        const result = createRow(current, bezeichnung, 0);
        if (!result) return current;
        return fachobjekt ? { document: result.document, createdEntityIds: [result.entityId] } : result.document;
      },
      `${createLabel} ${bezeichnung} anlegen`,
      `attribution.add({ kind: ${JSON.stringify(createKind)}, bezeichnung: ${JSON.stringify(bezeichnung)}, parent: ${JSON.stringify(createTarget.parentId)} });`,
    );
    setNewDraft("");
    setObjektartOverride(createKind);
  };
  const canImportCreate = Boolean(createKind && createTarget && createKind === activeKind);

  const attachToRow = (row: TableRow, group: TableGroup) => {
    if (row.psetId != null) return;
    onCommit((current) => attachPset(current, row.entityId, group.psetPattern, group.label, importart), `${group.label} an #${row.entityId}`, `attribution.attach({ id: ${row.entityId}, pset: ${JSON.stringify(group.label)} });`);
  };
  /** Spaltenaktion: Wert in alle leeren (oder alle) Zellen der Spalte schreiben; nicht anwendbare und abgeleitete bleiben aus. */
  const fillColumn = (column: TableColumn, value: string, mode: "empty" | "all") => {
    onCommit(
      (current) => {
        let next = current;
        for (const row of table.rows) {
          const cell = row.cells.find((candidate) => candidate.column.key === column.key);
          if (!cell || cell.state === "na" || cell.state === "abgeleitet") continue;
          if (mode === "empty" && cell.value) continue;
          next = writeCell(next, row, column, value, importart);
        }
        return next;
      },
      `${column.property} in ${mode === "empty" ? "leere" : "alle"} Zellen der Spalte`,
      `attribution.fillColumn({ pset: ${JSON.stringify(column.psetLabel)}, property: ${JSON.stringify(column.property)}, mode: ${JSON.stringify(mode)}, value: ${JSON.stringify(value)} });`,
    );
  };
  /** Spaltenaktion: das Pset der Spalte an allen Zeilen anlegen, die es nicht haben. */
  const attachColumnPset = (column: TableColumn) => {
    onCommit(
      (current) => {
        let next = current;
        for (const row of table.rows) {
          if (row.psetId != null) continue;
          const cell = row.cells.find((candidate) => candidate.column.key === column.key);
          if (cell?.state === "fehlt") next = attachPset(next, row.entityId, column.psetPattern, column.psetLabel, importart);
        }
        return next;
      },
      `${column.psetLabel} an alle Zeilen`,
      `attribution.attachAll({ pset: ${JSON.stringify(column.psetLabel)} });`,
    );
  };

  const highlightRow = (row: TableRow) => hoverScope === "row" && focusedCell?.rowKey === row.key;
  const highlightColumn = (columnKey: string) => hoverScope === "column" && focusedCell?.columnKey === columnKey;

  const renderCell = (row: TableRow, cell: TableCell) => {
    const meta = STATE_META[cell.state];
    const isEditing = editing?.rowKey === row.key && editing.columnKey === cell.column.key;
    const isFocused = focusedCell?.rowKey === row.key && focusedCell.columnKey === cell.column.key;
    const editable = cell.state !== "na" && cell.state !== "abgeleitet";
    return (
      <td
        key={cell.column.key}
        data-cell={`${row.key}|${cell.column.key}`}
        title={cell.state === "fehlt" ? "Pset nicht am Objekt — Doppelklick und Eingabe legen es an" : cell.note ? `${cell.note}${cell.value ? "" : " — leer, Doppelklick zum Ausfüllen"}` : undefined}
        className={cn(
          "h-7 border-b border-r border-border/50 px-2 py-0 font-mono text-[11px] whitespace-nowrap transition-colors",
          meta.className,
          isFocused && "outline outline-2 -outline-offset-2 outline-primary",
          highlightRow(row) && "bg-accent/60",
          highlightColumn(cell.column.key) && "bg-accent/60",
          hoverScope === "cell" && isFocused && "bg-accent",
        )}
        onClick={() => setFocusedCell({ rowKey: row.key, columnKey: cell.column.key })}
        onDoubleClick={() => editable && setEditing({ rowKey: row.key, columnKey: cell.column.key, draft: cell.value })}
      >
        {isEditing ? (
          <Input
            autoFocus
            className="h-6 px-1 font-mono text-[11px]"
            value={editing.draft}
            onChange={(event) => setEditing({ ...editing, draft: event.currentTarget.value })}
            onBlur={() => commitCell(row, cell, editing.draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitCell(row, cell, editing.draft);
              if (event.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="max-w-[260px] truncate">{cell.value}</span>
            {cell.target ? <span className="truncate text-muted-foreground">→ {cell.target}</span> : null}
            {meta.tone && meta.label && cell.value ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
          </span>
        )}
      </td>
    );
  };

  const availableMethods = focusedRow && focusedRow.psetId == null
    ? listMethodPsets().filter((pattern) => !document.propertySetsByEntity.get(focusedRow.entityId)?.some((set) => new RegExp(`^(?:ePset_|Pset_|ePSet_)?(?:${pattern})$`).test(set.name)))
    : [];

  return (
    <PanelShell>
      <div className="grid shrink-0 gap-2 sm:grid-cols-2">
        <DropdownField
          label="Importart"
          options={IMPORTARTEN.map((art) => ({ label: importartLabel(art), value: art, detail: art === detected ? "erkannt" : undefined }))}
          value={importart}
          onChange={(value) => setImportartOverride(value as Importart)}
        />
        <DropdownField
          label="Bauwerksmodell"
          options={[{ label: "Keins geladen", value: "", detail: "Bauteil-Referenzen bleiben ungeprüft" }, ...otherSessions.map((session) => ({ label: session.fileName, value: session.id }))]}
          value={bauwerksmodellId}
          onChange={setBauwerksmodellId}
        />
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        {tree.root?.id ? (
          <>
            <span className="font-medium text-foreground">Kontext</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{tree.root.id}</code>
          </>
        ) : null}
        {ids ? <Badge tone={idsFailures.length ? "warning" : "success"}>IDS {ids.results.length - idsFailures.length}/{ids.results.length}</Badge> : <Badge tone="neutral">keine IDS</Badge>}
        {bauteilPick ? <Badge tone="info">Bauteil wählen: Klick im Viewer auf das Bauwerksmodell …</Badge> : null}
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

      <div className="shrink-0">
        <SegmentedControl options={VIEWS} value={view} onChange={setView} />
      </div>

      {!building ? (
        <EmptyState title="Kein IfcBuilding" description="Das Portal verlangt genau ein IfcBuilding je Datei. Ohne es gibt es weder Projekt noch Baum." />
      ) : view === "tree" ? (
        <PanelShell scroll>
          <div className="overflow-hidden rounded-md border border-border/60 bg-card">
            {tree.root ? <TreeRows node={tree.root} depth={0} selectedId={selectedId} focusKey={focusKey} isExpanded={isExpanded} onToggle={toggle} onSelect={onSelectEntity} onFocus={(node) => { setFocusKey(node.key); setView("table"); }} createLabel={(node) => { const kind = childKindFor(node, importart); return kind ? KIND_LABELS[kind] || kind : null; }} onShow={onShowInViewer} onCreate={(node) => { const kind = childKindFor(node, importart); if (!kind) return; setFocusKey(node.key); setObjektartOverride(kind); setView("table"); setFocusCreate((count) => count + 1); }} /> : null}
            {tree.eimer.children.length ? (
              <div className="border-t border-dashed border-border/70">
                <TreeRows node={tree.eimer} depth={0} selectedId={selectedId} focusKey={focusKey} isExpanded={isExpanded} onToggle={toggle} onSelect={onSelectEntity} onFocus={(node) => { setFocusKey(node.key); setView("table"); }} createLabel={(node) => { const kind = childKindFor(node, importart); return kind ? KIND_LABELS[kind] || kind : null; }} onShow={onShowInViewer} onCreate={(node) => { const kind = childKindFor(node, importart); if (!kind) return; setFocusKey(node.key); setObjektartOverride(kind); setView("table"); setFocusCreate((count) => count + 1); }} />
              </div>
            ) : null}
          </div>
        </PanelShell>
      ) : view === "table" ? (
        <PanelShell>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{focusNode?.label ?? "Fachmodell"}</span>
            <span>· {table.rows.length.toLocaleString("de-DE")} Zeilen</span>
            {objektarten.length > 1 ? (
              <span className="flex items-center gap-1" role="tablist" aria-label="Objektart">
                {objektarten.map((entry) => (
                  <button
                    key={entry.kind}
                    type="button"
                    role="tab"
                    aria-selected={activeKind === entry.kind}
                    className={cn("rounded border px-1.5 py-0.5 text-[10.5px] font-medium", activeKind === entry.kind ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground")}
                    onClick={() => { setObjektartOverride(entry.kind); setFocusedCell(null); setEditing(null); }}
                  >
                    {KIND_LABELS[entry.kind] || entry.kind} {entry.count.toLocaleString("de-DE")}
                  </button>
                ))}
              </span>
            ) : activeKind ? (
              <Badge tone="neutral">{KIND_LABELS[activeKind] || activeKind}</Badge>
            ) : null}
            {focusKey ? <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => { setFocusKey(null); setObjektartOverride(null); }}>Ganzes Fachmodell</Button> : null}
            {createKind ? (
              <span className="flex items-center gap-1">
                <Input
                  ref={createInput}
                  className="h-6 w-44 px-1.5 text-[11px]"
                  placeholder={`${createLabel} anlegen · Bezeichnung`}
                  aria-label={`${createLabel} anlegen: Bezeichnung`}
                  value={newDraft}
                  onChange={(event) => setNewDraft(event.currentTarget.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") createOne(); }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  disabled={!newDraft.trim() || !createTarget}
                  title={
                    createTarget
                      ? repeat
                        ? `Legt ePset_${repeat.base}<n> mit ID ${childId(createTarget.parentId, newDraft.trim() || "<Bezeichnung>")} an`
                        : `Legt ${createLabel} mit ID ${childId(createTarget.parentId, newDraft.trim() || "<Bezeichnung>")} an · ${createPlacementHint}`
                      : createHint
                  }
                  onClick={createOne}
                >
                  <Plus className="size-3.5" />
                  Anlegen
                </Button>
                {fachobjekt ? (
                  <button
                    type="button"
                    className={cn("flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-medium", placeAtClickPoint ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground", !clickPoint && "opacity-60")}
                    disabled={!clickPoint}
                    title={
                      clickPoint
                        ? `Klickpunkt aus dem Viewer (${clickPoint.copiedAt}): ${formatMeters(clickPoint.ifc.x)} / ${formatMeters(clickPoint.ifc.y)} / ${formatMeters(clickPoint.ifc.z)} m — an/aus`
                        : "Im Viewer „Koordinaten picken“ einschalten und auf das Modell klicken; der nächste Marker entsteht dort."
                    }
                    onClick={() => setUseClickPoint((current) => !current)}
                  >
                    <LocateFixed className="size-3" />
                    {clickPoint ? (placeAtClickPoint ? "am Klickpunkt" : "Klickpunkt aus") : "kein Klickpunkt"}
                  </button>
                ) : null}
              </span>
            ) : null}
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={!fullTable.columns.length} title="CSV oder Excel auf die Spalten dieser Tabelle abbilden" onClick={() => setImportOpen(true)}>
              <FileUp className="size-3.5" />
              Import …
            </Button>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className={cn("rounded border px-1.5 py-0.5 text-[10.5px] font-medium", onlyGaps ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground")}
                title="Nur Spalten zeigen, in denen mindestens eine Zeile eine Lücke oder einen Fehler hat"
                onClick={() => setOnlyGaps((current) => !current)}
              >
                Nur Lücken{gapColumns.size ? ` (${gapColumns.size})` : ""}
              </button>
              <button
                type="button"
                className={cn("rounded border px-1.5 py-0.5 text-[10.5px] font-medium", showOptional ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground")}
                title="Leere optionale Katalogspalten ein- oder ausblenden"
                onClick={() => setShowOptional((current) => !current)}
              >
                Optionale Spalten{showOptional ? "" : ` (+${fullTable.columns.length - table.columns.length})`}
              </button>
              {expandedGroups.size ? (
                <button type="button" className="rounded border border-border px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground" title="Alle Spaltengruppen zuklappen" onClick={() => setExpandedGroups(new Set())}>
                  Gruppen zu
                </button>
              ) : null}
            </span>
          </div>
          {table.rows.length ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/60 bg-card">
              <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                  <tr>
                    <th className="sticky left-0 z-20 border-b border-r border-border/60 bg-muted px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground">{KIND_LABELS[table.objektart!] || "Objekt"}</th>
                    {table.groups.map((group) => {
                      const open = isGroupOpen(group);
                      return (
                        <th key={group.key} colSpan={open ? columnsOf(group).length : 1} className={cn("border-b border-r border-border/60 px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-wider", group.hard ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>
                          <button type="button" className="flex items-center gap-1" title={open ? "Gruppe zuklappen" : `Gruppe aufklappen · ${group.columns.length} Spalten`} onClick={() => toggleGroup(group)}>
                            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            <span>{group.label}{group.hard ? " · Portal-Pflicht" : ""}</span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    <th className="sticky left-0 z-20 border-b border-r border-border/60 bg-muted px-2 py-1 text-left text-[10px] font-normal text-muted-foreground">{table.rows.length} Zeilen</th>
                    {table.groups.map((group) => {
                      if (isGroupOpen(group)) {
                        return columnsOf(group).map((column) => {
                          const filled = table.rows.filter((row) => row.cells.find((cell) => cell.column.key === column.key)?.value).length;
                          return (
                            <th key={column.key} className={cn("min-w-[110px] border-b border-r border-border/60 px-2 py-1 text-left align-bottom font-medium text-foreground transition-colors", highlightColumn(column.key) && "bg-accent")} title={column.catalog ? `${column.catalog.typ} · ${column.catalog.format ?? ""} · LoI ${column.catalog.loi.join("/")} · ${column.catalog.gewerk.join(" ")} · Zeile ${column.catalog.zeile}` : undefined}>
                              <span className="flex items-center gap-1">
                                <span className="truncate">{column.property}</span>
                                {column.derived ? <Badge tone="neutral">abgel.</Badge> : column.soft ? <Badge tone="info">LoI</Badge> : null}
                              </span>
                              <span className="mt-0.5 block h-0.5 w-full overflow-hidden rounded bg-border">
                                <span className={cn("block h-full", filled === table.rows.length ? "bg-success" : filled ? "bg-warning" : "bg-destructive")} style={{ width: `${(filled / table.rows.length) * 100}%` }} />
                              </span>
                              <span className="font-mono text-[9px] text-muted-foreground">{filled}/{table.rows.length}</span>
                            </th>
                          );
                        });
                      }
                      const stats = groupStats(group);
                      const denominator = stats.required || stats.total || 1;
                      const numerator = stats.required ? stats.ok : stats.filled;
                      return (
                        <th key={group.key} className="min-w-[96px] border-b border-r border-border/60 px-2 py-1 text-left align-bottom font-normal text-muted-foreground" title={stats.required ? "Erfüllte Pflichtfelder / Pflichtfelder in dieser Gruppe über alle Zeilen" : "Gefüllte Felder / Felder in dieser Gruppe über alle Zeilen"}>
                          <span className="font-mono text-[10px]">{numerator}/{denominator} {stats.required ? "Pflicht" : "gefüllt"}</span>
                          <span className="mt-0.5 block h-0.5 w-full overflow-hidden rounded bg-border">
                            <span className={cn("block h-full", numerator === denominator ? "bg-success" : numerator ? "bg-warning" : "bg-destructive")} style={{ width: `${(numerator / denominator) * 100}%` }} />
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={row.key} className={cn(row.psetId == null && row.entityId === selectedId && "bg-accent/40")}>
                      <td className={cn("sticky left-0 z-10 max-w-[220px] truncate border-b border-r border-border/50 bg-card px-2 py-1 transition-colors", highlightRow(row) && "bg-accent")} title={row.id}>
                        <span className="flex w-full items-center gap-1">
                          <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => onSelectEntity(row.entityId)}>
                            <span className="font-mono text-[10px] text-muted-foreground">{row.psetName ?? `#${row.entityId}`}</span>
                            <span className="truncate">{row.label}</span>
                            {row.importErrors ? <Badge tone="danger">{row.importErrors}</Badge> : null}
                          </button>
                          {row.psetId == null ? (
                            <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Im 3D-Modell anzeigen (Fenster klappt ein)" aria-label="Im 3D-Modell anzeigen" onClick={() => onShowInViewer(row.entityId)}>
                              <Box className="size-3.5" />
                            </button>
                          ) : null}
                        </span>
                      </td>
                      {table.groups.map((group) => {
                        if (isGroupOpen(group)) return cellsOf(row, group).map((cell) => renderCell(row, cell));
                        const summary = summarizeGroup(cellsOfFull(row, group));
                        const meta = STATE_META[summary.state];
                        if (summary.state === "fehlt") {
                          return (
                            <td key={group.key} className={cn("h-7 border-b border-r border-border/50 px-2 py-0 font-mono text-[11px] whitespace-nowrap", meta.className, highlightRow(row) && "bg-accent/60")} title={`${group.label} liegt nicht an diesem Objekt`}>
                              <span className="flex items-center gap-1.5">
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
                            <span className="flex items-center gap-1.5">
                              <span>{summary.required ? `${summary.ok}/${summary.required}` : `${summary.filled}/${summary.total}`}</span>
                              {summary.state === "import" ? <Badge tone="danger">Import</Badge> : summary.state === "typ" ? <Badge tone="warning">Typ</Badge> : summary.state === "leer" ? <Badge tone="neutral">leer</Badge> : null}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={activeKind && createLabel && !table.rows.length ? `Noch kein${/e$/.test(createLabel) ? "e" : ""} ${createLabel}` : "Keine Zeilen"}
              description={
                activeKind && createLabel
                  ? createTarget
                    ? repeat
                      ? `Bezeichnung oben eingeben und „Anlegen“ — es entsteht ePset_${repeat.base}0 mit den Portal-Pflichtfeldern und den Textfeldern des Katalogs.`
                      : `Bezeichnung oben eingeben und „Anlegen“ — es entsteht ein IfcBuildingElementProxy mit Marker-Körper und den Psets des Portals (${createPlacementHint}).`
                    : createHint
                  : "Im Baum einen Ast doppelklicken oder „Tabelle“ wählen. Ziele, Bereiche, Stellen, Proben, Messanlagen, Maßnahmen, Sensoren und Kanäle sind eigene Objektarten und lassen sich über der Tabelle umschalten."
              }
            />
          )}

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

          {focusedRow && focusedTableCell ? (
            <div className="shrink-0 overflow-hidden rounded-md border border-border/60 bg-card">

              <Inspector
                cell={focusedTableCell}
                row={focusedRow}
                columnStats={(() => {
                  const cells = table.rows.map((row) => row.cells.find((candidate) => candidate.column.key === focusedTableCell.column.key)).filter((candidate): candidate is TableCell => Boolean(candidate));
                  return { rows: cells.length, filled: cells.filter((candidate) => candidate.value).length, empty: cells.filter((candidate) => !candidate.value && candidate.state !== "na" && candidate.state !== "abgeleitet" && candidate.state !== "fehlt").length, missing: cells.filter((candidate) => candidate.state === "fehlt").length };
                })()}
                onFillColumn={(mode) => fillColumn(focusedTableCell.column, focusedTableCell.value, mode)}
                onAttachColumn={() => attachColumnPset(focusedTableCell.column)}
                onAttachRow={() => { const group = table.groups.find((entry) => entry.columns.some((column) => column.key === focusedTableCell.column.key)); if (group) attachToRow(focusedRow, group); }}
                canPick={Boolean(bauwerksmodellId)}
                picking={bauteilPick?.entityId === focusedRow.entityId}
                availableMethods={availableMethods}
                methodDraft={methodDraft}
                onMethodDraft={setMethodDraft}
                onAddMethod={(pattern) => {
                  onCommit((current) => addMethodPset(current, focusedRow.entityId, pattern, importart), `Verfahren ${pattern} an #${focusedRow.entityId}`, `attribution.addMethod({ id: ${focusedRow.entityId}, pset: ${JSON.stringify(pattern)} });`);
                  setMethodDraft("");
                }}
                onPick={() => onStartBauteilPick(bauteilPick ? null : { sessionId: bauwerksmodellId, entityId: focusedRow.entityId, importart })}
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
              disabled={!check.findings.length && !idsFailures.length}
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
          <FindingsList findings={check.findings} ids={ids} selectedId={selectedId} onJump={jumpTo} onShow={onShowInViewer} />
        </PanelShell>
      )}
    </PanelShell>
  );
}

function Inspector({
  availableMethods,
  canPick,
  cell,
  columnStats,
  methodDraft,
  onAddMethod,
  onAttachColumn,
  onAttachRow,
  onEdit,
  onFillColumn,
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
  columnStats: { rows: number; filled: number; empty: number; missing: number };
  methodDraft: string;
  onAddMethod(pattern: string): void;
  onAttachColumn(): void;
  onAttachRow(): void;
  onEdit(): void;
  onFillColumn(mode: "empty" | "all"): void;
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
            <Button size="sm" variant={picking ? "default" : "outline"} className="h-6 px-2 text-xs" disabled={!canPick} title={canPick ? "Nächster Klick im Viewer auf das Bauwerksmodell setzt die BauteilID" : "Erst ein Bauwerksmodell wählen"} onClick={onPick}>
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
        <div className={head}><Columns3 className="size-3" />Spalte</div>
        <div className="text-[12.5px] font-medium text-foreground">{column.property}<span className="ml-1.5 font-normal text-muted-foreground">{column.psetLabel}</span></div>
        <div className="text-muted-foreground">{rule} · <span className="font-mono">{type}</span></div>
        <div className="font-mono text-muted-foreground">{columnStats.filled}/{columnStats.rows} gefüllt{columnStats.empty ? ` · ${columnStats.empty} leer` : ""}{columnStats.missing ? ` · ${columnStats.missing} ohne Pset` : ""}</div>
        <div className={cn(actions, "mt-auto")}>
          {editable && !column.position ? (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={!cell.value || !columnStats.empty} title="Diesen Wert in alle leeren Zellen der Spalte schreiben" onClick={() => onFillColumn("empty")}>In leere Zellen</Button>
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={!cell.value || columnStats.rows < 2} title="Diesen Wert in alle Zellen der Spalte schreiben, vorhandene werden überschrieben" onClick={() => onFillColumn("all")}>In alle Zellen</Button>
            </>
          ) : null}
          {columnStats.missing ? <Button size="sm" variant="outline" className="h-6 px-2 text-xs" title={`${column.psetLabel} an allen Zeilen anlegen, die es nicht haben`} onClick={onAttachColumn}><Plus className="size-3.5" />{column.psetLabel} an alle ({columnStats.missing})</Button> : null}
        </div>
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
  const kind = KIND_LABELS[node.kind];
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
            if (node.entityId != null && node.psetId == null) onSelect(node.entityId);
            else if (hasChildren) onToggle(node, depth);
          }}
          onDoubleClick={() => onFocus(node)}
          title={node.id ? `${node.id} · Doppelklick öffnet die Tabelle` : "Doppelklick öffnet die Tabelle"}
        >
          <span className={cn("truncate", node.kind === "gruppe" || node.kind === "eimer" ? "font-medium text-foreground" : "text-foreground")}>{node.label}</span>
          {kind ? <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground">{kind}</span> : null}
        </button>
        {node.aspekte.length && node.kind !== "projekt" ? (
          <span className="hidden shrink-0 gap-1 md:flex">
            {node.aspekte.slice(0, 4).map((aspekt) => (
              <span key={aspekt} className="rounded bg-accent px-1 font-mono text-[9.5px] text-accent-foreground">{aspekt}</span>
            ))}
            {node.aspekte.length > 4 ? <span className="font-mono text-[9.5px] text-muted-foreground">+{node.aspekte.length - 4}</span> : null}
          </span>
        ) : null}
        {node.objectCount > 1 || node.kind === "gruppe" || node.kind === "eimer" ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{node.objectCount.toLocaleString("de-DE")}</span> : null}
        {node.errorCount ? <Badge tone="danger">{node.errorCount}</Badge> : null}
        {node.entityId != null && node.psetId == null && node.kind !== "projekt" ? (
          <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Im 3D-Modell anzeigen (Fenster klappt ein)" aria-label="Im 3D-Modell anzeigen" onClick={() => onShow(node.entityId!)}>
            <Box className="size-3.5" />
          </button>
        ) : null}
        {hasChildren && node.objectCount ? (
          <button type="button" className="shrink-0 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground" title="Tabelle für diesen Ast" onClick={() => onFocus(node)}>
            Tabelle
          </button>
        ) : null}
        {create ? (
          <button type="button" className="flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground" title={`${create} hier anlegen`} onClick={() => onCreate(node)}>
            <Plus className="size-3" />
            {create}
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
    return <EmptyState title="Keine Befunde" description="Importer-Regeln und IDS des Portals sind erfüllt. Bauteil-Referenzen sind nur mit geladenem Bauwerksmodell geprüft." />;
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
