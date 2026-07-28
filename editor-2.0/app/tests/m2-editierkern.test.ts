/**
 * M2-Verifikationstests: Editierkern (Command-Pipeline + Mutations-Overlay + Export).
 *
 * Geprüft wird das Zusammenspiel von
 *   - `src/commands/pipeline.ts`      (useCommands: execute/undo/redo, Undo-/Redo-Stapel, Audit)
 *   - `src/commands/propertyCommands.ts` (cmdSetProperty, cmdSetAttribute, cmdSetPropertyOnMany …)
 *   - `src/core/session.ts`           (ModelSession: Parser-Store, MutablePropertyView, exportStep)
 *
 * Referenzkriterium ist durchgehend der **STEP-Export**: eine Änderung gilt erst
 * dann als zurückgenommen, wenn die DATA-Sektion byte-identisch zum Ausgangsexport
 * ist. Der Header wird bewusst ausgeklammert — er enthält einen Zeitstempel und
 * ist deshalb nie byte-stabil.
 *
 * Mehrere Testfälle dokumentieren bewusst das REALE Verhalten der ifc-lite-API
 * (bzw. der aktuellen Command-Implementierung), das vom naiv erwarteten abweicht.
 * Diese Fälle sind mit „BEFUND" markiert.
 */
import { describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";
import { extractPropertiesOnDemand } from "@ifc-lite/parser";
import { PropertyValueType } from "@ifc-lite/data";
import { ModelSession } from "../src/core/session";
import { useCommands } from "../src/commands/pipeline";
import {
  cmdSetProperty,
  cmdDeleteProperty,
  cmdSetAttribute,
  cmdSetPropertyOnMany,
} from "../src/commands/propertyCommands";

// ---------------------------------------------------------------------------
// Fixture & Helfer
// ---------------------------------------------------------------------------

/** Deterministisches Fixture: ein Geschoss mit drei Wänden (für Batch-Tests). */
function createSampleIfc(): string {
  const creator = new IfcCreator({ Name: "M2-Editierkern" });
  const storey = creator.addIfcBuildingStorey({
    Name: "Erdgeschoss",
    Elevation: 0,
  });
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

async function openSession(
  text: string,
  fileName = "m2.ifc",
): Promise<ModelSession> {
  const bytes = new TextEncoder().encode(text);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return ModelSession.open(fileName, buffer);
}

const toText = (content: Uint8Array): string => new TextDecoder().decode(content);

/**
 * DATA-Sektion des STEP-Files. Der Vergleich erfolgt auf dieser Sektion, weil
 * der HEADER einen Export-Zeitstempel trägt und deshalb nie byte-stabil ist.
 */
function dataSection(text: string): string {
  const start = text.indexOf("DATA;");
  const end = text.indexOf("ENDSEC;", start);
  expect(start, "kein DATA-Abschnitt im Export").toBeGreaterThan(-1);
  return text.slice(start + 5, end);
}

/** Export der Sitzung als DATA-Sektionstext (Referenz für Byte-Vergleiche). */
const exportData = (session: ModelSession): string =>
  dataSection(toText(session.exportStep()));

/**
 * DATA-Sektion mit maskierten GlobalIds.
 *
 * BEFUND B5: Entities, die der StepExporter aus dem Overlay neu backt
 * (IfcPropertySet, IfcRelDefinesByProperties …), bekommen bei JEDEM Export eine
 * frisch generierte GlobalId. Zwei Exporte desselben Overlay-Zustands sind
 * deshalb nicht byte-identisch. Für Vergleiche zwischen zwei Zuständen MIT
 * Overlay-Inhalt werden die 22-Zeichen-GUIDs daher maskiert; Vergleiche gegen
 * einen mutationsfreien Export bleiben echte Byte-Vergleiche.
 */
const exportDataOhneGuids = (session: ModelSession): string =>
  exportData(session).replace(/'[0-9A-Za-z_$]{22}'/g, "'<GUID>'");

const exportText = (session: ModelSession): string => toText(session.exportStep());

function wallIds(session: ModelSession): number[] {
  const ids = session.store.entityIndex.byType.get("IFCWALL") ?? [];
  expect(ids.length, "Fixture enthält keine Wände").toBeGreaterThanOrEqual(3);
  return [...ids];
}

/** Property aus einem frisch geparsten Modell lesen (Semantik-Prüfung). */
function readProperty(
  session: ModelSession,
  entityId: number,
  psetName: string,
  propName: string,
): unknown {
  const pset = extractPropertiesOnDemand(session.store, entityId).find(
    (p) => p.name === psetName,
  );
  return pset?.properties.find((p) => p.name === propName)?.value;
}

/**
 * ModelSession verdrahtet den On-Demand-Extractor der MutablePropertyView NICHT
 * (siehe BEFUND B1). Für Tests, die bestehende — also aus der Quelldatei
 * geparste — Properties bearbeiten, wird er hier nachgerüstet.
 */
function wireOnDemandExtractor(session: ModelSession): void {
  session.view.setOnDemandExtractor((entityId) =>
    extractPropertiesOnDemand(session.store, entityId),
  );
}

/** Eindeutige docId je Test — useCommands ist ein Modul-Singleton. */
let docCounter = 0;
const nextDocId = (): string => `m2-doc-${++docCounter}`;

// ---------------------------------------------------------------------------
// 1) cmdSetProperty: run / undo / redo
// ---------------------------------------------------------------------------

describe("M2: cmdSetProperty — Overlay, Undo, Redo", () => {
  it("run schreibt den Wert ins Overlay und in den Export", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);

    expect(session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating"))
      .toBeNull();

    cmdSetProperty(session, wall, "Pset_WallCommon", "FireRating", "REI 120").run();

    expect(
      session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating"),
    ).toBe("REI 120");
    expect(exportText(session)).toContain("REI 120");
    expect(session.changeCount).toBe(1);
  });

  it("undo stellt die DATA-Sektion byte-identisch zum Ausgangsexport her", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const before = exportData(session);

    const command = cmdSetProperty(
      session,
      wall,
      "Pset_WallCommon",
      "FireRating",
      "REI 120",
    );
    command.run();
    expect(exportData(session)).not.toBe(before);

    command.undo();
    expect(exportData(session)).toBe(before);
    expect(exportText(session)).not.toContain("REI 120");
  });

  it("redo über die Pipeline bringt den Wert zurück", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const docId = nextDocId();
    const before = exportData(session);

    useCommands
      .getState()
      .execute(
        docId,
        cmdSetProperty(session, wall, "Pset_WallCommon", "FireRating", "REI 120"),
      );
    const afterRun = exportDataOhneGuids(session);

    useCommands.getState().undo(docId);
    expect(exportData(session)).toBe(before);

    useCommands.getState().redo(docId);
    expect(
      session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating"),
    ).toBe("REI 120");
    // GUID-maskierter Vergleich, siehe BEFUND B5.
    expect(exportDataOhneGuids(session)).toBe(afterRun);
  });

  it("BEFUND B5: zwei Exporte desselben Overlay-Zustands sind nicht byte-identisch", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);

    // Ohne Overlay-Inhalt ist der Export byte-stabil …
    expect(exportData(session)).toBe(exportData(session));

    cmdSetProperty(session, wall, "Pset_WallCommon", "FireRating", "REI 120").run();

    // … sobald ein Pset aus dem Overlay gebacken wird, nicht mehr: die
    // GlobalIds der neu erzeugten IfcPropertySet-/IfcRelDefinesByProperties-
    // Records werden pro Export neu gewürfelt.
    expect(exportData(session)).not.toBe(exportData(session));
    // Nach Maskierung der GUIDs ist der Export wieder stabil.
    expect(exportDataOhneGuids(session)).toBe(exportDataOhneGuids(session));
  });

  it("cmdDeleteProperty entfernt den Wert, undo setzt ihn zurück", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);

    // Vorbedingung im Overlay anlegen, damit getPropertyValue den alten Wert kennt.
    session.view.setProperty(
      wall,
      "Pset_WallCommon",
      "FireRating",
      "REI 60",
      PropertyValueType.Label,
    );
    const withValue = exportDataOhneGuids(session);

    const command = cmdDeleteProperty(session, wall, "Pset_WallCommon", "FireRating");
    command.run();
    expect(session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating"))
      .toBeNull();

    command.undo();
    expect(session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating"))
      .toBe("REI 60");
    // GUID-maskierter Vergleich, siehe BEFUND B5.
    expect(exportDataOhneGuids(session)).toBe(withValue);
  });
});

