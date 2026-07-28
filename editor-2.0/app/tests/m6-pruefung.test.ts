/**
 * M6-Verifikationstests: Prüfzentrum-Quellen (Roadmap M6).
 *
 * Geprüft werden die drei in `src/domain/checks/sources/**` implementierten
 * Quellen direkt über ihre `run(session)`-Funktion — bewusst OHNE die
 * Registry aus `src/domain/checks/store.ts`, die parallel entsteht:
 *
 *   - `diagnostics` — Projekt/Einheiten, doppelte GlobalIds, Platzierung,
 *     Repräsentation, räumliche Zuordnung,
 *   - `objectInfo`  — ePset_Objektinformation-Familie (Portierung von 1.x),
 *   - `clash`       — @ifc-lite/clash über die Sitzungs-Exportbytes.
 *
 * BEFUND (Kernfrage Clash): Die Kette Export → `GeometryProcessor.process()`
 * (WASM) → `elementsFromStep` → `createClashEngine().run()` läuft im reinen
 * Node-Kontext von vitest vollständig durch; ein Skip ist nicht nötig.
 */
import { describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";
import { PropertyValueType } from "@ifc-lite/data";
import { ModelSession } from "../src/core/session";
import { run as runDiagnostics } from "../src/domain/checks/sources/diagnostics";
import { run as runObjectInfo } from "../src/domain/checks/sources/objectInfo";
import { run as runClash } from "../src/domain/checks/sources/clash";
import type { CheckFinding } from "../src/domain/checks/types";

// ---------------------------------------------------------------------------
// Fixtures & Helfer
// ---------------------------------------------------------------------------

/** Zwei sich kreuzende Wände in einem Geschoss (Kollisionsfall). */
function createCrossingWalls(): string {
  const creator = new IfcCreator({ Name: "M6-Prüfung" });
  const storey = creator.addIfcBuildingStorey({
    Name: "Erdgeschoss",
    Elevation: 0,
  });
  creator.addIfcWall(storey, {
    Name: "Wand A",
    Start: [0, 0, 0],
    End: [5, 0, 0],
    Thickness: 0.4,
    Height: 3,
  });
  creator.addIfcWall(storey, {
    Name: "Wand B",
    Start: [2, -2, 0],
    End: [2, 2, 0],
    Thickness: 0.4,
    Height: 3,
  });
  return creator.toIfc().content;
}

/** Vier freistehende Wände — Träger der Objektinfo-Psets. */
function createFourWalls(): string {
  const creator = new IfcCreator({ Name: "M6-Objektinfo" });
  const storey = creator.addIfcBuildingStorey({
    Name: "Erdgeschoss",
    Elevation: 0,
  });
  for (let i = 0; i < 4; i++) {
    creator.addIfcWall(storey, {
      Name: `Wand ${i + 1}`,
      Start: [0, i * 3, 0],
      End: [4, i * 3, 0],
      Thickness: 0.2,
      Height: 3,
    });
  }
  return creator.toIfc().content;
}

async function openSession(
  text: string,
  fileName = "m6.ifc",
): Promise<ModelSession> {
  const bytes = new TextEncoder().encode(text);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return ModelSession.open(fileName, buffer);
}

const WALL_LINE = /^#(\d+)=IFCWALL\('([^']+)'/;

/** Alle Wand-Zeilen des Exports als (expressId, GlobalId). */
function wallLines(text: string): Array<{ id: number; guid: string }> {
  const walls: Array<{ id: number; guid: string }> = [];
  for (const line of text.split("\n")) {
    const match = WALL_LINE.exec(line.trim());
    if (match) walls.push({ id: Number(match[1]), guid: match[2] });
  }
  return walls;
}

/**
 * GlobalId der zweiten Wand durch die der ersten ersetzen — so entsteht die
 * Kollision, die kein Erzeuger absichtlich baut.
 */
function forceDuplicateGlobalId(text: string): {
  text: string;
  guid: string;
  ids: number[];
} {
  const walls = wallLines(text);
  expect(walls.length, "Fixture braucht mindestens zwei Wände").toBeGreaterThan(
    1,
  );
  const [first, second] = walls;
  const patched = text
    .split("\n")
    .map((line) =>
      line.trimStart().startsWith(`#${second.id}=IFCWALL(`)
        ? line.split(`'${second.guid}'`).join(`'${first.guid}'`)
        : line,
    )
    .join("\n");
  return { text: patched, guid: first.guid, ids: [first.id, second.id] };
}

const kinds = (findings: CheckFinding[]): string[] =>
  findings.map((finding) => finding.kind);

const ofKind = (findings: CheckFinding[], kind: string): CheckFinding[] =>
  findings.filter((finding) => finding.kind === kind);

const PROJECT_UNIT_KINDS = [
  "missing-project",
  "multiple-projects",
  "missing-unit-assignment",
  "multiple-unit-assignments",
  "project-without-units",
];

// ---------------------------------------------------------------------------
// (a) Modell-Diagnostik
// ---------------------------------------------------------------------------

describe("M6: Modell-Diagnostik", () => {
  it("Normalmodell: Projekt und Einheiten gelten als bestanden", async () => {
    const session = await openSession(createCrossingWalls());
    const result = await runDiagnostics(session);

    expect(result.source).toBe("diagnostics");
    expect(result.checkedCount).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(
      result.findings.filter((f) => PROJECT_UNIT_KINDS.includes(f.kind)),
      "Normalmodell darf keine Projekt-/Einheiten-Befunde erzeugen",
    ).toEqual([]);
    expect(kinds(result.findings)).not.toContain("duplicate-global-id");
    // Beide Wände haben Platzierung, Geometrie und Geschosszuordnung.
    expect(kinds(result.findings)).not.toContain("missing-placement");
    expect(kinds(result.findings)).not.toContain("missing-representation");
    expect(kinds(result.findings)).not.toContain("missing-containment");
  });

  it("doppelte GlobalId wird als Fehler mit beiden Objekten gemeldet", async () => {
    const { text, guid, ids } = forceDuplicateGlobalId(createCrossingWalls());
    const session = await openSession(text);
    const result = await runDiagnostics(session);

    const duplicates = ofKind(result.findings, "duplicate-global-id");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].severity).toBe("error");
    expect(duplicates[0].message).toContain(guid);
    expect([...duplicates[0].entityIds].sort()).toEqual([...ids].sort());
    expect(duplicates[0].detail).toContain("GlobalId-Register");
  });

  it("Sitzungsänderung an der Repräsentation schlägt durch", async () => {
    const session = await openSession(createCrossingWalls());
    const wall = (session.store.entityIndex.byType.get("IFCWALL") ?? [])[0];
    // Representation ist Attribut 6 von IfcProduct — die Quelle liest
    // positionale Mutationen, nicht nur die Quellzeile.
    session.view.setPositionalAttribute(wall, 6, null);

    const result = await runDiagnostics(session);
    const missing = ofKind(result.findings, "missing-representation");
    expect(missing).toHaveLength(1);
    expect(missing[0].entityIds).toEqual([wall]);
    expect(missing[0].severity).toBe("warning");
  });

  it("Bauteile ohne räumliche Zuordnung werden gemeldet", async () => {
    const text = createCrossingWalls().replace(
      /^#\d+=IFCRELCONTAINEDINSPATIALSTRUCTURE[^\n]*\n/m,
      "",
    );
    const session = await openSession(text);
    const result = await runDiagnostics(session);

    const missing = ofKind(result.findings, "missing-containment");
    expect(missing).toHaveLength(2);
    expect(missing[0].severity).toBe("warning");
    expect(missing[0].message).toContain("räumlichen Struktur");
  });

  it("fehlende Einheitenzuweisung erscheint als Warnung", async () => {
    const text = createCrossingWalls().replace(
      /^#19=IFCUNITASSIGNMENT[^\n]*\n/m,
      "",
    );
    const session = await openSession(text);
    const result = await runDiagnostics(session);

    const missing = ofKind(result.findings, "missing-unit-assignment");
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe("warning");
    expect(missing[0].message).toContain("IFCUNITASSIGNMENT");
  });
});

