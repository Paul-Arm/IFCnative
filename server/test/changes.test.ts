import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildObjectRecords,
  diffObjectDetails,
  diffObjectIndexes,
  parseNativeIfcText,
} from "../src/ifc";
import { buildApp } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel, ifcModelWithGeometry, WALL } from "./fixtures";

/** Geometrie-Fixture mit gültigen 22-stelligen GlobalIds. */
function geometryModel(): string {
  return ifcModelWithGeometry().replace(/000aa'/g, "0000aa'");
}

const GEO_WALL = "0Wall000000000000000aa";

function movedAndStretched(text: string): string {
  return text
    .replace("#46,3.)", "#46,3.5)")
    .replace("#31=IFCLOCALPLACEMENT(#21,#11)", "#31=IFCLOCALPLACEMENT(#21,#60)")
    .replace(
      "ENDSEC;\nEND-ISO",
      "#60=IFCAXIS2PLACEMENT3D(#61,$,$);\n#61=IFCCARTESIANPOINT((1.,2.,0.));\nENDSEC;\nEND-ISO",
    );
}

test("Objekt-Records falten Psets und Relationen in das Besitzerobjekt", () => {
  const records = buildObjectRecords(parseNativeIfcText(ifcModel()));
  // Pset und Relationship haben eigene GlobalIds, sind aber keine Objekte.
  assert.deepEqual(
    records.map((record) => record.globalId),
    [WALL],
  );
  assert.equal(records[0]!.detail.psets["Pset_WallCommon"]?.["Height"], "3000");
});

test("Objekt-Diff benennt geänderte Facetten und konkrete Werte", () => {
  const before = buildObjectRecords(parseNativeIfcText(ifcModel()));
  const after = buildObjectRecords(
    parseNativeIfcText(ifcModel({ height: "3500.", wallName: "Wall B" })),
  );
  const diff = diffObjectIndexes(before, after);
  assert.equal(diff.modified.length, 1);
  assert.deepEqual(diff.modified[0]!.facets, ["attributes", "properties"]);

  const changes = diffObjectDetails(before[0]!.detail, after[0]!.detail);
  const height = changes.find((change) => change.field === "Height");
  assert.equal(height?.group, "Pset_WallCommon");
  assert.equal(height?.before, "3000");
  assert.equal(height?.after, "3500");
});

test("Zahlenschreibweise allein ist keine Änderung", () => {
  const before = buildObjectRecords(parseNativeIfcText(ifcModel({ height: "3000." })));
  const after = buildObjectRecords(parseNativeIfcText(ifcModel({ height: "3000.0" })));
  const diff = diffObjectIndexes(before, after);
  assert.equal(diff.modified.length, 0);
  assert.equal(diff.unchanged, 1);
});

test("Geometrie- und Lageänderungen werden als eigene Facetten erfasst", () => {
  const before = buildObjectRecords(parseNativeIfcText(geometryModel()));
  const after = buildObjectRecords(
    parseNativeIfcText(movedAndStretched(geometryModel())),
  );
  const diff = diffObjectIndexes(before, after);
  const wall = diff.modified.find((entry) => entry.globalId === GEO_WALL);
  assert.ok(wall, "Wand ist geändert");
  assert.deepEqual(wall.facets, ["placement", "geometry"]);
  assert.equal(wall.container, "Site");

  const changes = diffObjectDetails(
    before.find((record) => record.globalId === GEO_WALL)!.detail,
    after.find((record) => record.globalId === GEO_WALL)!.detail,
  );
  const shift = changes.find((change) => change.field === "Verschiebung");
  assert.ok(shift?.after?.startsWith("2.236068"), "Verschiebung = √5");
  const extrusion = changes.find((change) => change.field === "Extrusion");
  assert.equal(extrusion?.before, "3");
  assert.equal(extrusion?.after, "3.5");
  // Kennwerte erklären die Änderung — der Fingerabdruck bleibt draußen.
  assert.ok(!changes.some((change) => change.field === "Fingerabdruck"));
});

async function makeApp(repo = new MemoryRepository(), dir?: string) {
  const storeDir = dir ?? (await mkdtemp(join(tmpdir(), "ifc-vcs-changes-")));
  const app = await buildApp({
    repo,
    store: new FilesystemObjectStore(storeDir),
    jwtSecret: "test-secret",
    logRequests: false,
  });
  const get = async (path: string) => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/acme/models/tower/${path}`,
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  if (dir) {
    // Zweite Instanz über denselben Daten (frischer CommitService-Cache).
    return { app, get, storeDir, commit: undefined as never };
  }
  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "u@e.c", name: "U", password: "pw123456" },
  });
  const auth = { authorization: `Bearer ${JSON.parse(reg.body).token as string}` };
  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth,
    payload: { name: "Acme", slug: "acme" },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth,
    payload: { name: "Tower", slug: "tower", visibility: "public" },
  });
  const commit = async (text: string, message: string, compact = false) =>
    JSON.parse(
      (
        await app.inject({
          method: "POST",
          url:
            `/api/projects/acme/models/tower/commits?branch=main&message=${message}` +
            (compact ? "&compact=1" : ""),
          headers: { ...auth, "content-type": "application/x-step" },
          payload: text,
        })
      ).body,
    );
  return { app, commit, get, storeDir };
}

test("HTTP: /changes liefert Übersicht, Seiten mit Inline-Änderungen, GUIDs und Detail", async () => {
  const { app, commit, get } = await makeApp();
  const c1 = await commit(geometryModel(), "init");
  const c2 = await commit(movedAndStretched(geometryModel()), "move", true);

  // Kompakte Antwort ohne den vollen Entity-Diff.
  assert.equal(c2.diff, undefined);
  assert.equal(c2.commit.modified, 1);
  assert.equal(c2.commit.added, 0);

  const range = `from=${c1.commit.id}&to=${c2.commit.id}`;
  const overview = (await get(`changes?${range}`)).body.changes;
  assert.equal(overview.modified.count, 1);
  assert.equal(overview.facets.geometry, 1);
  assert.equal(overview.facets.placement, 1);
  assert.equal(overview.facets.properties, 0);
  assert.deepEqual(overview.containers, [{ name: "Site", count: 1 }]);

  const page = (await get(`changes/items?${range}&facet=geometry`)).body.page;
  assert.equal(page.total, 1);
  assert.equal(page.items[0].globalId, GEO_WALL);
  assert.equal(page.items[0].highlights[0].field, "Verschiebung");
  assert.ok(page.items[0].changeCount >= 3);

  const none = (await get(`changes/items?${range}&facet=properties`)).body.page;
  assert.equal(none.total, 0);

  const guids = (await get(`changes/guids?${range}`)).body.guids;
  assert.deepEqual(guids.modified, [GEO_WALL]);
  assert.deepEqual(guids.added, []);

  const detail = (await get(`changes/item?${range}&globalId=${GEO_WALL}`)).body.detail;
  assert.equal(detail.entry.status, "modified");
  assert.ok(detail.changes.some((c: { field: string }) => c.field === "Extrusion"));

  // Ohne Basis: erster Commit, alles neu — mit Eckdaten je Objekt.
  const first = (await get(`changes/items?to=${c1.commit.id}&q=wand`)).body.page;
  assert.equal(first.total, 1);
  assert.equal(first.items[0].status, "added");
  assert.ok(
    first.items[0].facts.some(
      (fact: { label: string; value: string }) =>
        fact.label === "Geometrie" && fact.value.startsWith("Rechteck"),
    ),
  );

  assert.equal((await get(`changes/items?${range}&facet=bogus`)).status, 400);
  assert.equal((await get(`changes?from=${c1.commit.id}`)).status, 400);
  await app.close();
});

test("Commits ohne Objekt-Index werden beim ersten Diff nachindiziert", async () => {
  // Simuliert Bestandsdaten: nach den Commits fehlt der Objekt-Index.
  class LegacyRepository extends MemoryRepository {
    dropObjectIndex(): void {
      this.commitObjects.clear();
      this.objectDetails.clear();
    }
  }
  const repo = new LegacyRepository();
  const first = await makeApp(repo);
  const c1 = await first.commit(ifcModel(), "init");
  const c2 = await first.commit(ifcModel({ height: "3200." }), "raise");
  await first.app.close();
  repo.dropObjectIndex();
  assert.equal(await repo.hasObjectIndex(c2.commit.id), false);

  const second = await makeApp(repo, first.storeDir);
  const overview = (
    await second.get(`changes?from=${c1.commit.id}&to=${c2.commit.id}`)
  ).body.changes;
  assert.equal(overview.modified.count, 1);
  assert.equal(overview.facets.properties, 1);
  assert.equal(await repo.hasObjectIndex(c1.commit.id), true);
  assert.equal(await repo.hasObjectIndex(c2.commit.id), true);
  await second.app.close();
});
