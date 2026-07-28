/**
 * M9-Verifikationstests: Ressourcen-Zuordnungen.
 *
 * Geprüft wird das Zusammenspiel von
 *   - `src/domain/resources/**`            (Emitter, Lese-Seite, Assign-Gerüst)
 *   - `src/commands/resourceCommands.ts`   (cmdAssignMaterial, …, cmdAddSiUnit,
 *                                           cmdCreateSpatialChild)
 *   - `src/core/session.ts`                (StoreEditor, RelationOverlay, Export)
 *
 * Referenzkriterium wie in M2/M5: je Command Export→Reparse-Nachweis (Record
 * und Beziehung vorhanden), Undo → DATA-Sektion byte-identisch, Redo mit
 * stabilen expressIds (Export nach Redo byte-gleich zum Export nach run).
 * Die von den Commands vergebenen GlobalIds sind feste Strings — anders als
 * bei Overlay-Psets (Befund B5) ist der Export hier byte-stabil.
 */
import { describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";
import {
  extractClassificationsOnDemand,
  extractDocumentsOnDemand,
  extractGroupMembersOnDemand,
  extractMaterialsOnDemand,
} from "@ifc-lite/parser";
import { RelationshipType } from "@ifc-lite/data";
import { ModelSession } from "../src/core/session";
import { useCommands } from "../src/commands/pipeline";
import {
  cmdAddSiUnit,
  cmdAssignClassification,
  cmdAssignDocument,
  cmdAssignMaterial,
  cmdAssignMaterialLayers,
  cmdAssignToGroup,
  cmdAssignType,
  cmdCreateSpatialChild,
} from "../src/commands/resourceCommands";
import {
  readGroupRows,
  readMaterialRows,
  readUnitRows,
  unitAssignmentOf,
} from "../src/domain/resources/read";
import { buildTreeItems } from "../src/panes/structure/treeModel";

// ---------------------------------------------------------------------------
// Fixture & Helfer (Muster tests/m2-editierkern.test.ts)
// ---------------------------------------------------------------------------

function createSampleIfc(): string {
  const creator = new IfcCreator({ Name: "M9-Ressourcen" });
  const storey = creator.addIfcBuildingStorey({
    Name: "Erdgeschoss",
    Elevation: 0,
  });
  for (const [i, name] of ["Wand A", "Wand B"].entries()) {
    creator.addIfcWall(storey, {
      Name: name,
      Start: [0, i, 0],
      End: [5, i, 0],
      Thickness: 0.2,
      Height: 3,
    });
  }
  return creator.toIfc().content;
}

async function openSession(
  text: string,
  fileName = "m9.ifc",
): Promise<ModelSession> {
  const bytes = new TextEncoder().encode(text);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return ModelSession.open(fileName, buffer);
}

const toText = (content: Uint8Array): string =>
  new TextDecoder().decode(content);

function dataSection(text: string): string {
  const start = text.indexOf("DATA;");
  const end = text.indexOf("ENDSEC;", start);
  expect(start, "kein DATA-Abschnitt im Export").toBeGreaterThan(-1);
  return text.slice(start + 5, end);
}

const exportData = (session: ModelSession): string =>
  dataSection(toText(session.exportStep()));
const exportText = (session: ModelSession): string =>
  toText(session.exportStep());

/** Export erneut parsen — Prüfstein für „ist wirklich im Modell". */
const reparse = (session: ModelSession): Promise<ModelSession> =>
  openSession(exportText(session), "m9-reparse.ifc");

function wallIds(session: ModelSession): number[] {
  const ids = session.store.entityIndex.byType.get("IFCWALL") ?? [];
  expect(ids.length, "Fixture ohne Wände").toBeGreaterThanOrEqual(2);
  return [...ids];
}

function storeyId(session: ModelSession): number {
  const ids = session.store.entityIndex.byType.get("IFCBUILDINGSTOREY") ?? [];
  expect(ids.length, "Fixture ohne Geschoss").toBeGreaterThan(0);
  return ids[0];
}

let docCounter = 0;
const nextDocId = (): string => `m9-doc-${++docCounter}`;

// ---------------------------------------------------------------------------
// 1) cmdAssignMaterial
// ---------------------------------------------------------------------------

describe("M9: cmdAssignMaterial", () => {
  it("run schreibt IFCMATERIAL + IFCRELASSOCIATESMATERIAL, Reparse liest das Material", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const docId = nextDocId();

    useCommands.getState().execute(
      docId,
      cmdAssignMaterial(session, [wall], {
        name: "Beton C30/37",
        category: "Concrete",
      }),
    );

    const exported = exportText(session);
    expect(exported).toContain("IFCMATERIAL('Beton C30/37',$,'Concrete')");
    expect(exported).toContain("IFCRELASSOCIATESMATERIAL");

    // Overlay-Kante sofort sichtbar (die Extraktoren lesen nur den CSR).
    const overlayRow = session
      .relationsOf(wall)
      .find((row) => row.relType === RelationshipType.AssociatesMaterial);
    expect(overlayRow?.origin).toBe("overlay");
    expect(
      readMaterialRows(session, wall).some(
        (row) => row.origin === "overlay" && row.label === "Beton C30/37",
      ),
    ).toBe(true);

    const reparsed = await reparse(session);
    const material = extractMaterialsOnDemand(reparsed.store, wall);
    expect(material?.name).toBe("Beton C30/37");
    // Nach Export+Reparse ist die Zuordnung eine geparste Zeile.
    expect(
      readMaterialRows(reparsed, wall).some(
        (row) => row.origin === "parsed" && row.label === "Beton C30/37",
      ),
    ).toBe(true);
  });

  it("undo stellt die DATA-Sektion byte-identisch her, redo ist byte-stabil", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const docId = nextDocId();
    const before = exportData(session);

    useCommands.getState().execute(
      docId,
      cmdAssignMaterial(session, [wall], { name: "Ziegel" }),
    );
    const afterRun = exportData(session);
    expect(afterRun).not.toBe(before);

    useCommands.getState().undo(docId);
    expect(exportData(session)).toBe(before);
    expect(
      session
        .relationsOf(wall)
        .some((row) => row.relType === RelationshipType.AssociatesMaterial),
    ).toBe(false);

    useCommands.getState().redo(docId);
    // Stabile expressIds + feste GlobalIds → byte-gleicher Export.
    expect(exportData(session)).toBe(afterRun);
  });

  it("vorhandenes Material wählen legt nur den Beziehungs-Record an", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA, wallB] = wallIds(session);
    const docId = nextDocId();

    useCommands.getState().execute(
      docId,
      cmdAssignMaterial(session, [wallA], { name: "Kalksandstein" }),
    );
    const materialCount = (text: string): number =>
      (text.match(/IFCMATERIAL\(/g) ?? []).length;
    const afterFirst = materialCount(exportText(session));

    const existingId = session.view
      .getNewEntities()
      .find((e) => e.type.toUpperCase() === "IFCMATERIAL")?.expressId;
    expect(existingId).toBeDefined();

    useCommands.getState().execute(
      docId,
      cmdAssignMaterial(session, [wallB], {
        materialId: existingId,
        name: "Kalksandstein",
      }),
    );
    expect(materialCount(exportText(session))).toBe(afterFirst);

    // Undo der zweiten Zuweisung lässt die erste unangetastet.
    useCommands.getState().undo(docId);
    expect(materialCount(exportText(session))).toBe(afterFirst);
    expect(exportText(session)).toContain("Kalksandstein");
  });
});