// ---------------------------------------------------------------------------
// (b) Objektinfo-IDs
// ---------------------------------------------------------------------------

/**
 * Objektinfo-Modell im Overlay aufbauen: Wand 1 verweist per Semikolon-Liste
 * auf eine doppelt vergebene und eine unbekannte ID, Wand 4 trägt ein
 * Objektinfo-Pset ohne _ID und eine Fremd-_ID.
 */
async function objectInfoSession(): Promise<{
  session: ModelSession;
  walls: number[];
  storeyId: number;
}> {
  const session = await openSession(createFourWalls(), "m6-objektinfo.ifc");
  const walls = session.store.entityIndex.byType.get("IFCWALL") ?? [];
  expect(walls.length).toBe(4);
  const storeyId = (session.store.entityIndex.byType.get("IFCBUILDINGSTOREY") ??
    [])[0];

  const label = PropertyValueType.Label;
  session.view.createPropertySet(walls[0], "ePset_Objektinformation", [
    { name: "_ID", value: "A-100", type: label },
    { name: "_UntersuchungszielIDs", value: "A-200;A-999", type: label },
    { name: "_QuelleID", value: "X-1", type: label },
  ]);
  session.view.createPropertySet(walls[1], "ePset_Objektinformation", [
    { name: "_ID", value: "A-200", type: label },
  ]);
  session.view.createPropertySet(walls[2], "ePset_Objektinformation", [
    { name: "_ID", value: "A-200", type: label },
  ]);
  session.view.createPropertySet(walls[3], "ePset_Objektinformation", [
    { name: "_Bezeichnung", value: "ohne Kennung", type: label },
    { name: "_ReferenzID", value: "", type: label },
  ]);
  session.view.createPropertySet(walls[3], "ePset_Fremdsystem", [
    { name: "_ID", value: "X-1", type: label },
  ]);
  session.view.createPropertySet(storeyId, "ePset_Objektinformation", [
    { name: "_ID", value: "", type: label },
  ]);
  return { session, walls, storeyId };
}

