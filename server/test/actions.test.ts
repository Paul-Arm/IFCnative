import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ActionRunner } from "../src/domain/actionRunner";
import { buildApp } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel, WALL } from "./fixtures";

/**
 * Der "Python"-Interpreter ist in den Tests der Node-Prozess selbst — Node
 * führt Skripte unabhängig von der Dateiendung als CommonJS aus. So testen
 * wir die komplette Skript-Pipeline (Datei schreiben, spawnen, Exit-Code,
 * stdout/stderr) ohne Python-Abhängigkeit in der CI.
 */
async function makeApp() {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-actions-"));
  const repo = new MemoryRepository();
  const store = new FilesystemObjectStore(dir);
  const runner = new ActionRunner(repo, store, {
    pythonBin: process.execPath,
    timeoutMs: 30_000,
  });
  const app = buildApp({ repo, store, jwtSecret: "test-secret", runner });
  return { app, runner, repo };
}

async function register(app: Awaited<ReturnType<typeof makeApp>>["app"]) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "user@example.com", name: "User", password: "pw123456" },
  });
  assert.equal(res.statusCode, 201);
  return JSON.parse(res.body).token as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function setupProjectWithCommit(
  app: Awaited<ReturnType<typeof makeApp>>["app"],
  token: string,
) {
  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(token),
    payload: { name: "Acme", slug: "acme" },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(token),
    payload: { name: "Tower", slug: "tower" },
  });
  const commit = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits?message=init",
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcModel(),
  });
  assert.equal(commit.statusCode, 201);
  return JSON.parse(commit.body).commit.id as string;
}

