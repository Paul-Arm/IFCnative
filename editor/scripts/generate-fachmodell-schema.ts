/**
 * Erzeugt src/ifc/attribution/fachmodell-schema.yaml.
 *
 * Quelle 1: die Importregeln des MKP-Portals (Repo mkp-portal), hier als
 * typisierte Daten gespiegelt — jede Angabe nennt die Python-/IDS-Datei, aus
 * der sie stammt. Solange das Portal sein Schema nicht selbst ausliefert, ist
 * diese Datei die einzige Stelle im Editor, an der diese Regeln stehen.
 *
 * Quelle 2: die openSIM-Objektkataloge (BWD = Diagnostik, MON = Monitoring),
 * eingelesen mit dem vorhandenen Parser parseCatalogWorkbook, damit Editor und
 * Schema denselben Katalogstand sehen.
 *
 * Aufruf (aus editor/):
 *   npx tsx scripts/generate-fachmodell-schema.ts <Katalog_BWD.xlsx> <Katalog_MON.xlsx> [ausgabe.yaml]
 *
 * Es wird bewusst keine YAML-Bibliothek verwendet (keine im Projekt); der
 * Emitter unten deckt den benötigten Teil von YAML 1.2 ab (Block-Maps,
 * Block-Sequenzen, Inline-Sequenzen skalarer Werte, zitierte Strings).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import * as XLSX from "xlsx";

import type { CatalogKind, CatalogPropertyRule, IfcObjectCatalog } from "../src/ifc/catalog";
import { parseCatalogWorkbook } from "../src/ifc/catalogExcel";

/* ------------------------------------------------------------------ */
/* YAML-Emitter                                                        */
/* ------------------------------------------------------------------ */

type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml };

const PLAIN_SCALAR = /^[A-Za-z0-9_äöüÄÖÜß][A-Za-z0-9_äöüÄÖÜß ./+()-]*$/;
const RESERVED = new Set(["true", "false", "null", "yes", "no", "on", "off", "~", ""]);

function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function scalar(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = value;
  if (
    RESERVED.has(text.toLowerCase()) ||
    /^[-+]?\d+([.,]\d+)?$/.test(text) ||
    /[:#]/.test(text) ||
    text !== text.trim() ||
    !PLAIN_SCALAR.test(text)
  ) {
    return quote(text);
  }
  return text;
}

function key(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) ? name : quote(name);
}

function isScalar(value: Yaml): value is string | number | boolean | null {
  return value === null || typeof value !== "object";
}

function emit(value: Yaml, indent: number): string[] {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    if (value.every(isScalar) && value.length <= 12) {
      return [`${pad}[${value.map((item) => scalar(item as string | number | boolean | null)).join(", ")}]`];
    }
    return value.flatMap((item) => {
      if (isScalar(item)) return [`${pad}- ${scalar(item)}`];
      const lines = emit(item, indent + 1);
      return [`${pad}- ${lines[0]!.trimStart()}`, ...lines.slice(1)];
    });
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return [`${pad}{}`];
    return entries.flatMap(([name, child]) => {
      if (isScalar(child)) return [`${pad}${key(name)}: ${scalar(child)}`];
      if (Array.isArray(child) && child.length > 0 && child.every(isScalar) && child.length <= 12) {
        return [`${pad}${key(name)}: ${emit(child, 0)[0]}`];
      }
      if (Array.isArray(child) && child.length === 0) return [`${pad}${key(name)}: []`];
      if (!Array.isArray(child) && Object.keys(child).length === 0) return [`${pad}${key(name)}: {}`];
      return [`${pad}${key(name)}:`, ...emit(child, indent + 1)];
    });
  }
  return [`${pad}${scalar(value)}`];
}

function toYaml(value: Yaml): string {
  return `${emit(value, 0).join("\n")}\n`;
}

/* ------------------------------------------------------------------ */
/* Quelle 1: Portal-Regeln (gespiegelt aus mkp-portal)                 */
/* ------------------------------------------------------------------ */

const PORTAL_QUELLEN = {
  repo: "mkp-portal",
  stand: "2026-09-02 · Commit a58e51504",
  dateien: [
    "packages/mkp-portal-ifc/mkp/portal/ifc/importer/psets.py (_cleanup_psets)",
    "packages/mkp-portal-ifc/mkp/portal/ifc/importer/report.py (Befundcodes)",
    "packages/mkp-portal-ifc/mkp/portal/ifc/importer/importer.py (Georeferenz)",
    "packages/mkp-portal-diagnostics/mkp/portal/diagnostics/importer/helpers.py",
    "packages/mkp-portal-diagnostics/mkp/portal/diagnostics/importer/pset_catalog.py",
    "packages/mkp-portal-diagnostics/mkp/portal/diagnostics/importer/create_db_models.py",
    "packages/mkp-portal-diagnostics/mkp/portal/diagnostics/importer/create_results_db_models.py",
    "packages/mkp-portal-monitoring/mkp/portal/monitoring/importer/helpers.py",
    "packages/mkp-portal-monitoring/mkp/portal/monitoring/importer/create_db_models.py",
    "packages/mkp-portal-structures/mkp/portal/structures/importer/structure_importer_constants.py",
    "packages/mkp-portal-structures/mkp/portal/structures/importer/id_name_extractors.py",
    "packages/mkp-portal-diagnostics/docs/ids/*.ids, packages/mkp-portal-structures/docs/ids/bauwerksmodell.ids",
    "services/mkp-portal-extern-frontend/src/utils/ifc-import-issues.ts (deutsche Texte)",
  ],
};