describe("M6: Objektinfo-IDs", () => {
  it("erkennt doppelte, leere, fehlende und unbekannte IDs", async () => {
    const { session, walls, storeyId } = await objectInfoSession();
    const result = await runObjectInfo(session);
    const found = kinds(result.findings);

    expect(result.source).toBe("object-info");
    expect(result.checkedCount).toBe(5);

    const duplicate = ofKind(result.findings, "duplicate-object-info-id");
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0].severity).toBe("error");
    expect(duplicate[0].message).toContain("A-200");
    expect([...duplicate[0].entityIds].sort()).toEqual(
      [walls[1], walls[2]].sort(),
    );

    const missingId = ofKind(result.findings, "missing-object-info-id");
    expect(missingId).toHaveLength(1);
    expect(missingId[0].entityIds).toEqual([walls[3]]);
    expect(missingId[0].severity).toBe("warning");

    const emptyId = ofKind(result.findings, "empty-object-info-id");
    expect(emptyId).toHaveLength(1);
    expect(emptyId[0].entityIds).toEqual([storeyId]);

    const emptyReference = ofKind(result.findings, "empty-id-reference");
    expect(emptyReference).toHaveLength(1);
    expect(emptyReference[0].severity).toBe("info");
    expect(emptyReference[0].message).toContain("_ReferenzID");

    expect(found).toContain("external-id-reference");
    const external = ofKind(result.findings, "external-id-reference")[0];
    expect(external.severity).toBe("info");
    expect(external.message).toContain("X-1");

    const unreferenced = ofKind(result.findings, "unreferenced-object-info-id");
    expect(unreferenced.map((f) => f.detail)).toContain("A-100");
  });

  it("Semikolon-Liste wird in Einzelreferenzen zerlegt", async () => {
    const { session, walls } = await objectInfoSession();
    const result = await runObjectInfo(session);

    // „A-200;A-999": A-200 ist doppelt vergeben (mehrdeutig), A-999 unbekannt.
    const ambiguous = ofKind(result.findings, "ambiguous-object-info-reference");
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0].severity).toBe("error");
    expect(ambiguous[0].entityIds[0]).toBe(walls[0]);
    expect(ambiguous[0].detail).toContain("A-200;A-999");

    const missing = ofKind(result.findings, "missing-object-info-reference");
    expect(missing.map((f) => f.message).join(" ")).toContain("A-999");
    expect(missing.every((f) => f.severity === "warning")).toBe(true);
    // Ohne Aufsplitten wäre „A-200;A-999" EINE unbekannte ID gewesen.
    expect(
      missing.some((f) => f.message.includes("A-200;A-999")),
      "Referenzliste darf nicht als ein Wert geprüft werden",
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) Tombstones
// ---------------------------------------------------------------------------