function idsXml(baseName: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<ids xmlns="http://standards.buildingsmart.org/IDS">`,
    `  <info><title>Test-IDS</title></info>`,
    `  <specifications>`,
    `    <specification name="Wand hat ${baseName}" ifcVersion="IFC4">`,
    `      <applicability minOccurs="1" maxOccurs="unbounded">`,
    `        <entity><name><simpleValue>IFCWALL</simpleValue></name></entity>`,
    `      </applicability>`,
    `      <requirements>`,
    `        <property cardinality="required">`,
    `          <propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet>`,
    `          <baseName><simpleValue>${baseName}</simpleValue></baseName>`,
    `        </property>`,
    `      </requirements>`,
    `    </specification>`,
    `  </specifications>`,
    `</ids>`,
  ].join("\n");
}

async function createAction(
  app: Awaited<ReturnType<typeof makeApp>>["app"],
  token: string,
  payload: Record<string, unknown>,
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/projects/acme/actions",
    headers: auth(token),
    payload,
  });
  assert.equal(res.statusCode, 201);
  return JSON.parse(res.body).action as { id: string };
}

test("IDS action: validate on demand, passing and failing", async () => {
  const { app, runner } = await makeApp();
  const token = await register(app);
  const commitId = await setupProjectWithCommit(app, token);

  const pass = await createAction(app, token, {
    name: "Höhe vorhanden",
    kind: "ids",
    fileName: "hoehe.ids",
    content: idsXml("Height"),
  });
  const fail = await createAction(app, token, {
    name: "FireRating vorhanden",
    kind: "ids",
    fileName: "firerating.ids",
    content: idsXml("FireRating"),
  });

  const validate = await app.inject({
    method: "POST",
    url: `/api/projects/acme/models/tower/commits/${commitId}/validate`,
    headers: auth(token),
    payload: {},
  });
  assert.equal(validate.statusCode, 201);
  assert.equal(JSON.parse(validate.body).runs.length, 2);

  await runner.idle();

  const runsRes = await app.inject({
    method: "GET",
    url: `/api/projects/acme/runs?commit=${commitId}`,
    headers: auth(token),
  });
  const runs = JSON.parse(runsRes.body).runs as {
    id: string;
    actionId: string;
    status: string;
    summary: string;
    failedGuids: string[];
    action: { name: string };
  }[];
  assert.equal(runs.length, 2);
  const passRun = runs.find((run) => run.actionId === pass.id);
  const failRun = runs.find((run) => run.actionId === fail.id);
  assert.equal(passRun?.status, "success");
  assert.equal(failRun?.status, "failed");
  assert.match(failRun?.summary ?? "", /1 fehlgeschlagen/);
  // Verstöße tragen die GlobalIds der betroffenen Objekte (3D-Verortung).
  assert.deepEqual(passRun?.failedGuids, []);
  assert.deepEqual(failRun?.failedGuids, [WALL]);

  // Log nur im Detail, mit den konkreten Verstößen.
  const detail = await app.inject({
    method: "GET",
    url: `/api/projects/acme/runs/${failRun?.id}`,
    headers: auth(token),
  });
  const run = JSON.parse(detail.body).run as { log: string };
  assert.match(run.log, /FEHLGESCHLAGEN/);
  assert.match(run.log, /FireRating/);

  await app.close();
});

test("script action: exit code decides, stdout lands in the log", async () => {
  const { app, runner } = await makeApp();
  const token = await register(app);
  const commitId = await setupProjectWithCommit(app, token);

  const script = [
    `const fs = require("fs");`,
    `const text = fs.readFileSync(process.argv[2], "utf8");`,
    `if (!process.env.IFC_PATH) { console.error("IFC_PATH fehlt"); process.exit(2); }`,
    `if (text.includes("IFCWALL")) { console.log("OK: Wand gefunden"); process.exit(0); }`,
    `console.error("Keine Wand im Modell"); process.exit(1);`,
  ].join("\n");
  const action = await createAction(app, token, {
    name: "Wand-Check",
    kind: "python",
    fileName: "check.py",
    content: script,
  });

  const validate = await app.inject({
    method: "POST",
    url: `/api/projects/acme/models/tower/commits/${commitId}/validate`,
    headers: auth(token),
    payload: { actionIds: [action.id] },
  });
  assert.equal(validate.statusCode, 201);

  await runner.idle();

  const runsRes = await app.inject({
    method: "GET",
    url: `/api/projects/acme/runs?commit=${commitId}`,
    headers: auth(token),
  });
  const [run] = JSON.parse(runsRes.body).runs as {
    id: string;
    status: string;
    summary: string;
  }[];
  assert.equal(run.status, "success");
  assert.equal(run.summary, "OK: Wand gefunden");

  const detail = await app.inject({
    method: "GET",
    url: `/api/projects/acme/runs/${run.id}`,
    headers: auth(token),
  });
  assert.match(JSON.parse(detail.body).run.log, /OK: Wand gefunden/);

  await app.close();
});

test("runOnCommit action starts automatically with a new commit", async () => {
  const { app, runner } = await makeApp();
  const token = await register(app);
  const commitId = await setupProjectWithCommit(app, token);

  await createAction(app, token, {
    name: "Auto-IDS",
    kind: "ids",
    content: idsXml("Height"),
    runOnCommit: true,
  });

  // Der erste Commit lag vor der Action — kein Run.
  const before = await app.inject({
    method: "GET",
    url: `/api/projects/acme/runs?commit=${commitId}`,
    headers: auth(token),
  });
  assert.equal(JSON.parse(before.body).runs.length, 0);

  const commit2 = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits?message=update",
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcModel({ height: "3200." }),
  });
  assert.equal(commit2.statusCode, 201);
  const commit2Id = JSON.parse(commit2.body).commit.id as string;

  await runner.idle();

  const after = await app.inject({
    method: "GET",
    url: `/api/projects/acme/runs?commit=${commit2Id}`,
    headers: auth(token),
  });
  const runs = JSON.parse(after.body).runs as { status: string }[];
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.status, "success");

  await app.close();
});

test("library: central file, referenced by an action, guarded deletion", async () => {
  const { app, runner } = await makeApp();
  const token = await register(app);
  const commitId = await setupProjectWithCommit(app, token);

  // Datei zentral in der Bibliothek ablegen.
  const uploaded = await app.inject({
    method: "POST",
    url: "/api/library",
    headers: auth(token),
    payload: {
      name: "Firmen-IDS",
      kind: "ids",
      fileName: "firma.ids",
      content: idsXml("Height"),
    },
  });
  assert.equal(uploaded.statusCode, 201);
  const libFile = JSON.parse(uploaded.body).file as { id: string };

  // Bibliothek listet die Datei mit Nutzungszähler und Eigentümer.
  const list = await app.inject({
    method: "GET",
    url: "/api/library",
    headers: auth(token),
  });
  const files = JSON.parse(list.body).files as {
    id: string;
    usageCount: number;
    owner: { email: string };
  }[];
  assert.equal(files[0]?.usageCount, 0);
  assert.equal(files[0]?.owner.email, "user@example.com");

  // Action referenziert die Bibliotheksdatei (kein eigener Upload).
  const created = await app.inject({
    method: "POST",
    url: "/api/projects/acme/actions",
    headers: auth(token),
    payload: {
      name: "IDS aus Bibliothek",
      libraryFileId: libFile.id,
      runOnCommit: true,
    },
  });
  assert.equal(created.statusCode, 201);
  const action = JSON.parse(created.body).action as {
    id: string;
    kind: string;
    libraryFileId: string;
  };
  assert.equal(action.kind, "ids");
  assert.equal(action.libraryFileId, libFile.id);

  // Im Projekt-Listing trägt die Action den Bibliotheksnamen.
  const actionsList = await app.inject({
    method: "GET",
    url: "/api/projects/acme/actions",
    headers: auth(token),
  });
  assert.equal(
    (JSON.parse(actionsList.body).actions as { libraryName: string }[])[0]
      ?.libraryName,
    "Firmen-IDS",
  );

  // Die Action läuft mit der Bibliotheksdatei.
  const validate = await app.inject({
    method: "POST",
    url: `/api/projects/acme/models/tower/commits/${commitId}/validate`,
    headers: auth(token),
    payload: {},
  });
  assert.equal(validate.statusCode, 201);
  await runner.idle();
  const runsRes = await app.inject({
    method: "GET",
    url: `/api/projects/acme/runs?commit=${commitId}`,
    headers: auth(token),
  });
  assert.equal(
    (JSON.parse(runsRes.body).runs as { status: string }[])[0]?.status,
    "success",
  );

  // Bibliotheksdatei zentral aktualisieren -> gilt sofort für die Action:
  // FireRating fehlt im Modell, der nächste Lauf schlägt fehl.
  const patched = await app.inject({
    method: "PATCH",
    url: `/api/library/${libFile.id}`,
    headers: auth(token),
    payload: { content: idsXml("FireRating") },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(JSON.parse(patched.body).file.usageCount, 1);

  await app.inject({
    method: "POST",
    url: `/api/projects/acme/models/tower/commits/${commitId}/validate`,
    headers: auth(token),
    payload: {},
  });
  await runner.idle();
  const runsAfter = await app.inject({
    method: "GET",
    url: `/api/projects/acme/runs?commit=${commitId}`,
    headers: auth(token),
  });
  assert.equal(
    (JSON.parse(runsAfter.body).runs as { status: string }[])[0]?.status,
    "failed",
  );

  // Inhalt an der Action selbst ändern ist gesperrt (Datei kommt zentral).
  const contentDenied = await app.inject({
    method: "PATCH",
    url: `/api/projects/acme/actions/${action.id}`,
    headers: auth(token),
    payload: { content: idsXml("Height") },
  });
  assert.equal(contentDenied.statusCode, 400);

  // Löschen blockiert, solange Actions die Datei verwenden.
  const delBlocked = await app.inject({
    method: "DELETE",
    url: `/api/library/${libFile.id}`,
    headers: auth(token),
  });
  assert.equal(delBlocked.statusCode, 409);

  // Fremde dürfen nicht ändern; nach Entfernen der Action klappt Löschen.
  const strangerRes = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "x@example.com", name: "X", password: "pw123456" },
  });
  const strangerToken = JSON.parse(strangerRes.body).token as string;
  const strangerDenied = await app.inject({
    method: "DELETE",
    url: `/api/library/${libFile.id}`,
    headers: auth(strangerToken),
  });
  assert.equal(strangerDenied.statusCode, 403);

  await app.inject({
    method: "DELETE",
    url: `/api/projects/acme/actions/${action.id}`,
    headers: auth(token),
  });
  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/library/${libFile.id}`,
    headers: auth(token),
  });
  assert.equal(deleted.statusCode, 204);

  await app.close();
});

