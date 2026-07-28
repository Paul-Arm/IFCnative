/**
 * M8-Verifikationstests: eigenes IDS-Fenster (`src/panes/ids-validation/**`).
 *
 * Geprüft wird der React-freie Teil (`run.ts`, `model.ts`, `csv.ts`,
 * `highlight.ts`) gegen einen ECHTEN Lauf von `validateIDS` über eine
 * `ModelSession` — genau das, was die Pane anzeigt.
 *
 * BEFUND (Kernfrage): `validateIDS` liefert je Spezifikation `status`,
 * `applicableCount`/`passedCount`/`failedCount`/`passRate` und je Objekt einen
 * `IDSEntityResult` — auch für BESTANDENE Objekte. Nur deshalb kann das Fenster
 * „bestanden" und „fehlgeschlagen" nebeneinander zeigen; die flache Befundliste
 * des Prüfzentrums verwirft die bestandenen Ergebnisse.
 */
import { describe, expect, it } from "vitest";
import { IfcCreator } from "@ifc-lite/create";
import { parseIDS } from "@ifc-lite/ids";

import { ModelSession } from "../src/core/session";
import type { IdsEntry } from "../src/domain/checks/idsSource";
import { runIdsValidation } from "../src/panes/ids-validation/run";
import {
  DEFAULT_IDS_FILTER,
  failureText,
  filterEntities,
  runTotals,
  type IdsEntityRow,
} from "../src/panes/ids-validation/model";
import { runResultToCsv } from "../src/panes/ids-validation/csv";
import { idsColors } from "../src/panes/ids-validation/highlight";

// — Fixtures —