// ---------------------------------------------------------------------------
// 2) cmdAssignMaterialLayers
// ---------------------------------------------------------------------------

describe("M9: cmdAssignMaterialLayers", () => {
  it("schreibt LayerSet + LayerSetUsage mit Richtung/Offset; Reparse liefert die Schichten", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const docId = nextDocId();
    const before = exportData(session);

    useCommands.getState().execute(
      docId,
      cmdAssignMaterialLayers(session, [wall], {
        setName: "AW 28 WDVS",
        layers: [
          { materialName: "Beton", thickness: 0.2, name: "Kern", category: "LoadBearing" },
          { materialName: "Dämmung", thickness: 0.08, name: "Dämmung", category: "Insulation" },
        ],
        direction: "AXIS2",
        sense: "POSITIVE",
        offset: 0,
      }),
    );

    const exported = exportText(session);
    expect(exported).toContain("IFCMATERIALLAYERSET(");
    expect(exported).toMatch(
      /IFCMATERIALLAYERSETUSAGE\(#\d+,\.AXIS2\.,\.POSITIVE\.,0\./,
    );

    const reparsed = await reparse(session);
    const material = extractMaterialsOnDemand(reparsed.store, wall);
    expect(material?.type).toBe("MaterialLayerSet");
    expect(material?.layers).toHaveLength(2);
    expect(material?.layers?.[0]?.thickness).toBeCloseTo(0.2);
    expect(material?.layers?.[1]?.materialName).toBe("Dämmung");

    useCommands.getState().undo(docId);
    expect(exportData(session)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 3) cmdAssignClassification
// ---------------------------------------------------------------------------

describe("M9: cmdAssignClassification", () => {
  it("legt IFCCLASSIFICATION einmalig je Quelle an; Reparse liefert die Referenz", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA, wallB] = wallIds(session);
    const docId = nextDocId();
    const before = exportData(session);

    useCommands.getState().execute(
      docId,
      cmdAssignClassification(session, [wallA], {
        system: "DIN 276",
        identification: "KG 331",
        name: "Tragende Wände",
      }),
    );
    useCommands.getState().execute(
      docId,
      cmdAssignClassification(session, [wallB], {
        system: "DIN 276",
        identification: "KG 332",
        name: "Nichttragende Wände",
      }),
    );

    const exported = exportText(session);
    // Ein System, zwei Referenzen, zwei Zuordnungen.
    expect((exported.match(/IFCCLASSIFICATION\(/g) ?? []).length).toBe(1);
    expect((exported.match(/IFCCLASSIFICATIONREFERENCE\(/g) ?? []).length).toBe(2);
    expect((exported.match(/IFCRELASSOCIATESCLASSIFICATION\(/g) ?? []).length).toBe(2);

    const reparsed = await reparse(session);
    const infoA = extractClassificationsOnDemand(reparsed.store, wallA);
    expect(infoA[0]?.identification).toBe("KG 331");
    expect(infoA[0]?.system).toBe("DIN 276");
    const infoB = extractClassificationsOnDemand(reparsed.store, wallB);
    expect(infoB[0]?.identification).toBe("KG 332");

    // Undo beider Zuweisungen → byte-identisch zum Ausgangszustand.
    useCommands.getState().undo(docId);
    useCommands.getState().undo(docId);
    expect(exportData(session)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 4) cmdAssignDocument
// ---------------------------------------------------------------------------

describe("M9: cmdAssignDocument", () => {
  it("schreibt Information + Referenz + Zuordnung; Undo byte-identisch, Redo stabil", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const docId = nextDocId();
    const before = exportData(session);

    useCommands.getState().execute(
      docId,
      cmdAssignDocument(session, [wall], {
        identification: "PLAN-001",
        name: "Grundriss EG",
        location: "https://example.invalid/plan-001.pdf",
      }),
    );

    const exported = exportText(session);
    expect(exported).toContain("IFCDOCUMENTINFORMATION(");
    expect(exported).toContain("IFCDOCUMENTREFERENCE(");
    expect(exported).toContain("IFCRELASSOCIATESDOCUMENT(");
    const afterRun = exportData(session);

    const reparsed = await reparse(session);
    const docs = extractDocumentsOnDemand(reparsed.store, wall);
    expect(docs[0]?.identification).toBe("PLAN-001");
    expect(docs[0]?.name).toBe("Grundriss EG");

    useCommands.getState().undo(docId);
    expect(exportData(session)).toBe(before);
    useCommands.getState().redo(docId);
    expect(exportData(session)).toBe(afterRun);
  });
});

// ---------------------------------------------------------------------------
// 5) cmdAssignToGroup (2 Objekte)
// ---------------------------------------------------------------------------

describe("M9: cmdAssignToGroup", () => {
  it("bündelt 2 Objekte in EINEM IFCRELASSIGNSTOGROUP (RelatedObjects-Liste + RelatingGroup)", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA, wallB] = wallIds(session);
    const docId = nextDocId();
    const before = exportData(session);

    useCommands.getState().execute(
      docId,
      cmdAssignToGroup(session, [wallA, wallB], {
        groupClass: "IFCSYSTEM",
        name: "Tragwerk",
      }),
    );

    const exported = exportText(session);
    const relLine = exported
      .split("\n")
      .find((line) => line.includes("IFCRELASSIGNSTOGROUP"));
    expect(relLine).toBeDefined();
    // Argumentreihenfolge: RelatedObjects-LISTE, RelatedObjectsType ($), RelatingGroup.
    expect(relLine).toContain(`(#${wallA},#${wallB}),$,#`);

    // Overlay-Lesepfad: beide Wände sehen die Gruppe sofort.
    expect(readGroupRows(session, wallA)).toHaveLength(1);
    expect(readGroupRows(session, wallB)).toHaveLength(1);
    expect(readGroupRows(session, wallA)[0].label).toBe("Tragwerk");

    const reparsed = await reparse(session);
    const groupId = (reparsed.store.entityIndex.byType.get("IFCSYSTEM") ?? [])[0];
    expect(groupId).toBeDefined();
    const members = extractGroupMembersOnDemand(reparsed.store, groupId);
    expect(members.map((m) => m.id).sort()).toEqual([wallA, wallB].sort());

    const afterRun = exportData(session);
    useCommands.getState().undo(docId);
    expect(exportData(session)).toBe(before);
    useCommands.getState().redo(docId);
    expect(exportData(session)).toBe(afterRun);
  });
});

// ---------------------------------------------------------------------------
// 6) cmdAssignType
// ---------------------------------------------------------------------------

describe("M9: cmdAssignType", () => {
  it("legt IFCWALLTYPE + IFCRELDEFINESBYTYPE an; Reparse zeigt die Typzuweisung", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const docId = nextDocId();
    const before = exportData(session);

    useCommands.getState().execute(
      docId,
      cmdAssignType(session, [wall], {
        typeClass: "IFCWALLTYPE",
        name: "AW 24 Beton",
        tag: "AW24",
      }),
    );

    const exported = exportText(session);
    expect(exported).toMatch(/IFCWALLTYPE\('[0-9A-Za-z_$]{22}',\$,'AW 24 Beton'/);
    expect(exported).toContain("IFCRELDEFINESBYTYPE(");

    const reparsed = await reparse(session);
    const typeRow = reparsed
      .relationsOf(wall)
      .find((row) => row.relType === RelationshipType.DefinesByType);
    expect(typeRow).toBeDefined();
    expect(typeRow?.otherType.toUpperCase()).toBe("IFCWALLTYPE");

    const afterRun = exportData(session);
    useCommands.getState().undo(docId);
    expect(exportData(session)).toBe(before);
    useCommands.getState().redo(docId);
    expect(exportData(session)).toBe(afterRun);
  });
});

// ---------------------------------------------------------------------------
// 7) cmdAddSiUnit (Einheiten-Erweiterung, modellweit)
// ---------------------------------------------------------------------------

describe("M9: cmdAddSiUnit", () => {
  it("hängt die IFCSIUNIT positional an die IFCUNITASSIGNMENT-Liste", async () => {
    const session = await openSession(createSampleIfc());
    const docId = nextDocId();
    const before = exportData(session);
    const assignment = unitAssignmentOf(session);
    expect(assignment, "Fixture ohne IfcUnitAssignment").not.toBeNull();
    const unitCountBefore = assignment?.tokens.length ?? 0;

    useCommands.getState().execute(
      docId,
      cmdAddSiUnit(session, {
        unitType: "MASSUNIT",
        prefix: "KILO",
        name: "GRAM",
      }),
    );

    expect(unitAssignmentOf(session)?.tokens).toHaveLength(unitCountBefore + 1);
    const exported = exportText(session);
    const unitLine = exported
      .split("\n")
      .find((line) => /IFCSIUNIT\(\*,\.MASSUNIT\./.test(line));
    expect(unitLine).toBeDefined();
    expect(unitLine).toContain(".KILO.");
    expect(unitLine).toContain(".GRAM.");
    const unitId = Number(unitLine?.match(/^#(\d+)=/)?.[1]);
    const assignLine = exported
      .split("\n")
      .find((line) => line.includes("IFCUNITASSIGNMENT"));
    expect(assignLine).toContain(`#${unitId}`);

    // Anzeige-Seite: Zeile mit Herkunft Overlay.
    expect(
      readUnitRows(session).some(
        (row) => row.origin === "overlay" && row.label === "KILO GRAM",
      ),
    ).toBe(true);

    // Reparse: Einheit hängt wirklich in der Zuweisung.
    const reparsed = await reparse(session);
    expect(unitAssignmentOf(reparsed)?.tokens.length).toBe(unitCountBefore + 1);
    expect(
      reparsed.store.entityIndex.byType.get("IFCSIUNIT")?.includes(unitId),
    ).toBe(true);

    const afterRun = exportData(session);
    useCommands.getState().undo(docId);
    expect(exportData(session)).toBe(before);
    useCommands.getState().redo(docId);
    expect(exportData(session)).toBe(afterRun);
  });
});

// ---------------------------------------------------------------------------
// 8) cmdCreateSpatialChild (Kontextmenü „Kind anlegen")
// ---------------------------------------------------------------------------

describe("M9: cmdCreateSpatialChild", () => {
  it("legt einen Raum unter dem Geschoss an (Objekt + IfcRelAggregates) und hängt ihn in den Baum", async () => {
    const session = await openSession(createSampleIfc());
    const storey = storeyId(session);
    const docId = nextDocId();
    const before = exportData(session);

    useCommands.getState().execute(
      docId,
      cmdCreateSpatialChild(session, storey, "IFCSPACE", "Büro 1.01"),
    );

    const exported = exportText(session);
    const spaceLine = exported
      .split("\n")
      .find((line) => /IFCSPACE\('[0-9A-Za-z_$]{22}',\$,'Büro 1\.01'/.test(line));
    expect(spaceLine).toBeDefined();
    const spaceId = Number(spaceLine?.match(/^#(\d+)=/)?.[1]);

    // Baum zeigt das Kind über die Overlay-Aggregation; Typ/Name kommen aus
    // dem Overlay-Record (treeModel.nodeIdentity), nicht aus der Parser-Tabelle.
    const storeyNode = findNode(session, storey);
    expect(storeyNode?.children.some((c) => c.expressId === spaceId)).toBe(true);
    const treeItem = buildTreeItems(session).find((i) => i.expressId === spaceId);
    expect(treeItem?.name).toBe("Büro 1.01");
    expect(treeItem?.type.toUpperCase()).toBe("IFCSPACE");

    // Reparse: Raum + Aggregation überleben den Export.
    const reparsed = await reparse(session);
    expect(reparsed.store.entityIndex.byType.get("IFCSPACE")).toHaveLength(1);
    const aggRow = reparsed
      .relationsOf(storey)
      .find(
        (row) =>
          row.relType === RelationshipType.Aggregates &&
          row.direction === "forward",
      );
    expect(aggRow?.otherType.toUpperCase()).toBe("IFCSPACE");

    const afterRun = exportData(session);
    useCommands.getState().undo(docId);
    expect(exportData(session)).toBe(before);
    expect(findNode(session, storey)?.children).toHaveLength(0);

    useCommands.getState().redo(docId);
    expect(exportData(session)).toBe(afterRun);
    expect(
      findNode(session, storey)?.children.some((c) => c.expressId === spaceId),
    ).toBe(true);
  });
});

/** Knoten im räumlichen Baum der Sitzung suchen (Tiefensuche). */
function findNode(
  session: ModelSession,
  expressId: number,
): { children: Array<{ expressId: number; name: string; children: unknown[] }> } | null {
  const root = session.spatialTree();
  if (!root) return null;
  const queue: Array<typeof root> = [root];
  while (queue.length > 0) {
    const node = queue.shift() as typeof root;
    if (node.expressId === expressId) return node;
    queue.push(...node.children);
  }
  return null;
}
