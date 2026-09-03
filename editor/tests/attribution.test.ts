import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32 as nodeCrc32 } from "node:zlib";

import { formatPortalMessage } from "../src/ifc/attribution/messages";
import { cleanValue, findPset, getProperty, getValue, psetMatches, splitIdList, stripPsetPrefix } from "../src/ifc/attribution/normalize";
import { buildBauwerksmodellIndex, closeMatches, runPortalCheck, type PortalFinding } from "../src/ifc/attribution/portalCheck";
import { classifyMethodPset, fachmodellSchema, katalogFor } from "../src/ifc/attribution/schema";
import { collectBcfTopics, createBcfArchive } from "../src/ifc/attribution/bcf";
import { compareAreaMethods, methodLabelForPset, normalizeMethodName } from "../src/ifc/attribution/methods";
import { addFachobjekt } from "../src/ifc/attribution/objects";
import { addMethodPset, addRepeatPset, attachPset, childId, nextRepeatIndex, upsertProperty, upsertPropertyInSet, writeBauteilReference, writeCell } from "../src/ifc/attribution/recipes";
import { buildTable, collectRows, formatMeters, objektartenOf, parseMeters } from "../src/ifc/attribution/table";
import { applyImport, autoMap, parseDelimited, planImport } from "../src/ifc/attribution/tableImport";
import { buildFachmodellTree, detectImportart } from "../src/ifc/attribution/tree";
import { createZip, crc32, readZipEntries } from "../src/ifc/attribution/zip";
import { getNativePlacementWorld, parseNativeIfcText, updateNativePropertyValue } from "../src/ifc/nativeDocument";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string) {
  const text = readFileSync(resolve(here, "fixtures/attribution", name), "latin1");
  return parseNativeIfcText(text, name);
}

function codes(findings: PortalFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) counts[finding.code] = (counts[finding.code] ?? 0) + 1;
  return counts;
}

function dump(findings: PortalFinding[]): string {
  return findings.map((finding) => `  [${finding.severity}] ${finding.code} · ${finding.element_name ?? "-"} · ${finding.pset_name ?? ""}.${finding.property_name ?? ""} · ${finding.value ?? ""}`).join("\n");
}

/* ---------------- Schema ---------------- */

test("Schema: Kataloge und Verfahren sind geladen", () => {
  assert.equal(fachmodellSchema.katalog.bwd.klassen, 66);
  assert.equal(fachmodellSchema.katalog.bwd.regeln, 915);
  assert.equal(fachmodellSchema.katalog.mon.klassen, 9);
  assert.equal(fachmodellSchema.verfahren.length, 40);
  assert.equal(katalogFor("monitoring")?.kind, "monitoring");
  assert.equal(katalogFor("bauwerksmodell"), null);
});

test("Schema: Verfahrens-Psets werden wie pset_catalog.py zugeordnet", () => {
  assert.equal(classifyMethodPset("Kernbohrung")?.kind, "main");
  assert.equal(classifyMethodPset("Altlasten3")?.kind, "main");
  const schicht = classifyMethodPset("Kernbohrung_Schicht2");
  assert.equal(schicht?.kind, "extended");
  assert.equal(schicht && schicht.kind === "extended" ? schicht.executionOnly : null, true);
  const saft = classifyMethodPset("Ultraschall-SAFT-Bild-Messung");
  assert.equal(saft && saft.kind === "extended" ? saft.executionOnly : null, false);
  assert.equal(classifyMethodPset("Objektinformation"), undefined);
});

/* ---------------- Normalisierung ---------------- */

test("Normalisierung: Präfixe, Suffixe, Leerwerte wie der Portal-Importer", () => {
  assert.equal(stripPsetPrefix("ePset_Objektinformationen"), "Objektinformationen");
  assert.equal(stripPsetPrefix("ePSet_Modellinformation"), "Modellinformation");
  assert.ok(psetMatches("ePset_Untersuchungsbereich0", "Untersuchungsbereich\\d*"));
  assert.ok(psetMatches("ePset_Kanal7", "Kanal\\d+"));
  assert.ok(!psetMatches("ePset_Kanal", "Kanal\\d+"));
  assert.ok(psetMatches("Pset_Objektinformation", "Objektinformation"));
  assert.ok(!psetMatches("ePset_Objektinformationen", "Objektinformation"));
  assert.equal(cleanValue("IFCTEXT('-')"), "");
  assert.equal(cleanValue("IFCLABEL('')"), "");
  assert.equal(cleanValue("IFCLABEL('6316873.B')"), "6316873.B");
  assert.deepEqual(splitIdList("a, b;c|d\ne, a"), ["a", "b", "c", "d", "e"]);

  const set = {
    id: 1,
    kind: "IFCPROPERTYSET",
    name: "ePset_Objektinformation",
    values: [
      { id: 2, name: "_ID_OI", value: "IFCLABEL('x.y.z')", type: "IFCPROPERTYSINGLEVALUE" },
      { id: 3, name: "_BauteilID_OI", value: "IFCLABEL('6316873.B.U.H.H.48')", type: "IFCPROPERTYSINGLEVALUE" },
      { id: 4, name: "_IDEbene1_OI", value: "IFCLABEL('')", type: "IFCPROPERTYSINGLEVALUE" },
    ],
  };
  assert.equal(getProperty(set, "ID")?.value, "x.y.z");
  assert.equal(getProperty(set, "BauteilID")?.value, "6316873.B.U.H.H.48");
  assert.equal(getProperty(set, "IDEbene1")?.value, "");
  assert.equal(getProperty(set, "Bezeichnung"), undefined);
});

test("Vorschläge: nahe Treffer wie difflib.get_close_matches", () => {
  const known = ["6316873.B.Ueberbau.Hohlkasten.Hohlkasten.48", "6316873.B.Ueberbau.Hohlkasten.Hohlkasten.55", "6316873.B.Unterbau.Pfeiler.Strompfeiler.1"];
  const suggestions = closeMatches("6316873.B.Ueberbau.Hohlkasten.Hohlkasten.49", known);
  assert.equal(suggestions[0], "6316873.B.Ueberbau.Hohlkasten.Hohlkasten.48");
  assert.deepEqual(closeMatches("völlig anders", known), []);
});

/* ---------------- Monitoring ---------------- */

test("Monitoring (MON_LBM): ohne Bauwerksmodell nur ungeprüfte Bauteil-Referenzen", () => {
  const document = loadFixture("monitoring-lbm.ifc");
  const result = runPortalCheck(document, { importart: "monitoring" });
  const counts = codes(result.findings);
  assert.equal(result.errorCount, 0, dump(result.findings));
  assert.equal(counts.editor_reference_unchecked, 4);
  assert.equal(result.stats.sensoren, 4);
  assert.equal(result.stats.kanaele, 17);
  assert.equal(result.stats.massnahmen, 5);
  assert.equal(result.stats.messanlagen, 1);
});

