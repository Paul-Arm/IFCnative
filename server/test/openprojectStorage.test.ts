import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildApp } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel } from "./fixtures";

const SECRET = "s".repeat(40);
const BASE = "/api/integrations/openproject/storage";

/** Speicher-Token wie vom Plugin (Storages::IfcHub…) ausgestellt. */
function storageToken(user: { id: string; email: string; name?: string } | null, secret = SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "openproject",
    aud: "ifc-hub-storage",
    iat: now,
    exp: now + 300,
    user: user && { login: "x", name: user.name ?? user.email, ...user },
  };
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

const PAUL = { id: "16", email: "paul@example.com", name: "Paul" };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-opstore-"));
  const repo = new MemoryRepository();
  const app = buildApp({
    repo,
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
    logRequests: false,
    openproject: { sharedSecret: SECRET },
  });
  // Paul hat ein Hub-Konto (per E-Mail zugeordnet) mit Projekt "acme".
  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: PAUL.email, name: "Paul", password: "pw123456" },
  });
  const session = { authorization: `Bearer ${JSON.parse(reg.body).token}` };
  await app.inject({ method: "POST", url: "/api/projects", headers: session, payload: { name: "Acme", slug: "acme" } });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: session,
    payload: { name: "Tower", slug: "tower", folder: "Fachmodelle/Tragwerk" },
  });
  const commit = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits?message=v1",
    headers: { ...session, "content-type": "application/x-step" },
    payload: ifcModel(),
  });
  assert.equal(commit.statusCode, 201, commit.body);
  return { app, repo, session };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

function get(app: App, url: string, user: typeof PAUL | null = PAUL) {
  return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${storageToken(user)}` } });
}

function post(app: App, url: string, payload: unknown, user: typeof PAUL | null = PAUL) {
  return app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${storageToken(user)}` },
    payload: payload as object,
  });
}

test("Speicher: Benutzer, Projekte als Ordner, Modelle mit Endung", async () => {
  const { app } = await setup();
  const me = JSON.parse((await get(app, `${BASE}/user`)).body);
  assert.equal(me.email, PAUL.email);

  const root = JSON.parse((await get(app, `${BASE}/files`)).body);
  assert.deepEqual(
    root.files.map((f: { id: string; name: string }) => [f.id, f.name]),
    [["/acme", "Acme"]],
  );

  const project = JSON.parse((await get(app, `${BASE}/files?location=/acme`)).body);
  assert.equal(project.parent.id, "/acme");
  assert.deepEqual(project.files.map((f: { name: string }) => f.name), ["Fachmodelle"]);

  const folder = JSON.parse((await get(app, `${BASE}/files?location=/acme/Fachmodelle/Tragwerk`)).body);
  assert.deepEqual(
    folder.ancestors.map((a: { location: string }) => a.location),
    ["/", "/acme", "/acme/Fachmodelle"],
  );
  const [tower] = folder.files;
  assert.equal(tower.name, "Tower.ifc");
  assert.equal(tower.location, "/acme/Fachmodelle/Tragwerk/Tower.ifc");
  assert.match(tower.id, /^m\./);
  assert.deepEqual(tower.permissions, ["readable", "writeable"]);
  assert.equal(tower.lastModifiedByName, "Paul");

  const info = JSON.parse((await get(app, `${BASE}/files/info?id=${tower.id}`)).body);
  assert.equal(info.name, "Tower.ifc");
  const batch = JSON.parse((await post(app, `${BASE}/files/info`, { ids: [tower.id, "m.unbekannt"] })).body);
  assert.deepEqual(
    batch.files.map((f: { status: string }) => f.status),
    ["ok", "not_found"],
  );

  const paths = JSON.parse((await get(app, `${BASE}/paths?location=/acme`)).body).paths;
  assert.equal(paths["/acme/Fachmodelle/Tragwerk/Tower.ifc"], tower.id);
});

test("Speicher: Download über signierten Link", async () => {
  const { app } = await setup();
  const folder = JSON.parse((await get(app, `${BASE}/files?location=/acme/Fachmodelle/Tragwerk`)).body);
  const link = JSON.parse((await get(app, `${BASE}/download-link?id=${folder.files[0].id}`)).body);
  const file = await app.inject({ method: "GET", url: link.path });
  assert.equal(file.statusCode, 200);
  assert.match(String(file.headers["content-disposition"]), /Tower\.ifc/);
  assert.ok(file.body.includes("ISO-10303-21"));
  assert.equal((await app.inject({ method: "GET", url: `${BASE}/download?t=kaputt` })).statusCode, 401);
});