const NORMALISIERUNG: Yaml = {
  quelle: "ifc/importer/psets.py::_cleanup_psets · diagnostics/importer/helpers.py::get_property_value, clean_required_value",
  psetPraefixe: ["Pset_", "ePset_", "ePSet_"],
  psetNameDanach: "exakt, groß-/kleinschreibungsabhängig (Regex fullmatch)",
  propertyPraefix: "_",
  propertyVergleich: "ohne Groß-/Kleinschreibung; 'Name' oder 'Name_<Suffix>' (Katalogkürzel) gelten gleich",
  propertyIdEntfernt: "eine Property namens 'id' (nach Präfixstrip) wird verworfen",
  leerwerte: ["", "-"],
  werttypen: "IFCTEXT und IFCLABEL sind gleichwertig; Werte werden als Python-Werte gelesen",
  klassifikationGelesen: false,
  geometrieOhneRepresentation: "wird importiert, nicht in die 3D-Szene übernommen, nicht auf Zuordenbarkeit geprüft",
  einheiten: "Einheit eines IfcPropertySingleValue wird an den Wert angehängt (get_property_unit)",
};

const PSET_FAMILIEN: Yaml = {
  quelle: "diagnostics/importer/helpers.py (AREA_PSET_REGEX …), monitoring/importer/helpers.py (CHANNEL_REGEX …), pset_catalog.py",
  Untersuchungsziel: "Untersuchungsziel\\d*",
  Untersuchungsbereich: "Untersuchungsbereich\\d*",
  Probe: "Probe\\d*",
  Messfeld: "Messfeld\\d*",
  Kanal: "Kanal\\d+",
  Maßnahme: "Maßnahme\\d+",
  Messanlage: "Messanlage\\d+",
  hinweis: "Dateien nummerieren 0-basiert einstellig; der Katalog schreibt X bzw. N; beides wird vom Portal akzeptiert",
};

const PSET_ALIASE: Yaml = {
  quelle: "diagnostics/importer/helpers.py PROJECT_PSET_NAMES, OBJECT_INFORMATION_PSET_NAMES · structures constants",
  Projekt: ["Diagnostik Projekt"],
  Objektinformation: ["Objektinformationen"],
  Bauwerk: [],
  Untersuchungsstelle: [],
  Untersuchungsergebnisse: [],
  Sensor: [],
  Position: [],
};

const IMPORTARTEN: Yaml = {
  quelle: "mkp-portal-ifc models.IfcFileTypes · diagnostics models.DiagnosticsIfcImportRole",
  bauwerksmodell: {
    label: "Bauwerksmodell",
    ids: "bauwerksmodell.ids",
    reihenfolge: "muss vor allen Fachmodellen importiert sein (structure_model_missing)",
    building: {
      pset: "Bauwerk",
      pflicht: ["Bauwerksnummer", "Bauwerksname", "Teilbauwerksnummer"],
      genauEinIfcBuilding: true,
      mindestensEinIfcBuildingStorey: true,
    },
    objektarten: ["Bauteil", "Raum"],
  },
  monitoring: {
    label: "Monitoring",
    ids: null,
    building: {
      psets: {
        Projekt: { pflicht: ["ID", "Bezeichnung"] },
        "Messanlage\\d+": { pflicht: ["ID"], hinweis: "projektübergreifend wiederverwendbar (Lookup in DB)" },
        "Maßnahme\\d+": { pflicht: ["ID", "Bezeichnung"], optional: ["BezeichnungKurz", "Messziel"] },
      },
    },
    objektarten: ["Sensor", "Kanal"],
    datumsformat: { datum: "TT.MM.JJJJ (%d.%m.%Y)", zeit: "HH:MM", befunde: ["invalid_date", "invalid_time"] },
  },
  planung: {
    label: "Untersuchungsplanung (A)",
    rolle: "planning",
    ids: "diagnostik-planung.ids",
    building: {
      psets: {
        Bauwerk: { pflicht: ["Bauwerksnummer"], hinweis: "muss der Bauwerksnummer des importierten Bauwerksmodells entsprechen" },
        Projekt: { pflicht: ["ID", "Bezeichnung|BezeichnungProjekt"] },
        "Untersuchungsziel\\d*": { pflicht: ["ID", "Bezeichnung|UntersuchungszielName"], mindestens: 1 },
        "Untersuchungsbereich\\d*": { pflicht: ["ID"], optional: ["Bezeichnung"], mindestens: 1 },
      },
    },
    objektarten: ["Untersuchungsstelle", "Messfeld", "Verfahren"],
    jedes3DElement: "Untersuchungsstelle (Objektinformation mit BauteilID)",
    verboten: {
      psets: ["Untersuchungsergebnisse"],
      nurAusfuehrung: "alle Psets aus verfahren[].nurAusfuehrung (IDS DIA-P-08)",
      proben: true,
    },
  },
  einzelergebnisse: {
    label: "Diagnostik Einzelergebnisse (B)",
    rolle: "execution",
    ids: "diagnostik-ausfuehrung.ids",
    building: "wie planung",
    objektarten: ["Untersuchungsstelle", "Probe", "Messfeld", "Verfahren"],
    jedes3DElement: "Untersuchungsstelle oder Probe",
    verboten: { psets: ["Untersuchungsergebnisse"] },
  },
  ergebnisse: {
    label: "Untersuchungsergebnisse (C)",
    rolle: "results",
    ids: "diagnostik-ergebnisse.ids",
    building: {
      psets: {
        Bauwerk: { pflicht: ["Bauwerksnummer"] },
        Projekt: { pflicht: ["ID", "Bezeichnung|BezeichnungProjekt"], hinweis: "Projekt muss bereits importiert sein (Planung oder Einzelergebnisse zuerst)" },
      },
    },
    objektarten: ["Ergebnis"],
    jedes3DElement: "Ergebnis (Pset Untersuchungsergebnisse)",
    verboten: { elementeOhne: ["Untersuchungsergebnisse"] },
  },
};