test("Monitoring (MON_LBM) gegen falsches Bauwerksmodell: Bauteil-Referenzen unbekannt", () => {
  const document = loadFixture("monitoring-lbm.ifc");
  const bauwerksmodell = loadFixture("bauwerksmodell-vlrlp.ifc");
  const index = buildBauwerksmodellIndex(bauwerksmodell);
  assert.equal(index.teilbauwerk, "A1");
  assert.equal(index.components.size, 10);
  const result = runPortalCheck(document, { importart: "monitoring", bauwerksmodell });
  const counts = codes(result.findings);
  assert.equal(counts.unknown_reference, 4, dump(result.findings));
  const finding = result.findings.find((entry) => entry.code === "unknown_reference");
  assert.equal(finding?.model_name, "Bauteil");
  assert.match(formatPortalMessage(finding!), /^Bauteil mit der ID '6316873\.B\./);
});

/* ---------------- Bauwerksmodell ---------------- */

test("Bauwerksmodell (VLRLP): zehn Bauteile mit sechsteiliger ID, keine Fehler", () => {
  const document = loadFixture("bauwerksmodell-vlrlp.ifc");
  const result = runPortalCheck(document, { importart: "bauwerksmodell" });
  assert.equal(result.errorCount, 0, dump(result.findings));
  assert.equal(result.stats.bauteile, 10);
});

/* ---------------- Diagnostik ---------------- */

test("Einzelergebnisse (B): fünf Stellen, vier Proben, keine Zuordnungsfehler", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const result = runPortalCheck(document, { importart: "einzelergebnisse" });
  const counts = codes(result.findings);
  assert.equal(counts.unassignable_element ?? 0, 0, dump(result.findings));
  assert.equal(result.stats.untersuchungsstellen, 5);
  assert.equal(result.stats.proben, 4);
  assert.equal(result.stats.untersuchungsbereiche, 5);
  assert.equal(result.stats.untersuchungsziele, 2);
  assert.equal(counts.editor_reference_unchecked, 5);
  assert.equal(counts.duplicate_ifc_id ?? 0, 0);
});

test("Einzelergebnisse als Planung (A): Proben sind nicht zuordenbar", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const result = runPortalCheck(document, { importart: "planung" });
  const samples = result.findings.filter((finding) => finding.code === "unassignable_element" && finding.reason === "sample_element");
  assert.equal(samples.length, 4, dump(result.findings));
  assert.match(samples[0]!.message, /als Probe gekennzeichnet/);
  assert.equal(samples[0]!.import_role, "Untersuchungsplanung (A)");
});

test("Einzelergebnisse als Ergebnisse (C): jedes Element ohne Untersuchungsergebnisse ist nicht zuordenbar", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const result = runPortalCheck(document, { importart: "ergebnisse" });
  const counts = codes(result.findings);
  assert.equal(counts.unassignable_element, 9, dump(result.findings));
  assert.equal(counts.missing_pset, 1);
  assert.ok(result.findings.every((finding) => finding.code !== "unassignable_element" || finding.reason === "result_pset_missing"));
});

/* ---------------- Baum ---------------- */

test("Baum: Importart wird erkannt", () => {
  assert.equal(detectImportart(loadFixture("monitoring-lbm.ifc")), "monitoring");
  assert.equal(detectImportart(loadFixture("diagnostik-einzelergebnisse.ifc")), "einzelergebnisse");
  assert.equal(detectImportart(loadFixture("bauwerksmodell-vlrlp.ifc")), "bauwerksmodell");
});

test("Baum (MON_LBM): Projekt → Messanlage → Sensoren → Kanäle, Maßnahmen als Container", () => {
  const document = loadFixture("monitoring-lbm.ifc");
  const check = runPortalCheck(document, { importart: "monitoring" });
  const tree = buildFachmodellTree(document, "monitoring", check.findings);
  assert.ok(tree.root);
  assert.equal(tree.root!.id, "6316873.B.SPP_SHM_Nibli_LS1");
  const messanlagen = tree.root!.children.find((node) => node.label === "Messanlagen")!;
  assert.equal(messanlagen.children.length, 1);
  assert.equal(messanlagen.children[0]!.children.length, 4);
  const sensor = messanlagen.children[0]!.children[0]!;
  assert.equal(sensor.kind, "sensor");
  assert.ok(sensor.children.every((kanal) => kanal.kind === "kanal"));
  assert.equal(tree.root!.objectCount, 4);
  assert.equal(tree.eimer.children.length, 0);
  assert.equal(tree.byEntity.size, 4);
});

test("Baum (Einzelergebnisse): Stellen unter Bereichen, Proben unter Stellen", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const check = runPortalCheck(document, { importart: "einzelergebnisse" });
  const tree = buildFachmodellTree(document, "einzelergebnisse", check.findings);
  const bereiche = tree.root!.children.find((node) => node.label === "Untersuchungsbereiche")!;
  assert.equal(bereiche.children.length, 5);
  const stellen = bereiche.children.flatMap((bereich) => bereich.children);
  assert.equal(stellen.length, 5);
  const proben = stellen.flatMap((stelle) => stelle.children);
  assert.equal(proben.length, 4);
  assert.ok(stellen.every((stelle) => stelle.aspekte.includes("Untersuchungsstelle")));
  assert.equal(tree.root!.objectCount, 9);
});

test("Baum: Gruppenknoten wissen, welche Objektart sich unter ihnen anlegen lässt", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const tree = buildFachmodellTree(document, "einzelergebnisse");
  const groups = Object.fromEntries(tree.root!.children.map((child) => [child.label, child.creates ?? null]));
  assert.equal(groups["Untersuchungsziele"], "untersuchungsziel");
  assert.equal(groups["Untersuchungsbereiche"], "untersuchungsbereich");
  const monitoring = buildFachmodellTree(loadFixture("monitoring-lbm.ifc"), "monitoring");
  assert.deepEqual(monitoring.root!.children.slice(0, 2).map((child) => child.creates), ["messanlage", "massnahme"]);
  assert.equal(tree.root!.children.find((child) => child.label === "Untersuchungsbereiche")!.children[0]!.creates, undefined, "Fachknoten tragen kein creates — das Panel leitet Stelle/Probe/Sensor/Kanal aus der Art ab");
});

test("Baum (Einzelergebnisse als Planung): Proben landen im Eimer", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const check = runPortalCheck(document, { importart: "planung" });
  const tree = buildFachmodellTree(document, "planung", check.findings);
  assert.equal(tree.eimer.children.length, 4);
  assert.equal(tree.eimer.errorCount, 4);
});

test("Baum (Bauwerksmodell): Gruppe → Typ → Variante → Bauteil", () => {
  const document = loadFixture("bauwerksmodell-vlrlp.ifc");
  const tree = buildFachmodellTree(document, "bauwerksmodell");
  assert.equal(tree.root!.id, "6316873.A1");
  const gruppe = tree.root!.children[0]!;
  assert.equal(gruppe.kind, "bauteilgruppe");
  assert.equal(gruppe.children[0]!.kind, "bauteiltyp");
  assert.equal(gruppe.children[0]!.children[0]!.kind, "bauteilvariante");
  assert.equal(gruppe.children[0]!.children[0]!.children[0]!.kind, "bauteil");
  assert.equal(tree.root!.objectCount, 10);
});

/* ---------------- Tabelle ---------------- */

