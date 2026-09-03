/**
 * Fachmodell-Baum: rekonstruiert aus einer Datei die Hierarchie, die das
 * Portal aus IDs und Referenzen liest — Projekt → Container → Fachobjekte →
 * Unterelemente — plus den Eimer „Nicht zuordenbar" für Elemente, die das
 * Portal in der gewählten Importart ablehnen würde.
 */
import type { NativeIfcDocument, NativeIfcEntity, NativeIfcPropertySet } from "../nativeDocument";

import { findPset, findPsets, getValue, idPrefix, psetMatches, stripPsetPrefix } from "./normalize";
import type { PortalFinding } from "./portalCheck";
import { isMainMethodPset, type Importart } from "./schema";

export type TreeNodeKind =
  | "projekt"
  | "gruppe"
  | "untersuchungsziel"
  | "untersuchungsbereich"
  | "untersuchungsstelle"
  | "probe"
  | "ergebnis"
  | "massnahme"
  | "messanlage"
  | "sensor"
  | "kanal"
  | "bauteilgruppe"
  | "bauteiltyp"
  | "bauteilvariante"
  | "bauteil"
  | "eimer";

export interface TreeNode {
  key: string;
  kind: TreeNodeKind;
  label: string;
  /** Vollständige ID, wenn der Knoten eine trägt. */
  id?: string;
  /** Trägerobjekt im Dokument (Element oder IfcBuilding). */
  entityId?: number;
  /** Pset, wenn der Knoten ein nummeriertes Pset ist (Container, Kanal). */
  psetId?: number;
  /** Aspekte = Pset-Namen ohne Präfix (Fachobjekte). */
  aspekte: string[];
  children: TreeNode[];
  /** Zahl der Fachobjekte im Teilbaum. */
  objectCount: number;
  /** Import-Befunde im Teilbaum (Fehler). */
  errorCount: number;
  /** Objektart, die sich unter diesem Gruppenknoten anlegen lässt (Ziel, Bereich, Messanlage, Maßnahme). */
  creates?: TreeNodeKind;
}

export interface FachmodellTree {
  importart: Importart;
  root: TreeNode | null;
  eimer: TreeNode;
  /** Knoten je Entity-ID, für Auswahl-Synchronisation mit dem Viewer. */
  byEntity: Map<number, TreeNode>;
}

const OBJEKTINFORMATION = ["Objektinformationen", "Objektinformation"];

/** Importart aus den Psets erraten — nur ein Vorschlag, die Wahl bleibt beim Nutzer. */
export function detectImportart(document: NativeIfcDocument): Importart {
  let hasResult = false;
  let hasSample = false;
  let hasKanal = false;
  let hasEbene = false;
  let hasPoint = false;
  for (const [entityId, sets] of document.propertySetsByEntity) {
    for (const set of sets) {
      const name = stripPsetPrefix(set.name);
      if (name === "Untersuchungsergebnisse") hasResult = true;
      if (/^Kanal\d+$/.test(name)) hasKanal = true;
      if (/^Probe\d*$/.test(name) && getValue(set, "UntersuchungsstelleID")) hasSample = true;
      if (name === "Objektinformation" && getValue(set, "IDEbene1")) hasEbene = true;
      if (OBJEKTINFORMATION.includes(name) && getValue(set, "BauteilID")) hasPoint = true;
    }
    void entityId;
  }
  if (hasResult) return "ergebnisse";
  if (hasKanal) return "monitoring";
  if (hasSample) return "einzelergebnisse";
  if (hasPoint) return "planung";
  if (hasEbene) return "bauwerksmodell";
  return "planung";
}

export function buildFachmodellTree(
  document: NativeIfcDocument,
  importart: Importart,
  findings: PortalFinding[] = [],
): FachmodellTree {
  const errorsByEntity = new Map<number, number>();
  const unassignable = new Set<number>();
  for (const finding of findings) {
    if (finding.severity !== "error" || finding.entityId == null) continue;
    errorsByEntity.set(finding.entityId, (errorsByEntity.get(finding.entityId) ?? 0) + 1);
    if (finding.code === "unassignable_element") unassignable.add(finding.entityId);
  }
  const builder = new TreeBuilder(document, importart, errorsByEntity, unassignable);
  return builder.build();
}

class TreeBuilder {
  readonly byEntity = new Map<number, TreeNode>();
  private readonly placed = new Set<number>();

  constructor(
    private readonly document: NativeIfcDocument,
    private readonly importart: Importart,
    private readonly errorsByEntity: Map<number, number>,
    private readonly unassignable: Set<number>,
  ) {}