/** Drei Wände; nur „Wand 1" trägt den geforderten Namen. */
function createWalls(): string {
  const creator = new IfcCreator({ Name: "M8-IDS" });
  const storey = creator.addIfcBuildingStorey({
    Name: "Erdgeschoss",
    Elevation: 0,
  });
  for (let i = 0; i < 3; i++) {
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

const IDS_NS = "http://standards.buildingsmart.org/IDS";

/** Alle Wände müssen `Name` = „Wand 1" tragen — 1 bestanden, 2 fehlgeschlagen. */
const WALL_NAME_IDS = `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="${IDS_NS}" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <info>
    <title>M8 Wandnamen</title>
  </info>
  <specifications>
    <specification name="Wandname" ifcVersion="IFC4">
      <applicability minOccurs="0" maxOccurs="unbounded">
        <entity><name><simpleValue>IFCWALL</simpleValue></name></entity>
      </applicability>
      <requirements>
        <attribute cardinality="required">
          <name><simpleValue>Name</simpleValue></name>
          <value><simpleValue>Wand 1</simpleValue></value>
        </attribute>
      </requirements>
    </specification>
  </specifications>
</ids>`;

/**
 * Trifft nichts (es gibt keine Träger im Modell).
 *
 * BEFUND zum Status-Punkt: „nicht anwendbar" (grau) vergibt der Validator nur,
 * wenn keine Objekte anwendbar sind UND die Spezifikation gar keine
 * Kardinalität mitbringt — was praktisch nie vorkommt, weil der IDS-Parser die
 * 1.0-Vorgabe kanonisiert: eine `<applicability>` ohne `minOccurs` bedeutet
 * `minOccurs="1"` (REQUIRED). Ohne Treffer ist die Kardinalität dann verletzt
 * und der Status lautet „fail" mit Kardinalitätsmeldung. Mit `minOccurs="0"`
 * (so erzeugt es der Objektkatalog) ist die Kardinalität erfüllt → „pass".
 */
function beamIds(cardinality: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="${IDS_NS}" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <info>
    <title>M8 Träger</title>
  </info>
  <specifications>
    <specification name="Trägername" ifcVersion="IFC4">
      <applicability${cardinality}>
        <entity><name><simpleValue>IFCBEAM</simpleValue></name></entity>
      </applicability>
      <requirements>
        <attribute cardinality="required">
          <name><simpleValue>Name</simpleValue></name>
        </attribute>
      </requirements>
    </specification>
  </specifications>
</ids>`;
}

/** Ohne Angabe → `minOccurs=1` → Kardinalität verletzt. */
const BEAM_IDS = beamIds("");
/** Ausdrücklich optional → Kardinalität erfüllt. */
const BEAM_OPTIONAL_IDS = beamIds(` minOccurs="0" maxOccurs="unbounded"`);

async function openSession(text: string): Promise<ModelSession> {
  const bytes = new TextEncoder().encode(text);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return ModelSession.open("m8.ifc", buffer);
}

function entry(id: string, name: string, xml: string): IdsEntry {
  const document = parseIDS(xml);
  return { id, name, document, specCount: document.specifications.length };
}

async function runFixture(entries: readonly IdsEntry[]) {
  const session = await openSession(createWalls());
  return runIdsValidation(session, entries, 7);
}

// — Lauf & Baumstruktur —

describe("IDS-Lauf → Anzeigebaum", () => {
  it("liefert je Spezifikation Zähler und je Objekt ein Ergebnis — auch bestanden", async () => {
    const result = await runFixture([entry("ids-1", "Wandnamen.ids", WALL_NAME_IDS)]);

    expect(result.documents).toHaveLength(1);
    const doc = result.documents[0];
    expect(doc.name).toBe("Wandnamen.ids");
    expect(doc.specs).toHaveLength(1);

    const spec = doc.specs[0];
    expect(spec.name).toBe("Wandname");
    expect(spec.status).toBe("fail");
    expect(spec.applicableCount).toBe(3);
    expect(spec.passedCount).toBe(1);
    expect(spec.failedCount).toBe(2);
    expect(spec.passRate).toBeGreaterThan(0);

    // Kernpunkt: bestandene Objekte sind im Bericht enthalten.
    expect(spec.entities).toHaveLength(3);
    expect(spec.entities.filter((e) => e.passed)).toHaveLength(1);
    expect(spec.entities.filter((e) => !e.passed)).toHaveLength(2);

    const passed = spec.entities.find((e) => e.passed) as IdsEntityRow;
    expect(passed.entityName).toBe("Wand 1");
    expect(passed.entityType.toUpperCase()).toContain("WALL");
    expect(passed.globalId).toBeTruthy();
    expect(passed.label).not.toBe("");
    expect(passed.failures).toHaveLength(0);
  });

  it("hält je Fehlschlag das Anforderungsdetail des Validators bereit", async () => {
    const result = await runFixture([entry("ids-1", "Wandnamen.ids", WALL_NAME_IDS)]);
    const failed = result.documents[0].specs[0].entities.filter((e) => !e.passed);

    for (const row of failed) {
      expect(row.failures.length).toBeGreaterThan(0);
      const failure = row.failures[0];
      // `checkedDescription` ist immer da; Grund/Erwartet/Gefunden je nach Fall.
      expect(failure.checked).not.toBe("");
      expect(failure.status).toBe("fail");
      expect(failure.optional).toBe(false);
      expect(failure.failureType).toBeTruthy();
      expect(failureText(failure)).not.toBe("");
    }
    // Der erwartete Wert der Anforderung steht im Detail.
    const detail = failed.map((r) => failureText(r.failures[0])).join(" ");
    expect(detail).toContain("Wand 1");
  });

  it("reicht die Kardinalitätsmeldung durch, wenn nichts anwendbar ist", async () => {
    const result = await runFixture([entry("ids-2", "Träger.ids", BEAM_IDS)]);
    const spec = result.documents[0].specs[0];

    expect(spec.applicableCount).toBe(0);
    expect(spec.entities).toHaveLength(0);
    // Vorgabe `minOccurs=1` (IDS-1.0-Default) ist verletzt.
    expect(spec.status).toBe("fail");
    expect(spec.cardinalityMessage).toBeTruthy();
  });

  it("meldet eine optionale Spezifikation ohne Treffer als bestanden", async () => {
    const result = await runFixture([
      entry("ids-2", "Träger.ids", BEAM_OPTIONAL_IDS),
    ]);
    const spec = result.documents[0].specs[0];

    expect(spec.status).toBe("pass");
    expect(spec.applicableCount).toBe(0);
    expect(spec.entities).toHaveLength(0);
    expect(spec.cardinalityMessage).toBeNull();
  });

  it("summiert mehrere geladene IDS-Dokumente", async () => {
    const result = await runFixture([
      entry("ids-1", "Wandnamen.ids", WALL_NAME_IDS),
      entry("ids-2", "Träger.ids", BEAM_OPTIONAL_IDS),
    ]);

    expect(result.documents).toHaveLength(2);
    expect(result.totals.specs).toBe(2);
    expect(result.totals.failedSpecs).toBe(1);
    expect(result.totals.checked).toBe(3);
    expect(result.totals.passed).toBe(1);
    expect(result.totals.failed).toBe(2);
    expect(result.ranAtRevision).toBe(7);
    expect(runTotals(result.documents)).toEqual(result.totals);
  });
});

// — Filter —

describe("Filter der Objektliste", () => {
  it(`trennt „nur Fehlschläge"/„alle" und sucht über Label, GlobalId, Fehlertext`, async () => {
    const result = await runFixture([entry("ids-1", "Wandnamen.ids", WALL_NAME_IDS)]);
    const rows = result.documents[0].specs[0].entities;
    const all = (text: string) => filterEntities(rows, { mode: "all", text });

    expect(filterEntities(rows, DEFAULT_IDS_FILTER)).toHaveLength(2);
    expect(all("")).toHaveLength(3);
    expect(all("Wand 3")).toHaveLength(1);
    expect(all(rows[0].globalId ?? "")).toHaveLength(1);
    expect(all("gibtesnicht")).toHaveLength(0);
    // Fehlertext trifft nur die Fehlschläge.
    expect(all("ATTRIBUTE").every((r) => !r.passed)).toBe(true);
  });
});

// — CSV-Bericht —

describe("CSV-Bericht", () => {
  it("schreibt BOM, Semikolon und die fünf vereinbarten Spalten", async () => {
    const result = await runFixture([entry("ids-1", "Wandnamen.ids", WALL_NAME_IDS)]);
    const csv = runResultToCsv(result, { mode: "all", text: "" });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.replace("\uFEFF", "").trim().split("\r\n");
    expect(lines[0]).toBe("Spezifikation;Entity;GlobalId;Status;Detail");
    expect(lines).toHaveLength(4); // Kopf + 3 Objekte

    for (const line of lines.slice(1)) {
      const cells = line.split(";");
      expect(cells[0]).toBe("Wandnamen.ids: Wandname");
      expect(cells[2]).not.toBe("");
      expect(["bestanden", "fehlgeschlagen"]).toContain(cells[3]);
    }
    // Bestandene tragen kein Detail, Fehlschläge schon.
    const passedLine = lines.find((l) => l.includes(";bestanden;")) as string;
    expect(passedLine.endsWith(";bestanden;")).toBe(true);
    expect(csv).toContain("fehlgeschlagen;");

    // …und der Export folgt dem Filter der Ansicht.
    const onlyFailed = runResultToCsv(result, DEFAULT_IDS_FILTER);
    expect(onlyFailed.replace("\uFEFF", "").trim().split("\r\n")).toHaveLength(3);
    expect(onlyFailed).not.toContain(";bestanden;");
  });
});

// — 3D-Kopplung —

describe("Farb-Map für die Viewer-Brücke", () => {
  it("färbt je nach Umschalter — Rot gewinnt gegen Grün", async () => {
    const result = await runFixture([entry("ids-1", "Wandnamen.ids", WALL_NAME_IDS)]);
    const spec = result.documents[0].specs[0];
    const passedId = (spec.entities.find((e) => e.passed) as IdsEntityRow).expressId;
    const failedId = (spec.entities.find((e) => !e.passed) as IdsEntityRow).expressId;

    expect(idsColors(result, { failed: false, passed: false }).size).toBe(0);
    expect(idsColors(null, { failed: true, passed: true }).size).toBe(0);

    const onlyFailed = idsColors(result, { failed: true, passed: false });
    expect(onlyFailed.size).toBe(2);
    expect(onlyFailed.has(passedId)).toBe(false);
    expect(onlyFailed.get(failedId)?.[0]).toBeGreaterThan(0.5); // rot

    const both = idsColors(result, { failed: true, passed: true });
    expect(both.size).toBe(3);
    expect(both.get(passedId)?.[1]).toBeGreaterThan(0.5); // grün
    expect(both.get(failedId)).toEqual(onlyFailed.get(failedId));
  });
});