test("Tabelle (Einzelergebnisse): Portal-Pflicht zuerst, Katalog-Pflicht nach LoI, Referenzen aufgelöst", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const check = runPortalCheck(document, { importart: "einzelergebnisse" });
  const tree = buildFachmodellTree(document, "einzelergebnisse", check.findings);
  const rows = collectRows(tree.root!).filter((node) => node.kind === "untersuchungsstelle");
  const table = buildTable(document, rows, { importart: "einzelergebnisse", scope: { loi: 300, gewerke: ["EE"] }, katalog: katalogFor("einzelergebnisse"), bauwerksmodell: null, findings: check.findings });
  assert.equal(table.objektart, "untersuchungsstelle");
  assert.equal(table.rows.length, 5);
  assert.ok(table.groups[0]!.hard, "erste Gruppe ist die Portal-Pflicht");
  const hard = table.columns.filter((column) => column.hard).map((column) => column.property);
  assert.deepEqual(hard, ["ID", "Bezeichnung", "BauteilID", "UntersuchungsbereichID"]);
  assert.equal(table.groups[0]!.columns.length, 4, "Portal-Pflicht-Gruppe enthält nur die vier Pflichtspalten");
  assert.ok(table.groups.some((group) => !group.hard && group.psetPattern === table.groups[0]!.psetPattern), "Katalog-Rest der Objektinformation als eigene Gruppe");
  assert.equal(table.columns.filter((column) => column.property === "Bezeichnung" && column.psetPattern === table.groups[0]!.psetPattern).length, 1, "keine Doppelspalten innerhalb einer Pset-Familie");
  const row = table.rows[0]!;
  const bereich = row.cells.find((cell) => cell.column.property === "UntersuchungsbereichID")!;
  assert.equal(bereich.state, "ok");
  assert.ok(bereich.target, "Bereich ist in der Datei auflösbar");
  const bauteil = row.cells.find((cell) => cell.column.property === "BauteilID")!;
  assert.equal(bauteil.state, "unbekannt");
  const probeId = row.cells.find((cell) => cell.column.property === "ProbeID")!;
  assert.equal(probeId.state, "na");
  const ebene = row.cells.find((cell) => cell.column.property === "IDEbene1")!;
  assert.equal(ebene.state, "abgeleitet");
  const kb = table.groups.find((group) => group.label === "Kernbohrung");
  assert.ok(kb, "Verfahrens-Pset Kernbohrung ist eine Spaltengruppe");
  assert.ok(kb!.columns.some((column) => column.soft), "Kernbohrung hat Katalog-Pflichtspalten bei LoI 300");
});

test("Tabelle (Monitoring): Sensoren mit MessanlageID aufgelöst, Bauteil gegen Bauwerksmodell", () => {
  const document = loadFixture("monitoring-lbm.ifc");
  const bauwerksmodell = loadFixture("bauwerksmodell-vlrlp.ifc");
  const check = runPortalCheck(document, { importart: "monitoring", bauwerksmodell });
  const tree = buildFachmodellTree(document, "monitoring", check.findings);
  const table = buildTable(document, collectRows(tree.root!), { importart: "monitoring", scope: { loi: 500, gewerke: [] }, katalog: katalogFor("monitoring"), bauwerksmodell: buildBauwerksmodellIndex(bauwerksmodell), findings: check.findings, objektart: "sensor" });
  assert.equal(table.objektart, "sensor");
  assert.equal(table.rows.length, 4);
  const row = table.rows[0]!;
  assert.equal(row.cells.find((cell) => cell.column.property === "MessanlageID")!.state, "ok");
  assert.equal(row.cells.find((cell) => cell.column.property === "BauteilID")!.state, "import");
  assert.ok(row.importErrors >= 1);
  const sensorGroup = table.groups.find((group) => group.label === "Sensor");
  assert.ok(sensorGroup && sensorGroup.columns.some((column) => column.property === "Hersteller"));
});

test("Tabelle (Einzelergebnisse): Ziele und Bereiche sind Pset-Zeilen mit eigenen Pflichtspalten", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const check = runPortalCheck(document, { importart: "einzelergebnisse" });
  const tree = buildFachmodellTree(document, "einzelergebnisse", check.findings);
  const rows = collectRows(tree.root!);
  const arten = objektartenOf(rows);
  assert.deepEqual(
    arten.map((entry) => `${entry.kind}:${entry.count}`),
    ["untersuchungsziel:2", "untersuchungsbereich:5", "untersuchungsstelle:5", "probe:4"],
    "Objektarten in Baumreihenfolge",
  );
  const options = { importart: "einzelergebnisse" as const, scope: { loi: 300 as const, gewerke: [] as string[] }, katalog: katalogFor("einzelergebnisse"), bauwerksmodell: null, findings: check.findings };
  const ziele = buildTable(document, rows, { ...options, objektart: "untersuchungsziel" });
  assert.equal(ziele.objektart, "untersuchungsziel");
  assert.equal(ziele.rows.length, 2);
  assert.ok(ziele.rows[0]!.psetId != null && ziele.rows[0]!.psetName === "Untersuchungsziel0", "Zeile trägt ihr Pset");
  assert.notEqual(ziele.rows[0]!.key, ziele.rows[1]!.key, "Pset-Zeilen am selben IfcBuilding bleiben unterscheidbar");
  assert.ok(ziele.groups.every((group) => group.label === "Untersuchungsziel"), "nur das eigene Pset, nicht die Gebäude-Psets");
  assert.ok(ziele.groups[0]!.hard && ziele.groups.slice(1).every((group) => !group.hard), "Portal-Pflicht als eigene, schmale Gruppe vor dem Katalog-Rest");
  assert.equal(ziele.columns.filter((column) => column.property === "ID").length, 1, "ID nur einmal, obwohl Portal und Katalog sie kennen");
  assert.deepEqual(ziele.columns.filter((column) => column.hard).map((column) => column.property), ["ID", "Bezeichnung"]);
  assert.ok(ziele.rows.every((row) => row.cells.every((cell) => cell.state === "ok")), "Ziele der Zieldatei sind vollständig");

  const bereiche = buildTable(document, rows, { ...options, objektart: "untersuchungsbereich" });
  assert.equal(bereiche.rows.length, 5);
  const first = bereiche.rows[0]!;
  assert.equal(first.cells.find((cell) => cell.column.property === "ID")!.state, "ok");
  const verfahren1 = first.cells.find((cell) => cell.column.property === "Untersuchungsverfahren1")!;
  assert.ok(verfahren1.column.soft, "Untersuchungsverfahren1 ist Katalog-Pflicht ab LoI 100");
  assert.equal(verfahren1.value, "Druckfestigkeitsprüfung");
  const ziel = first.cells.find((cell) => cell.column.property === "Untersuchungsziel")!;
  assert.equal(ziel.state, "leer", "leeres Katalog-Pflichtfeld wird als leer markiert");

  // Ohne Wunsch-Objektart gilt die häufigste unter dem Ast.
  assert.equal(buildTable(document, rows, options).objektart, "untersuchungsbereich");
});