const OBJEKTARTEN: Yaml = {
  Bauteil: {
    quelle: "structures/importer/structure_importer_constants.py, id_name_extractors.py, bauwerksmodell.ids BWM-02",
    importarten: ["bauwerksmodell"],
    entity: "jedes Element unterhalb eines IfcBuildingStorey (auch IfcFooting); Kinder ohne Ebenen liefern nur Geometrie",
    erkennung: { pset: "Objektinformation", property: "IDEbene1" },
    pflicht: [
      { pset: "Objektinformation", property: "ID", regex: "([^.]+\\.){5}[^.]+" },
      { pset: "Objektinformation", property: "IDEbene1" },
      { pset: "Objektinformation", property: "IDEbene2" },
      { pset: "Objektinformation", property: "IDEbene3" },
    ],
    id: {
      grammatik: "Bauwerksnummer.Teilbauwerksnummer.IDEbene1.IDEbene2.IDEbene3.Nr",
      abgeleitet: { Bauteilgruppe: "Segmente 1-3", Bauteiltyp: "Segmente 1-4", Bauteilvariante: "Segmente 1-5", Name: "Segmente 5-6" },
      nr: "Laufnummer je (Teilbauwerk, Ebene1, Ebene2, Ebene3); nicht aus Name oder Reihenfolge ableitbar → max+1",
    },
    befunde: ["component_missing_attributes", "duplicate_ifc_id"],
  },
  Raum: {
    quelle: "bauwerksmodell.ids BWM-03, structures create_db_models",
    importarten: ["bauwerksmodell"],
    entity: "IfcSpace",
    erkennung: { pset: "Objektinformation", property: "IDEbene1" },
    pflicht: "wie Bauteil",
  },
  Untersuchungsstelle: {
    quelle: "diagnostics/importer/create_db_models.py::_extract_measurement_point_candidate, _unassignable_reason · IDS DIA-P-04, DIA-P-07",
    importarten: ["planung", "einzelergebnisse"],
    entity: "IfcBuildingElementProxy",
    erkennung: { pset: "Objektinformation|Objektinformationen", property: "BauteilID", bedingung: "nicht leer" },
    pflicht: [
      { pset: "Objektinformation", property: "ID", aliase: ["IDUntersuchungsstelle"] },
      { pset: "Objektinformation", property: "Bezeichnung", aliase: ["BezeichnungUntersuchungsstelle"] },
      { pset: "Objektinformation", property: "BauteilID", referenz: "Bauteil", quelle: "bauwerksmodell" },
      { pset: "Objektinformation", property: "UntersuchungsbereichID", referenz: "Untersuchungsbereich", quelle: "datei" },
    ],
    optional: [
      { pset: "Untersuchungsstelle", property: "Beschreibung|Bemerkung", rolle: "description" },
      { pset: "Objektinformation", property: "UntersuchungszielID|UntersuchungszielIDs", rolle: "Fallback für Verfahren ohne eigenes Untersuchungsziel" },
      { pset: "Objektinformation", property: "MessfeldID", rolle: "Fallback, nur bei genau einem Verfahren" },
    ],
    id: { konvention: "{Projekt.ID}.{Bezeichnung}", bezeichnungMuster: "{Untersuchungsbereich.Bezeichnung}_{Kürzel}{NN}", portalPrueft: "nur Eindeutigkeit" },
    nichtAnwendbar: ["ProbeID", "MessfeldID (ohne Messfeld)", "IDEbene1..3 (abgeleitet aus BauteilID)"],
    aspekte: { basis: ["Objektinformation", "Untersuchungsstelle"], verfahren: "beliebig viele aus verfahren[]" },
    unassignableGruende: ["object_information_pset_missing", "component_reference_missing", "execution_only_pset (nur planung)", "sample_element (nur planung)", "result_element"],
  },
  Verfahren: {
    quelle: "diagnostics/importer/pset_catalog.py, create_db_models.py::_extract_planned_method_candidates",
    importarten: ["planung", "einzelergebnisse"],
    entity: "Pset am Fachobjekt (Untersuchungsstelle oder Probe), kein eigenes Element",
    erkennung: "Pset-Name matcht ein Haupt-Pset aus verfahren[]",
    pflicht: [{ property: "UntersuchungszielID|UntersuchungszielIDs", liste: "getrennt durch , ; | oder Zeilenumbruch", fallback: "Objektinformation" }],
    optional: [{ property: "MessfeldID", referenz: "Messfeld", quelle: "gleiches Fachobjekt" }],
    id: { abgeleitet: "{Fachobjekt.ID}.{Pset-Name}" },
    erweitert: "Psets aus verfahren[].erweitert gehören zu genau einem vorhandenen Haupt-Pset (unassigned_extended_property_set)",
  },
  Messfeld: {
    quelle: "pset_catalog.py MEASUREMENT_FIELD_PROPERTY_SET_PATTERN, create_db_models.py::_extract_measurement_field_candidates",
    importarten: ["planung", "einzelergebnisse"],
    entity: "Pset Messfeld\\d* an der Untersuchungsstelle",
    pflicht: [{ property: "ID" }],
  },
  Probe: {
    quelle: "create_db_models.py::_extract_sample_candidate, _is_sample · IDS DIA-A-05",
    importarten: ["einzelergebnisse"],
    entity: "IfcBuildingElementProxy",
    erkennung: { pset: "Probe\\d*|Objektinformation", property: "UntersuchungsstelleID", bedingung: "nicht leer" },
    pflicht: [
      { pset: "Probe\\d*", property: "ID", aliase: ["IDProbe"] },
      { pset: "Probe\\d*", property: "UntersuchungsstelleID", referenz: "Untersuchungsstelle", quelle: "datei" },
    ],
    optional: [
      { pset: "Probe\\d*", property: "Bezeichnung|IDProbe", fallback: "ID" },
      { pset: "Probe\\d*", property: "Material" },
      { pset: "Probe\\d*", property: "Bemerkung|Beschreibung" },
    ],
    id: { konvention: "{Untersuchungsstelle.ID}.{IDProbe}" },
    aspekte: { basis: ["Objektinformation", "Probe\\d*"], verfahren: "ausgeführte Verfahren an der Probe" },
  },
  Ergebnis: {
    quelle: "create_results_db_models.py · helpers.RESULT_* · IDS DIA-UE-03, DIA-UE-04",
    importarten: ["ergebnisse"],
    entity: "IfcBuildingElementProxy",
    erkennung: { pset: "Untersuchungsergebnisse" },
    pflicht: [
      { pset: "Objektinformation", property: "(Bauwerksmodell|Bauwerk|Teilbauwerk|Bauteilgruppe|Bauteiltyp|Bauteilvariante|Bauteil|Raum|Objekt)ID\\d*_UE", anzahl: "genau 1", referenz: "Bauwerksmodell-Objekt beliebiger Ebene", quelle: "bauwerksmodell" },
    ],
    optional: [
      { pset: "Objektinformation", property: "ID", fallback: "GlobalId des Elements" },
      { pset: "Objektinformation", property: "Bezeichnung", fallback: "Name des Elements" },
      { pset: "Objektinformation", property: "Bemerkung|Beschreibung" },
    ],
    referenzziele: { Bauwerk: "Bauwerksnummer", Teilbauwerk: "Bauwerksnummer.Teilbauwerksnummer", Bauteilgruppe: "3 Segmente", Bauteiltyp: "4 Segmente", Bauteilvariante: "5 Segmente", Bauteil: "6 Segmente", Raum: "6 Segmente" },
    befunde: ["invalid_result_target_count", "ambiguous_result_target", "unknown_reference"],
  },
  Sensor: {
    quelle: "monitoring/importer/create_db_models.py::_update_or_create_sensor",
    importarten: ["monitoring"],
    entity: "IfcBuildingElementProxy",
    erkennung: { pset: "Objektinformation" },
    pflicht: [
      { pset: "Objektinformation", property: "ID", praefix: "Projekt.ID (alles vor dem letzten Punkt)" },
      { pset: "Objektinformation", property: "Bezeichnung" },
      { pset: "Objektinformation", property: "BauteilID", referenz: "Bauteil", quelle: "bauwerksmodell" },
      { pset: "Objektinformation", property: "MessanlageID", referenz: "Messanlage", quelle: "datei oder DB" },
    ],
    optional: [
      { pset: "Sensor", property: "StartMessungDatum", format: "TT.MM.JJJJ" },
      { pset: "Sensor", property: "EndeMessungDatum", format: "TT.MM.JJJJ" },
    ],
    id: { konvention: "{Projekt.ID}.{Bezeichnung}", portalPrueft: "Präfix = Projekt-ID" },
    aspekte: { basis: ["Objektinformation", "Sensor", "Position"], kanaele: "Kanal\\d+" },
  },
  Kanal: {
    quelle: "monitoring/importer/create_db_models.py::_update_or_create_channel, helpers.get_sensor_from_channel_ifc_id",
    importarten: ["monitoring"],
    entity: "Pset Kanal\\d+ am Sensor",
    pflicht: [
      { property: "ID", praefix: "Sensor.ID (alles vor dem letzten Punkt)" },
      { property: "Bezeichnung" },
      { property: "MaßnahmeID", referenz: "Maßnahme", quelle: "datei" },
    ],
    id: { konvention: "{Sensor.ID}.{Bezeichnung}", portalPrueft: "Präfix = Sensor-ID" },
  },
  Untersuchungsziel: { importarten: ["planung", "einzelergebnisse"], entity: "Pset Untersuchungsziel\\d* am IfcBuilding", pflicht: [{ property: "ID" }, { property: "Bezeichnung|UntersuchungszielName" }], id: { konvention: "{Projekt.ID}.{Bezeichnung}" } },
  Untersuchungsbereich: { importarten: ["planung", "einzelergebnisse"], entity: "Pset Untersuchungsbereich\\d* am IfcBuilding", pflicht: [{ property: "ID" }], optional: [{ property: "Bezeichnung" }], id: { konvention: "{Projekt.ID}.{Bezeichnung}" } },
  Maßnahme: { importarten: ["monitoring"], entity: "Pset Maßnahme\\d+ am IfcBuilding", pflicht: [{ property: "ID", praefix: "Projekt.ID" }, { property: "Bezeichnung" }], optional: [{ property: "BezeichnungKurz" }, { property: "Messziel" }], id: { konvention: "{Projekt.ID}.{Bezeichnung} (Langform)" } },
  Messanlage: { importarten: ["monitoring"], entity: "Pset Messanlage\\d+ am IfcBuilding", pflicht: [{ property: "ID" }], id: { konvention: "{Projekt.ID}.{Bezeichnung}" } },
};

