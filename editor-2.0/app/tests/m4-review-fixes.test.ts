/**
 * M4-Regressionstests zu den verifizierten Review-Befunden (Fable).
 *
 * Referenzkriterium ist wie in tests/m2-editierkern.test.ts der STEP-Export:
 * eine Änderung gilt erst als korrekt, wenn das REPARSTE Exportergebnis sie
 * zeigt — und ein Undo erst dann, wenn die DATA-Sektion wieder byte-identisch
 * zum Ausgangsexport ist.
 *
 * Abgedeckt: Befund 1 (Multi-Target-Beziehungen), 2 (Strukturbaum sieht
 * Edits), 4 (zentraler Tombstone-Filter), 8 (closeDocument räumt auf),
 * 9 (openDocument meldet Fehler), 12 (redo ohne Historien-Wildwuchs),
 * 13 (session.setProperty entfernt).
 */
import { describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";
import { IfcTypeEnum, RelationshipType } from "@ifc-lite/data";
import { ModelSession } from "../src/core/session";
import { useCommands } from "../src/commands/pipeline";
import { useDocuments } from "../src/store/documents";
import { useSelection } from "../src/store/selection";
import { cmdSetProperty } from "../src/commands/propertyCommands";
import { cmdDeleteEntityCascade } from "../src/commands/entityCommands";
import { cmdCreateRelation } from "../src/commands/relationCommands";
import { createListProvider } from "../src/panes/lists/provider";

// ---------------------------------------------------------------------------
// Fixture & Helfer
// ---------------------------------------------------------------------------

/** Ein Geschoss, drei Wände — alle drei in EINEM IfcRelContainedInSpatialStructure. */
function createSampleIfc(): string {
  const creator = new IfcCreator({ Name: "M4-Review" });
  const storey = creator.addIfcBuildingStorey({ Name: "Erdgeschoss", Elevation: 0 });
  for (const [i, name] of ["Wand A", "Wand B", "Wand C"].entries()) {
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

function toBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function openSession(text: string, fileName = "m4.ifc"): Promise<ModelSession> {
  return ModelSession.open(fileName, toBuffer(text));
}

const exportText = (session: ModelSession): string =>
  new TextDecoder().decode(session.exportStep());

/** DATA-Sektion (der HEADER trägt einen Zeitstempel und ist nie byte-stabil). */
function dataSection(text: string): string {
  const start = text.indexOf("DATA;");
  const end = text.indexOf("ENDSEC;", start);
  return text.slice(start + 5, end);
}

const exportData = (session: ModelSession): string =>
  dataSection(exportText(session));

function wallIds(session: ModelSession): number[] {
  return [...(session.store.entityIndex.byType.get("IFCWALL") ?? [])];
}

function storeyId(session: ModelSession): number {
  const ids = session.store.entityIndex.byType.get("IFCBUILDINGSTOREY") ?? [];
  expect(ids.length, "Fixture ohne Geschoss").toBeGreaterThan(0);
  return ids[0];
}

/** Namen der Bauteile, die im REPARSTEN Modell im Geschoss hängen. */
function containedNames(session: ModelSession): string[] {
  const storey = session.spatialTree()?.children[0]?.children[0]?.children[0];
  expect(storey?.type.toUpperCase(), "Geschoss nicht an erwarteter Stelle").toBe(
    "IFCBUILDINGSTOREY",
  );
  return (storey?.elements ?? [])
    .map((id) => session.store.entities.getName(id))
    .sort();
}

let docCounter = 0;
const nextDocId = (): string => `m4-doc-${++docCounter}`;

// ---------------------------------------------------------------------------
// Befund 1: Multi-Target-Beziehungen verlieren beim Löschen keine Mitglieder
// ---------------------------------------------------------------------------

describe("Befund 1: Kaskadenlöschung kürzt Multi-Target-Beziehungen", () => {
  it("Fixture bündelt alle drei Wände in EINER Containment-Beziehung", async () => {
    const session = await openSession(createSampleIfc());
    const rows = session
      .relationsOf(storeyId(session))
      .filter((row) => row.relType === RelationshipType.ContainsElements);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.relId)).size).toBe(1);
  });

  it("Wand A löschen lässt B und C räumlich zugeordnet (Export-Reparse)", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA] = wallIds(session);
    const nameA = session.store.entities.getName(wallA);

    cmdDeleteEntityCascade(session, wallA).run();

    const reparsed = await openSession(exportText(session), "m4-nach-delete.ifc");
    // Wand A ist weg …
    const namesAfter = wallIds(reparsed).map((id) =>
      reparsed.store.entities.getName(id),
    );
    expect(namesAfter).not.toContain(nameA);
    expect(namesAfter).toHaveLength(2);

    // … und die verbliebenen Wände hängen weiterhin im Geschoss.
    expect(containedNames(reparsed)).toEqual(["Wand B", "Wand C"]);

    // Die Containment-Beziehung existiert im Reparse als echte Kante.
    const storey = storeyId(reparsed);
    const rows = reparsed
      .relationsOf(storey)
      .filter((row) => row.relType === RelationshipType.ContainsElements);
    expect(rows).toHaveLength(2);
  });

  it("die gekürzte Beziehung bleibt für die übrigen Wände sichtbar", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA, wallB] = wallIds(session);

    cmdDeleteEntityCascade(session, wallA).run();

    // Aus Sicht von B unverändert vorhanden, aus Sicht von A verschwunden.
    expect(
      session
        .relationsOf(wallB)
        .filter((row) => row.relType === RelationshipType.ContainsElements),
    ).toHaveLength(1);
    expect(
      session
        .relationsOf(wallA)
        .filter((row) => row.relType === RelationshipType.ContainsElements),
    ).toHaveLength(0);
  });

  it("undo stellt Liste und Overlay byte-genau wieder her", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA] = wallIds(session);
    const before = exportData(session);

    const command = cmdDeleteEntityCascade(session, wallA);
    command.run();
    expect(exportData(session)).not.toBe(before);

    command.undo();
    expect(exportData(session)).toBe(before);
    expect(containedNames(session)).toEqual(["Wand A", "Wand B", "Wand C"]);
  });

  it("redo nach undo führt zum selben Export wie das erste do", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA] = wallIds(session);
    const docId = nextDocId();

    useCommands.getState().execute(docId, cmdDeleteEntityCascade(session, wallA));
    const afterDo = exportData(session);

    useCommands.getState().undo(docId);
    useCommands.getState().redo(docId);
    expect(exportData(session)).toBe(afterDo);
  });

  it("das letzte Mitglied löscht die Beziehung ganz (Record tombstoned)", async () => {
    const session = await openSession(createSampleIfc());
    const ids = wallIds(session);
    for (const id of ids) cmdDeleteEntityCascade(session, id).run();

    const text = exportText(session);
    expect(text).not.toContain("IFCRELCONTAINEDINSPATIALSTRUCTURE");
    expect(containedNames(session)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Befund 2: Der Strukturbaum sieht strukturelle Edits
// ---------------------------------------------------------------------------

describe("Befund 2: spatialTree berücksichtigt Tombstones und Overlay", () => {
  it("gelöschte Bauteile fallen aus dem Baum, undo bringt sie zurück", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA] = wallIds(session);
    expect(containedNames(session)).toEqual(["Wand A", "Wand B", "Wand C"]);

    const command = cmdDeleteEntityCascade(session, wallA);
    command.run();
    expect(containedNames(session)).toEqual(["Wand B", "Wand C"]);

    command.undo();
    expect(containedNames(session)).toEqual(["Wand A", "Wand B", "Wand C"]);
  });

  it("ein per Overlay angelegtes Containment hängt sich in den Baum ein", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA] = wallIds(session);
    const storey = storeyId(session);

    // Wand A aus dem Geschoss lösen …
    cmdDeleteEntityCascade(session, wallA).run();
    expect(containedNames(session)).toEqual(["Wand B", "Wand C"]);

    // … und ein neues Bauteil per Overlay-Beziehung einhängen.
    const proxy = session
      .editor()
      .addEntity("IfcBuildingElementProxy", [
        "0123456789abcdefghijkl",
        null,
        "Neues Bauteil",
        null,
        null,
        null,
        null,
        null,
      ]);
    const create = cmdCreateRelation(
      session,
      "IFCRELCONTAINEDINSPATIALSTRUCTURE",
      storey,
      [proxy.expressId],
    );
    create.run();
    expect(session.spatialTree());
    const storeyNode = session.spatialTree()?.children[0]?.children[0]?.children[0];
    expect(storeyNode?.elements).toContain(proxy.expressId);

    create.undo();
    const afterUndo = session.spatialTree()?.children[0]?.children[0]?.children[0];
    expect(afterUndo?.elements).not.toContain(proxy.expressId);
  });
});