test("action scope: project-wide, folder, or single model", async () => {
  const { app, runner } = await makeApp();
  const token = await register(app);
  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(token),
    payload: { name: "Acme", slug: "acme" },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(token),
    payload: { name: "Tower", slug: "tower" },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(token),
    payload: { name: "Halle", slug: "halle", folder: "Hochbau/EG" },
  });
  const models = JSON.parse(
    (
      await app.inject({
        method: "GET",
        url: "/api/projects/acme/models",
        headers: auth(token),
      })
    ).body,
  ).models as { id: string; slug: string }[];
  const towerId = models.find((m) => m.slug === "tower")!.id;

  // Drei Actions: projektweit, Ordner "Hochbau", nur Modell "tower".
  const all = await createAction(app, token, {
    name: "Projektweit",
    kind: "ids",
    content: idsXml("Height"),
    runOnCommit: true,
  });
  const folderScoped = await createAction(app, token, {
    name: "Nur Hochbau",
    kind: "ids",
    content: idsXml("Height"),
    scopeFolder: "Hochbau",
    runOnCommit: true,
  });
  const towerScoped = await createAction(app, token, {
    name: "Nur Tower",
    kind: "ids",
    content: idsXml("Height"),
    scopeModelId: towerId,
    runOnCommit: true,
  });

  // Beides gleichzeitig ist ungültig.
  const both = await app.inject({
    method: "POST",
    url: "/api/projects/acme/actions",
    headers: auth(token),
    payload: {
      name: "X",
      kind: "ids",
      content: idsXml("Height"),
      scopeFolder: "Hochbau",
      scopeModelId: towerId,
    },
  });
  assert.equal(both.statusCode, 400);

  // Commit in "Hochbau/EG": projektweite + Ordner-Action laufen automatisch.
  const halleCommit = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/halle/commits?message=init",
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcModel(),
  });
  const halleCommitId = JSON.parse(halleCommit.body).commit.id as string;
  await runner.idle();
  const halleRuns = JSON.parse(
    (
      await app.inject({
        method: "GET",
        url: `/api/projects/acme/runs?commit=${halleCommitId}`,
        headers: auth(token),
      })
    ).body,
  ).runs as { actionId: string }[];
  assert.deepEqual(
    halleRuns.map((run) => run.actionId).sort(),
    [all.id, folderScoped.id].sort(),
  );

  // Commit auf "tower": projektweite + Modell-Action.
  const towerCommit = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits?message=init",
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcModel(),
  });
  const towerCommitId = JSON.parse(towerCommit.body).commit.id as string;
  await runner.idle();
  const towerRuns = JSON.parse(
    (
      await app.inject({
        method: "GET",
        url: `/api/projects/acme/runs?commit=${towerCommitId}`,
        headers: auth(token),
      })
    ).body,
  ).runs as { actionId: string }[];
  assert.deepEqual(
    towerRuns.map((run) => run.actionId).sort(),
    [all.id, towerScoped.id].sort(),
  );

  // Explizite Auswahl einer Action außerhalb des Geltungsbereichs -> 400.
  const denied = await app.inject({
    method: "POST",
    url: `/api/projects/acme/models/tower/commits/${towerCommitId}/validate`,
    headers: auth(token),
    payload: { actionIds: [folderScoped.id] },
  });
  assert.equal(denied.statusCode, 400);

  await app.close();
});

test("actions require write access; viewers can read runs", async () => {
  const { app } = await makeApp();
  const token = await register(app);
  await setupProjectWithCommit(app, token);

  const viewerRes = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "viewer@example.com", name: "Viewer", password: "pw123456" },
  });
  const viewerToken = JSON.parse(viewerRes.body).token as string;
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/members",
    headers: auth(token),
    payload: { email: "viewer@example.com", role: "viewer" },
  });

  const create = await app.inject({
    method: "POST",
    url: "/api/projects/acme/actions",
    headers: auth(viewerToken),
    payload: { name: "X", kind: "ids", content: idsXml("Height") },
  });
  assert.equal(create.statusCode, 403);

  const list = await app.inject({
    method: "GET",
    url: "/api/projects/acme/runs",
    headers: auth(viewerToken),
  });
  assert.equal(list.statusCode, 200);

  await app.close();
});
