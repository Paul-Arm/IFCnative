/**
 * Tabellenmodell: Zeilen = Fachobjekte eines Baumknotens, Spalten = Psets mit
 * Properties. Zwei Pflichtstufen: „Import" (Portal, hart) und „Vollständig"
 * (Katalog nach LoI und Gewerk, weich). Reines Modell ohne React.
 */
import { getNativeLengthUnitScale, getNativePlacementWorld, type NativeIfcDocument, type NativeIfcPropertySet } from "../nativeDocument";

import { findPset, findPsets, getProperty, getValue, psetMatches, stripPropertyPrefix, stripPsetPrefix } from "./normalize";
import type { BauwerksmodellIndex, PortalFinding } from "./portalCheck";
import { classifyMethodPset, type Importart, type Katalog, type KatalogKlasse, type KatalogProperty } from "./schema";
import type { TreeNode, TreeNodeKind } from "./tree";

export type LoiLevel = 100 | 200 | 300 | 400 | 500;

export interface Scope {
  loi: LoiLevel;
  gewerke: string[];
}

/** `fehlt` = das Pset liegt nicht am Objekt; eine Eingabe legt es an. Zählt nicht als Lücke. */
export type CellState = "ok" | "import" | "leer" | "typ" | "abgeleitet" | "na" | "neutral" | "unbekannt" | "fehlt";

export type ReferenceKind = "Bauteil" | "Untersuchungsbereich" | "Untersuchungsziel" | "Untersuchungsstelle" | "Messanlage" | "Maßnahme";

export interface TableColumn {
  key: string;
  /** Pset-Muster (Portal-Name ohne Präfix, ggf. Regex-Fragment). */
  psetPattern: string;
  psetLabel: string;
  /** Kanonischer Property-Name ohne Präfix und Suffix. */
  property: string;
  hard: boolean;
  soft: boolean;
  catalog?: KatalogProperty;
  reference?: ReferenceKind;
  derived?: boolean;
  /** Welt-Koordinate der Platzierung (m); Schreiben verschiebt das Objekt. */
  position?: "x" | "y" | "z";
  /** Alias-Namen, unter denen das Portal die Property ebenfalls liest. */
  aliase: string[];
}

export interface TableGroup {
  /** Eindeutig: Pset-Muster, bei der Portal-Pflicht-Gruppe mit Suffix `|hard`. */
  key: string;
  psetPattern: string;
  label: string;
  hard: boolean;
  columns: TableColumn[];
}

export interface TableCell {
  column: TableColumn;
  value: string;
  raw: string;
  psetId?: number;
  propertyId?: number;
  state: CellState;
  note?: string;
  /** Aufgelöstes Referenzziel (Name), wenn bekannt. */
  target?: string;
}

export interface TableRow {
  /** Eindeutig je Zeile: Entity-ID, bei Pset-Zeilen ergänzt um die Pset-ID. */
  key: string;
  entityId: number;
  /** Gesetzt, wenn die Zeile ein nummeriertes Pset ist (Ziel, Bereich, Messanlage, Maßnahme, Kanal). */
  psetId?: number;
  psetName?: string;
  kind: TreeNodeKind;
  label: string;
  id?: string;
  cells: TableCell[];
  importErrors: number;
}

export interface TableModel {
  objektart: TreeNodeKind | null;
  groups: TableGroup[];
  columns: TableColumn[];
  rows: TableRow[];
}

interface ObjektartRule {
  hard: Array<{ pset: string; label: string; property: string; aliase?: string[]; reference?: ReferenceKind }>;
  derived: Array<{ pset: string; property: string }>;
  nichtAnwendbar: Array<{ pset: string; property: string }>;
  /** Katalogklassen-Codes der Basis-Aspekte. */
  katalogklassen: string[];
  /** Pset-Familie, wenn die Objektart ein nummeriertes Pset ist (Zeile = ein Pset, nicht eine Entity). */
  familie?: string;
}

const OBJEKTINFORMATION = "Objektinformation(en)?";
/** Pseudo-Pset der Positionsspalten (trifft keinen Pset-Namen in der Datei). */
export const POSITION_PATTERN = "@position";

