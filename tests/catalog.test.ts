import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import { parseCatalogWorkbook } from "../src/ifc/catalogExcel";
import {
    applyCatalogQuickFix,
    validateEntityAgainstCatalogObject,
} from "../src/ifc/catalogValidation";
import {
    addNativeElement,
    addNativeEmptyPropertySet,
    addNativePropertyToSet,
    createNativeSampleDocument,
} from "../src/ifc/nativeDocument";

test("catalog workbook parser imports object class sheets", () => {
  const catalog = parseCatalogWorkbook(createCatalogWorkbook(), "catalog.xlsx");

  assert.equal(catalog.objectTypes.length, 1);
  assert.equal(catalog.objectTypes[0].name, "Testwand");
  assert.equal(catalog.objectTypes[0].code, "BWD - TW");
  assert.equal(catalog.objectTypes[0].ifcClass, "IFCWALL");
  assert.equal(catalog.objectTypes[0].propertyRules.length, 2);
  assert.equal(catalog.objectTypes[0].propertyRules[0].psetName, "ePset_Test");
  assert.equal(catalog.objectTypes[0].propertyRules[0].valueType, "IFCLABEL");
  assert.equal(catalog.objectTypes[0].propertyRules[1].valueType, "IFCREAL");
});

test("catalog parser prefers master property rows by object code suffix", () => {
  const catalog = parseCatalogWorkbook(
    createCatalogWorkbookWithStaleClassSheet(),
    "catalog.xlsx",
  );

  const objectType = catalog.objectTypes[0];
  assert.equal(objectType.name, "Chloridanalyse");
  assert.equal(objectType.code, "BWD - CA");
  assert.deepEqual(
    objectType.propertyRules.map((rule) => rule.psetName),
    ["ePset_Chloridgehalt", "ePset_Chloridgehalt"],
  );
  assert.deepEqual(
    objectType.propertyRules.map((rule) => rule.propertyName),
    ["_Chloridanalyse_CA", "_Datum_CA"],
  );
});

test("catalog parser imports central class and property tables", () => {
  const catalog = parseCatalogWorkbook(
    createCatalogWorkbookWithCentralTables(),
    "catalog.xlsx",
  );

  const codes = catalog.objectTypes.map((objectType) => objectType.code);
  assert.ok(codes.includes("BWD - UZ"));
  assert.ok(codes.includes("BWD - US"));
  assert.ok(codes.includes("BWD - UB"));
  assert.ok(
    catalog.objectTypes.every(
      (objectType) => objectType.ifcClass === "IFCBUILDINGELEMENTPROXY",
    ),
  );
  const uz = catalog.objectTypes.find(
    (objectType) => objectType.code === "BWD - UZ",
  );
  const us = catalog.objectTypes.find(
    (objectType) => objectType.code === "BWD - US",
  );
  const ub = catalog.objectTypes.find(
    (objectType) => objectType.code === "BWD - UB",
  );
  assert.equal(uz?.id, "bwd-uz");
  assert.equal(uz?.sheetName, "Alle Merkmale (Propertys)");
  assert.equal(uz?.name, "Untersuchungsziel");
  assert.equal(uz?.propertyRules.length, 1);
  assert.equal(us?.propertyRules.length, 2);
  assert.equal(ub?.propertyRules.length, 1);
});

test("catalog parser groups monitoring objects by property set", () => {
  const catalog = parseCatalogWorkbook(
    createMonitoringWorkbook(),
    "monitoring.xlsx",
  );

  assert.equal(catalog.kind, "monitoring");
  // One object class per Merkmalsgruppe (pset), not per IFC element.
  assert.equal(catalog.objectTypes.length, 3);
  // Display names drop the (e)Pset_ prefix and a trailing plural "N".
  assert.deepEqual(
    catalog.objectTypes.map((objectType) => objectType.name).sort(),
    ["Bauwerk", "Kanal", "Maßnahme"],
  );

  const bauwerk = catalog.objectTypes.find(
    (objectType) => objectType.name === "Bauwerk",
  );
  assert.ok(bauwerk);
  assert.equal(bauwerk.code, "MON - BW");
  assert.equal(bauwerk.ifcClass, "IFCBUILDING");
  assert.equal(bauwerk.propertyRules.length, 1);
  assert.equal(bauwerk.propertyRules[0].psetName, "ePset_Bauwerk");
  assert.equal(bauwerk.propertyRules[0].propertyName, "_Bauwerksnummer_BW");
  assert.equal(bauwerk.propertyRules[0].valueType, "IFCREAL");
  assert.equal(bauwerk.propertyRules[0].requirement, "required");
  assert.equal(bauwerk.propertyRules[0].tradeMarkers["TM MEKO"], true);

  const kanal = catalog.objectTypes.find(
    (objectType) => objectType.name === "Kanal",
  );
  assert.ok(kanal);
  assert.equal(kanal.code, "MON - K");
  assert.equal(kanal.ifcClass, "IFCELEMENTPROXY");
  assert.equal(kanal.propertyRules[0].valueType, "IFCTEXT");
});