/** Haupt-Psets der Verfahren, 1:1 aus pset_catalog.py (Reihenfolge wie dort). */
const VERFAHREN: Array<{ pset: string; erweitert?: string[]; nurAusfuehrung?: string[] }> = [
  { pset: "Abdichtung Gefuege", nurAusfuehrung: ["AbdichtungGefuege_Schicht\\d*"] },
  { pset: "Abreißversuch", erweitert: ["Abreißversuch Pruefstempel [12]"] },
  { pset: "Altlasten\\d*" },
  { pset: "Bestandsaufnahme messtechnisch" },
  { pset: "Bestandsaufnahme visuell" },
  { pset: "Bewehrung elektromagnetisch" },
  { pset: "Bewehrung visuell\\d*" },
  { pset: "Carbonatisierungstiefe" },
  { pset: "Chloridgehalt" },
  { pset: "Druckfestigkeit" },
  { pset: "Elektromagnetisches Verfahren" },
  { pset: "E-Modul" },
  { pset: "Endoskopie", nurAusfuehrung: ["Endoskopie_Schicht\\d*"] },
  { pset: "Feuchtegehalt" },
  { pset: "Gefuegebeschreibung" },
  { pset: "Georadar" },
  { pset: "Impakt-Echo" },
  { pset: "Kernbohrung", nurAusfuehrung: ["Kernbohrung_Schicht\\d*"] },
  { pset: "Mauerwerk Gefuege außen" },
  { pset: "Mauerwerk Gefuege innen", nurAusfuehrung: ["MauerwerkGefuegeInnen_Schicht\\d*"] },
  { pset: "Moertel Gefuege", nurAusfuehrung: ["MoertelGefuege_Schicht\\d*"] },
  { pset: "Naturstein Gefuege", nurAusfuehrung: ["NatursteinGefuege_Schicht\\d*"] },
  { pset: "Nitratgehalt" },
  { pset: "Oeffnung", nurAusfuehrung: ["Oeffnung_Schicht\\d*"] },
  { pset: "Potentialfeldmessung" },
  { pset: "Rohdichte" },
  { pset: "Rueckdehnungsmessung" },
  { pset: "Rueckprallhammer" },
  { pset: "Salze" },
  { pset: "Schichtung" },
  { pset: "Sondierungskernbohrung", nurAusfuehrung: ["Sondierungskernbohrung_Schicht\\d*"] },
  { pset: "Spanndrahtbruchortung elektromagnetisch" },
  { pset: "Spannglied visuell" },
  { pset: "Spiralbohrung", nurAusfuehrung: ["Spiralbohrung_Schicht\\d*"] },
  { pset: "Stahl mechanische Eigenschaften" },
  { pset: "Sulfatgehalt" },
  { pset: "Sulfidgehalt" },
  { pset: "Ultraschall", erweitert: ["Ultraschall-SAFT-Bild-Messbereich", "Ultraschall-SAFT-Bild-Messung"], nurAusfuehrung: ["Ultraschall-SAFT-Bild-Auswertung"] },
  { pset: "Betondeckung elektromagnetisch" },
  { pset: "Beton Gefuege", nurAusfuehrung: ["BetonGefuege_Schicht\\d*"] },
];

