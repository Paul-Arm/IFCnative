import assert from "node:assert/strict";
import test from "node:test";

import {
    describeFacet,
    describeFacetBodySegments,
    describeValue,
    expandXsdPattern,
    stringifySegments,
    validateIds,
    valueMatches,
    type IdsDocumentModel,
    type IdsSpecification,
    type IdsValue,
} from "../src/ifc/ids";
import { parseNativeIfcText } from "../src/ifc/nativeDocument";

const IDS_TEST_IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('ids-test.ifc','2026-08-28T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('Proj0000000000000000A1',$,'Projekt',$,$,$,$,$,$);
#10=IFCSITE('Site0000000000000000A1',$,'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$,$);
#11=IFCBUILDING('Bldg0000000000000000A1',$,'Haus',$,$,$,$,$,.ELEMENT.,$,$,$);
#12=IFCBUILDINGSTOREY('Stry0000000000000000A1',$,'EG',$,$,$,$,'Erdgeschoss',.ELEMENT.,0.);
#20=IFCRELAGGREGATES('RelA0000000000000000A1',$,$,$,#1,(#10));
#21=IFCRELAGGREGATES('RelA0000000000000000A2',$,$,$,#10,(#11));
#22=IFCRELAGGREGATES('RelA0000000000000000A3',$,$,$,#11,(#12));
#100=IFCWALL('WallA000000000000000A1',$,'Wand A','Aussenwand',$,$,$,'TAG-A',.SOLIDWALL.);
#200=IFCWALL('WallB000000000000000A1',$,'Wand B',$,$,$,$,$,.NOTDEFINED.);
#30=IFCRELCONTAINEDINSPATIALSTRUCTURE('RelC0000000000000000A1',$,$,$,(#100,#200),#12);
#110=IFCPROPERTYSET('Pset0000000000000000A1',$,'Pset_WallCommon',$,(#111,#112,#113));
#111=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('F90'),$);
#112=IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.T.),$);
#113=IFCPROPERTYSINGLEVALUE('Kommentar',$,IFCLABEL(''),$);
#115=IFCRELDEFINESBYPROPERTIES('RelP0000000000000000A1',$,$,$,(#100),#110);
#120=IFCMATERIAL('Beton',$,$);
#121=IFCRELASSOCIATESMATERIAL('RelM0000000000000000A1',$,$,$,(#100),#120);
#130=IFCCLASSIFICATION('BS','2015',$,'Uniclass',$,$,$);
#131=IFCCLASSIFICATIONREFERENCE($,'Ss_20_10','Waende',#130,$,$);
#132=IFCRELASSOCIATESCLASSIFICATION('RelK0000000000000000A1',$,$,$,(#100),#131);
ENDSEC;
END-ISO-10303-21;
`;

function simple(value: string): IdsValue {
  return { kind: "simple", simple: value };
}

function makeSpecification(
  partial: Partial<IdsSpecification>,
): IdsSpecification {
  return {
    applicability: [],
    applicabilityMaxOccurs: null,
    applicabilityMinOccurs: 0,
    id: "spec-test",
    ifcVersions: [],
    name: "Testspezifikation",
    requirements: [],
    ...partial,
  };
}

function makeModel(specifications: IdsSpecification[]): IdsDocumentModel {
  return { fileName: "test.ids", info: {}, specifications, warnings: [] };
}

function parseTestDocument() {
  return parseNativeIfcText(IDS_TEST_IFC, "ids-test.ifc");
}

test("IDS: Property-Anforderung meldet fehlendes FireRating", () => {
  const document = parseTestDocument();
  const summary = validateIds(
    document,
    makeModel([
      makeSpecification({
        applicability: [{ name: simple("IFCWALL"), type: "entity" }],
        requirements: [
          {
            baseName: simple("FireRating"),
            cardinality: "required",
            propertySet: simple("Pset_WallCommon"),
            type: "property",
            value: {
              kind: "restriction",
              restriction: { enumeration: ["F30", "F90"] },
            },
          },
        ],
      }),
    ]),
  );
  const result = summary.results[0];
  assert.equal(result.applicableCount, 2);
  assert.equal(result.passedCount, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].entityId, 200);
  assert.equal(result.status, "fail");
  assert.equal(summary.failCount, 1);
  // Verstoß-Meldungen tragen Klartext plus Segmente mit markierten Werten;
  // Wand B hat gar keine Psets — die Diagnose sagt das explizit.
  const failureMessage = result.failures[0].messages[0];
  assert.equal(
    failureMessage.text,
    "Kein Pset entspricht „Pset_WallCommon“ — das Objekt hat keine Psets.",
  );
  assert.deepEqual(
    failureMessage.segments
      .filter((segment) => segment.kind === "value")
      .map((segment) => segment.text),
    ["Pset_WallCommon"],
  );
});

test("IDS: Property-Verstöße orten den Fehler (Pset, Inhalt, leerer Wert)", () => {
  const document = parseTestDocument();
  const summary = validateIds(
    document,
    makeModel([
      // Property fehlt, obwohl das Pset existiert -> Pset samt Inhalt nennen.
      makeSpecification({
        applicability: [
          {
            name: simple("IFCWALL"),
            predefinedType: simple("SOLIDWALL"),
            type: "entity",
          },
        ],
        requirements: [
          {
            baseName: simple("Combustible"),
            cardinality: "required",
            propertySet: simple("Pset_WallCommon"),
            type: "property",
          },
        ],
      }),
      // Property vorhanden, aber leer.
      makeSpecification({
        applicability: [
          {
            name: simple("IFCWALL"),
            predefinedType: simple("SOLIDWALL"),
            type: "entity",
          },
        ],
        requirements: [
          {
            baseName: simple("Kommentar"),
            cardinality: "required",
            propertySet: simple("Pset_WallCommon"),
            type: "property",
          },
        ],
      }),
      // Falscher Wert -> Ist-Wert samt Fundort (Pset) nennen.
      makeSpecification({
        applicability: [
          {
            name: simple("IFCWALL"),
            predefinedType: simple("SOLIDWALL"),
            type: "entity",
          },
        ],
        requirements: [
          {
            baseName: simple("FireRating"),
            cardinality: "required",
            propertySet: simple("Pset_WallCommon"),
            type: "property",
            value: simple("F30"),
          },
        ],
      }),
    ]),
  );
  const [missing, empty, mismatch] = summary.results;

  const missingMessage = missing.failures[0].messages[0];
  assert.equal(
    missingMessage.text,
    "Property „Combustible“ fehlt im Pset „Pset_WallCommon“ — enthalten: FireRating, LoadBearing, Kommentar.",
  );
  // Der Pset-Verweis ist klickbar (STEP-ID der Pset-Entität).
  const psetRef = missingMessage.segments.find(
    (segment) => segment.kind === "ref",
  );
  assert.equal(psetRef?.entityId, 110);

  assert.equal(
    empty.failures[0].messages[0].text,
    "Property Kommentar im Pset „Pset_WallCommon“ ist vorhanden, aber leer.",
  );

  assert.equal(
    mismatch.failures[0].messages[0].text,
    "Property „FireRating“ = F90 (Pset „Pset_WallCommon“) entspricht nicht „F30“.",
  );
});

test("IDS: PredefinedType in der Anwendbarkeit filtert Objekte", () => {
  const document = parseTestDocument();
  const summary = validateIds(
    document,
    makeModel([
      makeSpecification({
        applicability: [
          {
            name: simple("IFCWALL"),
            predefinedType: simple("SOLIDWALL"),
            type: "entity",
          },
        ],
        requirements: [
          {
            cardinality: "required",
            name: simple("Name"),
            type: "attribute",
            value: simple("Wand A"),
          },
        ],
      }),
    ]),
  );
  const result = summary.results[0];
  assert.equal(result.applicableCount, 1);
  assert.equal(result.status, "pass");
});

test("IDS: Material- und Klassifikations-Facetten (inkl. Präfix-Matching)", () => {
  const document = parseTestDocument();
  const summary = validateIds(
    document,
    makeModel([
      makeSpecification({
        applicability: [{ name: simple("IFCWALL"), type: "entity" }],
        requirements: [
          { cardinality: "required", type: "material", value: simple("Beton") },
          {
            cardinality: "required",
            system: simple("Uniclass"),
            type: "classification",
            value: simple("Ss_20"),
          },
        ],
      }),
    ]),
  );
  const result = summary.results[0];
  // Wand A erfüllt beides (Ss_20_10 beginnt mit Ss_20); Wand B hat weder
  // Material noch Klassifikation.
  assert.equal(result.passedCount, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].entityId, 200);
  assert.equal(result.failures[0].messages.length, 2);
});

test("IDS: partOf findet die räumliche Struktur", () => {
  const document = parseTestDocument();
  const summary = validateIds(
    document,
    makeModel([
      makeSpecification({
        applicability: [{ name: simple("IFCWALL"), type: "entity" }],
        requirements: [
          {
            cardinality: "required",
            entityName: simple("IFCBUILDINGSTOREY"),
            type: "partOf",
          },
          {
            cardinality: "required",
            entityName: simple("IFCBUILDING"),
            type: "partOf",
          },
        ],
      }),
    ]),
  );
  assert.equal(summary.results[0].status, "pass");
});

test("IDS: prohibited-Kardinalität und verbotene Spezifikationen", () => {
  const document = parseTestDocument();
  const summary = validateIds(
    document,
    makeModel([
      // Property verboten: Wand A hat sie -> Verstoß, Wand B nicht -> ok.
      makeSpecification({
        applicability: [{ name: simple("IFCWALL"), type: "entity" }],
        requirements: [
          {
            baseName: simple("FireRating"),
            cardinality: "prohibited",
            propertySet: simple("Pset_WallCommon"),
            type: "property",
          },
        ],
      }),
      // Anwendbarkeit maxOccurs=0: IFCWALL darf nicht vorkommen -> fail.
      makeSpecification({
        applicability: [{ name: simple("IFCWALL"), type: "entity" }],
        applicabilityMaxOccurs: 0,
      }),
      // Anwendbarkeit maxOccurs=0 ohne Treffer -> pass.
      makeSpecification({
        applicability: [{ name: simple("IFCPILE"), type: "entity" }],
        applicabilityMaxOccurs: 0,
      }),
      // minOccurs=1 ohne Treffer -> fail.
      makeSpecification({
        applicability: [{ name: simple("IFCCHIMNEY"), type: "entity" }],
        applicabilityMinOccurs: 1,
      }),
    ]),
  );
  const [prohibitedProperty, prohibitedWalls, prohibitedPiles, requiredChimney] =
    summary.results;
  assert.equal(prohibitedProperty.status, "fail");
  assert.equal(prohibitedProperty.failures[0]?.entityId, 100);
  assert.equal(prohibitedWalls.status, "fail");
  assert.equal(prohibitedWalls.failures.length, 2);
  assert.equal(prohibitedPiles.status, "pass");
  assert.equal(requiredChimney.status, "fail");
});

test("IDS: Schema-Filter überspringt fremde IFC-Versionen", () => {
  const document = parseTestDocument();
  const summary = validateIds(
    document,
    makeModel([
      makeSpecification({
        applicability: [{ name: simple("IFCWALL"), type: "entity" }],
        ifcVersions: ["IFC2X3"],
      }),
      makeSpecification({
        applicability: [{ name: simple("IFCWALL"), type: "entity" }],
        ifcVersions: ["IFC4"],
      }),
    ]),
  );
  assert.equal(summary.results[0].status, "not-applicable");
  assert.notEqual(summary.results[1].status, "not-applicable");
});

test("IDS: einfache Muster werden zu lesbaren Aufzählungen expandiert", () => {
  assert.deepEqual(expandXsdPattern("(Pset_|ePset_|ePSet_)?Bauwerk"), [
    "Bauwerk",
    "Pset_Bauwerk",
    "ePset_Bauwerk",
    "ePSet_Bauwerk",
  ]);
  assert.deepEqual(expandXsdPattern("_?Bauwerksnummer"), [
    "Bauwerksnummer",
    "_Bauwerksnummer",
  ]);
  assert.deepEqual(expandXsdPattern("F[39]0"), ["F30", "F90"]);
  assert.deepEqual(expandXsdPattern("A{2}"), ["AA"]);
  assert.deepEqual(expandXsdPattern("Pset\\.X"), ["Pset.X"]);
  // Unbegrenzte Konstrukte bleiben unexpandiert.
  assert.equal(expandXsdPattern("Pset_.*"), undefined);
  assert.equal(expandXsdPattern("[A-Z]\\d+"), undefined);
  assert.equal(expandXsdPattern("(a|b)+"), undefined);

  assert.equal(
    describeValue({
      kind: "restriction",
      restriction: { patterns: ["(Pset_|ePset_|ePSet_)?Bauwerk"] },
    }),
    "„Bauwerk“, „Pset_Bauwerk“, „ePset_Bauwerk“ oder „ePSet_Bauwerk“",
  );
  assert.equal(
    describeValue({
      kind: "restriction",
      restriction: { patterns: ["Pset_.*"] },
    }),
    "beginnt mit „Pset_“",
  );
  assert.equal(
    describeValue({
      kind: "restriction",
      restriction: { patterns: [".*nummer"] },
    }),
    "endet auf „nummer“",
  );
  assert.equal(
    describeValue({
      kind: "restriction",
      restriction: { patterns: ["[A-Z]{2}\\d{4}"] },
    }),
    "Muster /[A-Z]{2}\\d{4}/",
  );
  // „beliebig“ statt kryptischem /.*/ — und Ziffern-Läufe als <n>.
  assert.equal(
    describeValue({ kind: "restriction", restriction: { patterns: [".*"] } }),
    "beliebig",
  );
  assert.equal(
    describeValue({
      kind: "restriction",
      restriction: {
        patterns: ["(Pset_|ePset_|ePSet_)?Untersuchungsziel[0-9]*"],
      },
    }),
    "„Untersuchungsziel<n>“, „Pset_Untersuchungsziel<n>“, „ePset_Untersuchungsziel<n>“ oder „ePSet_Untersuchungsziel<n>“",
  );
  const referenceList = describeValue({
    kind: "restriction",
    restriction: {
      patterns: [
        "_?(Bauwerksmodell|Bauwerk|Teilbauwerk|Bauteilgruppe|Bauteiltyp|Bauteilvariante|Bauteil|Raum|Objekt)ID[0-9]*_UE",
      ],
    },
  });
  assert.ok(referenceList.startsWith("„BauwerksmodellID<n>_UE“"));
  assert.ok(referenceList.endsWith(", …"));
  assert.equal(
    describeValue({
      kind: "restriction",
      restriction: { enumeration: ["F30", "F90"] },
    }),
    "„F30“ oder „F90“",
  );
  assert.equal(
    describeFacet({
      baseName: {
        kind: "restriction",
        restriction: { patterns: ["_?Bauwerksnummer"] },
      },
      cardinality: "required",
      propertySet: {
        kind: "restriction",
        restriction: { patterns: ["(Pset_|ePset_|ePSet_)?Bauwerk"] },
      },
      type: "property",
    }),
    "Property „Bauwerksnummer“ oder „_Bauwerksnummer“ im Pset „Bauwerk“, „Pset_Bauwerk“, „ePset_Bauwerk“ oder „ePSet_Bauwerk“ vorhanden",
  );
});

test("IDS: Facetten-Segmente trennen Werte von Schlüsselwörtern", () => {
  const segments = describeFacetBodySegments({
    baseName: {
      kind: "restriction",
      restriction: { patterns: ["_?ID"] },
    },
    cardinality: "required",
    propertySet: { kind: "simple", simple: "Pset_Projekt" },
    type: "property",
  });
  // Werte („ID“, „_ID“, „Pset_Projekt“) sind als value markiert, die
  // Schlüsselwörter („ oder “, „ im Pset “, „ vorhanden“) als text.
  assert.deepEqual(
    segments.filter((segment) => segment.kind === "value").map((s) => s.text),
    ["ID", "_ID", "Pset_Projekt"],
  );
  assert.ok(
    segments.some(
      (segment) => segment.kind === "text" && segment.text === " im Pset ",
    ),
  );
  assert.equal(
    stringifySegments(segments),
    "„ID“ oder „_ID“ im Pset „Pset_Projekt“ vorhanden",
  );
});

test("IDS: valueMatches deckt Zahlen, Muster und Schranken ab", () => {
  assert.ok(valueMatches(simple("2.5"), "2.5000001"));
  assert.ok(!valueMatches(simple("2.5"), "2.6"));
  assert.ok(valueMatches(simple("F90"), "F90"));
  assert.ok(!valueMatches(simple("f90"), "F90"));
  assert.ok(
    valueMatches(
      { kind: "restriction", restriction: { patterns: ["Wand .*"] } },
      "Wand A",
    ),
  );
  assert.ok(
    !valueMatches(
      { kind: "restriction", restriction: { patterns: ["Wand"] } },
      "Wand A",
    ),
  );
  assert.ok(
    valueMatches(
      {
        kind: "restriction",
        restriction: { maxInclusive: 120, minInclusive: 30 },
      },
      "90",
    ),
  );
  assert.ok(
    !valueMatches(
      {
        kind: "restriction",
        restriction: { maxInclusive: 120, minInclusive: 30 },
      },
      "20",
    ),
  );
  assert.ok(
    !valueMatches(
      { kind: "restriction", restriction: { minInclusive: 30 } },
      "kein Wert",
    ),
  );
});