test("catalog parser honours an explicit monitoring kind override", () => {
  // The diagnostics fixture would otherwise auto-detect as diagnostik.
  const catalog = parseCatalogWorkbook(
    createMonitoringWorkbook(),
    "monitoring.xlsx",
    "diagnostik",
  );
  assert.equal(catalog.kind, "diagnostik");
  assert.equal(catalog.objectTypes.length, 0);
});

test("catalog validation can quick-fix missing psets and classification", () => {
  const catalog = parseCatalogWorkbook(createCatalogWorkbook(), "catalog.xlsx");
  const objectType = catalog.objectTypes[0];
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withWall = addNativeElement(sample, storey.id, "IFCWALL", "Testwand");
  const wall = withWall.entities.find(
    (entity) => entity.type === "IFCWALL" && entity.name === "Testwand",
  );
  assert.ok(wall);

  const findings = validateEntityAgainstCatalogObject(
    withWall,
    wall.id,
    objectType,
  );
  const missingPset = findings.find(
    (finding) => finding.kind === "missing-pset",
  );
  const missingClassification = findings.find(
    (finding) => finding.kind === "missing-classification",
  );
  assert.ok(missingPset?.quickFix);
  assert.ok(missingClassification?.quickFix);

  const withPset = applyCatalogQuickFix(withWall, wall.id, missingPset);
  const pset = withPset.propertySetsByEntity
    .get(wall.id)
    ?.find((set) => set.name === "ePset_Test");
  assert.ok(pset);
  assert.deepEqual(
    pset.values.map((value) => value.name),
    ["_Status_TW", "_Breite_TW"],
  );

  const withClassification = applyCatalogQuickFix(
    withPset,
    wall.id,
    missingClassification,
  );
  assert.ok(
    withClassification.resourcesByEntity
      .get(wall.id)
      ?.some((resource) => resource.includes("BWD - TW")),
  );
});

test("native pset table helpers create empty sets and append rows", () => {
  const sample = createNativeSampleDocument();
  const storey = sample.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey);
  const withWall = addNativeElement(sample, storey.id, "IFCWALL", "Table Wall");
  const wall = withWall.entities.find(
    (entity) => entity.type === "IFCWALL" && entity.name === "Table Wall",
  );
  assert.ok(wall);

  const withEmptyPset = addNativeEmptyPropertySet(
    withWall,
    wall.id,
    "Pset_Table",
  );
  const emptyPset = withEmptyPset.propertySetsByEntity
    .get(wall.id)
    ?.find((set) => set.name === "Pset_Table");
  assert.ok(emptyPset);
  assert.equal(emptyPset.values.length, 0);

  const withRow = addNativePropertyToSet(
    withEmptyPset,
    emptyPset.id,
    "Status",
    "Reviewed",
    "IFCLABEL",
  );
  const updatedPset = withRow.propertySetsByEntity
    .get(wall.id)
    ?.find((set) => set.name === "Pset_Table");
  assert.ok(updatedPset);
  assert.equal(updatedPset.values[0].name, "Status");
  assert.equal(updatedPset.values[0].value, "IFCLABEL('Reviewed')");
});