  build(): FachmodellTree {
    const building = this.document.entitiesByType.get("IFCBUILDING")?.[0];
    let root: TreeNode | null = null;
    switch (this.importart) {
      case "bauwerksmodell":
        root = this.buildBauwerksmodell(building);
        break;
      case "monitoring":
        root = this.buildMonitoring(building);
        break;
      case "ergebnisse":
        root = this.buildErgebnisse(building);
        break;
      default:
        root = this.buildDiagnostik(building);
    }
    const eimer = this.buildEimer();
    if (root) finalize(root);
    finalize(eimer);
    return { importart: this.importart, root, eimer, byEntity: this.byEntity };
  }

  /* ---------------- Diagnostik A/B ---------------- */

  private buildDiagnostik(building: NativeIfcEntity | undefined): TreeNode | null {
    if (!building) return null;
    const projekt = findPset(this.document, building.id, "Projekt", "Diagnostik Projekt");
    const projektId = getValue(projekt, "ID");
    const root = this.node("projekt", getValue(projekt, "Bezeichnung", "BezeichnungProjekt") || building.name || "Projekt", { id: projektId, entityId: building.id, aspekte: psetNames(this.document, building.id) });

    const ziele = this.node("gruppe", "Untersuchungsziele", { creates: "untersuchungsziel" });
    for (const set of findPsets(this.document, building.id, "Untersuchungsziel\\d*")) {
      ziele.children.push(this.node("untersuchungsziel", getValue(set, "Bezeichnung", "UntersuchungszielName") || stripPsetPrefix(set.name), { id: getValue(set, "ID"), entityId: building.id, psetId: set.id }));
    }
    const bereiche = this.node("gruppe", "Untersuchungsbereiche", { creates: "untersuchungsbereich" });
    const bereichById = new Map<string, TreeNode>();
    for (const set of findPsets(this.document, building.id, "Untersuchungsbereich\\d*")) {
      const id = getValue(set, "ID");
      const node = this.node("untersuchungsbereich", getValue(set, "Bezeichnung") || lastSegment(id) || stripPsetPrefix(set.name), { id, entityId: building.id, psetId: set.id });
      bereiche.children.push(node);
      if (id) bereichById.set(id, node);
    }
    const ohneBereich = this.node("gruppe", "Ohne Untersuchungsbereich", {});

    const stellen = new Map<string, TreeNode>();
    for (const entity of this.document.entitiesByType.get("IFCBUILDINGELEMENTPROXY") ?? []) {
      const info = findPset(this.document, entity.id, ...OBJEKTINFORMATION);
      if (!info) continue;
      // Stelle = BauteilID gesetzt (so liest es das Portal) — oder erkennbar gewollt: ID/Bezeichnung da, keine Probe-Referenz.
      // So bleiben frisch angelegte Stellen ohne BauteilID an ihrem Platz im Baum statt im Eimer; der Befund zählt trotzdem.
      const isSample = findPsets(this.document, entity.id, "Probe\\d*").some((set) => getValue(set, "UntersuchungsstelleID"));
      const intended = Boolean(getValue(info, "BauteilID")) || (!isSample && Boolean(getValue(info, "ID", "IDUntersuchungsstelle") || getValue(info, "Bezeichnung", "BezeichnungUntersuchungsstelle")));
      if (!intended) continue;
      const id = getValue(info, "ID", "IDUntersuchungsstelle");
      const node = this.node("untersuchungsstelle", getValue(info, "Bezeichnung", "BezeichnungUntersuchungsstelle") || entity.name || `#${entity.id}`, { id, entityId: entity.id, aspekte: psetNames(this.document, entity.id) });
      node.objectCount = 1;
      this.place(entity.id, node);
      if (id) stellen.set(id, node);
      const bereich = bereichById.get(getValue(info, "UntersuchungsbereichID"));
      (bereich ?? ohneBereich).children.push(node);
    }
    if (this.importart === "einzelergebnisse") {
      const ohneStelle = this.node("gruppe", "Proben ohne Untersuchungsstelle", {});
      for (const entity of this.document.entitiesByType.get("IFCBUILDINGELEMENTPROXY") ?? []) {
        if (this.placed.has(entity.id) || this.unassignable.has(entity.id)) continue;
        const probe = findPsets(this.document, entity.id, "Probe\\d*").find((set) => getValue(set, "UntersuchungsstelleID")) ?? findPset(this.document, entity.id, "Objektinformation");
        const stelleId = getValue(probe, "UntersuchungsstelleID");
        if (!probe || !stelleId) continue;
        const node = this.node("probe", getValue(probe, "Bezeichnung", "IDProbe") || entity.name || `#${entity.id}`, { id: getValue(probe, "ID", "IDProbe"), entityId: entity.id, aspekte: psetNames(this.document, entity.id) });
        node.objectCount = 1;
        this.place(entity.id, node);
        (stellen.get(stelleId) ?? ohneStelle).children.push(node);
      }
      if (ohneStelle.children.length) root.children.push(ohneStelle);
    }
    // Bereichs-Chips: die Verfahren, die an den Stellen des Bereichs tatsächlich als Pset liegen.
    for (const bereich of [...bereiche.children, ohneBereich]) {
      bereich.aspekte = [...new Set(bereich.children.flatMap((child) => child.aspekte.filter((name) => isMainMethodPset(name))))];
    }
    root.children.unshift(ziele, bereiche);
    if (ohneBereich.children.length) root.children.push(ohneBereich);
    return root;
  }

