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