function createCatalogWorkbook() {
  const workbook = XLSX.utils.book_new();
  const objectSheet = XLSX.utils.aoa_to_sheet([
    [
      'Merkmalsgruppe "Klasse"',
      "Testwand",
      "BWD - TW",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "V001",
    ],
    ["IFC-Klassifikation", "IfcWall"],
    [
      "Merkmalsliste",
      "Merkmal",
      "Datentyp",
      "Format",
      "Einheit",
      "Eintrag",
      "TM UP",
      "TM EE",
      "TM UE",
      "Level of Information",
    ],
    ["(Propertyset)", "(Property)", "", "", "", "", "", "", "", "LoI 100"],
    [
      "ePset_Test",
      "_Status_TW",
      "ifcLabel",
      "Text",
      "ohne",
      "erforderlich",
      "X",
      "X",
      "-",
      "X",
    ],
    [
      "ePset_Test",
      "_Breite_TW",
      "IfcReal",
      "Fliesskommazahl",
      "m",
      "erforderlich",
      "X",
      "X",
      "-",
      "X",
    ],
  ]);
  const ignoredSheet = XLSX.utils.aoa_to_sheet([
    [
      "Pset Name",
      "ePset_Test",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "V001",
    ],
  ]);
  XLSX.utils.book_append_sheet(workbook, objectSheet, "Testwand");
  XLSX.utils.book_append_sheet(workbook, ignoredSheet, "Pset_Test");
  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
}

function createCatalogWorkbookWithStaleClassSheet() {
  const workbook = XLSX.utils.book_new();
  const objectSheet = XLSX.utils.aoa_to_sheet([
    [
      'Merkmalsgruppe "Klasse"',
      "Chloridanalyse",
      "BWD - CA",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "V001",
    ],
    ["IFC-Klassifikation", "IfcBuildingElementProxy"],
    [
      "Merkmalsliste",
      "Merkmal",
      "Datentyp",
      "Format",
      "Einheit",
      "Eintrag",
      "TM UP",
      "TM EE",
      "TM UE",
      "Level of Information",
    ],
    ["(Propertyset)", "(Property)", "", "", "", "", "", "", "", "LoI 100"],
    [
      "ePset_Ultraschall",
      "_Datum_USM",
      "ifcLabel",
      "Text",
      "ohne",
      "erforderlich",
      "X",
      "X",
      "-",
      "X",
    ],
  ]);
  const masterSheet = XLSX.utils.aoa_to_sheet([
    [
      "Element",
      "Merkmal (Property) DEUTSCH",
      "Merkmalsgruppe (Kategorie: PropertySet)",
      "Herkunft",
      "TM UP",
      "TM EE",
      "TM UE",
      "LoI 100",
      "LoI 200",
      "LoI 300",
      "LoI 400",
      "LoI 500",
      "Datentyp IFC",
      "IFC-Typ",
      "Format",
      "Format Allplan",
      "Einheit*",
      "Eintrag",
    ],
    [
      "Proxy",
      "_Chloridanalyse_CA",
      "ePset_Chloridgehalt",
      "openSIM",
      "X",
      "X",
      "-",
      "-",
      "-",
      "X",
      "X",
      "X",
      "Text",
      "ifcLabel",
      "[Text]",
      "Text",
      "ohne",
      "erforderlich",
    ],
    [
      "Proxy",
      "_Datum_CA",
      "ePset_Chloridgehalt",
      "openSIM",
      "-",
      "X",
      "-",
      "-",
      "-",
      "X",
      "X",
      "X",
      "Text",
      "ifcLabel",
      "[Datum]",
      "Datum",
      "ohne",
      "erforderlich",
    ],
  ]);
  XLSX.utils.book_append_sheet(workbook, objectSheet, "Chloridanalyse");
  XLSX.utils.book_append_sheet(
    workbook,
    masterSheet,
    "Alle Merkmale (Propertys)",
  );
  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
}

