/**
 * M3-Verifikation Objektkatalog: Portierung der relevanten Fälle aus
 * 1.x `tests/catalog.test.ts` gegen die 2.0-Portierung
 * (`src/domain/catalog/**`), plus die beiden Neuerungen:
 *  - Katalogklasse → IDS-1.0-Dokument (Gegenprobe mit @ifc-lite/ids)
 *  - Quick-Fix „add-pset-properties" gegen ein IfcCreator-Modell
 *
 * Die Arbeitsmappen entstehen im Test mit `xlsx.utils` — wie in 1.x. Die
 * Kopfzeilen sind als „|"-Listen notiert, damit die Spaltenpositionen (die
 * der Parser hart adressiert) auf einen Blick lesbar bleiben.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { IfcCreator } from "@ifc-lite/create";
import { auditIDSDocument, parseIDS } from "@ifc-lite/ids";
import { ModelSession } from "../src/core/session";
import { cmdCatalogQuickFix } from "../src/domain/catalog/commands";
import { parseCatalogWorkbook } from "../src/domain/catalog/excel";
import { buildCatalogIds, catalogIdsFileName } from "../src/domain/catalog/ids";
import type { CatalogObjectType } from "../src/domain/catalog/model";
import { validateEntityAgainstCatalogObject } from "../src/domain/catalog/validation";

// — Fixtures —

const cols = (line: string): string[] => line.split("|");

const SHEET_HEADER = cols(
  "Merkmalsliste|Merkmal|Datentyp|Format|Einheit|Eintrag|TM UP|TM EE|TM UE|Level of Information",
);
const MASTER_HEADER = cols(
  "Element|Merkmal (Property) DEUTSCH|Merkmalsgruppe (Kategorie: PropertySet)|Herkunft|TM UP|TM EE|TM UE|LoI 100|LoI 200|LoI 300|LoI 400|LoI 500|Datentyp IFC|IFC-Typ|Format|Format Allplan|Einheit*|Eintrag",
);
const MONITORING_HEADER = cols(
  "Element|Merkmal (Property) Ausgabe|Rohtext für Attribuierung|Merkmal (Property) Allplan|Merkmalsgruppe (Kategorie: PropertySet)|Herkunft|TM MEKO|TM INSP|TM INSD|LoI 100|LoI 200|LoI 300|LoI 400|LoI 500|Datentyp IFC|IFC-Klasse|Format|Format Allplan|Eintrag|Beispiel*",
);
const CLASS_TABLE_HEADER = cols(
  "Klasse / Domäne (Kurztext)|Bezeichnung|Version|Status|Datum letzte Änderung|Bearbeiter:in|Klasse / Domäne (Langtext)",
);

const PAD = (count: number): string[] => Array(count).fill("");

/** Arbeitsmappe aus [Sheet-Name, Zeilen]-Paaren. */
function workbookOf(...sheets: Array<[string, unknown[][]]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

/** Diagnostik-Mappe mit einem Klassen-Sheet (ohne Master-Sheets). */
const classSheetWorkbook = (): ArrayBuffer =>
  workbookOf(
    [
      "Testwand",
      [
        ['Merkmalsgruppe "Klasse"', "Testwand", "BWD - TW", ...PAD(11), "V001"],
        ["IFC-Klassifikation", "IfcWall"],
        SHEET_HEADER,
        ["(Propertyset)", "(Property)", ...PAD(7), "LoI 100"],
        ["ePset_Test", "_Status_TW", "ifcLabel", "Text", "ohne", "erforderlich", "X", "X", "-", "X"],
        ["ePset_Test", "_Breite_TW", "IfcReal", "Fliesskommazahl", "m", "erforderlich", "X", "X", "-", "X"],
      ],
    ],
    ["Pset_Test", [["Pset Name", "ePset_Test", ...PAD(12), "V001"]]],
  );

/** Klassen-Sheet mit veralteter Merkmalsliste + führendem Master-Sheet. */
const staleClassSheetWorkbook = (): ArrayBuffer =>
  workbookOf(
    [
      "Chloridanalyse",
      [
        ['Merkmalsgruppe "Klasse"', "Chloridanalyse", "BWD - CA", ...PAD(11), "V001"],
        ["IFC-Klassifikation", "IfcBuildingElementProxy"],
        SHEET_HEADER,
        ["(Propertyset)", "(Property)", ...PAD(7), "LoI 100"],
        ["ePset_Ultraschall", "_Datum_USM", "ifcLabel", "Text", "ohne", "erforderlich", "X", "X", "-", "X"],
      ],
    ],
    [
      "Alle Merkmale (Propertys)",
      [
        MASTER_HEADER,
        ["Proxy", "_Chloridanalyse_CA", "ePset_Chloridgehalt", "openSIM", "X", "X", "-", "-", "-", "X", "X", "X", "Text", "ifcLabel", "[Text]", "Text", "ohne", "erforderlich"],
        ["Proxy", "_Datum_CA", "ePset_Chloridgehalt", "openSIM", "-", "X", "-", "-", "-", "X", "X", "X", "Text", "ifcLabel", "[Datum]", "Datum", "ohne", "erforderlich"],
      ],
    ],
  );

/** Diagnostik-Mappe mit beiden Master-Sheets. */
const centralTablesWorkbook = (): ArrayBuffer =>
  workbookOf(
    [
      "Übersicht Klassen+Domänen",
      [
        CLASS_TABLE_HEADER,
        ["Untersuchungsstelle", "BWD - US", "V001", "F", "", "MKP", "US"],
        ["Untersuchungsbereich", "BWD - UB", "V001", "F", "", "MKP", "UB"],
      ],
    ],
    [
      "Alle Merkmale (Propertys)",
      [
        MASTER_HEADER,
        ["Proxy", "_Bezeichnung_UZ", "ePset_Untersuchungsziel", "openSIM", "X", "X", "X", "-", "X", "X", "X", "X", "Text", "ifcLabel", "[Text]", "Text", "ohne", "erforderlich"],
        ["Proxy", "_AnzahlProben_US", "ePset_Untersuchungsstelle", "openSIM", "X", "X", "-", "X", "X", "X", "X", "X", "Count", "IfcReal", "-", "Ganzzahl", "ohne", "erforderlich"],
        ["Proxy", "_Bauteil_US", "ePset_Untersuchungsstelle", "openSIM", "X", "X", "-", "-", "X", "X", "X", "X", "Text", "ifcLabel", "[Text]", "Text", "ohne", "erforderlich"],
        ["Proxy", "_ID_UB", "ePset_Untersuchungsbereich", "openSIM", "X", "X", "X", "-", "X", "X", "X", "X", "Text", "ifcLabel", "[Text]", "Text", "ohne", "erforderlich"],
      ],
    ],
  );

/** Monitoring-Mappe (ein Merkmals-Sheet, Klassen aus der Element-Spalte). */
const monitoringWorkbook = (): ArrayBuffer =>
  workbookOf([
    "Alle Merkmale (Propertys)",
    [
      MONITORING_HEADER,
      ["Building", "_Bauwerksnummer", "Bauwerksnummer", "_Bauwerksnummer_BW", "ePset_Bauwerk", "Nibli", "X", "X", "X", "X", "X", "X", "X", "X", "IfcReal", "IfcBuilding", "-", "Ganzzahl", "erforderlich", "05387"],
      ["Building", "_ID", "ID", "_ID_MAßN", "ePset_MaßnahmeN", "Nibli", "X", "X", "X", "X", "X", "X", "X", "X", "IfcText", "IfcBuilding", "-", "Text", "erforderlich", ""],
      ["Sensor", "_ID", "ID", "_ID_K", "ePset_KanalN", "Nibli", "X", "X", "X", "-", "X", "X", "X", "X", "IfcText", "IfcElementProxy", "-", "Text", "erforderlich", ""],
      // Changelog-Zeile ohne Element muss ignoriert werden.
      ["", "Update zur vorherigen Version", ...PAD(7)],
    ],
  ]);

const testwand = (): CatalogObjectType =>
  parseCatalogWorkbook(classSheetWorkbook(), "katalog.xlsx").objectTypes[0];

// — Parser —

describe("M3: Katalog-Import (Diagnostik)", () => {
  it("liest Klassen-Sheets mit Merkmalsliste", () => {
    const catalog = parseCatalogWorkbook(classSheetWorkbook(), "katalog.xlsx");
    expect(catalog.kind).toBe("diagnostik");
    expect(catalog.objectTypes).toHaveLength(1);
    const objectType = catalog.objectTypes[0];
    expect(objectType.name).toBe("Testwand");
    expect(objectType.code).toBe("BWD - TW");
    expect(objectType.ifcClass).toBe("IFCWALL");
    expect(objectType.propertyRules.map((rule) => rule.valueType)).toEqual([
      "IFCLABEL",
      "IFCREAL",
    ]);
    expect(objectType.propertyRules[0].psetName).toBe("ePset_Test");
    expect(objectType.propertyRules[0].requirement).toBe("required");
    expect(objectType.propertyRules[0].loiMarkers["LoI 100"]).toBe(true);
    expect(objectType.propertyRules[0].tradeMarkers["TM UE"]).toBe(false);
    expect(objectType.propertyRules[1].unit).toBe("m");
  });

  it("bevorzugt die Master-Merkmalsliste über das Code-Kürzel", () => {
    const catalog = parseCatalogWorkbook(staleClassSheetWorkbook(), "katalog.xlsx");
    const objectType = catalog.objectTypes[0];
    expect(objectType.name).toBe("Chloridanalyse");
    expect(objectType.code).toBe("BWD - CA");
    expect(objectType.propertyRules.map((rule) => rule.propertyName)).toEqual([
      "_Chloridanalyse_CA",
      "_Datum_CA",
    ]);
    expect(
      objectType.propertyRules.every((rule) => rule.psetName === "ePset_Chloridgehalt"),
    ).toBe(true);
  });

  it("importiert zentrale Klassen- und Merkmalstabellen", () => {
    const catalog = parseCatalogWorkbook(centralTablesWorkbook(), "katalog.xlsx");
    const byCode = (code: string) =>
      catalog.objectTypes.find((objectType) => objectType.code === code);
    expect(catalog.objectTypes.map((objectType) => objectType.code)).toEqual(
      expect.arrayContaining(["BWD - US", "BWD - UB", "BWD - UZ"]),
    );
    expect(
      catalog.objectTypes.every((o) => o.ifcClass === "IFCBUILDINGELEMENTPROXY"),
    ).toBe(true);
    // BWD - UZ steht nur in der Merkmalsliste und wird daraus nachgezogen.
    expect(byCode("BWD - UZ")?.id).toBe("bwd-uz");
    expect(byCode("BWD - UZ")?.name).toBe("Untersuchungsziel");
    expect(byCode("BWD - UZ")?.sheetName).toBe("Alle Merkmale (Propertys)");
    expect(byCode("BWD - UZ")?.propertyRules).toHaveLength(1);
    expect(byCode("BWD - US")?.propertyRules).toHaveLength(2);
    expect(byCode("BWD - UB")?.propertyRules).toHaveLength(1);
  });
});

describe("M3: Katalog-Import (Monitoring)", () => {
  it("gruppiert Monitoring-Objekte je Merkmalsgruppe", () => {
    const catalog = parseCatalogWorkbook(monitoringWorkbook(), "monitoring.xlsx");
    expect(catalog.kind).toBe("monitoring");
    expect(catalog.objectTypes).toHaveLength(3);
    expect(catalog.objectTypes.map((objectType) => objectType.name).sort()).toEqual([
      "Bauwerk",
      "Kanal",
      "Maßnahme",
    ]);

    const bauwerk = catalog.objectTypes.find((o) => o.name === "Bauwerk");
    expect(bauwerk?.code).toBe("MON - BW");
    expect(bauwerk?.ifcClass).toBe("IFCBUILDING");
    expect(bauwerk?.propertyRules).toHaveLength(1);
    expect(bauwerk?.propertyRules[0].psetName).toBe("ePset_Bauwerk");
    expect(bauwerk?.propertyRules[0].propertyName).toBe("_Bauwerksnummer_BW");
    expect(bauwerk?.propertyRules[0].valueType).toBe("IFCREAL");
    expect(bauwerk?.propertyRules[0].requirement).toBe("required");
    expect(bauwerk?.propertyRules[0].tradeMarkers["TM MEKO"]).toBe(true);

    const kanal = catalog.objectTypes.find((o) => o.name === "Kanal");
    expect(kanal?.code).toBe("MON - K");
    expect(kanal?.ifcClass).toBe("IFCELEMENTPROXY");
    expect(kanal?.propertyRules[0].valueType).toBe("IFCTEXT");
  });

  it("respektiert eine erzwungene Variante", () => {
    const catalog = parseCatalogWorkbook(
      monitoringWorkbook(),
      "monitoring.xlsx",
      "diagnostik",
    );
    expect(catalog.kind).toBe("diagnostik");
    expect(catalog.objectTypes).toHaveLength(0);
    expect(catalog.diagnostics.join(" ")).toContain("Keine Klassen-Sheets");
  });
});

// — IDS-Generator —

describe("M3: Katalogklasse → IDS 1.0", () => {
  it("erzeugt wohlgeformtes IDS mit Entity- und Property-Facetten", async () => {
    const xml = buildCatalogIds(testwand(), { date: "2026-01-01" });
    expect(xml).toContain('xmlns="http://standards.buildingsmart.org/IDS"');

    const document = parseIDS(xml);
    expect(document.specifications).toHaveLength(1);
    const spec = document.specifications[0];
    expect(spec.identifier).toBe("bwd-tw");
    expect(spec.ifcVersions).toEqual(["IFC4"]);

    const entity = spec.applicability.facets[0];
    if (entity.type !== "entity") throw new Error("Entity-Facette erwartet");
    expect(entity.name).toEqual({ type: "simpleValue", value: "IFCWALL" });

    expect(spec.requirements).toHaveLength(2);
    expect(spec.requirements.every((r) => r.optionality === "required")).toBe(true);
    const property = (index: number) => {
      const facet = spec.requirements[index].facet;
      if (facet.type !== "property") throw new Error("Property-Facette erwartet");
      return facet;
    };
    expect(property(0).propertySet).toEqual({ type: "simpleValue", value: "ePset_Test" });
    expect(property(0).baseName).toEqual({ type: "simpleValue", value: "_Status_TW" });
    expect(property(0).dataType).toEqual({ type: "simpleValue", value: "IFCLABEL" });
    expect(property(1).baseName).toEqual({ type: "simpleValue", value: "_Breite_TW" });
    expect(property(1).dataType).toEqual({ type: "simpleValue", value: "IFCREAL" });

    // Gegenprobe mit dem IDS-Auditor: keine strukturellen Fehler.
    const audit = await auditIDSDocument(xml);
    expect(
      audit.issues.filter(
        (issue) =>
          issue.severity === "error" &&
          (issue.code.startsWith("E_PARSE") || issue.code.startsWith("E_XSD")),
      ),
    ).toEqual([]);
  });

  it("filtert nach LoI-Stufe und benennt die Datei nach der Klasse", () => {
    const type = testwand();
    // Beide Merkmale tragen nur LoI 100.
    const loi100 = parseIDS(buildCatalogIds(type, { loi: "LoI 100" }));
    expect(loi100.specifications[0].requirements).toHaveLength(2);
    const loi500 = parseIDS(buildCatalogIds(type, { loi: "LoI 500" }));
    expect(loi500.specifications[0].requirements).toHaveLength(0);
    expect(catalogIdsFileName(type)).toBe("Testwand.ids");
  });
});

// — Validierung + Quick-Fix gegen ein echtes Modell —

async function wallSession(): Promise<{ session: ModelSession; wallId: number }> {
  const creator = new IfcCreator({ Name: "M3-Katalogprobe" });
  const storey = creator.addIfcBuildingStorey({ Name: "Erdgeschoss", Elevation: 0 });
  creator.addIfcWall(storey, {
    Name: "Testwand",
    Start: [0, 0, 0],
    End: [5, 0, 0],
    Thickness: 0.2,
    Height: 3,
  });
  const bytes = new TextEncoder().encode(creator.toIfc().content);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const session = await ModelSession.open("m3.ifc", buffer);
  const wallId = (session.store.entityIndex.byType.get("IFCWALL") ?? [])[0];
  expect(wallId).toBeGreaterThan(0);
  return { session, wallId };
}

describe("M3: Prüfung gegen die Katalogklasse", () => {
  it("meldet fehlende Merkmalsgruppe und Klassifikation", async () => {
    const { session, wallId } = await wallSession();
    const findings = validateEntityAgainstCatalogObject(session, wallId, testwand());

    // IFC-Klasse passt (IfcWall), also kein class-mismatch.
    expect(findings.some((entry) => entry.kind === "class-mismatch")).toBe(false);
    const missingPset = findings.find((entry) => entry.kind === "missing-pset");
    expect(missingPset?.severity).toBe("error");
    expect(missingPset?.quickFix?.kind).toBe("add-pset-properties");
    // Entscheidung: Klassifikation ist reine Anzeige, kein Quick-Fix.
    const classification = findings.find(
      (entry) => entry.kind === "missing-classification",
    );
    expect(classification).toBeDefined();
    expect(classification?.quickFix).toBeUndefined();
  });

  it("Quick-Fix add-pset-properties besteht die Re-Validierung", async () => {
    const { session, wallId } = await wallSession();
    const objectType = testwand();
    const missingPset = validateEntityAgainstCatalogObject(
      session,
      wallId,
      objectType,
    ).find((entry) => entry.kind === "missing-pset");
    if (!missingPset) throw new Error("missing-pset erwartet");

    const command = cmdCatalogQuickFix(session, missingPset);
    expect(command).not.toBeNull();
    command?.run();

    const pset = session.view
      .getForEntity(wallId)
      .find((entry) => entry.name === "ePset_Test");
    expect(pset?.properties.map((property) => property.name)).toEqual([
      "_Status_TW",
      "_Breite_TW",
    ]);

    // Struktur-Befunde sind weg; offen bleibt nur der Hinweis auf den noch
    // leeren Textwert und die (nicht behebbare) Klassifikation.
    const after = validateEntityAgainstCatalogObject(session, wallId, objectType);
    expect(after.filter((entry) => entry.kind === "missing-pset")).toEqual([]);
    expect(after.filter((entry) => entry.kind === "missing-property")).toEqual([]);
    expect(after.filter((entry) => entry.kind === "property-type-mismatch")).toEqual([]);
    expect(after.filter((entry) => entry.severity === "error")).toEqual([]);

    // Undo stellt den Ausgangszustand wieder her.
    command?.undo();
    expect(
      validateEntityAgainstCatalogObject(session, wallId, objectType).some(
        (entry) => entry.kind === "missing-pset",
      ),
    ).toBe(true);
  });
});
