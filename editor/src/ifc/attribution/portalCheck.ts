/**
 * Importvorschau: bildet die Regeln des MKP-Portal-Importers nach, die nicht
 * in den IDS-Dateien stehen — Zuordenbarkeit je Importart, Pflichtfelder,
 * Eindeutigkeit, Referenzauflösung (in der Datei und gegen ein geladenes
 * Bauwerksmodell), erweiterte Verfahrens-Psets, Ergebnis-Referenzen,
 * ID-Präfixe bei Monitoring, Datumsformat.
 *
 * Quellen: mkp-portal packages/mkp-portal-diagnostics/.../create_db_models.py,
 * create_results_db_models.py, monitoring/.../create_db_models.py,
 * structures/.../create_db_models.py. Befundcodes und Felder wie dort.
 */
import type { NativeIfcDocument, NativeIfcEntity, NativeIfcPropertySet } from "../nativeDocument";

import { formatPortalMessage, type PortalIssueFields } from "./messages";
import { areaMethodEntries, compareAreaMethods, mainMethodPsets } from "./methods";
import {
  cleanValue,
  findProperties,
  findPset,
  findPsets,
  getProperty,
  getValue,
  idPrefix,
  isObjectiveIdProperty,
  psetMatches,
  splitIdList,
  stripPsetPrefix,
} from "./normalize";
import { classifyMethodPset, isMainMethodPset, type Importart, importartLabel } from "./schema";

export type PortalSeverity = "error" | "warning";

export interface PortalFinding extends PortalIssueFields {
  /** Portal-Code oder, bei Editor-eigenen Hinweisen, ein Code mit Präfix `editor_`. */
  code: string;
  severity: PortalSeverity;
  /** Betroffene Entity im Dokument, wenn zuordenbar. */
  entityId?: number;
  message: string;
}

export interface BauwerksmodellIndex {
  bauwerksnummer: string;
  teilbauwerk: string;
  /** Alle referenzierbaren IDs: Bauwerk, Teilbauwerk, Gruppe, Typ, Variante, Bauteil, Raum. */
  all: Set<string>;
  /** Nur Bauteile und Räume (Ziel von `BauteilID`). */
  components: Map<string, number>;
}

export interface PortalCheckOptions {
  importart: Importart;
  /** Geladenes Bauwerksmodell zur Auflösung von `BauteilID`; ohne es bleiben diese Referenzen ungeprüft. */
  bauwerksmodell?: NativeIfcDocument | null;
}

export interface PortalCheckResult {
  importart: Importart;
  findings: PortalFinding[];
  errorCount: number;
  warningCount: number;
  stats: Record<string, number>;
}

const UNASSIGNABLE_ELEMENT_REPORT_LIMIT = 20;
const RESULT_REFERENCE = /^(?:Bauwerksmodell|Bauwerk|Teilbauwerk|Bauteilgruppe|Bauteiltyp|Bauteilvariante|Bauteil|Raum|Objekt)ID\d*_UE$/;
const DATE_DD_MM_YYYY = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const OBJEKTINFORMATION = ["Objektinformationen", "Objektinformation"];
const PROJEKT = ["Projekt", "Diagnostik Projekt"];

/* ------------------------------------------------------------------ */
/* Öffentliche API                                                     */
/* ------------------------------------------------------------------ */

export function runPortalCheck(document: NativeIfcDocument, options: PortalCheckOptions): PortalCheckResult {
  const context = new CheckContext(document, options);
  context.checkBuildingCount();
  switch (options.importart) {
    case "bauwerksmodell":
      context.checkBauwerksmodell();
      break;
    case "monitoring":
      context.checkMonitoring();
      break;
    case "planung":
    case "einzelergebnisse":
      context.checkDiagnostik();
      break;
    case "ergebnisse":
      context.checkErgebnisse();
      break;
  }
  return context.result();
}