test("Tabelle (Monitoring): Kanäle eines Sensors als Pset-Zeilen, MaßnahmeID aufgelöst", () => {
  const document = loadFixture("monitoring-lbm.ifc");
  const check = runPortalCheck(document, { importart: "monitoring" });
  const tree = buildFachmodellTree(document, "monitoring", check.findings);
  const messanlage = tree.root!.children[0]!.children[0]!;
  const sensor = messanlage.children[0]!;
  assert.equal(sensor.kind, "sensor");
  const table = buildTable(document, collectRows(sensor), { importart: "monitoring", scope: { loi: 300, gewerke: [] }, katalog: katalogFor("monitoring"), bauwerksmodell: null, findings: check.findings, objektart: "kanal" });
  assert.equal(table.objektart, "kanal");
  assert.equal(table.rows.length, sensor.children.length);
  assert.ok(table.rows.length >= 1);
  const row = table.rows[0]!;
  assert.equal(row.psetName, "Kanal0");
  assert.equal(row.cells.find((cell) => cell.column.property === "MaßnahmeID")!.state, "ok");
  assert.ok(row.cells.find((cell) => cell.column.property === "MaßnahmeID")!.target, "Maßnahme in der Datei aufgelöst");
  assert.equal(row.cells.find((cell) => cell.column.property === "Datentyp")!.value, "Bildformat");
  // Messanlagen-Tabelle: eine Zeile je Messanlage-Pset am IfcBuilding
  const anlagen = buildTable(document, collectRows(tree.root!), { importart: "monitoring", scope: { loi: 300, gewerke: [] }, katalog: katalogFor("monitoring"), bauwerksmodell: null, findings: check.findings, objektart: "messanlage" });
  assert.equal(anlagen.rows.length, 1);
  assert.equal(anlagen.rows[0]!.cells.find((cell) => cell.column.property === "Hersteller")!.value, "Gantner Instruments");
});

test("Rezepte: Pset-Zeile schreiben und Wiederholgruppe anlegen (nächster Index, ID aus Eltern-ID)", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const building = document.entitiesByType.get("IFCBUILDING")![0]!;
  const ziel0 = findPset(document, building.id, "Untersuchungsziel0")!;
  const written = upsertPropertyInSet(document, building.id, ziel0.id, "Bezeichnung", "Dauerhaftigkeit Beton (neu)", "IFCLABEL", ["UntersuchungszielName"]);
  assert.notEqual(written, document);
  assert.equal(getValue(findPset(written, building.id, "Untersuchungsziel0"), "Bezeichnung"), "Dauerhaftigkeit Beton (neu)");
  assert.equal(getValue(findPset(written, building.id, "Untersuchungsziel1"), "Bezeichnung"), getValue(findPset(document, building.id, "Untersuchungsziel1"), "Bezeichnung"), "Nachbar-Pset unberührt");
  assert.equal(upsertPropertyInSet(written, building.id, ziel0.id, "Bezeichnung", "Dauerhaftigkeit Beton (neu)", "IFCLABEL"), written, "gleicher Wert = kein neues Dokument");

  assert.equal(nextRepeatIndex(document, building.id, "Untersuchungsziel\\d*"), 2);
  assert.equal(nextRepeatIndex(document, building.id, "Messanlage\\d*"), 0);
  const projektId = "6316873.B.Bauwerksdiagnostik_LBM";
  const id = childId(projektId, "Chloridbelastung");
  const added = addRepeatPset(document, building.id, "untersuchungsziel", "einzelergebnisse", { ID: id, Bezeichnung: "Chloridbelastung" });
  const neu = findPset(added, building.id, "Untersuchungsziel2");
  assert.ok(neu, "ePset_Untersuchungsziel2 angelegt");
  assert.equal(getValue(neu, "ID"), `${projektId}.Chloridbelastung`);
  assert.equal(getValue(neu, "Bezeichnung"), "Chloridbelastung");
  assert.ok(neu!.values.every((value) => value.name.startsWith("_")), "Properties ohne Katalogsuffix, mit Portal-Unterstrich");
  assert.equal(nextRepeatIndex(added, building.id, "Untersuchungsziel\\d*"), 3);
  // Bereich: Portal-Pflicht + Katalog-Textfelder, leer außer den übergebenen Werten
  const bereich = addRepeatPset(added, building.id, "untersuchungsbereich", "einzelergebnisse", { ID: childId(projektId, "US_G"), Bezeichnung: "US_G" });
  const neuerBereich = findPset(bereich, building.id, "Untersuchungsbereich5")!;
  assert.ok(neuerBereich.values.some((value) => value.name === "_Untersuchungsverfahren1"));
  assert.equal(getValue(neuerBereich, "Untersuchungsverfahren1"), "");
  // Kanal am Sensor, ID aus Sensor-ID
  const monitoring = loadFixture("monitoring-lbm.ifc");
  const sensor = monitoring.entitiesByType.get("IFCBUILDINGELEMENTPROXY")!.find((entity) => findPset(monitoring, entity.id, "Kanal0"))!;
  const sensorId = getValue(findPset(monitoring, sensor.id, "Objektinformation"), "ID");
  const before = nextRepeatIndex(monitoring, sensor.id, "Kanal\\d*");
  const mitKanal = addRepeatPset(monitoring, sensor.id, "kanal", "monitoring", { ID: childId(sensorId, "Neu"), Bezeichnung: "Neu" });
  const kanal = findPset(mitKanal, sensor.id, `Kanal${before}`)!;
  assert.equal(getValue(kanal, "ID"), `${sensorId}.Neu`);
  assert.ok(kanal.values.some((value) => value.name === "_MaßnahmeID"), "MaßnahmeID als Portal-Pflichtfeld vorhanden");
});