  /* ---------------- Ergebnisse C ---------------- */

  private buildErgebnisse(building: NativeIfcEntity | undefined): TreeNode | null {
    if (!building) return null;
    const projekt = findPset(this.document, building.id, "Projekt", "Diagnostik Projekt");
    const root = this.node("projekt", getValue(projekt, "Bezeichnung", "BezeichnungProjekt") || building.name || "Projekt", { id: getValue(projekt, "ID"), entityId: building.id, aspekte: psetNames(this.document, building.id) });
    for (const entity of this.document.entitiesByType.get("IFCBUILDINGELEMENTPROXY") ?? []) {
      if (this.unassignable.has(entity.id)) continue;
      if (!findPset(this.document, entity.id, "Untersuchungsergebnisse")) continue;
      const info = findPset(this.document, entity.id, "Objektinformation");
      const node = this.node("ergebnis", getValue(info, "Bezeichnung") || entity.name || `#${entity.id}`, { id: getValue(info, "ID") || entity.globalId, entityId: entity.id, aspekte: psetNames(this.document, entity.id) });
      node.objectCount = 1;
      this.place(entity.id, node);
      root.children.push(node);
    }
    return root;
  }

  /* ---------------- Monitoring ---------------- */

  private buildMonitoring(building: NativeIfcEntity | undefined): TreeNode | null {
    if (!building) return null;
    const projekt = findPset(this.document, building.id, "Projekt");
    const root = this.node("projekt", getValue(projekt, "Bezeichnung") || building.name || "Projekt", { id: getValue(projekt, "ID"), entityId: building.id, aspekte: psetNames(this.document, building.id) });
    const messanlagen = this.node("gruppe", "Messanlagen", { creates: "messanlage" });
    const messanlageById = new Map<string, TreeNode>();
    for (const set of findPsets(this.document, building.id, "Messanlage\\d+")) {
      const id = getValue(set, "ID");
      const node = this.node("messanlage", getValue(set, "Bezeichnung") || lastSegment(id) || stripPsetPrefix(set.name), { id, entityId: building.id, psetId: set.id });
      messanlagen.children.push(node);
      if (id) messanlageById.set(id, node);
    }
    const massnahmen = this.node("gruppe", "Maßnahmen", { creates: "massnahme" });
    const massnahmeById = new Map<string, TreeNode>();
    for (const set of findPsets(this.document, building.id, "Maßnahme\\d+")) {
      const id = getValue(set, "ID");
      const node = this.node("massnahme", getValue(set, "Bezeichnung") || lastSegment(id) || stripPsetPrefix(set.name), { id, entityId: building.id, psetId: set.id });
      massnahmen.children.push(node);
      if (id) massnahmeById.set(id, node);
    }
    const ohneMessanlage = this.node("gruppe", "Sensoren ohne Messanlage", {});
    for (const entity of this.document.entitiesByType.get("IFCBUILDINGELEMENTPROXY") ?? []) {
      if (this.unassignable.has(entity.id)) continue;
      const info = findPset(this.document, entity.id, "Objektinformation");
      if (!info) continue;
      const sensor = this.node("sensor", getValue(info, "Bezeichnung") || entity.name || `#${entity.id}`, { id: getValue(info, "ID"), entityId: entity.id, aspekte: psetNames(this.document, entity.id).filter((name) => !/^Kanal\d+$/.test(name)) });
      sensor.objectCount = 1;
      this.place(entity.id, sensor);
      for (const kanal of findPsets(this.document, entity.id, "Kanal\\d+")) {
        const massnahme = massnahmeById.get(getValue(kanal, "MaßnahmeID"));
        sensor.children.push(this.node("kanal", getValue(kanal, "Bezeichnung") || stripPsetPrefix(kanal.name), { id: getValue(kanal, "ID"), entityId: entity.id, psetId: kanal.id, aspekte: massnahme ? [`→ ${massnahme.label}`] : [] }));
      }
      (messanlageById.get(getValue(info, "MessanlageID")) ?? ohneMessanlage).children.push(sensor);
    }
    root.children.push(messanlagen, massnahmen);
    if (ohneMessanlage.children.length) root.children.push(ohneMessanlage);
    return root;
  }