/** Referenzierbare IDs eines Bauwerksmodells (Portal: StructureComponent, -Group, -Type, -Variant, Space, StructurePart, Structure). */
export function buildBauwerksmodellIndex(document: NativeIfcDocument): BauwerksmodellIndex {
  const building = document.entitiesByType.get("IFCBUILDING")?.[0];
  const bauwerk = building ? findPset(document, building.id, "Bauwerk") : undefined;
  const bauwerksnummer = getValue(bauwerk, "Bauwerksnummer");
  const teilbauwerk = getValue(bauwerk, "Teilbauwerksnummer");
  const all = new Set<string>();
  const components = new Map<string, number>();
  if (bauwerksnummer) all.add(bauwerksnummer);
  if (bauwerksnummer && teilbauwerk) all.add(`${bauwerksnummer}.${teilbauwerk}`);
  for (const entity of document.entities) {
    const info = findPset(document, entity.id, "Objektinformation");
    if (!info || !getValue(info, "IDEbene1")) continue;
    const id = getValue(info, "ID");
    if (!id) continue;
    components.set(id, entity.id);
    const segments = id.split(".");
    for (const length of [3, 4, 5]) {
      if (segments.length > length) all.add(segments.slice(0, length).join("."));
    }
    all.add(id);
  }
  return { bauwerksnummer, teilbauwerk, all, components };
}

/** Portal: difflib.get_close_matches(value, known, n=3, cutoff=0.6). */
export function closeMatches(value: string, known: Iterable<string>, limit = 3, cutoff = 0.6): string[] {
  const scored: Array<{ candidate: string; ratio: number }> = [];
  for (const candidate of known) {
    const ratio = similarity(value, candidate);
    if (ratio >= cutoff) scored.push({ candidate, ratio });
  }
  scored.sort((a, b) => b.ratio - a.ratio || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, limit).map((entry) => entry.candidate);
}

/* ------------------------------------------------------------------ */
/* Prüfkontext                                                         */
/* ------------------------------------------------------------------ */

interface ElementProps {
  entity: NativeIfcEntity;
  psets: NativeIfcPropertySet[];
  /** Pset-Namen ohne Präfix, sortiert — wie `pset_names` im Portal-Befund. */
  psetNames: string[];
  hasRepresentation: boolean;
}

interface Candidate {
  entity: NativeIfcEntity;
  id: string;
  psetName: string;
}

class CheckContext {
  readonly findings: PortalFinding[] = [];
  readonly stats: Record<string, number> = {};
  private readonly bauwerksmodell: BauwerksmodellIndex | null;
  private readonly roleLabel: string;

  constructor(
    private readonly document: NativeIfcDocument,
    private readonly options: PortalCheckOptions,
  ) {
    this.bauwerksmodell = options.bauwerksmodell ? buildBauwerksmodellIndex(options.bauwerksmodell) : null;
    this.roleLabel = importartLabel(options.importart);
  }

  result(): PortalCheckResult {
    return {
      importart: this.options.importart,
      findings: this.findings,
      errorCount: this.findings.filter((finding) => finding.severity === "error").length,
      warningCount: this.findings.filter((finding) => finding.severity === "warning").length,
      stats: this.stats,
    };
  }

  /* ---------------- gemeinsam ---------------- */

  checkBuildingCount(): void {
    const buildings = this.document.entitiesByType.get("IFCBUILDING") ?? [];
    if (buildings.length !== 1) {
      this.add({ code: "invalid_building_count", count: buildings.length }, "error");
    }
  }

  private building(): NativeIfcEntity | undefined {
    return this.document.entitiesByType.get("IFCBUILDING")?.[0];
  }

  private elements(type = "IFCBUILDINGELEMENTPROXY"): ElementProps[] {
    return (this.document.entitiesByType.get(type) ?? []).map((entity) => this.props(entity));
  }

  private props(entity: NativeIfcEntity): ElementProps {
    const psets = this.document.propertySetsByEntity.get(entity.id) ?? [];
    return {
      entity,
      psets,
      psetNames: [...new Set(psets.map((set) => stripPsetPrefix(set.name)))].sort(),
      hasRepresentation: (entity.args[6] ?? "").trim().startsWith("#"),
    };
  }