const ID_GRAMMATIK: Yaml = {
  trenner: ".",
  segment: "[^.]+ — Leerzeichen, Umlaute, _ - + kommen real vor",
  TEILBAUWERK: "Bauwerksnummer . Teilbauwerksnummer",
  BAUTEIL: "TEILBAUWERK . Ebene1 . Ebene2 . Ebene3 . Nr",
  PROJEKT: "TEILBAUWERK . Projekt.Bezeichnung",
  CONTAINER: "PROJEKT . Bezeichnung (Untersuchungsbereich, Untersuchungsziel, Maßnahme in Langform, Messanlage)",
  FACHOBJEKT: "PROJEKT . Bezeichnung (Untersuchungsstelle, Sensor)",
  KANAL: "FACHOBJEKT . Kanal.Bezeichnung",
  PROBE: "FACHOBJEKT . IDProbe",
  ERGEBNIS: "PROJEKT . UE . GlobalId (beobachtet; Portal: ID optional)",
  portalErzwingt: ["BAUTEIL sechs Segmente (IDS-Regex)", "MON: Projekt = Präfix von Sensor/Maßnahme/Messanlage", "MON: Sensor = Präfix von Kanal", "Eindeutigkeit je Objektart"],
  konventionNichtErzwungen: ["DIA-Präfixe", "Bezeichnungsmuster", "PROBE fünf Segmente", "ERGEBNIS mit GlobalId"],
};