test("Fachobjekte: Untersuchungsstelle und Probe entstehen mit Marker, Psets und Platz im Baum", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const projektId = "6316873.B.Bauwerksdiagnostik_LBM";
  const bereichId = `${projektId}.F_P`;
  const stelle = addFachobjekt(document, {
    kind: "untersuchungsstelle",
    importart: "einzelergebnisse",
    bezeichnung: "F_P_BK-02",
    parentId: projektId,
    values: { Objektinformation: { UntersuchungsbereichID: bereichId } },
  });
  assert.ok(stelle.entityId > 0 && stelle.document !== document);
  const entity = stelle.document.entityById.get(stelle.entityId)!;
  assert.equal(entity.type, "IFCBUILDINGELEMENTPROXY");
  assert.equal(entity.name, "F_P_BK-02");
  assert.ok(getNativePlacementWorld(stelle.document, stelle.entityId), "Marker hat eine Platzierung");
  assert.ok((entity.args[6] ?? "").trim().startsWith("#"), "Marker hat eine Repräsentation");
  const info = findPset(stelle.document, stelle.entityId, "Objektinformation")!;
  assert.equal(getValue(info, "ID"), `${projektId}.F_P_BK-02`);
  assert.equal(getValue(info, "Bezeichnung"), "F_P_BK-02");
  assert.equal(getValue(info, "BauteilID"), "", "BauteilID bleibt leer — kommt per Picker");
  assert.equal(getValue(info, "UntersuchungsbereichID"), bereichId);
  assert.ok(findPset(stelle.document, stelle.entityId, "Untersuchungsstelle"), "Katalog-Pset Untersuchungsstelle angelegt");
  assert.ok(info.values.every((value) => value.name.startsWith("_") && !/_(OI|US|UB|PB)$/.test(value.name)), "ohne Katalogsuffix");

  // Ohne BauteilID lehnt das Portal die Stelle ab — der Baum zeigt sie trotzdem unter ihrem Bereich, mit Befund.
  const check = runPortalCheck(stelle.document, { importart: "einzelergebnisse" });
  assert.ok(check.findings.some((finding) => finding.entityId === stelle.entityId && finding.code === "unassignable_element"));
  const tree = buildFachmodellTree(stelle.document, "einzelergebnisse", check.findings);
  const node = tree.byEntity.get(stelle.entityId)!;
  assert.equal(node.kind, "untersuchungsstelle");
  assert.ok(node.errorCount >= 1);
  const bereiche = tree.root!.children.find((child) => child.label === "Untersuchungsbereiche")!;
  const bereich = bereiche.children.find((child) => child.id === bereichId)!;
  assert.ok(bereich.children.some((child) => child.entityId === stelle.entityId), "unter dem Bereich eingehängt, nicht im Eimer");
  assert.ok(!tree.eimer.children.some((child) => child.entityId === stelle.entityId));

  // Probe an der neuen Stelle: ID aus Stellen-ID, Marker an der Platzierung der Stelle.
  const probe = addFachobjekt(stelle.document, { kind: "probe", importart: "einzelergebnisse", bezeichnung: "F_P_BK-02_Probe1", parentId: stelle.id, placementRelativeToId: stelle.entityId });
  assert.ok(probe.entityId > 0);
  const probeSet = findPset(probe.document, probe.entityId, "Probe0")!;
  assert.equal(getValue(probeSet, "ID"), `${stelle.id}.F_P_BK-02_Probe1`);
  assert.equal(getValue(probeSet, "UntersuchungsstelleID"), stelle.id);
  assert.equal(getValue(probeSet, "IDProbe"), "F_P_BK-02_Probe1");
  assert.ok(probeSet.values.some((value) => value.name === "_Material"), "Katalog-Textfelder der Probe");
  const stelleWorld = getNativePlacementWorld(probe.document, stelle.entityId)!;
  const probeWorld = getNativePlacementWorld(probe.document, probe.entityId)!;
  assert.ok(Math.abs(stelleWorld.worldX - probeWorld.worldX) < 1e-6 && Math.abs(stelleWorld.worldZ - probeWorld.worldZ) < 1e-6, "Probe sitzt an der Stelle");
  const tree2 = buildFachmodellTree(probe.document, "einzelergebnisse", runPortalCheck(probe.document, { importart: "einzelergebnisse" }).findings);
  assert.equal(tree2.byEntity.get(probe.entityId)?.kind, "probe");
  assert.ok(tree2.byEntity.get(stelle.entityId)!.children.some((child) => child.entityId === probe.entityId), "Probe unter ihrer Stelle");

  // Sensor im Monitoring: drei Psets, MessanlageID vorbelegt
  const monitoring = loadFixture("monitoring-lbm.ifc");
  const sensor = addFachobjekt(monitoring, { kind: "sensor", importart: "monitoring", bezeichnung: "NiF+0001_T", parentId: "6316873.B.SPP_SHM_Nibli_LS1", values: { Objektinformation: { MessanlageID: "6316873.B.SPP_SHM_Nibli_LS1.Ni-MA1" } } });
  assert.ok(sensor.entityId > 0);
  for (const name of ["Objektinformation", "Sensor", "Position"]) assert.ok(findPset(sensor.document, sensor.entityId, name), `${name} angelegt`);
  assert.equal(getValue(findPset(sensor.document, sensor.entityId, "Objektinformation"), "MessanlageID"), "6316873.B.SPP_SHM_Nibli_LS1.Ni-MA1");
  assert.equal(addFachobjekt(monitoring, { kind: "kanal", importart: "monitoring", bezeichnung: "x", parentId: "p" }).entityId, -1, "unbekannte Objektart: nichts passiert");
});

test("Tabellenimport: Parsen, automatische Zuordnung, Plan und Anwenden als eine Änderung", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const check = runPortalCheck(document, { importart: "einzelergebnisse" });
  const tree = buildFachmodellTree(document, "einzelergebnisse", check.findings);
  const options = { importart: "einzelergebnisse" as const, scope: { loi: 300 as const, gewerke: [] as string[] }, katalog: katalogFor("einzelergebnisse"), bauwerksmodell: null, findings: check.findings, objektart: "untersuchungsbereich" as const };
  const model = buildTable(document, collectRows(tree.root!), options);
  const fpVerfahren = model.rows.find((row) => row.label === "F_P")!.cells.find((cell) => cell.column.property === "Untersuchungsverfahren1")!.value;
  assert.ok(fpVerfahren, "F_P hat ein erstes Verfahren");
  const csv = [
    "ID;Bezeichnung;Untersuchungsverfahren1;Untersuchungsziel;Bemerkung",
    `6316873.B.Bauwerksdiagnostik_LBM.F_P;F_P;${fpVerfahren};"Dauerhaftigkeit; Beton";`,
    "6316873.B.Bauwerksdiagnostik_LBM.US_F-West_BP_VBA04;US_F-West_BP_VBA04;Druckfestigkeitsprüfung;;unverändert",
    "6316873.B.Bauwerksdiagnostik_LBM.US_NEU;US_NEU;Georadar;Standsicherheit;neu",
    ";;;;",
  ].join("\n");
  const parsed = parseDelimited(csv);
  assert.deepEqual(parsed.headers, ["ID", "Bezeichnung", "Untersuchungsverfahren1", "Untersuchungsziel", "Bemerkung"]);
  assert.equal(parsed.rows.length, 3, "Leerzeile fällt weg");
  assert.equal(parsed.rows[0]![3], "Dauerhaftigkeit; Beton", "Anführungszeichen schützen den Trenner");
  assert.deepEqual(parseDelimited("a\tb\n1\t2").rows, [["1", "2"]], "Tab wird erkannt");

  const mapping = autoMap(parsed.headers, model);
  assert.equal(mapping.keyHeader, "ID");
  const targetProperty = (header: string) => {
    const target = mapping.targets[header];
    return target?.kind === "column" ? model.columns.find((column) => column.key === target.columnKey)?.property : undefined;
  };
  assert.equal(targetProperty("Untersuchungsverfahren1"), "Untersuchungsverfahren1");
  assert.equal(targetProperty("Untersuchungsziel"), "Untersuchungsziel");
  assert.equal(targetProperty("Bemerkung"), "Bemerkung");

  const plan = planImport(parsed, mapping, model, { createMissing: false, overwriteWithEmpty: false });
  assert.equal(plan.updates, 2, "F_P bekommt Untersuchungsziel, VBA04 eine Bemerkung; Druckfestigkeitsprüfung steht schon");
  assert.equal(plan.unchanged, 0);
  assert.equal(plan.skipped, 1, "US_NEU ohne Anlegen übersprungen");
  const fp = plan.rows[0]!;
  assert.equal(fp.action, "update");
  assert.deepEqual(fp.changes.map((change) => `${change.column.property}:${change.to}`), ["Untersuchungsziel:Dauerhaftigkeit; Beton"], "Untersuchungsverfahren1 steht schon → keine Änderung");
  const vba04 = plan.rows[1]!;
  assert.equal(vba04.action, "update", "Bemerkung 'unverändert' ist neu für VBA04");

  const withCreate = planImport(parsed, mapping, model, { createMissing: true, overwriteWithEmpty: false });
  assert.equal(withCreate.creates, 1);
  assert.equal(withCreate.rows[2]!.bezeichnung, "US_NEU");
  assert.deepEqual(withCreate.rows[2]!.changes.map((change) => change.column.property), ["Untersuchungsverfahren1", "Untersuchungsziel", "Bemerkung"]);

  const building = document.entitiesByType.get("IFCBUILDING")![0]!;
  const projektId = tree.root!.id!;
  const applied = applyImport(document, withCreate, "einzelergebnisse", (current, bezeichnung) => {
    const index = nextRepeatIndex(current, building.id, "Untersuchungsbereich\\d*");
    const next = addRepeatPset(current, building.id, "untersuchungsbereich", "einzelergebnisse", { ID: childId(projektId, bezeichnung), Bezeichnung: bezeichnung });
    return { document: next, entityId: building.id, psetId: findPset(next, building.id, `Untersuchungsbereich${index}`)!.id };
  });
  assert.equal(applied.updated, 2);
  assert.equal(applied.created, 1);
  assert.notEqual(applied.document, document);
  assert.equal(getValue(findPset(applied.document, building.id, "Untersuchungsbereich4"), "Untersuchungsziel"), "Dauerhaftigkeit; Beton");
  const neu = findPset(applied.document, building.id, "Untersuchungsbereich5")!;
  assert.equal(getValue(neu, "ID"), `${projektId}.US_NEU`);
  assert.equal(getValue(neu, "Untersuchungsverfahren1"), "Georadar");
  assert.equal(getValue(neu, "Bemerkung"), "neu");
  // Erneut planen: alles unverändert
  const again = buildTable(applied.document, collectRows(buildFachmodellTree(applied.document, "einzelergebnisse").root!), options);
  const replan = planImport(parsed, autoMap(parsed.headers, again), again, { createMissing: true, overwriteWithEmpty: false });
  assert.equal(replan.updates + replan.creates, 0);
  assert.equal(replan.unchanged, 3);
});