describe("M6: gelöschte Objekte erzeugen keine Befunde", () => {
  it("Diagnostik überspringt tombstonete Objekte", async () => {
    const { text, ids } = forceDuplicateGlobalId(createCrossingWalls());
    const session = await openSession(text);
    expect(
      ofKind((await runDiagnostics(session)).findings, "duplicate-global-id"),
    ).toHaveLength(1);

    expect(session.view.deleteEntity(ids[1])).toBe(true);
    const after = await runDiagnostics(session);
    expect(ofKind(after.findings, "duplicate-global-id")).toHaveLength(0);
    expect(
      after.findings.some((f) => f.entityIds.includes(ids[1])),
      "kein Befund darf auf ein gelöschtes Objekt zeigen",
    ).toBe(false);
  });

  it("Objektinfo überspringt tombstonete Objekte", async () => {
    const { session, walls } = await objectInfoSession();
    expect(session.view.deleteEntity(walls[2])).toBe(true);

    const result = await runObjectInfo(session);
    expect(result.checkedCount).toBe(4);
    expect(ofKind(result.findings, "duplicate-object-info-id")).toHaveLength(0);
    expect(
      result.findings.some((f) => f.entityIds.includes(walls[2])),
      "kein Befund darf auf ein gelöschtes Objekt zeigen",
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) Kollisionen
// ---------------------------------------------------------------------------

describe("M6: Kollisionsprüfung", () => {
  it("zwei überlappende Wände ergeben mindestens eine Kollision", async () => {
    const session = await openSession(createCrossingWalls());
    const result = await runClash(session);

    expect(result.source).toBe("clash");
    expect(
      kinds(result.findings),
      "Geometrie-Pipeline muss im Node-Test laufen",
    ).not.toContain("clash-unavailable");
    expect(result.checkedCount).toBe(2);

    const collisions = ofKind(result.findings, "hard-clash");
    expect(collisions.length).toBeGreaterThanOrEqual(1);
    expect(collisions[0].severity).toBe("warning");
    expect(collisions[0].message).toContain("kollidiert mit");
    expect(collisions[0].entityIds).toHaveLength(2);
    expect(collisions[0].detail).toContain("Durchdringung");
  }, 60_000);

  it("kollisionsfreies Modell meldet nichts", async () => {
    const session = await openSession(createFourWalls(), "m6-frei.ifc");
    const result = await runClash(session);

    expect(kinds(result.findings)).not.toContain("clash-unavailable");
    expect(ofKind(result.findings, "hard-clash")).toHaveLength(0);
    expect(result.checkedCount).toBe(4);
  }, 60_000);
});