const BEFUNDE: Yaml = {
  quelle: "ifc/importer/report.py, issues.py · Texte: mkp-portal-extern-frontend/src/utils/ifc-import-issues.ts",
  missing_required_property: { felder: ["element_name", "pset_name", "property_name"], de: "Das Pflichtfeld '{property_name}' im PSet '{pset_name}' fehlt oder ist leer. Bitte den Wert in der IFC-Datei ergänzen." },
  missing_pset: { felder: ["element_name", "pset_name"], de: "Das Pflicht-PSet '{pset_name}' fehlt. Bitte das PSet mit allen Pflichtfeldern in der IFC-Datei ergänzen." },
  duplicate_ifc_id: { felder: ["model_name", "value", "element_name", "pset_name"], de: "Die IFC-ID '{value}' für {model_name} ist mehrfach vergeben. Jede IFC-ID darf nur einmal vorkommen." },
  unknown_reference: { felder: ["model_name", "element_name", "pset_name", "property_name", "value", "suggestions"], vorschlaege: "difflib.get_close_matches, n=3, cutoff=0.6", de: "{model_name} mit der ID '{value}' wurde nicht gefunden. Bitte die Schreibweise der Referenz prüfen." },
  unassignable_element: {
    felder: ["element_name", "element_type", "ifc_guid", "import_role", "pset_names", "reason", "pset_name", "property_name"],
    de: "Das 3D-Element kann der gewählten Importart '{import_role}' nicht zugeordnet werden.",
    gruende: {
      result_element: "Das Element ist über das PSet '{pset_name}' als Untersuchungsergebnis gekennzeichnet und gehört daher zum Import der Untersuchungsergebnisse.",
      result_pset_missing: "Dem Element fehlt das PSet '{pset_name}', das Untersuchungsergebnisse kennzeichnet.",
      sample_element: "Das Element ist über die Referenz '{property_name}' als Probe gekennzeichnet und gehört daher zum Import der Untersuchungsdurchführung.",
      execution_only_pset: "Das PSet '{pset_name}' ist nur beim Import der Untersuchungsdurchführung zulässig.",
      object_information_pset_missing: "Dem Element fehlt das PSet 'Objektinformationen' (bzw. 'Objektinformation') mit der Bauteil-Referenz.",
      component_reference_missing: "Im PSet '{pset_name}' fehlt die Bauteil-Referenz '{property_name}' oder sie ist leer.",
    },
    limit: 20,
  },
  unassignable_element_overflow: { felder: ["count"], de: "Darüber hinaus können {count} weitere 3D-Elemente nicht zugeordnet werden." },
  invalid_result_target_count: { felder: ["element_name", "count"], de: "Das Ergebnis muss genau einem Objekt des Bauwerksmodells zugeordnet sein, gefunden wurden {count} Objekte." },
  ambiguous_result_target: { felder: ["element_name", "value", "count"], de: "Die Bauwerksmodell-Referenz '{value}' ist nicht eindeutig: {count} Objekte kommen infrage. Bitte die Referenz präzisieren." },
  unassigned_extended_property_set: { felder: ["element_name", "pset_name"], de: "Das erweiterte PSet '{pset_name}' konnte keiner Untersuchungsmethode zugeordnet werden. Bitte den PSet-Namen prüfen." },
  component_missing_attributes: { felder: ["element_name", "property_names"], de: "Folgende Pflichtangaben fehlen oder sind leer: {property_names}. Bitte die Werte in der IFC-Datei ergänzen." },
  structure_model_missing: { felder: [], de: "Es wurde noch kein Bauwerksmodell für dieses Asset importiert. Bitte zuerst das Bauwerksmodell importieren." },
  invalid_building_count: { felder: ["count"], de: "Die IFC-Datei muss genau ein IfcBuilding enthalten, gefunden wurden {count}." },
  data_conflict: { felder: ["model_name", "value"], de: "Die Angaben zu {model_name} '{value}' widersprechen bereits importierten Daten. Bitte prüfen, ob eine abweichende Version der Datei importiert wurde." },
  invalid_date: { felder: ["value"], de: "Ungültiges Datum: '{value}'. Erwartet wird das Format TT.MM.JJJJ." },
  invalid_time: { felder: ["value"], de: "Ungültige Uhrzeit: '{value}'. Erwartet wird das Format HH:MM." },
  glb_no_scene: { felder: [], de: "Die 3D-Konvertierung ist fehlgeschlagen: Die konvertierte Datei enthält keine 3D-Szene." },
  glb_conversion_failed: { felder: [], de: "Die 3D-Konvertierung der IFC-Datei ist fehlgeschlagen. Die Datei konnte nicht in ein 3D-Modell umgewandelt werden." },
  internal_error: { felder: [], de: "Beim Import ist ein unerwarteter interner Fehler aufgetreten. Bitte den Import erneut starten oder den Support kontaktieren." },
  georeferenz: { felder: [], ohneCode: true, de: "IFC file contains no recognizable georeference / IFC CRS does not match the existing asset scene georeference", regel: "erste Datei je Bauwerk setzt CRS und Ursprung (IfcMapConversion, sonst IfcSite); spätere müssen kompatibel sein" },
};