test("Position: Weltkoordinaten als Spalten, Schreiben verschiebt den Marker, Import mit Rechtswert/Hochwert", () => {
  assert.equal(parseMeters("32 455 176,289"), 32455176.289);
  assert.equal(formatMeters(91.5811367971286), "91.581");
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const check = runPortalCheck(document, { importart: "einzelergebnisse" });
  const tree = buildFachmodellTree(document, "einzelergebnisse", check.findings);
  const options = { importart: "einzelergebnisse" as const, scope: { loi: 300 as const, gewerke: [] as string[] }, katalog: katalogFor("einzelergebnisse"), bauwerksmodell: null, findings: check.findings, objektart: "untersuchungsstelle" as const };
  const model = buildTable(document, collectRows(tree.root!), options);
  const position = model.groups.find((group) => group.label.startsWith("Position"))!;
  assert.deepEqual(position.columns.map((column) => column.property), ["X", "Y", "Z"]);
  const row = model.rows.find((entry) => entry.entityId === 470)!;
  const x = row.cells.find((cell) => cell.column.position === "x")!;
  assert.equal(x.value, "32455176.289");
  assert.equal(row.cells.find((cell) => cell.column.position === "z")!.value, "91.581");
  // Ziele (Pset-Zeilen) haben keine Position
  assert.ok(!buildTable(document, collectRows(tree.root!), { ...options, objektart: "untersuchungsziel" }).groups.some((group) => group.label.startsWith("Position")));

  const moved = writeCell(document, row, x.column, "32455177,5", "einzelergebnisse");
  assert.notEqual(moved, document);
  const world = getNativePlacementWorld(moved, 470)!;
  assert.ok(Math.abs(world.worldX - 32455177.5) < 1e-6 && Math.abs(world.worldY - 5497815.8661216) < 1e-3, "nur X verschoben (Platzierung schreibt 4 Nachkommastellen)");
  assert.equal(writeCell(moved, row, x.column, "32455177.5", "einzelergebnisse"), moved, "gleicher Wert = keine Änderung");
  assert.equal(writeCell(moved, row, x.column, "abc", "einzelergebnisse"), moved, "Unsinn wird ignoriert");

  // Import: bestehende Stelle verschieben, neue Stelle mit Koordinaten anlegen
  const csv = "ID;Bezeichnung;Rechtswert;Hochwert;Höhe\n6316873.B.Bauwerksdiagnostik_LBM.F_P_BK-01;F_P_BK-01;32455180;5497815.8661216;91.581\n6316873.B.Bauwerksdiagnostik_LBM.F_P_BK-09;F_P_BK-09;32455190,25;5497820;92";
  const parsed = parseDelimited(csv);
  const mapping = autoMap(parsed.headers, model);
  const target = (header: string) => {
    const entry = mapping.targets[header];
    return entry?.kind === "column" ? model.columns.find((column) => column.key === entry.columnKey) : undefined;
  };
  assert.equal(target("Rechtswert")?.position, "x");
  assert.equal(target("Hochwert")?.position, "y");
  assert.equal(target("Höhe")?.position, "z");
  const plan = planImport(parsed, mapping, model, { createMissing: true, overwriteWithEmpty: false });
  assert.equal(plan.updates, 1);
  assert.deepEqual(plan.rows[0]!.changes.map((change) => change.column.property), ["X"], "Y und Z unverändert (numerischer Vergleich)");
  assert.equal(plan.creates, 1);
  const storey = document.entitiesByType.get("IFCBUILDINGSTOREY")![0]!;
  const applied = applyImport(document, plan, "einzelergebnisse", (current, bezeichnung) => {
    const result = addFachobjekt(current, { kind: "untersuchungsstelle", importart: "einzelergebnisse", bezeichnung, parentId: "6316873.B.Bauwerksdiagnostik_LBM", storeyId: storey.id });
    return result.entityId < 0 ? null : { document: result.document, entityId: result.entityId };
  });
  assert.deepEqual(applied.movedEntityIds, [470]);
  assert.equal(applied.createdEntityIds.length, 1);
  assert.ok(Math.abs(getNativePlacementWorld(applied.document, 470)!.worldX - 32455180) < 1e-6);
  const neu = getNativePlacementWorld(applied.document, applied.createdEntityIds[0]!)!;
  assert.ok(Math.abs(neu.worldX - 32455190.25) < 1e-6 && Math.abs(neu.worldY - 5497820) < 1e-6 && Math.abs(neu.worldZ - 92) < 1e-6, `neue Stelle steht auf den Import-Koordinaten (${neu.worldX}/${neu.worldY}/${neu.worldZ})`);
});

test("ZIP: store-Archiv mit korrekten CRCs, Offsets und UTF-8-Namen", () => {
  const text = new TextEncoder().encode("Größe: 3 Bauteile\n");
  assert.equal(crc32(text), nodeCrc32(text) >>> 0, "CRC32 wie zlib");
  const archive = createZip([{ name: "bcf.version", data: "<Version/>" }, { name: "3e7/markup.bcf", data: text }], new Date(2026, 8, 2, 12, 30, 0));
  assert.equal(String.fromCharCode(...archive.subarray(0, 4)), "PK\u0003\u0004");
  const entries = readZipEntries(archive);
  assert.deepEqual(entries.map((entry) => entry.name), ["bcf.version", "3e7/markup.bcf"]);
  assert.equal(new TextDecoder().decode(entries[1]!.data), "Größe: 3 Bauteile\n");
  assert.equal(entries[1]!.crc, nodeCrc32(text) >>> 0);
  assert.equal(entries[0]!.crc, nodeCrc32(Buffer.from("<Version/>")) >>> 0);
});

