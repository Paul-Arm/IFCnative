/**
 * M5-Verifikationstests: Baukasten (Geometrie erzeugen und ändern).
 *
 * Geprüft wird das Zusammenspiel von
 *   - `src/domain/geometry/**`            (Emitter, Referenzketten, Records)
 *   - `src/commands/geometryCommands.ts`  (cmdCreateElement, cmdUpdateDimensions,
 *                                          cmdMoveElement, cmdCreateOpening)
 *   - `src/core/session.ts`               (StoreEditor, RelationOverlay, Export)
 *
 * Referenzkriterium ist wie in M2 der STEP-Export: eine Änderung gilt erst als
 * zurückgenommen, wenn die DATA-Sektion byte-identisch zum Ausgangsexport ist.
 * Zusätzlich wird der Export neu geparst — nur was den Reparse übersteht, ist
 * wirklich im Modell angekommen.
 *
 * BEFUND (Kernfrage): Die In-Store-Builder aus @ifc-lite/create arbeiten
 * unverändert auf `session.editor()` (StoreEditor über IfcDataStore +
 * MutablePropertyView). Sie decken Wand/Decke/Stütze/Träger mit Rechteckprofil
 * ab; Kreisprofil, IfcBuildingElementProxy und Öffnungen emittiert
 * `domain/geometry/build.ts` selbst.
 */
import { describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";
import { ModelSession } from "../src/core/session";
import { useCommands } from "../src/commands/pipeline";
import {
  cmdCreateElement,
  cmdCreateOpening,
  cmdMoveElement,
  cmdUpdateDimensions,
} from "../src/commands/geometryCommands";
import {
  DEFAULT_CREATE_PARAMS,
  DEFAULT_OPENING_PARAMS,
  findExtrusion,
  findPlacementPoint,
  toMetres,
  toNative,
} from "../src/domain/geometry";
import type { IfcDataStore } from "@ifc-lite/parser";

// ---------------------------------------------------------------------------
// Fixture & Helfer
// ---------------------------------------------------------------------------

function createSampleIfc(): string {
  const creator = new IfcCreator({ Name: "M5-Baukasten" });
  const storey = creator.addIfcBuildingStorey({
    Name: "Erdgeschoss",
    Elevation: 0,
  });
  creator.addIfcWall(storey, {
    Name: "Bestandswand",
    Start: [0, 0, 0],
    End: [5, 0, 0],
    Thickness: 0.2,
    Height: 3,
  });
  return creator.toIfc().content;
}

async function openSession(
  text: string,
  fileName = "m5.ifc",
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

/** Export erneut parsen — Prüfstein für „ist wirklich im Modell". */
const reparse = (session: ModelSession): Promise<ModelSession> =>
  openSession(toText(session.exportStep()), "m5-reparse.ifc");

const storeyId = (session: ModelSession): number => {
  const ids = session.store.entityIndex.byType.get("IFCBUILDINGSTOREY") ?? [];
  expect(ids.length, "Fixture ohne Geschoss").toBeGreaterThan(0);
  return ids[0];
};

const sourceOf = (session: ModelSession) => ({
  store: session.store,
  view: session.view,
});

/** Elemente des ersten Geschosses im Strukturbaum. */
function storeyElements(session: ModelSession): number[] {
  const found: number[] = [];
  const walk = (node: ReturnType<ModelSession["spatialTree"]>): void => {
    if (!node) return;
    if (node.type.toUpperCase() === "IFCBUILDINGSTOREY") {
      found.push(...node.elements);
    }
    for (const child of node.children) walk(child);
  };
  walk(session.spatialTree());
  return found;
}

let docCounter = 0;
const nextDocId = (): string => `m5-doc-${++docCounter}`;

// ---------------------------------------------------------------------------
// 1) cmdCreateElement
// ---------------------------------------------------------------------------

describe("M5: cmdCreateElement — Records, Containment, Undo/Redo", () => {
  it("erzeugt Bauteil, Extrusion und Containment; Undo ist byte-identisch", async () => {
    const session = await openSession(createSampleIfc());
    const docId = nextDocId();
    const before = exportData(session);

    const command = cmdCreateElement(session, storeyId(session), {
      ...DEFAULT_CREATE_PARAMS,
      klasse: "wall",
      breite: 4,
      tiefe: 0.24,
      hoehe: 2.75,
      x: 0,
      y: 3,
      name: "Neue Wand",
      tag: "W-01",
    });
    useCommands.getState().execute(docId, command);
    const newId = command.createdId();
    expect(newId, "cmdCreateElement liefert keine expressId").not.toBeNull();

    // Overlay-Kante ist sofort im Strukturbaum sichtbar (ohne Reparse).
    expect(storeyElements(session)).toContain(newId);

    const afterCreate = exportData(session);
    const roundTrip = await reparse(session);
    expect(roundTrip.store.entityIndex.byType.get("IFCWALL")).toContain(newId);
    expect(storeyElements(roundTrip), "Containment fehlt nach Reparse").toContain(
      newId as number,
    );

    const extrusion = findExtrusion(sourceOf(roundTrip), newId as number);
    expect(extrusion, "kein Extrusionskörper nach Reparse").not.toBeNull();
    expect(extrusion?.profile.type).toBe("IFCRECTANGLEPROFILEDEF");
    expect(extrusion?.xDim).toBeCloseTo(4, 6);
    expect(extrusion?.yDim).toBeCloseTo(0.24, 6);
    expect(extrusion?.depth).toBeCloseTo(2.75, 6);
    expect(roundTrip.identityOf(newId as number).name).toBe("Neue Wand");

    useCommands.getState().undo(docId);
    expect(exportData(session), "Undo nicht byte-identisch").toBe(before);
    expect(storeyElements(session)).not.toContain(newId);

    useCommands.getState().redo(docId);
    expect(exportData(session), "Redo weicht vom ersten Lauf ab").toBe(
      afterCreate,
    );
    expect(command.createdId(), "expressId nach Redo instabil").toBe(newId);
  });

  it("Eigenbau-Pfad: Kreisprofil und IfcBuildingElementProxy", async () => {
    const session = await openSession(createSampleIfc());
    const docId = nextDocId();

    const command = cmdCreateElement(session, storeyId(session), {
      ...DEFAULT_CREATE_PARAMS,
      klasse: "proxy",
      profil: "kreis",
      radius: 0.25,
      hoehe: 3.5,
      x: 2,
      y: 2,
      z: 0,
      name: "Rundstütze",
    });
    useCommands.getState().execute(docId, command);
    const newId = command.createdId() as number;

    const roundTrip = await reparse(session);
    expect(
      roundTrip.store.entityIndex.byType.get("IFCBUILDINGELEMENTPROXY"),
    ).toContain(newId);
    const extrusion = findExtrusion(sourceOf(roundTrip), newId);
    expect(extrusion?.profile.type).toBe("IFCCIRCLEPROFILEDEF");
    expect(extrusion?.radius).toBeCloseTo(0.25, 6);
    expect(extrusion?.depth).toBeCloseTo(3.5, 6);
    expect(storeyElements(roundTrip)).toContain(newId);
  });
});

// ---------------------------------------------------------------------------
// 2) cmdUpdateDimensions
// ---------------------------------------------------------------------------

describe("M5: cmdUpdateDimensions — Maße bestehender Extrusionen", () => {
  it("ändert XDim und Depth einer geparsten Wand und ist undo-/redo-bar", async () => {
    const session = await openSession(createSampleIfc());
    const docId = nextDocId();
    const wallId = (session.store.entityIndex.byType.get("IFCWALL") ?? [])[0];
    const before = exportData(session);
    const original = findExtrusion(sourceOf(session), wallId);
    expect(original?.xDim).toBeCloseTo(5, 6);

    useCommands
      .getState()
      .execute(docId, cmdUpdateDimensions(session, wallId, { xDim: 7.5, depth: 4 }));
    const afterEdit = exportData(session);

    const roundTrip = await reparse(session);
    const changed = findExtrusion(sourceOf(roundTrip), wallId);
    expect(changed?.xDim).toBeCloseTo(7.5, 6);
    expect(changed?.yDim).toBeCloseTo(0.2, 6);
    expect(changed?.depth).toBeCloseTo(4, 6);

    useCommands.getState().undo(docId);
    expect(exportData(session), "Undo nicht byte-identisch").toBe(before);
    useCommands.getState().redo(docId);
    expect(exportData(session)).toBe(afterEdit);
  });

  it("ändert die Maße eines frisch erzeugten Overlay-Bauteils", async () => {
    const session = await openSession(createSampleIfc());
    const docId = nextDocId();
    const create = cmdCreateElement(session, storeyId(session), {
      ...DEFAULT_CREATE_PARAMS,
      klasse: "column",
      breite: 0.3,
      tiefe: 0.3,
      hoehe: 3,
      x: 1,
      y: 1,
    });
    useCommands.getState().execute(docId, create);
    const newId = create.createdId() as number;
    const beforeEdit = exportData(session);

    useCommands
      .getState()
      .execute(
        docId,
        cmdUpdateDimensions(session, newId, { xDim: 0.5, yDim: 0.6, depth: 2.5 }),
      );

    const roundTrip = await reparse(session);
    const changed = findExtrusion(sourceOf(roundTrip), newId);
    expect(changed?.xDim).toBeCloseTo(0.5, 6);
    expect(changed?.yDim).toBeCloseTo(0.6, 6);
    expect(changed?.depth).toBeCloseTo(2.5, 6);

    useCommands.getState().undo(docId);
    expect(
      exportData(session),
      "Undo am Overlay-Record nicht byte-identisch",
    ).toBe(beforeEdit);
  });

  it("meldet einen Fehler, wenn das Bauteil keine Extrusion trägt", async () => {
    const session = await openSession(createSampleIfc());
    const storey = storeyId(session);
    expect(() => cmdUpdateDimensions(session, storey, { depth: 2 }).run()).toThrow(
      /Extrusionskörper/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3) cmdMoveElement
// ---------------------------------------------------------------------------

describe("M5: cmdMoveElement — Location des IfcLocalPlacement", () => {
  it("verschiebt den IfcCartesianPoint und nimmt das sauber zurück", async () => {
    const session = await openSession(createSampleIfc());
    const docId = nextDocId();
    const wallId = (session.store.entityIndex.byType.get("IFCWALL") ?? [])[0];
    const before = exportData(session);
    const start = findPlacementPoint(sourceOf(session), wallId);
    expect(start, "Wand ohne IfcLocalPlacement").not.toBeNull();

    useCommands.getState().execute(docId, cmdMoveElement(session, wallId, 1, 2, 0.5));
    const afterMove = exportData(session);

    const roundTrip = await reparse(session);
    const moved = findPlacementPoint(sourceOf(roundTrip), wallId);
    expect(moved?.coords[0]).toBeCloseTo((start?.coords[0] ?? 0) + 1, 6);
    expect(moved?.coords[1]).toBeCloseTo((start?.coords[1] ?? 0) + 2, 6);
    expect(moved?.coords[2]).toBeCloseTo((start?.coords[2] ?? 0) + 0.5, 6);
    // Der mutierte Punkt bleibt derselbe Record — keine neue Geometrie.
    expect(moved?.point.expressId).toBe(start?.point.expressId);

    useCommands.getState().undo(docId);
    expect(exportData(session), "Undo nicht byte-identisch").toBe(before);
    useCommands.getState().redo(docId);
    expect(exportData(session)).toBe(afterMove);
  });

  it("rechnet Meter-Eingaben in die Modelleinheit um", () => {
    const millimetre = { lengthUnitScale: 0.001 } as unknown as IfcDataStore;
    expect(toNative(millimetre, 2.8)).toBe(2800);
    expect(toMetres(millimetre, 2800)).toBeCloseTo(2.8, 9);
    const metre = { lengthUnitScale: 1 } as unknown as IfcDataStore;
    expect(toNative(metre, 2.8)).toBe(2.8);
  });
});

// ---------------------------------------------------------------------------
// 4) cmdCreateOpening
// ---------------------------------------------------------------------------

describe("M5: cmdCreateOpening — IfcOpeningElement + IfcRelVoidsElement", () => {
  it("schneidet eine Öffnung in eine geparste Wand; Undo bleibt sauber", async () => {
    const session = await openSession(createSampleIfc());
    const docId = nextDocId();
    const wallId = (session.store.entityIndex.byType.get("IFCWALL") ?? [])[0];
    const before = exportData(session);

    const command = cmdCreateOpening(session, wallId, {
      ...DEFAULT_OPENING_PARAMS,
      breite: 1.2,
      hoehe: 2.1,
      abstand: 2,
      bruestung: 0.9,
      name: "Fenster 1",
    });
    useCommands.getState().execute(docId, command);
    const openingId = command.createdId() as number;
    const afterCreate = exportData(session);

    // Die Void-Kante ist über das Sitzungs-Overlay sofort sichtbar.
    const relations = session.relationsOf(wallId);
    expect(relations.some((row) => row.otherId === openingId)).toBe(true);

    const roundTrip = await reparse(session);
    expect(
      roundTrip.store.entityIndex.byType.get("IFCOPENINGELEMENT"),
    ).toContain(openingId);
    expect(
      (roundTrip.store.entityIndex.byType.get("IFCRELVOIDSELEMENT") ?? []).length,
    ).toBe(1);
    const openingBody = findExtrusion(sourceOf(roundTrip), openingId);
    expect(openingBody?.xDim).toBeCloseTo(1.2, 6);
    expect(openingBody?.depth).toBeCloseTo(2.1, 6);
    const openingPlace = findPlacementPoint(sourceOf(roundTrip), openingId);
    expect(openingPlace?.coords[0]).toBeCloseTo(2, 6);
    expect(openingPlace?.coords[2]).toBeCloseTo(0.9, 6);

    useCommands.getState().undo(docId);
    expect(exportData(session), "Undo nicht byte-identisch").toBe(before);
    expect(
      session.relationsOf(wallId).some((row) => row.otherId === openingId),
    ).toBe(false);

    useCommands.getState().redo(docId);
    expect(exportData(session)).toBe(afterCreate);
    expect(command.createdId(), "expressId nach Redo instabil").toBe(openingId);
  });

  it("weist unzulässige Wirte über die Beziehungsregeln ab", async () => {
    const session = await openSession(createSampleIfc());
    expect(() =>
      cmdCreateOpening(session, storeyId(session), DEFAULT_OPENING_PARAMS),
    ).toThrow(/Öffnung/);
  });
});