const IDS_SPEZIFIKATIONEN: Yaml = [
  { datei: "diagnostik-planung.ids", version: "1.1.0", ids: ["DIA-P-01 Bauwerksbezug", "DIA-P-02 Diagnostik-Projekt", "DIA-P-03 Untersuchungsziele", "DIA-P-06 Untersuchungsbereiche", "DIA-P-04 Untersuchungsstellen", "DIA-P-07 Jedes 3D-Element ist Untersuchungsstelle", "DIA-P-05 Keine Untersuchungsergebnisse", "DIA-P-08 Keine Ausführungs-PSets"] },
  { datei: "diagnostik-ausfuehrung.ids", version: "1.1.0", ids: ["DIA-A-01", "DIA-A-02", "DIA-A-03", "DIA-A-07", "DIA-A-04 Untersuchungsstellen", "DIA-A-05 Proben", "DIA-A-06 Keine Untersuchungsergebnisse"] },
  { datei: "diagnostik-ergebnisse.ids", version: "1.0.0", ids: ["DIA-UE-01", "DIA-UE-02", "DIA-UE-03 Jedes 3D-Element ist Ergebnis", "DIA-UE-04 Bauwerksmodell-Referenz"] },
  { datei: "bauwerksmodell.ids", version: "1.0.0", ids: ["BWM-01 Bauwerksdaten", "BWM-02 Bauteil-Kennung", "BWM-04 Geschoss-Struktur", "BWM-03 Räume"] },
  { hinweis: "nicht in IDS abbildbar und vom Portal geprüft: Eindeutigkeit, Referenzauflösung, Entweder-oder (Stelle/Probe), Zuordnung erweiterter Psets, genau eine Ergebnis-Referenz, ID-Präfixe bei Monitoring, Georeferenz" },
];

/* ------------------------------------------------------------------ */
/* Quelle 2: Objektkataloge                                            */
/* ------------------------------------------------------------------ */

const LOI_LEVELS = ["LoI 100", "LoI 200", "LoI 300", "LoI 400", "LoI 500"];