  /**
   * Editor-Regel (Qualität, kein Portal-Befund): Was der Bereich als Verfahren nennt, muss an seinen Stellen als Pset liegen — und umgekehrt.
   * Abgleich über Katalogname, Pset-Name und Umlaut-Normalisierung („Druckfestigkeitsprüfung“ ↔ Pset „Druckfestigkeit“).
   */
  private checkAreaMethods(building: NativeIfcEntity | undefined, areas: Candidate[], points: Array<Candidate & { info: NativeIfcPropertySet }>): void {
    if (!building) return;
    for (const area of areas) {
      const set = findPsets(this.document, building.id, "Untersuchungsbereich\\d*").find((entry) => stripPsetPrefix(entry.name) === area.psetName);
      const entries = areaMethodEntries(set);
      const members = points.filter((point) => getValue(point.info, "UntersuchungsbereichID") === area.id);
      if (!members.length) continue;
      const stellenPsets = members.flatMap((point) => mainMethodPsets((this.document.propertySetsByEntity.get(point.entity.id) ?? []).map((entry) => stripPsetPrefix(entry.name))));
      const comparison = compareAreaMethods(entries, stellenPsets);
      for (const entry of comparison.unused) {
        this.add({ code: "editor_area_method_unused", element_name: building.name, pset_name: area.psetName, property_name: entry.property, value: entry.value }, "warning", building.id);
      }
      for (const point of members) {
        const own = mainMethodPsets((this.document.propertySetsByEntity.get(point.entity.id) ?? []).map((entry) => stripPsetPrefix(entry.name)));
        for (const missing of comparison.missing.filter((candidate) => own.includes(candidate.pset))) {
          this.add(
            { code: "editor_method_not_in_area", element_name: point.entity.name, pset_name: missing.pset, value: missing.label, suggestions: entries.map((entry) => entry.value) },
            "warning",
            point.entity.id,
          );
        }
      }
    }
  }

  private add(fields: PortalIssueFields, severity: PortalSeverity, entityId?: number): void {
    this.findings.push({ ...fields, severity, entityId, message: formatPortalMessage(fields) });
  }

  private requireProperty(
    set: NativeIfcPropertySet | undefined,
    names: string[],
    element: NativeIfcEntity | undefined,
    psetName: string,
  ): string {
    const value = getValue(set, ...names);
    if (!value) {
      this.add(
        { code: "missing_required_property", element_name: element?.name, pset_name: psetName, property_name: names[0] },
        "error",
        element?.id,
      );
    }
    return value;
  }

  private requirePset(entityId: number | undefined, elementName: string | undefined, ...patterns: string[]): NativeIfcPropertySet | undefined {
    const set = entityId == null ? undefined : findPset(this.document, entityId, ...patterns);
    if (!set) this.add({ code: "missing_pset", element_name: elementName, pset_name: patterns[0] }, "error", entityId);
    return set;
  }