export function formatMeters(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Zahl aus Nutzereingabe oder Tabelle: Komma oder Punkt, Leerzeichen erlaubt. */
export function parseMeters(text: string): number | undefined {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

export const OBJEKTART_RULES: Partial<Record<TreeNodeKind, ObjektartRule>> = {
  untersuchungsstelle: {
    hard: [
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "ID", aliase: ["IDUntersuchungsstelle"] },
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "Bezeichnung", aliase: ["BezeichnungUntersuchungsstelle"] },
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "BauteilID", reference: "Bauteil" },
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "UntersuchungsbereichID", reference: "Untersuchungsbereich" },
    ],
    derived: [
      { pset: OBJEKTINFORMATION, property: "IDEbene1" },
      { pset: OBJEKTINFORMATION, property: "IDEbene2" },
      { pset: OBJEKTINFORMATION, property: "IDEbene3" },
    ],
    nichtAnwendbar: [
      { pset: OBJEKTINFORMATION, property: "ProbeID" },
      { pset: OBJEKTINFORMATION, property: "MessfeldID" },
    ],
    katalogklassen: ["BWD - OI", "BWD - US"],
  },
  probe: {
    hard: [
      { pset: "Probe\\d*", label: "Probe", property: "ID", aliase: ["IDProbe"] },
      { pset: "Probe\\d*", label: "Probe", property: "UntersuchungsstelleID", reference: "Untersuchungsstelle" },
    ],
    derived: [{ pset: OBJEKTINFORMATION, property: "IDEbene1" }, { pset: OBJEKTINFORMATION, property: "IDEbene2" }, { pset: OBJEKTINFORMATION, property: "IDEbene3" }],
    nichtAnwendbar: [{ pset: OBJEKTINFORMATION, property: "BauteilID" }, { pset: OBJEKTINFORMATION, property: "MessfeldID" }],
    katalogklassen: ["BWD - PB", "BWD - OI"],
  },
  ergebnis: {
    hard: [],
    derived: [],
    nichtAnwendbar: [],
    katalogklassen: ["BWD - UE", "BWD - OI"],
  },
  sensor: {
    hard: [
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "ID" },
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "Bezeichnung" },
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "BauteilID", reference: "Bauteil" },
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "MessanlageID", reference: "Messanlage" },
    ],
    derived: [],
    nichtAnwendbar: [],
    katalogklassen: ["MON - OI", "MON - SEN", "MON - PO"],
  },
  untersuchungsziel: {
    hard: [
      { pset: "Untersuchungsziel\\d*", label: "Untersuchungsziel", property: "ID" },
      { pset: "Untersuchungsziel\\d*", label: "Untersuchungsziel", property: "Bezeichnung", aliase: ["UntersuchungszielName"] },
    ],
    derived: [],
    nichtAnwendbar: [],
    katalogklassen: ["BWD - UZ"],
    familie: "Untersuchungsziel\\d*",
  },
  untersuchungsbereich: {
    hard: [{ pset: "Untersuchungsbereich\\d*", label: "Untersuchungsbereich", property: "ID" }],
    derived: [],
    nichtAnwendbar: [],
    katalogklassen: ["BWD - UB"],
    familie: "Untersuchungsbereich\\d*",
  },
  messanlage: {
    hard: [{ pset: "Messanlage\\d*", label: "Messanlage", property: "ID" }],
    derived: [],
    nichtAnwendbar: [],
    katalogklassen: ["MON - MA"],
    familie: "Messanlage\\d*",
  },
  massnahme: {
    hard: [
      { pset: "Maßnahme\\d*", label: "Maßnahme", property: "ID" },
      { pset: "Maßnahme\\d*", label: "Maßnahme", property: "Bezeichnung" },
    ],
    derived: [],
    nichtAnwendbar: [],
    katalogklassen: ["MON - MASSN"],
    familie: "Maßnahme\\d*",
  },
  kanal: {
    hard: [
      { pset: "Kanal\\d*", label: "Kanal", property: "ID" },
      { pset: "Kanal\\d*", label: "Kanal", property: "Bezeichnung" },
      { pset: "Kanal\\d*", label: "Kanal", property: "MaßnahmeID", reference: "Maßnahme" },
    ],
    derived: [],
    nichtAnwendbar: [],
    katalogklassen: ["MON - K"],
    familie: "Kanal\\d*",
  },
  bauteil: {
    hard: [
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "ID" },
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "IDEbene1" },
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "IDEbene2" },
      { pset: OBJEKTINFORMATION, label: "Objektinformation", property: "IDEbene3" },
    ],
    derived: [],
    nichtAnwendbar: [],
    katalogklassen: [],
  },
};