function readWorkbook(path: string): ArrayBuffer {
  const buffer = readFileSync(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/** MON: Spalte "Ausgabe" (Index 1) je (Pset, Allplan-Name Index 3) — die Dateien tragen die Ausgabe-Namen. */
function monitoringOutputNames(path: string): Map<string, string> {
  const workbook = XLSX.read(readWorkbook(path), { cellDates: false });
  const sheet = workbook.Sheets["Alle Merkmale (Propertys)"];
  const map = new Map<string, string>();
  if (!sheet) return map;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  for (const row of rows) {
    const pset = String(row[4] ?? "").trim();
    const output = String(row[1] ?? "").trim();
    const attribute = String(row[3] ?? "").trim();
    if (pset && attribute) map.set(`${pset.toLowerCase()}|${attribute.toLowerCase()}`, output);
  }
  return map;
}

function stripPrefix(name: string): string {
  return name.replace(/^(Pset_|ePset_|ePSet_)/, "");
}

function kurzname(rule: CatalogPropertyRule, classCode: string, monOutput: Map<string, string> | null): string {
  const raw = rule.propertyName;
  if (monOutput) {
    const output = monOutput.get(`${rule.psetName.toLowerCase()}|${raw.toLowerCase()}`);
    if (output) return output.replace(/^_/, "");
  }
  const abbr = classCode.replace(/^(BWD|MON) - /, "");
  const withoutPrefix = raw.replace(/^_/, "");
  if (abbr && withoutPrefix.endsWith(`_${abbr}`)) return withoutPrefix.slice(0, -(abbr.length + 1));
  return withoutPrefix;
}

function markers(record: Record<string, boolean>, labels: string[]): string[] {
  return labels.filter((label) => record[label]);
}

function catalogToYaml(catalog: IfcObjectCatalog, kind: CatalogKind, file: string, monOutput: Map<string, string> | null): Yaml {
  const loiLabels = LOI_LEVELS;
  const tradeLabels = [...new Set(catalog.objectTypes.flatMap((o) => o.propertyRules.flatMap((r) => Object.keys(r.tradeMarkers))))];
  const klassen: Yaml[] = catalog.objectTypes.map((objectType) => {
    const psets = new Map<string, CatalogPropertyRule[]>();
    for (const rule of objectType.propertyRules) {
      const list = psets.get(rule.psetName) ?? [];
      list.push(rule);
      psets.set(rule.psetName, list);
    }
    return {
      code: objectType.code,
      name: objectType.name,
      ifcClass: objectType.ifcClass,
      version: objectType.version || null,
      sheet: objectType.sheetName,
      psets: [...psets].map(([psetName, rules]) => {
        const portalName = stripPrefix(psetName);
        const familie = /(X|N)$/.test(portalName) ? `${portalName.slice(0, -1)}\\d*` : null;
        return {
          name: psetName,
          portalName,
          familie,
          properties: rules.map((rule) => ({
            name: rule.propertyName,
            kurz: kurzname(rule, objectType.code, monOutput),
            typ: rule.valueType,
            format: rule.format || null,
            einheit: rule.unit || null,
            pflicht: rule.requirement === "required",
            loi: markers(rule.loiMarkers, loiLabels).map((l) => Number(l.replace("LoI ", ""))),
            gewerk: markers(rule.tradeMarkers, tradeLabels).map((t) => t.replace(/^TM /, "")),
            zeile: rule.sourceRow,
          })),
        };
      }),
    };
  });
  return {
    kind,
    datei: file,
    importiertAm: catalog.importedAt,
    klassen: catalog.objectTypes.length,
    regeln: catalog.objectTypes.reduce((n, o) => n + o.propertyRules.length, 0),
    gewerke: tradeLabels.map((t) => t.replace(/^TM /, "")),
    loiKumulativ: "Marker sind in den Daten kumulativ (Regel ab 300 hat 300/400/500); Filter liest nur die Zielstufe",
    diagnose: catalog.diagnostics,
    objektklassen: klassen,
  };
}

/* ------------------------------------------------------------------ */
/* Zusammenbau                                                         */
/* ------------------------------------------------------------------ */

function main(): void {
  const [bwdPath, monPath, outArg] = process.argv.slice(2);
  if (!bwdPath || !monPath) {
    console.error("Aufruf: npx tsx scripts/generate-fachmodell-schema.ts <Katalog_BWD.xlsx> <Katalog_MON.xlsx> [ausgabe.yaml]");
    process.exit(1);
  }
  const outPath = resolve(outArg ?? "src/ifc/attribution/fachmodell-schema.yaml");

  const bwd = parseCatalogWorkbook(readWorkbook(bwdPath), bwdPath.split(/[\\/]/).pop() ?? bwdPath, "diagnostik");
  const mon = parseCatalogWorkbook(readWorkbook(monPath), monPath.split(/[\\/]/).pop() ?? monPath, "monitoring");
  const monOutput = monitoringOutputNames(monPath);

  const schema: Yaml = {
    schemaVersion: "0.1.0",
    erzeugt: new Date().toISOString(),
    generator: "editor/scripts/generate-fachmodell-schema.ts",
    zweck: "Einzige Stelle im Editor für Importarten, Objektarten, Pflichtfelder, Normalisierung, Befunde (Portal) und Katalogregeln (openSIM). Vom Attribuierungs-Panel und den Validatoren zu lesen; zur Übernahme ins Portal gedacht.",
    quellen: { portal: PORTAL_QUELLEN, katalog: { bwd: bwdPath.split(/[\\/]/).pop() ?? bwdPath, mon: monPath.split(/[\\/]/).pop() ?? monPath } },
    normalisierung: NORMALISIERUNG,
    psetFamilien: PSET_FAMILIEN,
    psetAliase: PSET_ALIASE,
    importarten: IMPORTARTEN,
    objektarten: OBJEKTARTEN,
    verfahren: VERFAHREN.map((v) => ({ pset: v.pset, erweitert: v.erweitert ?? [], nurAusfuehrung: v.nurAusfuehrung ?? [] })),
    idGrammatik: ID_GRAMMATIK,
    befunde: BEFUNDE,
    idsSpezifikationen: IDS_SPEZIFIKATIONEN,
    katalog: {
      bwd: catalogToYaml(bwd, "diagnostik", bwdPath.split(/[\\/]/).pop() ?? bwdPath, null),
      mon: catalogToYaml(mon, "monitoring", monPath.split(/[\\/]/).pop() ?? monPath, monOutput),
    },
  };

  const header = [
    "# Fachmodell-Schema — GENERIERT, nicht von Hand ändern.",
    "# Portal-Regeln: scripts/generate-fachmodell-schema.ts (Abschnitte normalisierung … idsSpezifikationen).",
    "# Katalogregeln: aus den openSIM-Excel-Dateien über src/ifc/catalogExcel.ts.",
    "# Neu erzeugen: npx tsx scripts/generate-fachmodell-schema.ts <BWD.xlsx> <MON.xlsx>",
    "",
  ].join("\n");

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, header + toYaml(schema), "utf8");
  // JSON-Zwilling: wird vom Editor nativ importiert (resolveJsonModule), die
  // YAML ist die lesbare Fassung für Menschen und für das Portal-Team.
  const jsonPath = outPath.replace(/\.ya?ml$/, ".json");
  writeFileSync(jsonPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  console.log(
    `geschrieben: ${outPath}\n  JSON: ${jsonPath}\n  BWD: ${bwd.objectTypes.length} Klassen, ${bwd.objectTypes.reduce((n, o) => n + o.propertyRules.length, 0)} Regeln` +
      `\n  MON: ${mon.objectTypes.length} Klassen, ${mon.objectTypes.reduce((n, o) => n + o.propertyRules.length, 0)} Regeln (Ausgabe-Namen: ${monOutput.size})` +
      `\n  Verfahren: ${VERFAHREN.length} · Objektarten: ${Object.keys(OBJEKTARTEN as object).length} · Befunde: ${Object.keys(BEFUNDE as object).length - 1}`,
  );
}

main();