test("BCF: ein Thema je Befund mit Objekt-Auswahl, gültiges Paket", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const bauwerksmodell = loadFixture("bauwerksmodell-vlrlp.ifc");
  const check = runPortalCheck(document, { importart: "einzelergebnisse", bauwerksmodell });
  assert.ok(check.errorCount >= 5, "unbekannte Bauteil-Referenzen gegen das falsche Bauwerksmodell");
  const topics = collectBcfTopics(document, check.findings, null, { fileName: document.fileName, importart: "einzelergebnisse" });
  assert.equal(topics.length, check.findings.length);
  const first = topics[0]!;
  assert.equal(first.type, "Error", "Fehler zuerst");
  assert.ok(first.title.startsWith("unknown_reference: "), first.title);
  assert.ok(first.components[0]?.ifcGuid?.length === 22, "IfcGuid des betroffenen Elements");
  assert.ok(first.comments.some((line) => line.startsWith("Betroffenes IFC-Objekt")));
  assert.ok(new Set(topics.map((topic) => topic.guid)).size === topics.length, "GUIDs eindeutig");

  const archive = createBcfArchive(document, topics, { fileName: document.fileName, importart: "einzelergebnisse", author: "Test", date: new Date("2026-09-02T10:00:00Z") });
  const entries = readZipEntries(archive);
  const names = entries.map((entry) => entry.name);
  assert.ok(names.includes("bcf.version") && names.includes("project.bcfp"));
  assert.equal(names.filter((name) => name.endsWith("/markup.bcf")).length, topics.length);
  assert.equal(names.filter((name) => name.endsWith("/viewpoint.bcfv")).length, topics.filter((topic) => topic.components.length).length);
  const markup = new TextDecoder().decode(entries.find((entry) => entry.name === `${first.guid}/markup.bcf`)!.data);
  assert.ok(markup.includes(`<Topic Guid="${first.guid}" TopicType="Error" TopicStatus="Open">`));
  assert.ok(markup.includes("<CreationAuthor>Test</CreationAuthor>") && markup.includes("2026-09-02T10:00:00.000Z"));
  const escaped = first.description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  assert.ok(markup.includes(`<Description>${escaped}</Description>`), "Beschreibung XML-maskiert");
  const viewpoint = new TextDecoder().decode(entries.find((entry) => entry.name === `${first.guid}/viewpoint.bcfv`)!.data);
  assert.ok(viewpoint.includes(`IfcGuid="${first.components[0]!.ifcGuid}"`));
  assert.ok(viewpoint.includes(`AuthoringToolId="#${check.findings.find((finding) => finding.severity === "error")!.entityId}"`));
  const projectGuid = document.entitiesByType.get("IFCPROJECT")![0]!.globalId;
  assert.ok(new TextDecoder().decode(entries.find((entry) => entry.name === "project.bcfp")!.data).includes(`ProjectId="${projectGuid}"`));
});

test("Fachobjekt am Klickpunkt: absolute Weltkoordinate wird zur Platzierung", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const result = addFachobjekt(document, { kind: "untersuchungsstelle", importart: "einzelergebnisse", bezeichnung: "Klick", parentId: "6316873.B.Bauwerksdiagnostik_LBM", worldPosition: { x: 32455200.5, y: 5497830.25, z: 95 } });
  assert.ok(result.entityId > 0);
  const world = getNativePlacementWorld(result.document, result.entityId)!;
  assert.ok(Math.abs(world.worldX - 32455200.5) < 1e-3 && Math.abs(world.worldY - 5497830.25) < 1e-3 && Math.abs(world.worldZ - 95) < 1e-3, `${world.worldX}/${world.worldY}/${world.worldZ}`);
});

test("Verfahren: Bereichsliste ↔ Psets der Stellen, Umlaute und Katalognamen gleichwertig", () => {
  assert.equal(normalizeMethodName("Druckfestigkeitsprüfung"), "druckfestigkeitspruefung");
  assert.equal(methodLabelForPset("Druckfestigkeit"), "Druckfestigkeitspruefung");
  assert.equal(methodLabelForPset("Beton Gefuege"), "Betongefuege");
  assert.equal(methodLabelForPset("Kernbohrung"), "Kernbohrung");
  const comparison = compareAreaMethods(
    [{ property: "Untersuchungsverfahren0", value: "Kernbohrung" }, { property: "Untersuchungsverfahren1", value: "Druckfestigkeitsprüfung" }, { property: "Untersuchungsverfahren2", value: "Georadar" }],
    ["Kernbohrung", "Druckfestigkeit", "E-Modul"],
  );
  assert.deepEqual(comparison.unused.map((entry) => entry.value), ["Georadar"]);
  assert.deepEqual(comparison.missing, [{ pset: "E-Modul", label: "Bestimmung E-Modul" }]);

  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const check = runPortalCheck(document, { importart: "einzelergebnisse" });
  const notInArea = check.findings.filter((finding) => finding.code === "editor_method_not_in_area");
  assert.ok(notInArea.some((finding) => finding.pset_name === "E-Modul"), "E-Modul liegt an einer Stelle, kein Bereich nennt es");
  assert.ok(notInArea.every((finding) => finding.severity === "warning" && finding.entityId != null && finding.suggestions?.length));
  assert.ok(!notInArea.some((finding) => finding.pset_name === "Kernbohrung"), "Kernbohrung ist überall genannt");
  assert.ok(notInArea[0]!.message.includes("Bestimmung E-Modul") && notInArea[0]!.message.includes("Pset E-Modul"), notInArea[0]!.message);
  const unused = check.findings.filter((finding) => finding.code === "editor_area_method_unused");
  assert.ok(unused.every((finding) => finding.pset_name?.startsWith("Untersuchungsbereich") && finding.property_name?.startsWith("Untersuchungsverfahren")));
  assert.ok(!unused.some((finding) => normalizeMethodName(finding.value ?? "") === "druckfestigkeitspruefung" && finding.pset_name === "Untersuchungsbereich0"), "VBA04 hat Druckfestigkeit als Pset → kein Befund trotz Umlaut");

  // Bereichs-Chips im Baum: Verfahren der Stellen, aggregiert
  const tree = buildFachmodellTree(document, "einzelergebnisse", check.findings);
  const bereiche = tree.root!.children.find((child) => child.label === "Untersuchungsbereiche")!;
  const vba04 = bereiche.children.find((child) => child.label === "US_F-West_BP_VBA04")!;
  assert.ok(vba04.aspekte.includes("Kernbohrung") && vba04.aspekte.includes("Druckfestigkeit"), vba04.aspekte.join(","));
  assert.ok(!vba04.aspekte.includes("Objektinformation"), "nur Verfahrens-Psets, keine Basis-Psets");
});