// ---------------------------------------------------------------------------
// Befund 4: Tombstone-Filter zentral
// ---------------------------------------------------------------------------

describe("Befund 4: gelöschte Objekte verschwinden aus allen Lesewegen", () => {
  it("der Listen-Provider liefert gelöschte Ids nicht mehr", async () => {
    const session = await openSession(createSampleIfc());
    const provider = createListProvider(session);
    const allIds = (): number[] => provider.getAllEntityIds?.() ?? [];
    const [wallA] = wallIds(session);

    expect(allIds()).toContain(wallA);
    expect(provider.getEntitiesByType(IfcTypeEnum.IfcWall)).toHaveLength(3);

    cmdDeleteEntityCascade(session, wallA).run();

    expect(allIds()).not.toContain(wallA);
    expect(provider.getEntitiesByType(IfcTypeEnum.IfcWall)).toHaveLength(2);
  });

  it("relationsOf blendet Zeilen zu gelöschten Gegenstellen aus", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA] = wallIds(session);
    const storey = storeyId(session);

    // Nur das Bauteil tombstonen (ohne Kaskade), damit der Overlay-Filter
    // isoliert geprüft wird: die CSR-Kante Geschoss → Wand A bleibt bestehen.
    session.view.deleteEntity(wallA);

    const targets = session.relationsOf(storey).map((row) => row.otherId);
    expect(targets).not.toContain(wallA);
  });

  it("die Auswahl verliert gelöschte Objekte", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA, wallB] = wallIds(session);
    const docId = nextDocId();
    useSelection.getState().setSelection(docId, [wallA, wallB]);

    cmdDeleteEntityCascade(session, wallA, docId).run();

    expect(useSelection.getState().byDocument[docId]).toEqual([wallB]);
  });
});