  /* ---------------- Bauwerksmodell ---------------- */

  private buildBauwerksmodell(building: NativeIfcEntity | undefined): TreeNode | null {
    if (!building) return null;
    const bauwerk = findPset(this.document, building.id, "Bauwerk");
    const nummer = getValue(bauwerk, "Bauwerksnummer");
    const teilbauwerk = getValue(bauwerk, "Teilbauwerksnummer");
    const root = this.node("projekt", getValue(bauwerk, "Bauwerksname") || building.name || "Bauwerk", { id: nummer && teilbauwerk ? `${nummer}.${teilbauwerk}` : nummer, entityId: building.id, aspekte: psetNames(this.document, building.id) });
    const gruppen = new Map<string, TreeNode>();
    for (const entity of this.document.entities) {
      if (!/^IFC/.test(entity.type) || entity.type === "IFCBUILDING") continue;
      const info = findPset(this.document, entity.id, "Objektinformation");
      if (!info || !getValue(info, "IDEbene1")) continue;
      const id = getValue(info, "ID");
      const segments = id.split(".");
      const path: Array<[TreeNodeKind, string, string]> = [
        ["bauteilgruppe", getValue(info, "IDEbene1"), segments.slice(0, 3).join(".")],
        ["bauteiltyp", getValue(info, "IDEbene2"), segments.slice(0, 4).join(".")],
        ["bauteilvariante", getValue(info, "IDEbene3"), segments.slice(0, 5).join(".")],
      ];
      let parent = root;
      for (const [kind, label, prefix] of path) {
        const key = `${kind}:${prefix || label}`;
        let node = gruppen.get(key);
        if (!node) {
          node = this.node(kind, label || prefix, { id: prefix, entityId: undefined });
          gruppen.set(key, node);
          parent.children.push(node);
        }
        parent = node;
      }
      const leaf = this.node("bauteil", entity.name || lastSegment(id) || `#${entity.id}`, { id, entityId: entity.id, aspekte: psetNames(this.document, entity.id) });
      leaf.objectCount = 1;
      this.place(entity.id, leaf);
      parent.children.push(leaf);
    }
    return root;
  }

  /* ---------------- Eimer ---------------- */

  private buildEimer(): TreeNode {
    const eimer = this.node("eimer", "Nicht zuordenbar", {});
    const proxies = this.importart === "bauwerksmodell" ? [] : (this.document.entitiesByType.get("IFCBUILDINGELEMENTPROXY") ?? []);
    for (const entity of proxies) {
      if (this.placed.has(entity.id)) continue;
      const hasRepresentation = (entity.args[6] ?? "").trim().startsWith("#");
      if (!hasRepresentation && !this.unassignable.has(entity.id)) continue;
      const node = this.node("untersuchungsstelle", entity.name || `#${entity.id}`, { entityId: entity.id, aspekte: psetNames(this.document, entity.id) });
      node.objectCount = 1;
      this.place(entity.id, node);
      eimer.children.push(node);
    }
    return eimer;
  }

  /* ---------------- Hilfen ---------------- */

  private node(kind: TreeNodeKind, label: string, init: { id?: string; entityId?: number; psetId?: number; aspekte?: string[]; creates?: TreeNodeKind }): TreeNode {
    const key = `${kind}:${init.id ?? ""}:${init.entityId ?? ""}:${init.psetId ?? ""}:${label}`;
    return {
      key,
      kind,
      label,
      id: init.id || undefined,
      entityId: init.entityId,
      psetId: init.psetId,
      aspekte: init.aspekte ?? [],
      creates: init.creates,
      children: [],
      objectCount: 0,
      errorCount: init.entityId != null && init.psetId == null ? (this.errorsByEntity.get(init.entityId) ?? 0) : 0,
    };
  }

  private place(entityId: number, node: TreeNode): void {
    this.placed.add(entityId);
    this.byEntity.set(entityId, node);
  }
}

function finalize(node: TreeNode): void {
  for (const child of node.children) {
    finalize(child);
    node.objectCount += child.objectCount;
    node.errorCount += child.errorCount;
  }
}

function psetNames(document: NativeIfcDocument, entityId: number): string[] {
  return [...new Set((document.propertySetsByEntity.get(entityId) ?? []).map((set: NativeIfcPropertySet) => stripPsetPrefix(set.name)))];
}

function lastSegment(id: string): string {
  return id ? (id.split(".").pop() ?? "") : "";
}

/** Verfahren eines Fachobjekts: Haupt-Psets aus der Portalliste. */
export function methodPsets(document: NativeIfcDocument, entityId: number): string[] {
  return psetNames(document, entityId).filter((name) => isMainMethodPset(name));
}

export { idPrefix, psetMatches };