function createMonitoringWorkbook() {
  const workbook = XLSX.utils.book_new();
  const propertySheet = XLSX.utils.aoa_to_sheet([
    [
      "Element",
      "Merkmal (Property) Ausgabe",
      "Rohtext für Attribuierung",
      "Merkmal (Property) Allplan",
      "Merkmalsgruppe (Kategorie: PropertySet)",
      "Herkunft",
      "TM MEKO",
      "TM INSP",
      "TM INSD",
      "LoI 100",
      "LoI 200",
      "LoI 300",
      "LoI 400",
      "LoI 500",
      "Datentyp IFC",
      "IFC-Klasse",
      "Format",
      "Format Allplan",
      "Eintrag",
      "Beispiel*",
    ],
    [
      "Building",
      "_Bauwerksnummer",
      "Bauwerksnummer",
      "_Bauwerksnummer_BW",
      "ePset_Bauwerk",
      "Nibli",
      "X",
      "X",
      "X",
      "X",
      "X",
      "X",
      "X",
      "X",
      "IfcReal",
      "IfcBuilding",
      "-",
      "Ganzzahl",
      "erforderlich",
      "05387",
    ],
    [
      "Building",
      "_ID",
      "ID",
      "_ID_MAßN",
      "ePset_MaßnahmeN",
      "Nibli",
      "X",
      "X",
      "X",
      "X",
      "X",
      "X",
      "X",
      "X",
      "IfcText",
      "IfcBuilding",
      "-",
      "Text",
      "erforderlich",
      "",
    ],
    [
      "Sensor",
      "_ID",
      "ID",
      "_ID_K",
      "ePset_KanalN",
      "Nibli",
      "X",
      "X",
      "X",
      "-",
      "X",
      "X",
      "X",
      "X",
      "IfcText",
      "IfcElementProxy",
      "-",
      "Text",
      "erforderlich",
      "",
    ],
    // Trailing changelog noise without an Element must be ignored.
    ["", "Update zur vorherigen Version", "", "", "", "", "", "", ""],
  ]);
  XLSX.utils.book_append_sheet(
    workbook,
    propertySheet,
    "Alle Merkmale (Propertys)",
  );
  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
}

function createCatalogWorkbookWithCentralTables() {
  const workbook = XLSX.utils.book_new();
  const classSheet = XLSX.utils.aoa_to_sheet([
    [
      "Klasse / Domäne (Kurztext)",
      "Bezeichnung",
      "Version",
      "Status",
      "Datum letzte Änderung",
      "Bearbeiter:in",
      "Klasse / Domäne (Langtext)",
    ],
    ["Untersuchungsstelle", "BWD - US", "V001", "F", "", "MKP", "US"],
    ["Untersuchungsbereich", "BWD - UB", "V001", "F", "", "MKP", "UB"],
  ]);
  const masterSheet = XLSX.utils.aoa_to_sheet([
    [
      "Element",
      "Merkmal (Property) DEUTSCH",
      "Merkmalsgruppe (Kategorie: PropertySet)",
      "Herkunft",
      "TM UP",
      "TM EE",
      "TM UE",
      "LoI 100",
      "LoI 200",
      "LoI 300",
      "LoI 400",
      "LoI 500",
      "Datentyp IFC",
      "IFC-Typ",
      "Format",
      "Format Allplan",
      "Einheit*",
      "Eintrag",
    ],
    [
      "Proxy",
      "_Bezeichnung_UZ",
      "ePset_Untersuchungsziel",
      "openSIM",
      "X",
      "X",
      "X",
      "-",
      "X",
      "X",
      "X",
      "X",
      "Text",
      "ifcLabel",
      "[Text]",
      "Text",
      "ohne",
      "erforderlich",
    ],
    [
      "Proxy",
      "_AnzahlProben_US",
      "ePset_Untersuchungsstelle",
      "openSIM",
      "X",
      "X",
      "-",
      "X",
      "X",
      "X",
      "X",
      "X",
      "Count",
      "IfcReal",
      "-",
      "Ganzzahl",
      "ohne",
      "erforderlich",
    ],
    [
      "Proxy",
      "_Bauteil_US",
      "ePset_Untersuchungsstelle",
      "openSIM",
      "X",
      "X",
      "-",
      "-",
      "X",
      "X",
      "X",
      "X",
      "Text",
      "ifcLabel",
      "[Text]",
      "Text",
      "ohne",
      "erforderlich",
    ],
    [
      "Proxy",
      "_ID_UB",
      "ePset_Untersuchungsbereich",
      "openSIM",
      "X",
      "X",
      "X",
      "-",
      "X",
      "X",
      "X",
      "X",
      "Text",
      "ifcLabel",
      "[Text]",
      "Text",
      "ohne",
      "erforderlich",
    ],
  ]);
  XLSX.utils.book_append_sheet(
    workbook,
    classSheet,
    "Übersicht Klassen+Domänen",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    masterSheet,
    "Alle Merkmale (Propertys)",
  );
  return XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
}