// ---------------------------------------------------------------------------
// Befund 8 / 9: Dokumenten-Store
// ---------------------------------------------------------------------------

describe("Befund 8: closeDocument räumt Historie und Auswahl auf", () => {
  it("byDocument-Einträge von Commands und Selection verschwinden", async () => {
    await useDocuments.getState().openDocument("m4-close.ifc", toBuffer(createSampleIfc()));
    const docId = useDocuments.getState().activeId as string;
    const session = useDocuments.getState().documents.at(-1)!.session;
    const [wall] = wallIds(session);

    useCommands
      .getState()
      .execute(docId, cmdSetProperty(session, wall, "Pset_WallCommon", "FireRating", "REI 90"));
    useSelection.getState().setSelection(docId, [wall]);

    expect(useCommands.getState().byDocument[docId]).toBeDefined();
    expect(useSelection.getState().byDocument[docId]).toBeDefined();

    useDocuments.getState().closeDocument(docId);

    expect(useDocuments.getState().documents.some((d) => d.id === docId)).toBe(false);
    expect(docId in useCommands.getState().byDocument).toBe(false);
    expect(docId in useSelection.getState().byDocument).toBe(false);
  });
});

describe("Befund 9: openDocument meldet Fehler statt unhandled rejection", () => {
  it("eine unparsbare Datei landet als Meldung im progress-Feld", async () => {
    // Ein fehlender Puffer bringt den Parser zum Werfen — vor dem Fix wurde
    // die Rejection nicht behandelt und die Statusleiste blieb stumm.
    await expect(
      useDocuments
        .getState()
        .openDocument("kaputt.ifc", null as unknown as ArrayBuffer),
    ).resolves.toBeUndefined();

    const progress = useDocuments.getState().progress;
    expect(progress).toMatch(/^Fehler beim Öffnen von kaputt\.ifc: /);

    // Das nächste erfolgreiche Öffnen löscht die Meldung.
    await useDocuments.getState().openDocument("m4-ok.ifc", toBuffer(createSampleIfc()));
    expect(useDocuments.getState().progress).toBeNull();
    useDocuments.getState().closeDocument(useDocuments.getState().activeId as string);
  });
});

// ---------------------------------------------------------------------------
// Befund 12 / 13
// ---------------------------------------------------------------------------

describe("Befund 12: redo bläht die Mutationshistorie nicht auf", () => {
  it("execute → undo → redo hält getMutations().length konstant und den Export gleich", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const docId = nextDocId();

    useCommands
      .getState()
      .execute(docId, cmdSetProperty(session, wall, "Pset_WallCommon", "FireRating", "REI 120"));
    const afterDo = session.view.getMutations().length;
    const exportAfterDo = exportData(session).replace(/'[0-9A-Za-z_$]{22}'/g, "'<GUID>'");

    useCommands.getState().undo(docId);
    useCommands.getState().redo(docId);

    // cmdSetProperty hat einen skipHistory-Pfad — es darf KEIN Eintrag
    // hinzukommen (vor dem Fix waren es zwei pro Zyklus: undo + redo).
    expect(session.view.getMutations().length).toBe(afterDo);
    expect(session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating")).toBe(
      "REI 120",
    );
    expect(exportData(session).replace(/'[0-9A-Za-z_$]{22}'/g, "'<GUID>'")).toBe(
      exportAfterDo,
    );
  });

  it("cmdCreateRelation behält beim Redo die expressId der Beziehung", async () => {
    const session = await openSession(createSampleIfc());
    const [wallA, wallB] = wallIds(session);
    const docId = nextDocId();

    const command = cmdCreateRelation(session, "IFCRELCONNECTSELEMENTS", wallA, [wallB]);
    useCommands.getState().execute(docId, command);
    const created = session.relationOverlay.all().at(-1)?.relExpressId;
    expect(created).toBeDefined();

    useCommands.getState().undo(docId);
    useCommands.getState().redo(docId);

    expect(session.relationOverlay.all().at(-1)?.relExpressId).toBe(created);
  });
});

describe("Befund 13: session.setProperty ist entfernt", () => {
  it("die Sitzung bietet keinen Schreibweg an der Command-Pipeline vorbei", async () => {
    const session = await openSession(createSampleIfc());
    expect(
      (session as unknown as Record<string, unknown>).setProperty,
    ).toBeUndefined();
  });
});