  private checkUnique(modelName: string, candidates: Candidate[]): void {
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) {
        this.add(
          { code: "duplicate_ifc_id", model_name: modelName, value: candidate.id, element_name: candidate.entity.name, pset_name: candidate.psetName },
          "error",
          candidate.entity.id,
        );
      }
      seen.add(candidate.id);
    }
  }

  private referenceError(fields: Omit<PortalIssueFields, "code" | "suggestions">, known: Iterable<string>, entityId: number): void {
    this.add({ code: "unknown_reference", ...fields, suggestions: closeMatches(fields.value ?? "", known) }, "error", entityId);
  }

  /** `BauteilID` gegen das geladene Bauwerksmodell; ohne Modell nur ein Hinweis. */
  private checkBauteilReference(value: string, entity: NativeIfcEntity, psetName: string, propertyName = "BauteilID"): void {
    if (!value) return;
    if (!this.bauwerksmodell) {
      this.add(
        { code: "editor_reference_unchecked", model_name: "Bauteil", element_name: entity.name, pset_name: psetName, property_name: propertyName, value },
        "warning",
        entity.id,
      );
      return;
    }
    if (!this.bauwerksmodell.components.has(value)) {
      this.referenceError(
        { model_name: "Bauteil", element_name: entity.name, pset_name: psetName, property_name: propertyName, value },
        this.bauwerksmodell.components.keys(),
        entity.id,
      );
    }
  }

  /* ---------------- Bauwerksmodell ---------------- */

  checkBauwerksmodell(): void {
    const building = this.building();
    const bauwerk = this.requirePset(building?.id, "IfcBuilding", "Bauwerk");
    for (const property of ["Bauwerksnummer", "Bauwerksname", "Teilbauwerksnummer"]) {
      this.requireProperty(bauwerk, [property], building, "Bauwerk");
    }
    if (!(this.document.entitiesByType.get("IFCBUILDINGSTOREY")?.length ?? 0)) {
      this.add({ code: "missing_pset", element_name: "IfcBuilding", pset_name: "IfcBuildingStorey" }, "error", building?.id);
    }
    const candidates: Candidate[] = [];
    for (const entity of this.document.entities) {
      if (!/^IFC/.test(entity.type) || entity.type === "IFCBUILDING") continue;
      const info = findPset(this.document, entity.id, "Objektinformation");
      if (!info || !getValue(info, "IDEbene1")) continue;
      const missing = ["ID", "IDEbene2", "IDEbene3"].filter((name) => !getValue(info, name));
      if (missing.length) {
        this.add({ code: "component_missing_attributes", element_name: entity.name, property_names: missing }, "error", entity.id);
        continue;
      }
      const id = getValue(info, "ID");
      if (!/^([^.]+\.){5}[^.]+$/.test(id)) {
        this.add(
          { code: "editor_invalid_component_id", element_name: entity.name, pset_name: "Objektinformation", property_name: "ID", value: id },
          "error",
          entity.id,
        );
      }
      candidates.push({ entity, id, psetName: "Objektinformation" });
    }
    this.stats.bauteile = candidates.length;
    this.checkUnique(componentModelName(candidates), candidates);
  }

  /* ---------------- Monitoring ---------------- */

  checkMonitoring(): void {
    const building = this.building();
    const projekt = this.requirePset(building?.id, "IfcBuilding", "Projekt");
    const projektId = this.requireProperty(projekt, ["ID"], building, "Projekt");
    this.requireProperty(projekt, ["Bezeichnung"], building, "Projekt");

    const messanlagen = this.numberedBuildingPsets(building, "Messanlage\\d+", "Messanlage", ["ID"], projektId);
    const massnahmen = this.numberedBuildingPsets(building, "Maßnahme\\d+", "Maßnahme", ["ID", "Bezeichnung"], projektId);
    const messanlageIds = new Set(messanlagen.map((candidate) => candidate.id));
    const massnahmeIds = new Set(massnahmen.map((candidate) => candidate.id));

    const sensors: Candidate[] = [];
    const channels: Candidate[] = [];
    for (const element of this.elements()) {
      const info = findPset(this.document, element.entity.id, "Objektinformation");
      if (!info) {
        this.add({ code: "missing_pset", element_name: element.entity.name, pset_name: "Objektinformation" }, "error", element.entity.id);
        continue;
      }
      const sensorId = this.requireProperty(info, ["ID"], element.entity, "Objektinformation");
      this.requireProperty(info, ["Bezeichnung"], element.entity, "Objektinformation");
      const bauteilId = this.requireProperty(info, ["BauteilID"], element.entity, "Objektinformation");
      const messanlageId = this.requireProperty(info, ["MessanlageID"], element.entity, "Objektinformation");
      if (!sensorId) continue;
      sensors.push({ entity: element.entity, id: sensorId, psetName: "Objektinformation" });
      if (projektId && idPrefix(sensorId) !== projektId) {
        this.add(
          { code: "unknown_reference", model_name: "Monitoringprojekt", element_name: element.entity.name, pset_name: "Objektinformation", property_name: "ID", value: sensorId, suggestions: [`${projektId}.${sensorId.split(".").pop() ?? ""}`] },
          "error",
          element.entity.id,
        );
      }
      if (messanlageId && !messanlageIds.has(messanlageId)) {
        // Messanlagen dürfen aus früheren Importen stammen → nur Warnung, wie das Portal es nachschlagen würde.
        this.add(
          { code: "editor_reference_unchecked", model_name: "Messanlage", element_name: element.entity.name, pset_name: "Objektinformation", property_name: "MessanlageID", value: messanlageId, suggestions: closeMatches(messanlageId, messanlageIds) },
          "warning",
          element.entity.id,
        );
      }
      this.checkBauteilReference(bauteilId, element.entity, "Objektinformation");

      const sensor = findPset(this.document, element.entity.id, "Sensor");
      for (const property of ["StartMessungDatum", "EndeMessungDatum"]) {
        const value = getValue(sensor, property);
        if (value && !DATE_DD_MM_YYYY.test(value)) {
          this.add({ code: "invalid_date", element_name: element.entity.name, pset_name: "Sensor", property_name: property, value }, "error", element.entity.id);
        }
      }

      for (const kanal of findPsets(this.document, element.entity.id, "Kanal\\d+")) {
        const psetName = stripPsetPrefix(kanal.name);
        const kanalId = this.requireProperty(kanal, ["ID"], element.entity, psetName);
        this.requireProperty(kanal, ["Bezeichnung"], element.entity, psetName);
        const massnahmeId = this.requireProperty(kanal, ["MaßnahmeID"], element.entity, psetName);
        if (!kanalId) continue;
        channels.push({ entity: element.entity, id: kanalId, psetName });
        if (idPrefix(kanalId) !== sensorId) {
          this.add(
            { code: "unknown_reference", model_name: "Sensor", element_name: element.entity.name, pset_name: psetName, property_name: "ID", value: kanalId, suggestions: [`${sensorId}.${kanalId.split(".").pop() ?? ""}`] },
            "error",
            element.entity.id,
          );
        }
        if (massnahmeId && !massnahmeIds.has(massnahmeId)) {
          this.referenceError({ model_name: "Maßnahme", element_name: element.entity.name, pset_name: psetName, property_name: "MaßnahmeID", value: massnahmeId }, massnahmeIds, element.entity.id);
        }
      }
    }
    this.stats.sensoren = sensors.length;
    this.stats.kanaele = channels.length;
    this.stats.massnahmen = massnahmen.length;
    this.stats.messanlagen = messanlagen.length;
    this.checkUnique("Sensor", sensors);
    this.checkUnique("Kanal", channels);
  }

  private numberedBuildingPsets(
    building: NativeIfcEntity | undefined,
    pattern: string,
    modelName: string,
    required: string[],
    projektId: string,
  ): Candidate[] {
    const candidates: Candidate[] = [];
    if (!building) return candidates;
    for (const set of findPsets(this.document, building.id, pattern)) {
      const psetName = stripPsetPrefix(set.name);
      let id = "";
      for (const property of required) {
        const value = this.requireProperty(set, [property], building, psetName);
        if (property === "ID") id = value;
      }
      if (!id) continue;
      candidates.push({ entity: building, id, psetName });
      if (projektId && idPrefix(id) !== projektId) {
        this.add(
          { code: "unknown_reference", model_name: "Monitoringprojekt", element_name: building.name, pset_name: psetName, property_name: "ID", value: id, suggestions: [`${projektId}.${id.split(".").pop() ?? ""}`] },
          "error",
          building.id,
        );
      }
    }
    this.checkUnique(modelName, candidates);
    return candidates;
  }

  /* ---------------- Diagnostik A / B ---------------- */

  checkDiagnostik(): void {
    const role = this.options.importart;
    this.checkAssignable(role);

    const building = this.building();
    const bauwerk = this.requirePset(building?.id, "IfcBuilding", "Bauwerk");
    const bauwerksnummer = this.requireProperty(bauwerk, ["Bauwerksnummer"], building, "Bauwerk");
    if (bauwerksnummer && this.bauwerksmodell?.bauwerksnummer && bauwerksnummer !== this.bauwerksmodell.bauwerksnummer) {
      this.add({ code: "data_conflict", model_name: "Bauwerk", value: bauwerksnummer }, "error", building?.id);
    }
    const projekt = this.requirePset(building?.id, "IfcBuilding", ...PROJEKT);
    this.requireProperty(projekt, ["ID"], building, "Projekt");
    this.requireProperty(projekt, ["Bezeichnung", "BezeichnungProjekt"], building, "Projekt");

    const objectives = this.buildingCandidates(building, "Untersuchungsziel\\d*", ["ID", "Bezeichnung|UntersuchungszielName"]);
    if (!objectives.length) this.add({ code: "missing_pset", element_name: building?.name, pset_name: "Untersuchungsziel" }, "error", building?.id);
    const areas = this.buildingCandidates(building, "Untersuchungsbereich\\d*", ["ID"]);
    if (!areas.length) this.add({ code: "missing_pset", element_name: building?.name, pset_name: "Untersuchungsbereich" }, "error", building?.id);
    this.checkUnique("MeasurementObjective", objectives);
    this.checkUnique("MeasurementArea", areas);
    const objectiveIds = new Set(objectives.map((candidate) => candidate.id));
    const areaIds = new Set(areas.map((candidate) => candidate.id));

    // Untersuchungsstellen
    const points: Array<Candidate & { info: NativeIfcPropertySet; fields: Map<string, string> }> = [];
    for (const element of this.elements()) {
      const info = findPset(this.document, element.entity.id, ...OBJEKTINFORMATION);
      if (!info || !getValue(info, "BauteilID")) continue;
      const psetName = stripPsetPrefix(info.name);
      const id = this.requireProperty(info, ["ID", "IDUntersuchungsstelle"], element.entity, psetName);
      this.requireProperty(info, ["Bezeichnung", "BezeichnungUntersuchungsstelle"], element.entity, psetName);
      const bauteilId = getValue(info, "BauteilID");
      const areaId = this.requireProperty(info, ["UntersuchungsbereichID"], element.entity, psetName);
      if (!id) continue;
      const fields = new Map<string, string>();
      for (const messfeld of findPsets(this.document, element.entity.id, "Messfeld\\d*")) {
        const fieldId = getValue(messfeld, "ID") || `${id}.${stripPsetPrefix(messfeld.name)}`;
        fields.set(fieldId, stripPsetPrefix(messfeld.name));
      }
      points.push({ entity: element.entity, id, psetName, info, fields });
      this.checkBauteilReference(bauteilId, element.entity, psetName);
      if (areaId && !areaIds.has(areaId)) {
        this.referenceError({ model_name: "Untersuchungsbereich", element_name: element.entity.name, pset_name: psetName, property_name: "UntersuchungsbereichID", value: areaId }, areaIds, element.entity.id);
      }
      this.checkMethods(element, info, id, fields, objectiveIds);
    }
    if (!points.length) this.add({ code: "missing_pset", pset_name: "Objektinformationen" }, "error");
    this.checkUnique("MeasurementPoint", points);
    this.checkAreaMethods(building, areas, points);
    this.stats.untersuchungsstellen = points.length;
    this.stats.untersuchungsbereiche = areas.length;
    this.stats.untersuchungsziele = objectives.length;

    // Proben (nur B)
    if (role === "einzelergebnisse") {
      const pointIds = new Set(points.map((point) => point.id));
      const samples: Candidate[] = [];
      for (const element of this.elements()) {
        const samplePset =
          findPsets(this.document, element.entity.id, "Probe\\d*").find((set) => getValue(set, "UntersuchungsstelleID")) ??
          (getValue(findPset(this.document, element.entity.id, "Objektinformation"), "UntersuchungsstelleID")
            ? findPset(this.document, element.entity.id, "Objektinformation")
            : undefined);
        if (!samplePset) continue;
        const psetName = stripPsetPrefix(samplePset.name);
        const id = this.requireProperty(samplePset, ["ID", "IDProbe"], element.entity, psetName);
        const pointId = this.requireProperty(samplePset, ["UntersuchungsstelleID"], element.entity, psetName);
        if (!id) continue;
        samples.push({ entity: element.entity, id, psetName });
        if (pointId && !pointIds.has(pointId)) {
          this.referenceError({ model_name: "Untersuchungsstelle", element_name: element.entity.name, pset_name: psetName, property_name: "UntersuchungsstelleID", value: pointId }, pointIds, element.entity.id);
        }
        const info = findPset(this.document, element.entity.id, ...OBJEKTINFORMATION);
        this.checkMethods(element, info, id, new Map(), objectiveIds);
      }
      this.checkUnique("Sample", samples);
      this.stats.proben = samples.length;
    }
  }

  private buildingCandidates(building: NativeIfcEntity | undefined, pattern: string, required: string[]): Candidate[] {
    const candidates: Candidate[] = [];
    if (!building) return candidates;
    for (const set of findPsets(this.document, building.id, pattern)) {
      const psetName = stripPsetPrefix(set.name);
      let id = "";
      for (const spec of required) {
        const names = spec.split("|");
        const value = this.requireProperty(set, names, building, psetName);
        if (names[0] === "ID") id = value;
      }
      if (id) candidates.push({ entity: building, id, psetName });
    }
    return candidates;
  }

  /** Verfahrens-Psets eines Fachobjekts: Untersuchungsziel, Messfeld, erweiterte Psets. */
  private checkMethods(
    element: ElementProps,
    info: NativeIfcPropertySet | undefined,
    parentId: string,
    fields: Map<string, string>,
    objectiveIds: Set<string>,
  ): void {
    const mainSets = element.psets.filter((set) => isMainMethodPset(stripPsetPrefix(set.name)));
    // erweiterte Psets brauchen ihr Haupt-Pset
    for (const set of element.psets) {
      const name = stripPsetPrefix(set.name);
      const hit = classifyMethodPset(name);
      if (hit?.kind !== "extended") continue;
      const ownerPresent = mainSets.some((main) => psetMatches(main.name, hit.verfahren.pset));
      if (!ownerPresent) {
        this.add({ code: "unassigned_extended_property_set", element_name: element.entity.name, pset_name: name }, "error", element.entity.id);
      }
    }
    for (const set of mainSets) {
      const psetName = stripPsetPrefix(set.name);
      const objectives = collectObjectives(set).length ? collectObjectives(set) : collectObjectives(info);
      if (!objectives.length) {
        this.add({ code: "missing_required_property", element_name: element.entity.name, pset_name: psetName, property_name: "UntersuchungszielID" }, "error", element.entity.id);
        continue;
      }
      for (const objectiveId of objectives) {
        if (!objectiveIds.has(objectiveId)) {
          this.referenceError({ model_name: "Untersuchungsziel", element_name: element.entity.name, pset_name: psetName, property_name: "UntersuchungszielID", value: objectiveId }, objectiveIds, element.entity.id);
        }
      }
      const fieldId = getValue(set, "MessfeldID") || (mainSets.length === 1 ? getValue(info, "MessfeldID") : "");
      if (fieldId && !fields.has(fieldId)) {
        this.referenceError({ model_name: "Messfeld", element_name: element.entity.name, pset_name: psetName, property_name: "MessfeldID", value: fieldId }, fields.keys(), element.entity.id);
      }
      this.stats.verfahren = (this.stats.verfahren ?? 0) + 1;
    }
  }

  /** Portal: `_validate_assignable_physical_elements` + `_unassignable_reason`. */
  private checkAssignable(role: Importart): void {
    const unassignable: Array<{ element: ElementProps; reason: { code: string; pset_name?: string; property_name?: string } }> = [];
    for (const element of this.elements()) {
      if (!element.hasRepresentation) continue;
      const reason = this.unassignableReason(element, role);
      if (reason) unassignable.push({ element, reason });
    }
    for (const { element, reason } of unassignable.slice(0, UNASSIGNABLE_ELEMENT_REPORT_LIMIT)) {
      this.add(
        {
          code: "unassignable_element",
          reason: reason.code,
          element_name: element.entity.name,
          element_type: element.entity.type,
          ifc_guid: element.entity.globalId,
          import_role: this.roleLabel,
          pset_names: element.psetNames,
          pset_name: reason.pset_name,
          property_name: reason.property_name,
        },
        "error",
        element.entity.id,
      );
    }
    const overflow = unassignable.length - UNASSIGNABLE_ELEMENT_REPORT_LIMIT;
    if (overflow > 0) this.add({ code: "unassignable_element_overflow", count: overflow }, "error");
    this.stats.elemente = this.elements().filter((element) => element.hasRepresentation).length;
    this.stats.nichtZuordenbar = unassignable.length;
  }

  private unassignableReason(element: ElementProps, role: Importart): { code: string; pset_name?: string; property_name?: string } | null {
    const names = element.psetNames;
    const hasResult = names.includes("Untersuchungsergebnisse");
    if (role === "ergebnisse") return hasResult ? null : { code: "result_pset_missing", pset_name: "Untersuchungsergebnisse" };
    if (hasResult) return { code: "result_element", pset_name: "Untersuchungsergebnisse" };

    const infoSets = element.psets.filter((set) => OBJEKTINFORMATION.some((alias) => psetMatches(set.name, alias)));
    const hasComponentReference = infoSets.some((set) => Boolean(getValue(set, "BauteilID")));
    const isPoint = infoSets.length > 0 && hasComponentReference;
    const isSample = this.isSample(element);

    if (role === "planung") {
      const executionOnly = element.psets.find((set) => isExecutionOnlyPset(stripPsetPrefix(set.name)));
      if (executionOnly) return { code: "execution_only_pset", pset_name: stripPsetPrefix(executionOnly.name) };
      if (!isPoint && isSample) return { code: "sample_element", property_name: "UntersuchungsstelleID" };
      return pointReason(infoSets, hasComponentReference);
    }
    if (isPoint || isSample) return null;
    return pointReason(infoSets, hasComponentReference);
  }

  private isSample(element: ElementProps): boolean {
    const probe = element.psets.find((set) => psetMatches(set.name, "Probe\\d*"));
    const source = probe ?? element.psets.find((set) => psetMatches(set.name, "Objektinformation"));
    return Boolean(getValue(source, "UntersuchungsstelleID"));
  }

  /* ---------------- Ergebnisse (C) ---------------- */

  checkErgebnisse(): void {
    this.checkAssignable("ergebnisse");
    const building = this.building();
    const bauwerk = this.requirePset(building?.id, "IfcBuilding", "Bauwerk");
    this.requireProperty(bauwerk, ["Bauwerksnummer"], building, "Bauwerk");
    const projekt = this.requirePset(building?.id, "IfcBuilding", ...PROJEKT);
    this.requireProperty(projekt, ["ID"], building, "Projekt");
    this.requireProperty(projekt, ["Bezeichnung", "BezeichnungProjekt"], building, "Projekt");

    const results: Candidate[] = [];
    for (const element of this.elements()) {
      if (!element.psetNames.includes("Untersuchungsergebnisse")) continue;
      const info = findPset(this.document, element.entity.id, "Objektinformation");
      const id = getValue(info, "ID") || element.entity.globalId;
      results.push({ entity: element.entity, id, psetName: "Objektinformation" });
      const targets = [...new Set(findProperties(info, RESULT_REFERENCE).map((hit) => hit.value).filter(Boolean))];
      if (targets.length !== 1) {
        this.add({ code: "invalid_result_target_count", element_name: element.entity.name, pset_name: "Objektinformation", count: targets.length }, "error", element.entity.id);
        continue;
      }
      const target = targets[0]!;
      if (!this.bauwerksmodell) {
        this.add({ code: "editor_reference_unchecked", model_name: "Bauwerksmodell-Objekt", element_name: element.entity.name, pset_name: "Objektinformation", property_name: "BauwerksmodellID_UE", value: target }, "warning", element.entity.id);
      } else if (!this.bauwerksmodell.all.has(target)) {
        this.referenceError({ model_name: "Bauwerksmodell-Objekt", element_name: element.entity.name, pset_name: "Objektinformation", property_name: "BauwerksmodellID_UE", value: target }, this.bauwerksmodell.all, element.entity.id);
      }
    }
    if (!results.length) this.add({ code: "missing_pset", pset_name: "Untersuchungsergebnisse" }, "error");
    this.checkUnique("MeasurementResult", results);
    this.stats.ergebnisse = results.length;
  }
}

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function isExecutionOnlyPset(psetName: string): boolean {
  const hit = classifyMethodPset(psetName);
  return hit?.kind === "extended" && hit.executionOnly;
}

function pointReason(infoSets: NativeIfcPropertySet[], hasComponentReference: boolean): { code: string; pset_name?: string; property_name?: string } | null {
  if (!infoSets.length) return { code: "object_information_pset_missing" };
  if (!hasComponentReference) return { code: "component_reference_missing", pset_name: stripPsetPrefix(infoSets[0]!.name), property_name: "BauteilID" };
  return null;
}

function collectObjectives(set: NativeIfcPropertySet | undefined): string[] {
  if (!set) return [];
  const ids: string[] = [];
  for (const property of set.values) {
    if (!isObjectiveIdProperty(property.name)) continue;
    for (const id of splitIdList(cleanValue(property.value))) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function componentModelName(candidates: Candidate[]): string {
  return candidates.some((candidate) => candidate.entity.type === "IFCSPACE") ? "Bauteil/Raum" : "Bauteil";
}

/** Ähnlichkeit 0–1, angelehnt an difflib.SequenceMatcher.ratio (2·M/T über die längste gemeinsame Teilfolge, hier per Levenshtein). */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

export function isPortalCode(code: string): boolean {
  return !code.startsWith("editor_");
}

export { getProperty };
