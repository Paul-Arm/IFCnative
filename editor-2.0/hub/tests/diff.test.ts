/**
 * Versionsvergleich: eine geänderte Property muss genau ein Objekt als
 * `modified` melden — alles andere bleibt unangetastet.
 *
 * Zugleich der Prüfpunkt für Risiko R2 / Befund B5 (05-risiken-entscheidungen.md):
 * wie fein ist die Detailtiefe von `@ifc-lite/diff`?
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "@ifc-lite/diff";
import { diffIfcBytes, toDiffResult } from "../src/ifc/diff.js";
import { parseIfc } from "../src/ifc/parse.js";
import { buildFingerprints } from "../src/ifc/fingerprints.js";
import {
  buildModel,
  CHANGED_WALL,
  FIRE_RATING_HEAD,
  STABLE_WALL,
  toBytes,
  withChangedProperty,
} from "./helpers.js";

async function globalIdOfWall(
  bytes: Uint8Array,
  wallName: string,
): Promise<string> {
  const store = await parseIfc(bytes);
  for (const [globalId, expressId] of store.entities.getGlobalIdMap()) {
    if (store.entities.getName(expressId) === wallName) return globalId;
  }
  throw new Error(`Wand "${wallName}" nicht im Testmodell gefunden.`);
}

describe("Diff zweier Stände", () => {
  it("meldet genau das Objekt mit der geänderten Property als modified", async () => {
    const base = toBytes(buildModel());
    const head = toBytes(withChangedProperty(new TextDecoder().decode(base)));

    const changedId = await globalIdOfWall(base, CHANGED_WALL);
    const stableId = await globalIdOfWall(base, STABLE_WALL);
    // Bearbeiten + Re-Export lässt die Identitäten unberührt (R2).
    expect(await globalIdOfWall(head, CHANGED_WALL)).toBe(changedId);

    const diff = await diffIfcBytes(base, head);

    expect(diff.summary.added).toBe(0);
    expect(diff.summary.removed).toBe(0);
    expect(diff.summary.modified).toBe(1);
    expect(diff.summary.unchanged).toBeGreaterThan(0);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toHaveLength(1);

    const [entry] = diff.modified;
    expect(entry?.globalId).toBe(changedId);
    expect(entry?.globalId).not.toBe(stableId);
    expect(entry?.label).toBe(`IfcWall · ${CHANGED_WALL}`);
    expect(typeof entry?.expressId).toBe("number");
  });

  it("gibt die betroffene Komponente mit (Pset-Granularität, kein Feld-Detail)", async () => {
    const base = toBytes(buildModel());
    const head = toBytes(withChangedProperty(new TextDecoder().decode(base)));

    const diff = await diffIfcBytes(base, head);
    const [entry] = diff.modified;

    // @ifc-lite/diff liefert Teil-Hashes je Komponente: hier schlägt genau
    // das Property-Set an, in dem FireRating steckt.
    expect(entry?.changedComponents).toEqual(["pset:Pset_WallCommon"]);
    // Der Name der Property und ihr Alt-/Neuwert stehen NICHT im Ergebnis —
    // dafür wäre der Port von `entityFieldDiff` nötig (siehe README).
    expect(JSON.stringify(diff)).not.toContain(FIRE_RATING_HEAD);
    expect(diff.fieldDetail).toBe(false);
    expect(diff.scope).toBe("data");
  });

  it("erkennt einen unveränderten Stand als leeren Diff", async () => {
    const bytes = toBytes(buildModel());
    const diff = await diffIfcBytes(bytes, bytes);

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.summary.unchanged).toBeGreaterThan(0);
  });

  it("meldet hinzugefügte und entfernte Objekte richtig herum", async () => {
    // ifc-lite nennt es `deleted`, der API-Vertrag der App `removed` — und
    // `added` muss auf den Kopfstand zeigen, `removed` auf die Basis.
    const base = toBytes(buildModel());
    const fingerprints = buildFingerprints(await parseIfc(base));
    expect(fingerprints.length).toBeGreaterThan(1);

    const stableId = await globalIdOfWall(base, STABLE_WALL);
    const withoutStable = fingerprints.filter(
      (entry) => entry.key !== stableId,
    );
    expect(withoutStable).toHaveLength(fingerprints.length - 1);

    // Basis vollständig, Kopfstand ohne die Wand → removed.
    const dropped = toDiffResult(
      diffModels(fingerprints, withoutStable, { scope: "data" }),
    );
    expect(dropped.removed.map((entry) => entry.globalId)).toEqual([stableId]);
    expect(dropped.removed[0]?.label).toBe(`IfcWall · ${STABLE_WALL}`);
    expect(dropped.added).toEqual([]);
    expect(dropped.summary).toMatchObject({ added: 0, removed: 1, modified: 0 });

    // Umgekehrte Richtung → added, mit den Angaben aus dem Kopfstand.
    const gained = toDiffResult(
      diffModels(withoutStable, fingerprints, { scope: "data" }),
    );
    expect(gained.added.map((entry) => entry.globalId)).toEqual([stableId]);
    expect(gained.added[0]?.label).toBe(`IfcWall · ${STABLE_WALL}`);
    expect(gained.removed).toEqual([]);
    expect(gained.summary).toMatchObject({ added: 1, removed: 0, modified: 0 });
  });
});