// ---------------------------------------------------------------------------
// 2) cmdSetProperty auf eine BESTEHENDE (geparste) Property
// ---------------------------------------------------------------------------

describe("M2: cmdSetProperty auf bestehende Property", () => {
  /** Fixture: Property setzen → exportieren → neu parsen. */
  async function sessionWithExistingProperty(): Promise<ModelSession> {
    const seed = await openSession(createSampleIfc());
    const [wall] = wallIds(seed);
    seed.view.setProperty(
      wall,
      "Pset_WallCommon",
      "FireRating",
      "REI 30",
      PropertyValueType.Label,
    );
    return openSession(exportText(seed), "m2-mit-pset.ifc");
  }

  it("BEFUND B1: ohne On-Demand-Extractor kennt das Overlay den geparsten Altwert nicht", async () => {
    const session = await sessionWithExistingProperty();
    const [wall] = wallIds(session);

    // Die Property IST im Modell vorhanden …
    expect(readProperty(session, wall, "Pset_WallCommon", "FireRating")).toBe(
      "REI 30",
    );
    // … aber MutablePropertyView liest sie nicht, weil ModelSession nur
    // `store.properties` als Basistabelle übergibt und `setOnDemandExtractor`
    // nie aufruft. parseColumnar füllt diese Tabelle nicht.
    expect(session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating"))
      .toBeNull();

    // Folge: cmdSetProperty merkt sich oldValue === null; das Undo LÖSCHT die
    // Property, statt den Altwert wiederherzustellen.
    const command = cmdSetProperty(
      session,
      wall,
      "Pset_WallCommon",
      "FireRating",
      "REI 90",
    );
    command.run();
    command.undo();

    const reparsed = await openSession(exportText(session));
    const [wall2] = wallIds(reparsed);
    expect(readProperty(reparsed, wall2, "Pset_WallCommon", "FireRating"))
      .toBeUndefined();
  });

  it("mit verdrahtetem On-Demand-Extractor stellt undo den alten WERT wieder her", async () => {
    const session = await sessionWithExistingProperty();
    wireOnDemandExtractor(session);
    const [wall] = wallIds(session);

    expect(session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating"))
      .toBe("REI 30");

    const command = cmdSetProperty(
      session,
      wall,
      "Pset_WallCommon",
      "FireRating",
      "REI 90",
    );
    command.run();
    expect(session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating"))
      .toBe("REI 90");
    expect(exportText(session)).toContain("REI 90");

    command.undo();
    // Wiederhergestellt wird der WERT — nicht eine Löschung.
    expect(session.view.getPropertyValue(wall, "Pset_WallCommon", "FireRating"))
      .toBe("REI 30");

    const reparsed = await openSession(exportText(session));
    const [wall2] = wallIds(reparsed);
    expect(readProperty(reparsed, wall2, "Pset_WallCommon", "FireRating")).toBe(
      "REI 30",
    );
  });

  it("BEFUND B2: das Undo ist semantisch, nicht byte-identisch (Overlay backt das Pset neu)", async () => {
    const session = await sessionWithExistingProperty();
    wireOnDemandExtractor(session);
    const [wall] = wallIds(session);
    const before = exportDataOhneGuids(session);

    const command = cmdSetProperty(
      session,
      wall,
      "Pset_WallCommon",
      "FireRating",
      "REI 90",
    );
    command.run();
    command.undo();

    // Sobald ein Pset im Overlay berührt wurde, überspringt der StepExporter das
    // Original-IfcPropertySet und emittiert es aus dem Overlay neu (neue
    // GlobalId/ExpressIds). Der Inhalt stimmt, die Bytes unterscheiden sich —
    // auch mit maskierten GUIDs, der Unterschied ist also strukturell.
    expect(exportDataOhneGuids(session)).not.toBe(before);
    expect(exportText(session)).toContain("REI 30");
    expect(exportText(session)).not.toContain("REI 90");
  });
});

// ---------------------------------------------------------------------------
// 3) cmdSetAttribute
// ---------------------------------------------------------------------------

describe("M2: cmdSetAttribute (Name einer Wand)", () => {
  it("run schreibt den neuen Namen in Overlay und Export", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const oldName = session.store.entities.getName(wall);
    expect(oldName).toBe("Wand A");

    cmdSetAttribute(session, wall, "Name", "Wand A (geändert)", oldName).run();

    expect(session.view.getAttributeMutationsForEntity(wall)).toEqual([
      { name: "Name", value: "Wand A (geändert)" },
    ]);
    expect(exportText(session)).toContain("Wand A (geändert)");
  });

  it("BEFUND B3: undo räumt das Overlay, der Export behält aber den neuen Namen", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const oldName = session.store.entities.getName(wall);
    const before = exportData(session);

    const command = cmdSetAttribute(
      session,
      wall,
      "Name",
      "Wand A (geändert)",
      oldName,
    );
    command.run();
    command.undo();

    // Das Overlay-Map ist korrekt geleert …
    expect(session.view.getAttributeMutationsForEntity(wall)).toEqual([]);
    // … aber der StepExporter liest UPDATE_ATTRIBUTE aus der APPEND-ONLY
    // Mutationshistorie (`getMutations()`), nicht aus dem Overlay-Map.
    // `removeAttributeMutation()` — der Undo-Pfad von cmdSetAttribute —
    // entfernt nichts aus dieser Historie, also bleibt der neue Name im Export.
    expect(
      session.view.getMutations().filter((m) => m.type === "UPDATE_ATTRIBUTE"),
    ).toHaveLength(1);
    expect(exportText(session)).toContain("Wand A (geändert)");
    expect(exportData(session)).not.toBe(before);
  });

  it("ein History-anhängendes Gegen-setAttribute stellt den Export byte-identisch her", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const oldName = session.store.entities.getName(wall);
    const before = exportData(session);

    // Vorwärts …
    session.view.setAttribute(wall, "Name", "Wand A (geändert)", oldName);
    expect(exportText(session)).toContain("Wand A (geändert)");

    // … und zurück, OHNE skipHistory: die spätere Mutation überschreibt die
    // frühere beim Export. Das ist der Pfad, den ein korrektes Undo braucht.
    session.view.setAttribute(wall, "Name", oldName, "Wand A (geändert)");

    expect(exportText(session)).not.toContain("Wand A (geändert)");
    expect(exportData(session)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 4) cmdSetPropertyOnMany
// ---------------------------------------------------------------------------

describe("M2: cmdSetPropertyOnMany (Batch als ein Undo-Schritt)", () => {
  it("ein run setzt alle drei Objekte, ein undo entfernt alle", async () => {
    const session = await openSession(createSampleIfc());
    const walls = wallIds(session).slice(0, 3);
    const docId = nextDocId();
    const before = exportData(session);

    const command = cmdSetPropertyOnMany(
      session,
      walls,
      "ePset_Bauteil",
      "Bauabschnitt",
      "BA-02",
    );
    expect(command.label).toContain("3 Objekte");

    useCommands.getState().execute(docId, command);

    for (const id of walls) {
      expect(session.view.getPropertyValue(id, "ePset_Bauteil", "Bauabschnitt"))
        .toBe("BA-02");
    }
    expect(session.view.getModifiedEntityCount()).toBe(3);

    // Genau EIN Undo-Schritt auf dem Stapel.
    expect(useCommands.getState().byDocument[docId].undoStack).toHaveLength(1);

    const reparsed = await openSession(exportText(session));
    for (const id of wallIds(reparsed).slice(0, 3)) {
      expect(readProperty(reparsed, id, "ePset_Bauteil", "Bauabschnitt")).toBe(
        "BA-02",
      );
    }

    useCommands.getState().undo(docId);

    for (const id of walls) {
      expect(session.view.getPropertyValue(id, "ePset_Bauteil", "Bauabschnitt"))
        .toBeNull();
    }
    expect(exportData(session)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 5) Pipeline-Invarianten
// ---------------------------------------------------------------------------

describe("M2: Pipeline-Invarianten (useCommands)", () => {
  it("execute×3 → undo×3 liefert die Ursprungs-DATA-Sektion byte-gleich", async () => {
    const session = await openSession(createSampleIfc());
    const walls = wallIds(session);
    const docId = nextDocId();
    const before = exportData(session);

    const pipeline = useCommands.getState();
    pipeline.execute(
      docId,
      cmdSetProperty(session, walls[0], "Pset_M2", "Stufe", "1"),
    );
    pipeline.execute(
      docId,
      cmdSetProperty(session, walls[1], "Pset_M2", "Stufe", "2"),
    );
    pipeline.execute(
      docId,
      cmdSetProperty(session, walls[2], "Pset_M2", "Stufe", "3"),
    );
    expect(exportData(session)).not.toBe(before);
    expect(useCommands.getState().byDocument[docId].undoStack).toHaveLength(3);

    for (let i = 0; i < 3; i++) useCommands.getState().undo(docId);

    expect(exportData(session)).toBe(before);
    const history = useCommands.getState().byDocument[docId];
    expect(history.undoStack).toHaveLength(0);
    expect(history.redoStack).toHaveLength(3);
    // Audit-Log: 3× "do" + 3× "undo", in Reihenfolge.
    expect(history.audit.map((a) => a.kind)).toEqual([
      "do",
      "do",
      "do",
      "undo",
      "undo",
      "undo",
    ]);
  });

  it("undo bei leerem Stapel ist ein no-op (kein Wurf, kein Export-Effekt)", async () => {
    const session = await openSession(createSampleIfc());
    const docId = nextDocId();
    const before = exportData(session);

    expect(useCommands.getState().byDocument[docId]).toBeUndefined();
    expect(() => useCommands.getState().undo(docId)).not.toThrow();
    expect(() => useCommands.getState().redo(docId)).not.toThrow();

    // Es wird nicht einmal ein History-Eintrag angelegt.
    expect(useCommands.getState().byDocument[docId]).toBeUndefined();
    expect(exportData(session)).toBe(before);
  });

  it("ein neues execute leert den Redo-Stapel", async () => {
    const session = await openSession(createSampleIfc());
    const walls = wallIds(session);
    const docId = nextDocId();
    const pipeline = useCommands.getState();

    pipeline.execute(docId, cmdSetProperty(session, walls[0], "Pset_M2", "A", "1"));
    pipeline.execute(docId, cmdSetProperty(session, walls[1], "Pset_M2", "A", "2"));
    useCommands.getState().undo(docId);
    expect(useCommands.getState().byDocument[docId].redoStack).toHaveLength(1);

    pipeline.execute(docId, cmdSetProperty(session, walls[2], "Pset_M2", "A", "3"));

    const history = useCommands.getState().byDocument[docId];
    expect(history.redoStack).toHaveLength(0);
    expect(history.undoStack).toHaveLength(2);
    // Der verworfene Redo-Befehl darf nicht nachträglich wirken.
    useCommands.getState().redo(docId);
    expect(session.view.getPropertyValue(walls[1], "Pset_M2", "A")).toBeNull();
  });

  it("execute arbeitet ohne registriertes Dokument (documents.touch ist dann ein no-op)", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const docId = nextDocId();

    // Die Pipeline ruft useDocuments.getState().touch(docId) auf. Ist das
    // Dokument nicht registriert, mappt touch über eine leere Liste — no-op.
    expect(() =>
      useCommands
        .getState()
        .execute(docId, cmdSetProperty(session, wall, "Pset_M2", "A", "x")),
    ).not.toThrow();
    expect(session.view.getPropertyValue(wall, "Pset_M2", "A")).toBe("x");
  });
});

// ---------------------------------------------------------------------------
// 6) view-/StoreEditor-Ebene: Semantik-Absicherung für kommende Commands
// ---------------------------------------------------------------------------

describe("M2: view-Ebene — Psets, Entities, StoreEditor", () => {
  it("createPropertySet + deletePropertySet ist ein sauberer Roundtrip", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const before = exportData(session);

    session.view.createPropertySet(wall, "ePset_Objektinformation", [
      { name: "_Bezeichnung", value: "Außenwand", type: PropertyValueType.Label },
      { name: "_Nummer", value: 7, type: PropertyValueType.Integer },
    ]);
    expect(exportText(session)).toContain("ePset_Objektinformation");

    const reparsed = await openSession(exportText(session));
    const [wall2] = wallIds(reparsed);
    expect(readProperty(reparsed, wall2, "ePset_Objektinformation", "_Bezeichnung"))
      .toBe("Außenwand");

    session.view.deletePropertySet(wall, "ePset_Objektinformation");
    expect(exportText(session)).not.toContain("ePset_Objektinformation");
    expect(exportData(session)).toBe(before);
  });

  it("BEFUND B6: view.createEntity vergibt ohne gesetzte Wasserlinie kollidierende IDs", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);

    // setExpressIdWatermark() wird ausschließlich vom StoreEditor-Konstruktor
    // aufgerufen. Wer view.createEntity() direkt benutzt, ohne vorher
    // session.editor() angefasst zu haben, beginnt bei 1 — und kollidiert mit
    // bestehenden Records (#1 = IFCPERSON im Fixture).
    expect(session.view.peekNextExpressId()).toBe(1);
    const collided = session.view.createEntity("IfcRelAggregates", [
      "2mIfcRelAggrM2Test00w",
      null,
      null,
      null,
      `#${wall}`,
      [`#${wall}`],
    ]);
    expect(collided.expressId).toBe(1);
    session.view.deleteEntity(collided.expressId);

    // Nach dem ersten session.editor()-Zugriff ist die Wasserlinie gesetzt.
    session.editor();
    expect(session.view.peekNextExpressId()).toBeGreaterThan(wall);
  });

  it("createEntity + deleteEntity: eine Overlay-Entity verschwindet spurlos", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    session.editor(); // setzt die expressId-Wasserlinie, siehe BEFUND B6
    const before = exportData(session);
    const aggregatesBefore = (
      session.store.entityIndex.byType.get("IFCRELAGGREGATES") ?? []
    ).length;

    const created = session.view.createEntity("IfcRelAggregates", [
      "2mIfcRelAggrM2Test01x",
      null,
      "Overlay-Aggregat",
      null,
      `#${wall}`,
      [`#${wall}`],
    ]);
    expect(session.view.getNewEntities()).toHaveLength(1);

    const withEntity = exportText(session);
    expect(
      (withEntity.match(/IFCRELAGGREGATES/g) ?? []).length,
    ).toBe(aggregatesBefore + 1);

    // Overlay-Entities werden bei deleteEntity schlicht vergessen (kein Grabstein).
    expect(session.view.deleteEntity(created.expressId)).toBe(true);
    expect(session.view.getNewEntities()).toHaveLength(0);
    expect(exportData(session)).toBe(before);
  });

  it("deleteEntity + restoreFromTombstone auf einer bestehenden Entity", async () => {
    const session = await openSession(createSampleIfc());
    const walls = wallIds(session);
    const victim = walls[2];
    const before = exportData(session);

    expect(session.view.deleteEntity(victim)).toBe(true);
    expect(session.view.isDeleted(victim)).toBe(true);
    expect(session.view.getTombstones().has(victim)).toBe(true);

    const reparsed = await openSession(exportText(session));
    expect(
      (reparsed.store.entityIndex.byType.get("IFCWALL") ?? []).length,
    ).toBe(walls.length - 1);

    expect(session.view.restoreFromTombstone(victim)).toBe(true);
    expect(session.view.isDeleted(victim)).toBe(false);
    expect(exportData(session)).toBe(before);
    // Zweiter Restore findet keinen Grabstein mehr.
    expect(session.view.restoreFromTombstone(victim)).toBe(false);
  });

  it("StoreEditor.addEntity eines IFCRELAGGREGATES landet im Export und im Reparse", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const aggregatesBefore = (
      session.store.entityIndex.byType.get("IFCRELAGGREGATES") ?? []
    ).length;

    // session.editor() ist der App-Pfad: eine gecachte StoreEditor-Instanz je
    // Sitzung, deren Konstruktor die expressId-Wasserlinie setzt.
    const editor = session.editor();
    // Argumentkonventionen: GlobalId als PLAINER String (der Exporter quotet
    // selbst — eigene Quotes würden zu '''…''' verdoppelt), Referenzen als
    // '#42'-Strings, Listen als Array, leere Slots als null → '$'.
    const ref = editor.addEntity("IfcRelAggregates", [
      "2mIfcRelAggrM2Test02y",
      null,
      "M2-Aggregat",
      null,
      `#${wall}`,
      [`#${wall}`],
    ]);
    expect(ref.expressId).toBeGreaterThan(wall);

    const exported = exportText(session);
    const line = exported
      .split("\n")
      .find((l) => l.startsWith(`#${ref.expressId}=`));
    expect(line).toBeDefined();
    expect(line).toContain("IFCRELAGGREGATES");
    expect(line).toContain("'2mIfcRelAggrM2Test02y'");
    expect(line).toContain("'M2-Aggregat'");
    expect(line).toContain(`#${wall}`);
    expect(line).toContain(`(#${wall})`);

    const reparsed = await openSession(exported);
    expect(
      (reparsed.store.entityIndex.byType.get("IFCRELAGGREGATES") ?? []).length,
    ).toBe(aggregatesBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// 7) Undo-Sauberkeit
// ---------------------------------------------------------------------------

describe("M2: Undo-Sauberkeit — was die API nach dem Undo real liefert", () => {
  it("BEFUND B4: getMutations() ist append-only und schrumpft beim Undo NICHT", async () => {
    const session = await openSession(createSampleIfc());
    const [wall] = wallIds(session);
    const docId = nextDocId();

    expect(session.view.getMutations()).toHaveLength(0);
    expect(session.view.hasPendingChanges()).toBe(false);

    useCommands
      .getState()
      .execute(docId, cmdSetProperty(session, wall, "Pset_M2", "A", "1"));
    expect(session.view.getMutations()).toHaveLength(1);

    useCommands.getState().undo(docId);

    // Der Undo-Pfad benutzt skipHistory=true — die Historie bleibt also bei 1.
    // `session.changeCount` (= getMutations().length) taugt daher NICHT als
    // „ungespeicherte Änderungen"-Anzeige nach einem Undo.
    expect(session.view.getMutations()).toHaveLength(1);
    expect(session.changeCount).toBe(1);

    // hasPendingChanges() spiegelt den Overlay-Footprint und ist laut
    // ifc-lite-Doku eine bewusst konservative Überschätzung: das Undo hat
    // einen DELETE-Marker im Overlay hinterlassen, also bleibt es true.
    expect(session.view.hasPendingChanges()).toBe(true);
    expect(session.view.getModifiedEntityCount()).toBe(1);
  });

  it("verlässliches Kriterium bleibt der Export: nach execute+undo ist die DATA-Sektion identisch", async () => {
    const session = await openSession(createSampleIfc());
    const walls = wallIds(session);
    const docId = nextDocId();
    const before = exportData(session);

    useCommands
      .getState()
      .execute(docId, cmdSetProperty(session, walls[0], "Pset_M2", "A", "1"));
    useCommands
      .getState()
      .execute(
        docId,
        cmdSetPropertyOnMany(session, walls, "Pset_M2", "B", "2"),
      );
    useCommands.getState().undo(docId);
    useCommands.getState().undo(docId);

    expect(exportData(session)).toBe(before);
    // Trotzdem meldet das Overlay „pending" — Befund B4.
    expect(session.view.hasPendingChanges()).toBe(true);
  });
});