test("Speicher: Upload legt Modelle an bzw. committet neue Versionen", async () => {
  const { app, repo } = await setup();
  const uploadTo = async (folderId: string, fileName: string, body: string, query = "") => {
    const link = await post(app, `${BASE}/upload-link`, { folderId, fileName });
    assert.equal(link.statusCode, 200, link.body);
    const res = await app.inject({
      method: "POST",
      url: `${JSON.parse(link.body).path}${query}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(body),
    });
    return res;
  };

  // Neue Datei (PDF) in einen Ordner.
  const pdf = await uploadTo("/acme/Fachmodelle", "Plan.pdf", "%PDF-1.4 test");
  assert.equal(pdf.statusCode, 201, pdf.body);
  assert.equal(JSON.parse(pdf.body).name, "Plan.pdf");
  const project = await repo.getProjectBySlug("acme");
  const plan = (await repo.listModels(project!.id)).find((m) => m.name === "Plan.pdf");
  assert.equal(plan?.kind, "file");
  assert.equal(plan?.folder, "Fachmodelle");

  // Gleicher Name wie vorhandenes IFC-Modell -> neue Version desselben Modells.
  const tower = await repo.getModel(project!.id, "tower");
  const v2 = await uploadTo("/acme/Fachmodelle/Tragwerk", "Tower.ifc", ifcModel({ wallName: "Neu" }));
  assert.equal(v2.statusCode, 201, v2.body);
  assert.equal(JSON.parse(v2.body).id, `m.${tower!.id}`);
  const history = await repo.listCommits(tower!.id, "main");
  assert.equal(history.length, 2);
  assert.equal(history.some((c) => c.message === "Hochgeladen aus OpenProject"), true);

  // Commit-Nachricht aus dem Upload-Dialog.
  const v3 = await uploadTo(
    "/acme/Fachmodelle/Tragwerk",
    "Tower.ifc",
    ifcModel({ wallName: "Neuer" }),
    "&message=Stand%20LPH%205%20(%2377)",
  );
  assert.equal(v3.statusCode, 201, v3.body);
  const newest = (await repo.listCommits(tower!.id, "main")).map((c) => c.message);
  assert.ok(newest.includes("Stand LPH 5 (#77)"), newest.join(" | "));

  // Zielmodell gewählt: neue Version von "Tower" trotz anderem Dateinamen.
  const before = (await repo.listCommits(tower!.id, "main")).length;
  const targeted = await uploadTo(
    "/acme/Fachmodelle/Tragwerk",
    "Tower_Export_neu.ifc",
    ifcModel({ wallName: "Ziel" }),
    `&target=m.${tower!.id}&message=Export%20neu`,
  );
  assert.equal(targeted.statusCode, 201, targeted.body);
  assert.equal(JSON.parse(targeted.body).id, `m.${tower!.id}`);
  assert.equal((await repo.listCommits(tower!.id, "main")).length, before + 1);
  // Falsche Dateiart für das Zielmodell -> 400 (gemeinsamer Commit-Weg).
  const wrongKind = await uploadTo("/acme", "Plan.pdf", "%PDF-1.4", `&target=m.${tower!.id}`);
  assert.equal(wrongKind.statusCode, 400);
  // Zielmodell aus einem anderen Projekt -> 404.
  const other = await repo.createProject({ slug: "fremd", name: "Fremd", ownerId: tower!.projectId, visibility: "private" });
  const foreignModel = await repo.createModel({
    projectId: other.id, slug: "x", name: "X", visibility: "private", defaultBranch: "main", folder: "", kind: "ifc",
  });
  assert.equal((await uploadTo("/acme", "X.ifc", ifcModel(), `&target=m.${foreignModel.id}`)).statusCode, 404);

  // "Beide behalten" -> zusätzliches Modell mit Zähler.
  const both = await uploadTo("/acme/Fachmodelle/Tragwerk", "Tower.ifc", ifcModel(), "&overwrite=false");
  assert.equal(both.statusCode, 201, both.body);
  assert.equal(JSON.parse(both.body).name, "Tower (2).ifc");

  // Multipart wie aus dem Browser — "overwrite" darf NACH der Datei kommen.
  const link = JSON.parse((await post(app, `${BASE}/upload-link`, { folderId: "/acme", fileName: "Plan.pdf" })).body);
  const boundary = "----ifchub";
  const multipart = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="Plan.pdf"',
    "Content-Type: application/pdf",
    "",
    "%PDF-1.4 neu",
    `--${boundary}`,
    'Content-Disposition: form-data; name="overwrite"',
    "",
    "false",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const multi = await app.inject({
    method: "POST",
    url: link.path,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: multipart,
  });
  assert.equal(multi.statusCode, 201, multi.body);
  // Plan.pdf liegt schon in "Fachmodelle", aber nicht in der Projektwurzel.
  assert.equal(JSON.parse(multi.body).name, "Plan.pdf");

  // Kein IFC-Inhalt in einer .ifc-Datei -> 400 vom gemeinsamen Commit-Weg.
  const broken = await uploadTo("/acme", "Kaputt.ifc", "kein step");
  assert.equal(broken.statusCode, 400);
});

test("Speicher: Rechte — Leser, Dienst, fremde Projekte, ohne Token", async () => {
  const { app, repo } = await setup();
  const project = await repo.getProjectBySlug("acme");
  // Eve ist nur Leserin in acme.
  const eve = await repo.createUser({ email: "eve@example.com", name: "Eve", passwordHash: "x", isAdmin: false });
  await repo.addMember({ projectId: project!.id, userId: eve.id, role: "viewer" });
  const EVE = { id: "99", email: "eve@example.com", name: "Eve" };
  const folder = JSON.parse((await get(app, `${BASE}/files?location=/acme/Fachmodelle/Tragwerk`, EVE)).body);
  assert.deepEqual(folder.files[0].permissions, ["readable"]);
  assert.equal((await post(app, `${BASE}/upload-link`, { folderId: "/acme", fileName: "x.pdf" }, EVE)).statusCode, 403);

  // Dienst-Token (ohne Benutzer): lesen ja, hochladen nein.
  assert.equal((await get(app, `${BASE}/files?location=/acme`, null)).statusCode, 200);
  assert.equal((await post(app, `${BASE}/upload-link`, { folderId: "/acme", fileName: "x.pdf" }, null)).statusCode, 403);

  // Privates fremdes Projekt existiert für Paul nicht.
  await repo.createProject({ slug: "geheim", name: "Geheim", ownerId: eve.id, visibility: "private" });
  assert.equal((await get(app, `${BASE}/files?location=/geheim`)).statusCode, 404);

  // Ohne bzw. mit falsch signiertem Token.
  assert.equal((await app.inject({ method: "GET", url: `${BASE}/files` })).statusCode, 401);
  const forged = await app.inject({
    method: "GET",
    url: `${BASE}/files`,
    headers: { authorization: `Bearer ${storageToken(PAUL, "f".repeat(40))}` },
  });
  assert.equal(forged.statusCode, 401);
  // Pfad-Tricks werden abgewiesen.
  assert.equal((await get(app, `${BASE}/files?location=/acme/../geheim`)).statusCode, 400);
});

test("Speicher: Hub-Projekt zu einem OpenProject-Projekt", async () => {
  const { app, repo } = await setup();
  const project = await repo.getProjectBySlug("acme");
  assert.equal((await get(app, `${BASE}/project-link?openprojectProjectId=7`, null)).statusCode, 404);
  await repo.setExternalLink({ system: "openproject", kind: "project", externalId: "7", localId: project!.id });
  const link = JSON.parse((await get(app, `${BASE}/project-link?openprojectProjectId=7`, null)).body);
  assert.deepEqual(link, { slug: "acme", name: "Acme", location: "/acme" });
});

test("Speicher: Öffnen-Ziel eines Modells", async () => {
  const { app } = await setup();
  const folder = JSON.parse((await get(app, `${BASE}/files?location=/acme/Fachmodelle/Tragwerk`)).body);
  const open = JSON.parse((await get(app, `${BASE}/open?id=${folder.files[0].id}`)).body);
  assert.deepEqual(open, { hubPath: "/p/acme/m/tower", subPath: "/m/tower", openprojectProjectId: null });
  const openFolder = JSON.parse((await get(app, `${BASE}/open?id=${folder.files[0].id}&location=true`)).body);
  assert.equal(openFolder.subPath, "");
});