/** Objektarten mit Tabelle, in Baumreihenfolge (Container vor Fachobjekten vor Unterelementen). */
const TABLE_KINDS: TreeNodeKind[] = ["untersuchungsziel", "untersuchungsbereich", "untersuchungsstelle", "probe", "ergebnis", "messanlage", "massnahme", "sensor", "kanal", "bauteil"];

export function isTableKind(kind: TreeNodeKind): boolean {
  return TABLE_KINDS.includes(kind);
}

/** Objektarten unter einem Knoten mit Zeilenzahl, in Baumreihenfolge — für den Umschalter über der Tabelle. */
export function objektartenOf(nodes: TreeNode[]): Array<{ kind: TreeNodeKind; count: number }> {
  const counts = new Map<TreeNodeKind, number>();
  for (const node of nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  return TABLE_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({ kind, count: counts.get(kind)! }));
}

/** Fachobjekte unterhalb eines Knotens (inklusive Knoten), die eine Tabellenzeile werden — Entities und nummerierte Psets. */
export function collectRows(node: TreeNode): TreeNode[] {
  const rows: TreeNode[] = [];
  const visit = (current: TreeNode) => {
    if (TABLE_KINDS.includes(current.kind) && current.entityId != null) rows.push(current);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return rows;
}

export interface BuildTableOptions {
  importart: Importart;
  scope: Scope;
  katalog: Katalog | null;
  bauwerksmodell: BauwerksmodellIndex | null;
  findings: PortalFinding[];
  /** Gewünschte Objektart; fehlt sie unter den Knoten, gilt die häufigste. */
  objektart?: TreeNodeKind;
}

export function buildTable(document: NativeIfcDocument, nodes: TreeNode[], options: BuildTableOptions): TableModel {
  const rowsNodes = nodes.filter((node) => TABLE_KINDS.includes(node.kind) && node.entityId != null);
  if (!rowsNodes.length) return { objektart: null, groups: [], columns: [], rows: [] };
  const counts = new Map<TreeNodeKind, number>();
  for (const node of rowsNodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  const objektart = options.objektart && counts.has(options.objektart) ? options.objektart : [...counts].sort((a, b) => b[1] - a[1])[0]![0];
  const rule = OBJEKTART_RULES[objektart] ?? { hard: [], derived: [], nichtAnwendbar: [], katalogklassen: [] };
  const rowNodes = rowsNodes.filter((node) => node.kind === objektart);
  // Pset-Zeilen (Ziel, Bereich, Messanlage, Maßnahme, Kanal) sehen nur ihr eigenes Pset, Entity-Zeilen alle Psets des Objekts.
  const setsFor = (node: TreeNode): NativeIfcPropertySet[] => {
    const sets = document.propertySetsByEntity.get(node.entityId!) ?? [];
    return node.psetId != null ? sets.filter((set) => set.id === node.psetId) : sets;
  };
  const findRowSet = (node: TreeNode, pattern: string) => setsFor(node).find((set) => psetMatches(set.name, pattern));
  const references = collectReferenceTargets(document, options.bauwerksmodell);
  const errorsByEntity = new Map<number, number>();
  const errorsByPset = new Map<string, number>();
  for (const finding of options.findings) {
    if (finding.severity !== "error" || finding.entityId == null) continue;
    errorsByEntity.set(finding.entityId, (errorsByEntity.get(finding.entityId) ?? 0) + 1);
    if (finding.pset_name) {
      const key = `${finding.entityId}|${finding.pset_name}`;
      errorsByPset.set(key, (errorsByPset.get(key) ?? 0) + 1);
    }
  }

  /* Spalten: harte Portal-Felder → Katalog-Psets der Basisaspekte → Verfahrens-Psets → sonstige Psets in der Datei. */
  // Die Portal-Pflicht ist eine eigene, schmale Gruppe; der Katalog-Rest derselben Pset-Familie kommt als zweite Gruppe (im Panel zugeklappt).
  const groups = new Map<string, TableGroup>();
  const ensureGroup = (pattern: string, label: string, hard = false) => {
    const key = hard ? `${pattern}|hard` : pattern;
    let group = groups.get(key);
    if (!group) {
      const hardTwin = hard ? undefined : groups.get(`${pattern}|hard`);
      group = { key, psetPattern: pattern, label: hardTwin?.label ?? label, hard, columns: [] };
      groups.set(key, group);
    }
    return group;
  };
  const ensureColumn = (group: TableGroup, property: string, init: Partial<TableColumn>) => {
    const lower = property.toLowerCase();
    // Aliase (z. B. BezeichnungUntersuchungsstelle → Bezeichnung) landen in der bestehenden Spalte
    const matches = (entry: TableColumn) => entry.property.toLowerCase() === lower || entry.aliase.some((alias) => alias.toLowerCase() === lower);
    // Eine Portal-Pflichtspalte derselben Pset-Familie hat Vorrang: Kataloginfos hängen sich an sie, statt eine zweite Spalte zu erzeugen.
    const hardTwin = group.hard ? undefined : groups.get(`${group.psetPattern}|hard`)?.columns.find(matches);
    let column = hardTwin ?? group.columns.find(matches);
    if (!column) {
      column = { key: `${group.key}|${lower}`, psetPattern: group.psetPattern, psetLabel: group.label, property, hard: false, soft: false, aliase: [], ...init };
      group.columns.push(column);
    } else {
      Object.assign(column, { ...init, hard: column.hard || Boolean(init.hard), soft: column.soft || Boolean(init.soft), aliase: [...new Set([...column.aliase, ...(init.aliase ?? [])])] });
    }
    return column;
  };

  for (const hard of rule.hard) {
    const group = ensureGroup(hard.pset, hard.label, true);
    ensureColumn(group, hard.property, { hard: true, reference: hard.reference, aliase: hard.aliase ?? [] });
  }
  for (const derived of rule.derived) {
    ensureColumn(ensureGroup(derived.pset, "Objektinformation"), derived.property, { derived: true });
  }

  const klassen = options.katalog ? options.katalog.objektklassen : [];
  const inScope = (property: KatalogProperty) =>
    property.pflicht && property.loi.includes(options.scope.loi) && (options.scope.gewerke.length === 0 || property.gewerk.some((g) => options.scope.gewerke.includes(g)));
  const addKatalogPsets = (klasse: KatalogKlasse) => {
    for (const pset of klasse.psets) {
      const pattern = pset.familie ?? psetPatternFor(pset.portalName);
      const group = ensureGroup(pattern, pset.portalName);
      for (const property of pset.properties) {
        // Alle Katalogspalten, damit Import und Inspektor sie kennen; leere optionale blendet das Panel aus.
        ensureColumn(group, property.kurz, { soft: inScope(property), catalog: property });
      }
    }
  };
  for (const code of rule.katalogklassen) {
    const klasse = klassen.find((entry) => entry.code === code);
    if (klasse) addKatalogPsets(klasse);
  }
  // Verfahrens-Psets, die auf mindestens einer Zeile liegen
  const presentPsets = new Map<string, string>();
  for (const node of rowNodes) {
    for (const set of setsFor(node)) {
      const name = stripPsetPrefix(set.name);
      if (!presentPsets.has(name)) presentPsets.set(name, name);
    }
  }
  for (const name of presentPsets.keys()) {
    const method = classifyMethodPset(name);
    if (method?.kind === "main") {
      const klasse = klassen.find((entry) => entry.psets.some((pset) => psetMatches(pset.name, method.verfahren.pset)));
      if (klasse) addKatalogPsets(klasse);
      else ensureGroup(method.verfahren.pset, name);
    }
  }
  // Properties in der Datei, die der Katalog nicht kennt
  for (const node of rowNodes) {
    for (const set of setsFor(node)) {
      const candidates = [...groups.values()].filter((entry) => psetMatches(set.name, entry.psetPattern));
      const group = candidates.find((entry) => !entry.hard) ?? candidates[0];
      if (!group) continue;
      const known = candidates.flatMap((entry) => entry.columns);
      for (const property of set.values) {
        ensureColumn(group, canonicalPropertyName(property.name, known), {});
      }
    }
  }
  for (const na of rule.nichtAnwendbar) {
    const group = groups.get(na.pset);
    if (group) ensureColumn(group, na.property, {});
  }
  // Position: Welt-Koordinaten der Platzierung in Metern — nur für Objekt-Zeilen; Schreiben verschiebt den Marker.
  const scale = getNativeLengthUnitScale(document);
  if (!rule.familie && rowNodes.some((node) => getNativePlacementWorld(document, node.entityId!))) {
    const group = ensureGroup(POSITION_PATTERN, "Position (Welt, m)");
    ensureColumn(group, "X", { position: "x", aliase: ["Rechtswert", "Easting", "Ost", "PositionX", "KoordinateX", "PosX"] });
    ensureColumn(group, "Y", { position: "y", aliase: ["Hochwert", "Northing", "Nord", "PositionY", "KoordinateY", "PosY"] });
    ensureColumn(group, "Z", { position: "z", aliase: ["Hoehe", "Höhe", "Elevation", "PositionZ", "KoordinateZ", "PosZ"] });
  }

  const orderedGroups = [...groups.values()].filter((group) => group.columns.length).sort((a, b) => Number(b.hard) - Number(a.hard));
  for (const group of orderedGroups) {
    // stabil: harte Portal-Felder in Regelreihenfolge, dann Katalog-Pflicht, dann Rest in Einfügereihenfolge
    group.columns.sort((a, b) => Number(b.hard) - Number(a.hard) || (a.hard ? 0 : Number(b.soft) - Number(a.soft)));
  }
  const columns = orderedGroups.flatMap((group) => group.columns);

  const rows: TableRow[] = rowNodes.map((node) => {
    const entityId = node.entityId!;
    const ownSet = node.psetId != null ? setsFor(node)[0] : undefined;
    const psetName = ownSet ? stripPsetPrefix(ownSet.name) : undefined;
    const cells = columns.map((column) => (column.position ? positionCell(document, entityId, column, scale) : buildCell(findRowSet(node, column.psetPattern), column, rule, references, options.bauwerksmodell)));
    const importErrors = psetName ? (errorsByPset.get(`${entityId}|${psetName}`) ?? 0) : (errorsByEntity.get(entityId) ?? 0);
    return { key: node.psetId != null ? `${entityId}:${node.psetId}` : String(entityId), entityId, psetId: node.psetId, psetName, kind: node.kind, label: node.label, id: node.id, cells, importErrors };
  });
  return { objektart, groups: orderedGroups, columns, rows };
}

function psetPatternFor(portalName: string): string {
  // Eine Schreibweise für alle Objektarten, sonst entstehen zwei Objektinformation-Gruppen nebeneinander.
  if (/^Objektinformation(en)?$/.test(portalName)) return OBJEKTINFORMATION;
  return portalName;
}

function canonicalPropertyName(rawName: string, columns: TableColumn[]): string {
  const stripped = stripPropertyPrefix(rawName);
  const lower = stripped.toLowerCase();
  const known = columns.find((column) => lower === column.property.toLowerCase() || lower.startsWith(`${column.property.toLowerCase()}_`) || column.aliase.some((alias) => lower === alias.toLowerCase()));
  if (known) return known.property;
  const suffix = stripped.match(/^(.*)_([A-Z0-9ß]{1,6})$/);
  return suffix ? suffix[1]! : stripped;
}

interface ReferenceTargets {
  untersuchungsbereich: Map<string, string>;
  untersuchungsziel: Map<string, string>;
  untersuchungsstelle: Map<string, string>;
  messanlage: Map<string, string>;
  massnahme: Map<string, string>;
}

function collectReferenceTargets(document: NativeIfcDocument, bauwerksmodell: BauwerksmodellIndex | null): ReferenceTargets {
  const targets: ReferenceTargets = { untersuchungsbereich: new Map(), untersuchungsziel: new Map(), untersuchungsstelle: new Map(), messanlage: new Map(), massnahme: new Map() };
  const building = document.entitiesByType.get("IFCBUILDING")?.[0];
  if (building) {
    const collect = (pattern: string, into: Map<string, string>) => {
      for (const set of findPsets(document, building.id, pattern)) {
        const id = getValue(set, "ID");
        if (id) into.set(id, getValue(set, "Bezeichnung", "UntersuchungszielName") || stripPsetPrefix(set.name));
      }
    };
    collect("Untersuchungsbereich\\d*", targets.untersuchungsbereich);
    collect("Untersuchungsziel\\d*", targets.untersuchungsziel);
    collect("Messanlage\\d+", targets.messanlage);
    collect("Maßnahme\\d+", targets.massnahme);
  }
  for (const entity of document.entitiesByType.get("IFCBUILDINGELEMENTPROXY") ?? []) {
    const info = findPset(document, entity.id, "Objektinformationen", "Objektinformation");
    if (info && getValue(info, "BauteilID")) {
      const id = getValue(info, "ID", "IDUntersuchungsstelle");
      if (id) targets.untersuchungsstelle.set(id, getValue(info, "Bezeichnung", "BezeichnungUntersuchungsstelle") || entity.name);
    }
  }
  void bauwerksmodell;
  return targets;
}

const NUMERIC_TYPES = /^IFC(REAL|INTEGER|[A-Z]*MEASURE|NUMERICMEASURE)$/;

function positionCell(document: NativeIfcDocument, entityId: number, column: TableColumn, scale: number): TableCell {
  const world = getNativePlacementWorld(document, entityId);
  if (!world) return { column, value: "", raw: "", state: "na" };
  const axis = column.position === "x" ? world.worldX : column.position === "y" ? world.worldY : world.worldZ;
  const value = formatMeters(axis * scale);
  return { column, value, raw: value, state: "ok" };
}

function buildCell(
  set: NativeIfcPropertySet | undefined,
  column: TableColumn,
  rule: ObjektartRule,
  references: ReferenceTargets,
  bauwerksmodell: BauwerksmodellIndex | null,
): TableCell {
  const hit = getProperty(set, column.property, ...column.aliase);
  const base: TableCell = { column, value: hit?.value ?? "", raw: hit?.rawValue ?? "", psetId: set?.id, propertyId: hit?.propertyId, state: "neutral" };
  if (rule.nichtAnwendbar.some((na) => na.property === column.property && psetMatches(column.psetPattern, na.pset.replace("(en)?", "")) || (na.property === column.property && na.pset === column.psetPattern))) {
    return { ...base, state: "na" };
  }
  if (column.derived) return { ...base, state: "abgeleitet" };
  if (!set && !column.hard) return { ...base, state: "fehlt", note: "Pset nicht am Objekt" };
  if (column.reference && base.value) {
    const resolved = resolveReference(column.reference, base.value, references, bauwerksmodell);
    if (resolved.state === "unbekannt") return { ...base, state: "unbekannt", note: "Bauwerksmodell nicht geladen" };
    if (!resolved.target) return { ...base, state: "import", note: "kein Ziel" };
    return { ...base, state: "ok", target: resolved.target };
  }
  if (column.hard) return base.value ? { ...base, state: "ok" } : { ...base, state: "import", note: "Portal-Pflicht" };
  if (column.catalog && base.value && NUMERIC_TYPES.test(column.catalog.typ) && !/^-?\d+([.,]\d+)?$/.test(base.value)) {
    return { ...base, state: "typ", note: `${column.catalog.typ} erwartet` };
  }
  if (column.soft) return base.value ? { ...base, state: "ok" } : { ...base, state: "leer", note: "Katalog-Pflicht" };
  return { ...base, state: base.value ? "ok" : "neutral" };
}

function resolveReference(kind: ReferenceKind, value: string, references: ReferenceTargets, bauwerksmodell: BauwerksmodellIndex | null): { state: "ok" | "unbekannt"; target?: string } {
  switch (kind) {
    case "Bauteil": {
      if (!bauwerksmodell) return { state: "unbekannt" };
      const entityId = bauwerksmodell.components.get(value);
      return { state: "ok", target: entityId != null ? value.split(".").slice(-2).join(".") : undefined };
    }
    case "Untersuchungsbereich":
      return { state: "ok", target: references.untersuchungsbereich.get(value) };
    case "Untersuchungsziel":
      return { state: "ok", target: references.untersuchungsziel.get(value) };
    case "Untersuchungsstelle":
      return { state: "ok", target: references.untersuchungsstelle.get(value) };
    case "Messanlage":
      return { state: "ok", target: references.messanlage.get(value) };
    case "Maßnahme":
      return { state: "ok", target: references.massnahme.get(value) };
  }
  return { state: "ok" };
}

/** Bevorzugter Schreibtyp je Importart: DIA-Dateien und Katalog BWD nutzen IFCLABEL, Monitoring IFCTEXT. */
export function valueTypeFor(importart: Importart, catalog?: KatalogProperty): string {
  if (catalog && NUMERIC_TYPES.test(catalog.typ)) return catalog.typ;
  return importart === "monitoring" ? "IFCTEXT" : "IFCLABEL";
}

export function existingPsetName(set: NativeIfcPropertySet | undefined, fallback: string): string {
  return set ? set.name : `ePset_${fallback}`;
}