test("Tabelle: fehlendes Pset ist kein Leerstand — Zustand „fehlt“, Eingabe oder Anhängen legt es an", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const check = runPortalCheck(document, { importart: "einzelergebnisse" });
  const tree = buildFachmodellTree(document, "einzelergebnisse", check.findings);
  const options = { importart: "einzelergebnisse" as const, scope: { loi: 300 as const, gewerke: [] as string[] }, katalog: katalogFor("einzelergebnisse"), bauwerksmodell: null, findings: check.findings, objektart: "untersuchungsstelle" as const };
  const model = buildTable(document, collectRows(tree.root!), options);
  const emodul = model.groups.find((group) => group.label === "E-Modul")!;
  const withoutEmodul = model.rows.find((row) => !findPset(document, row.entityId, "E-Modul"))!;
  const withEmodul = model.rows.find((row) => findPset(document, row.entityId, "E-Modul"))!;
  const cellsWithout = withoutEmodul.cells.filter((cell) => cell.column.psetPattern === emodul.psetPattern);
  assert.ok(cellsWithout.length && cellsWithout.every((cell) => cell.state === "fehlt"), "ohne Pset: alle Zellen „fehlt“");
  assert.ok(withEmodul.cells.filter((cell) => cell.column.psetPattern === emodul.psetPattern).every((cell) => cell.state !== "fehlt"), "mit Pset: normale Zustände");
  const basis = withoutEmodul.cells.filter((cell) => cell.column.psetPattern === model.groups[0]!.psetPattern);
  assert.ok(basis.every((cell) => cell.state !== "fehlt"), "Portal-Pflicht ist nie „fehlt“");

  // Eingabe in eine „fehlt“-Zelle legt das Pset an
  const column = cellsWithout.find((cell) => cell.column.soft || cell.column.catalog)!.column;
  const written = writeCell(document, withoutEmodul, column, "42", "einzelergebnisse");
  const created = findPset(written, withoutEmodul.entityId, "E-Modul");
  assert.ok(created, "ePset_E-Modul angelegt");
  assert.equal(getValue(created, column.property), "42");

  // Anhängen ohne Wert: leere Katalog-Textfelder, idempotent; Basis-Pset ebenso
  const attached = attachPset(document, withoutEmodul.entityId, emodul.psetPattern, emodul.label, "einzelergebnisse");
  const set = findPset(attached, withoutEmodul.entityId, "E-Modul")!;
  assert.ok(set.values.length >= 1 && set.values.every((value) => value.name.startsWith("_")));
  assert.equal(attachPset(attached, withoutEmodul.entityId, emodul.psetPattern, emodul.label, "einzelergebnisse"), attached);
  const stelleRow = model.rows.find((row) => !findPset(document, row.entityId, "Untersuchungsstelle"));
  if (stelleRow) {
    const withBase = attachPset(document, stelleRow.entityId, "Untersuchungsstelle", "Untersuchungsstelle", "einzelergebnisse");
    assert.ok(findPset(withBase, stelleRow.entityId, "Untersuchungsstelle"), "Basis-Pset aus der Katalogklasse angelegt");
  }
});

test("Rezepte: Upsert schreibt ohne Suffix, Bauteil-Referenz leitet Ebenen ab, Verfahren anhängen ist idempotent", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const point = document.entitiesByType.get("IFCBUILDINGELEMENTPROXY")!.find((entity) => getValue(findPset(document, entity.id, "Objektinformation"), "BauteilID"))!;
  // vorhandene Property (mit Suffix _OI) aktualisieren
  const next = upsertProperty(document, point.id, ["Objektinformationen", "Objektinformation"], "Objektinformation", "Bezeichnung", "Neu", "IFCLABEL", ["BezeichnungUntersuchungsstelle"]);
  assert.notEqual(next, document);
  assert.equal(getValue(findPset(next, point.id, "Objektinformation"), "Bezeichnung"), "Neu");
  // Bauteil-Referenz + Ebenen
  const withBauteil = writeBauteilReference(next, point.id, "6316873.B.Ueberbau.Hohlkasten.Hohlkasten.48", "einzelergebnisse");
  const info = findPset(withBauteil, point.id, "Objektinformation");
  assert.equal(getValue(info, "BauteilID"), "6316873.B.Ueberbau.Hohlkasten.Hohlkasten.48");
  assert.equal(getValue(info, "IDEbene1"), "Ueberbau");
  assert.equal(getValue(info, "IDEbene3"), "Hohlkasten");
  // Verfahren anhängen
  const withMethod = addMethodPset(withBauteil, point.id, "Georadar", "einzelergebnisse");
  const georadar = findPset(withMethod, point.id, "Georadar");
  assert.ok(georadar, "ePset_Georadar angelegt");
  assert.equal(georadar!.name, "ePset_Georadar");
  assert.ok(georadar!.values.every((value) => value.name.startsWith("_") && !/_[A-Z]{2,4}$/.test(value.name)), "Properties ohne Katalogsuffix");
  assert.equal(addMethodPset(withMethod, point.id, "Georadar", "einzelergebnisse"), withMethod, "zweiter Aufruf ändert nichts");
  // neues Pset bei fehlendem Pset
  const fresh = upsertProperty(withMethod, point.id, ["Messfeld\\d*"], "Messfeld0", "ID", "x.y", "IFCLABEL");
  assert.equal(findPset(fresh, point.id, "Messfeld\\d*")?.name, "ePset_Messfeld0");
});

test("updateNativePropertyValue behält den Property-Namen, auch ohne name in updates", () => {
  const document = loadFixture("diagnostik-einzelergebnisse.ifc");
  const point = document.entitiesByType.get("IFCBUILDINGELEMENTPROXY")!.find((entity) => getValue(findPset(document, entity.id, "Objektinformation"), "BauteilID"))!;
  const set = findPset(document, point.id, "Objektinformation")!;
  const hit = getProperty(set, "Bezeichnung", "BezeichnungUntersuchungsstelle")!;
  const next = updateNativePropertyValue(document, hit.propertyId, { value: "Neu" });
  const entity = next.entityById.get(hit.propertyId)!;
  assert.equal(entity.args[0], `'${hit.rawName}'`, "Name bleibt in args[0]");
  assert.equal(getValue(findPset(next, point.id, "Objektinformation"), "Bezeichnung"), "Neu");
});

test("Befundtexte: wörtlich wie das Portal-Frontend", () => {
  assert.equal(
    formatPortalMessage({ code: "missing_required_property", pset_name: "Objektinformation", property_name: "BauteilID" }),
    "Das Pflichtfeld 'BauteilID' im PSet 'Objektinformation' fehlt oder ist leer. Bitte den Wert in der IFC-Datei ergänzen.",
  );
  assert.equal(
    formatPortalMessage({ code: "unassignable_element", import_role: "Planung (A)", reason: "component_reference_missing", pset_name: "Objektinformation", property_name: "BauteilID" }),
    "Das 3D-Element kann der gewählten Importart 'Planung (A)' nicht zugeordnet werden. Im PSet 'Objektinformation' fehlt die Bauteil-Referenz 'BauteilID' oder sie ist leer.",
  );
  const document = loadFixture("monitoring-lbm.ifc");
  const building = document.entitiesByType.get("IFCBUILDING")![0]!;
  assert.ok(findPset(document, building.id, "Projekt"));
});
