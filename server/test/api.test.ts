import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildApp } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel } from "./fixtures";

async function makeApp() {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-api-"));
  const app = buildApp({
    repo: new MemoryRepository(),
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
  });
  return app;
}

async function register(
  app: Awaited<ReturnType<typeof makeApp>>,
  email = "user@example.com",
  name = "User",
) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "pw123456" },
  });
  assert.equal(res.statusCode, 201);
  return JSON.parse(res.body).token as string;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function commitIfc(
  app: Awaited<ReturnType<typeof makeApp>>,
  token: string,
  ifcText: string,
  message: string,
  branch = "main",
) {
  return app.inject({
    method: "POST",
    url: `/api/projects/acme/models/tower/commits?branch=${encodeURIComponent(branch)}&message=${encodeURIComponent(message)}`,
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcText,
  });
}

test("end-to-end: register, project, model, two commits, diff, download", async () => {
  const app = await makeApp();
  const token = await register(app);

  const proj = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(token),
    payload: { name: "Acme", slug: "acme" },
  });
  assert.equal(proj.statusCode, 201);

  const model = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(token),
    payload: { name: "Tower", slug: "tower", visibility: "public" },
  });
  assert.equal(model.statusCode, 201);

  const c1 = await commitIfc(app, token, ifcModel(), "init");
  assert.equal(c1.statusCode, 201);
  const c1Body = JSON.parse(c1.body);
  assert.equal(c1Body.diff.added.length, 3);

  const c2 = await commitIfc(app, token, ifcModel({ height: "3200." }), "raise");
  assert.equal(c2.statusCode, 201);
  const c2Body = JSON.parse(c2.body);
  assert.equal(c2Body.diff.modified.length, 1);
  // Commits carry their author for UI display.
  assert.equal(c2Body.commit.author.email, "user@example.com");

  const history = await app.inject({
    method: "GET",
    url: "/api/projects/acme/models/tower/commits?branch=main",
    headers: auth(token),
  });
  const commits = JSON.parse(history.body).commits;
  assert.equal(commits.length, 2);
  assert.equal(commits[0].author.name, "User");

  const diff = await app.inject({
    method: "GET",
    url: `/api/projects/acme/models/tower/diff?from=${c1Body.commit.id}&to=${c2Body.commit.id}`,
    headers: auth(token),
  });
  assert.equal(diff.statusCode, 200);
  assert.equal(JSON.parse(diff.body).diff.modified.length, 1);

  const file = await app.inject({
    method: "GET",
    url: `/api/projects/acme/models/tower/commits/${c2Body.commit.id}/file`,
    headers: auth(token),
  });
  assert.equal(file.statusCode, 200);
  assert.ok(file.body.includes("ISO-10303-21"));

  await app.close();
});

test("unauthenticated requests are rejected", async () => {
  const app = await makeApp();
  const res = await app.inject({ method: "GET", url: "/api/projects" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("public models are browsable without authentication", async () => {
  const app = await makeApp();
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
    payload: { name: "Tower", slug: "tower", visibility: "public" },
  });
  await commitIfc(app, token, ifcModel(), "init");

  // No Authorization header — a client-less visitor.
  const models = await app.inject({
    method: "GET",
    url: "/api/projects/acme/models",
  });
  assert.equal(models.statusCode, 200);
  assert.equal(JSON.parse(models.body).models.length, 1);

  const history = await app.inject({
    method: "GET",
    url: "/api/projects/acme/models/tower/commits",
  });
  assert.equal(history.statusCode, 200);
  assert.equal(JSON.parse(history.body).commits.length, 1);

  await app.close();
});

test("branches: create from default head, commit on branch diffs against it", async () => {
  const app = await makeApp();
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
  const c1 = await commitIfc(app, token, ifcModel(), "init");
  assert.equal(c1.statusCode, 201);

  const created = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/branches",
    headers: auth(token),
    payload: { name: "variante-a" },
  });
  assert.equal(created.statusCode, 201);
  const branch = JSON.parse(created.body).branch;
  assert.equal(branch.headCommitId, JSON.parse(c1.body).commit.id);

  // A commit on the new branch diffs against the inherited head, not empty.
  const c2 = await commitIfc(
    app,
    token,
    ifcModel({ height: "3200." }),
    "variante",
    "variante-a",
  );
  assert.equal(c2.statusCode, 201);
  const c2Body = JSON.parse(c2.body);
  assert.equal(c2Body.diff.modified.length, 1);
  assert.equal(c2Body.diff.added.length, 0);
  assert.equal(c2Body.commit.parentCommitId, JSON.parse(c1.body).commit.id);

  // Duplicate branch name is rejected.
  const dup = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/branches",
    headers: auth(token),
    payload: { name: "variante-a" },
  });
  assert.equal(dup.statusCode, 409);

  await app.close();
});

test("members: admin can add, change role, and remove; owner is protected", async () => {
  const app = await makeApp();
  const owner = await register(app, "owner@example.com", "Owner");
  const other = await register(app, "other@example.com", "Other");
  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(owner),
    payload: { name: "Acme", slug: "acme" },
  });

  const added = await app.inject({
    method: "POST",
    url: "/api/projects/acme/members",
    headers: auth(owner),
    payload: { email: "other@example.com", role: "viewer" },
  });
  assert.equal(added.statusCode, 201);
  assert.equal(JSON.parse(added.body).member.user.email, "other@example.com");

  // A viewer must not manage members.
  const denied = await app.inject({
    method: "POST",
    url: "/api/projects/acme/members",
    headers: auth(other),
    payload: { email: "owner@example.com", role: "viewer" },
  });
  assert.equal(denied.statusCode, 403);

  // Members (with user info) appear in the project detail.
  const detail = await app.inject({
    method: "GET",
    url: "/api/projects/acme",
    headers: auth(owner),
  });
  const members = JSON.parse(detail.body).members;
  assert.equal(members.length, 2);
  assert.ok(members.every((m: { user: unknown }) => m.user !== null));

  const otherId = members.find(
    (m: { user: { email: string } }) => m.user.email === "other@example.com",
  ).userId;
  const removed = await app.inject({
    method: "DELETE",
    url: `/api/projects/acme/members/${otherId}`,
    headers: auth(owner),
  });
  assert.equal(removed.statusCode, 204);

  // The owner cannot be removed.
  const ownerId = members.find(
    (m: { role: string }) => m.role === "owner",
  ).userId;
  const rejected = await app.inject({
    method: "DELETE",
    url: `/api/projects/acme/members/${ownerId}`,
    headers: auth(owner),
  });
  assert.equal(rejected.statusCode, 400);

  await app.close();
});

test("multipart upload with message and branch fields", async () => {
  const app = await makeApp();
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

  const boundary = "----ifcvcs-test-boundary";
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="message"`,
    "",
    "Erster Stand",
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="tower.ifc"`,
    "Content-Type: application/x-step",
    "",
    ifcModel(),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const res = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits",
    headers: {
      ...auth(token),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: body,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).commit.message, "Erster Stand");

  await app.close();
});

test("model settings + deletion; project deletion is owner-only", async () => {
  const app = await makeApp();
  const owner = await register(app, "owner@example.com", "Owner");
  const maintainer = await register(app, "maint@example.com", "Maint");
  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(owner),
    payload: { name: "Acme", slug: "acme" },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/members",
    headers: auth(owner),
    payload: { email: "maint@example.com", role: "maintainer" },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(owner),
    payload: { name: "Tower", slug: "tower" },
  });
  const c1 = await commitIfc(app, owner, ifcModel(), "init");
  assert.equal(c1.statusCode, 201);

  // Sichtbarkeit ändern (admin darf).
  const patched = await app.inject({
    method: "PATCH",
    url: "/api/projects/acme/models/tower",
    headers: auth(maintainer),
    payload: { visibility: "public" },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(JSON.parse(patched.body).model.visibility, "public");

  // Default-Branch muss existieren.
  const badBranch = await app.inject({
    method: "PATCH",
    url: "/api/projects/acme/models/tower",
    headers: auth(owner),
    payload: { defaultBranch: "gibt-es-nicht" },
  });
  assert.equal(badBranch.statusCode, 400);

  // Projekt löschen darf nur der Owner …
  const denied = await app.inject({
    method: "DELETE",
    url: "/api/projects/acme",
    headers: auth(maintainer),
  });
  assert.equal(denied.statusCode, 403);

  // … Modell löschen darf der Maintainer.
  const deletedModel = await app.inject({
    method: "DELETE",
    url: "/api/projects/acme/models/tower",
    headers: auth(maintainer),
  });
  assert.equal(deletedModel.statusCode, 204);
  const gone = await app.inject({
    method: "GET",
    url: "/api/projects/acme/models/tower",
    headers: auth(owner),
  });
  assert.equal(gone.statusCode, 404);

  const deletedProject = await app.inject({
    method: "DELETE",
    url: "/api/projects/acme",
    headers: auth(owner),
  });
  assert.equal(deletedProject.statusCode, 204);
  const projectGone = await app.inject({
    method: "GET",
    url: "/api/projects/acme",
    headers: auth(owner),
  });
  assert.equal(projectGone.statusCode, 404);

  await app.close();
});

test("folders: create, place model, move, guarded delete", async () => {
  const app = await makeApp();
  const token = await register(app);
  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(token),
    payload: { name: "Acme", slug: "acme" },
  });

  // Ordner explizit anlegen (mit Unterordner).
  const created = await app.inject({
    method: "POST",
    url: "/api/projects/acme/folders",
    headers: auth(token),
    payload: { path: " Hochbau / EG " },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(JSON.parse(created.body).folder, "Hochbau/EG");

  // Modell direkt in einem Ordner anlegen.
  const model = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(token),
    payload: { name: "Tower", slug: "tower", folder: "Hochbau" },
  });
  assert.equal(model.statusCode, 201);
  assert.equal(JSON.parse(model.body).model.folder, "Hochbau");

  // Projekt liefert explizite + implizite Ordner inkl. Eltern.
  const detail = await app.inject({
    method: "GET",
    url: "/api/projects/acme",
    headers: auth(token),
  });
  assert.deepEqual(JSON.parse(detail.body).folders, ["Hochbau", "Hochbau/EG"]);

  // Modell verschieben (nur folder patchen — Name bleibt erhalten).
  const moved = await app.inject({
    method: "PATCH",
    url: "/api/projects/acme/models/tower",
    headers: auth(token),
    payload: { folder: "Hochbau/EG" },
  });
  assert.equal(moved.statusCode, 200);
  assert.equal(JSON.parse(moved.body).model.folder, "Hochbau/EG");
  assert.equal(JSON.parse(moved.body).model.name, "Tower");

  // Ordner mit Modellen darunter lässt sich nicht löschen …
  const blocked = await app.inject({
    method: "DELETE",
    url: "/api/projects/acme/folders?path=Hochbau",
    headers: auth(token),
  });
  assert.equal(blocked.statusCode, 409);

  // … nach dem Verschieben in die Wurzel schon.
  await app.inject({
    method: "PATCH",
    url: "/api/projects/acme/models/tower",
    headers: auth(token),
    payload: { folder: "" },
  });
  const removed = await app.inject({
    method: "DELETE",
    url: "/api/projects/acme/folders?path=Hochbau",
    headers: auth(token),
  });
  assert.equal(removed.statusCode, 204);
  const after = await app.inject({
    method: "GET",
    url: "/api/projects/acme",
    headers: auth(token),
  });
  assert.deepEqual(JSON.parse(after.body).folders, []);

  // Ungültige Pfade werden abgelehnt.
  const bad = await app.inject({
    method: "POST",
    url: "/api/projects/acme/folders",
    headers: auth(token),
    payload: { path: "a/../b" },
  });
  assert.equal(bad.statusCode, 400);

  await app.close();
});

test("markdown files: create, commit without STEP check, identical detection, download", async () => {
  const app = await makeApp();
  const token = await register(app);
  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(token),
    payload: { name: "Acme", slug: "acme" },
  });

  const created = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(token),
    payload: { name: "README.md", kind: "md", folder: "" },
  });
  assert.equal(created.statusCode, 201);
  const model = JSON.parse(created.body).model;
  assert.equal(model.kind, "md");

  const commitMd = (content: string, message: string) =>
    app.inject({
      method: "POST",
      url: `/api/projects/acme/models/${model.slug}/commits?message=${encodeURIComponent(message)}`,
      headers: { ...auth(token), "content-type": "text/markdown" },
      payload: content,
    });

  const c1 = await commitMd("# Projekt Acme\n\nHallo **Welt**.", "Erste Version");
  assert.equal(c1.statusCode, 201);
  const c1Body = JSON.parse(c1.body);
  assert.equal(c1Body.commit.schema, "markdown");
  assert.equal(c1Body.diff.identical, false);

  // Identischer Inhalt wird als solcher erkannt.
  const c2 = await commitMd("# Projekt Acme\n\nHallo **Welt**.", "Nochmal");
  assert.equal(JSON.parse(c2.body).diff.identical, true);

  // Geänderter Inhalt nicht.
  const c3 = await commitMd("# Projekt Acme\n\nGeändert.", "Update");
  assert.equal(JSON.parse(c3.body).diff.identical, false);

  const file = await app.inject({
    method: "GET",
    url: `/api/projects/acme/models/${model.slug}/commits/${JSON.parse(c3.body).commit.id}/file`,
    headers: auth(token),
  });
  assert.equal(file.statusCode, 200);
  assert.ok(file.headers["content-type"]?.toString().includes("text/markdown"));
  assert.ok(file.body.includes("Geändert"));

  // IFC-Modelle verlangen weiterhin echten STEP-Inhalt.
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(token),
    payload: { name: "Tower", slug: "tower" },
  });
  const notIfc = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits?message=x",
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: "# kein ifc",
  });
  assert.equal(notIfc.statusCode, 400);

  await app.close();
});

test("issues: labels, create with links, filter, patch, permissions", async () => {
  const app = await makeApp();
  const owner = await register(app, "owner@example.com", "Owner");
  const viewer = await register(app, "viewer@example.com", "Viewer");
  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(owner),
    payload: { name: "Acme", slug: "acme" },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/members",
    headers: auth(owner),
    payload: { email: "viewer@example.com", role: "viewer" },
  });
  const model = JSON.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/projects/acme/models",
        headers: auth(owner),
        payload: { name: "Tower", slug: "tower" },
      })
    ).body,
  ).model;

  // Label anlegen (write noetig — viewer darf nicht).
  const deniedLabel = await app.inject({
    method: "POST",
    url: "/api/projects/acme/labels",
    headers: auth(viewer),
    payload: { name: "bug", color: "#d73a4a" },
  });
  assert.equal(deniedLabel.statusCode, 403);
  const label = JSON.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/projects/acme/labels",
        headers: auth(owner),
        payload: { name: "bug", color: "#d73a4a" },
      })
    ).body,
  ).label;

  // Issue eroeffnen darf auch der viewer; Zuordnungen an User/Modell/Label.
  const ownerId = JSON.parse(
    (await app.inject({ method: "GET", url: "/api/me", headers: auth(owner) }))
      .body,
  ).user.id;
  const created = await app.inject({
    method: "POST",
    url: "/api/projects/acme/issues",
    headers: auth(viewer),
    payload: {
      title: "Wand kollidiert mit Decke",
      body: "Siehe **Achse 3**.",
      assigneeIds: [ownerId],
      modelIds: [model.id],
      labelIds: [label.id],
    },
  });
  assert.equal(created.statusCode, 201);
  const issue = JSON.parse(created.body).issue;
  assert.equal(issue.number, 1);
  assert.equal(issue.assignees[0].email, "owner@example.com");
  assert.equal(issue.models[0].slug, "tower");
  assert.equal(issue.labels[0].name, "bug");

  // Ungueltige Zuordnung wird abgelehnt.
  const bad = await app.inject({
    method: "POST",
    url: "/api/projects/acme/issues",
    headers: auth(owner),
    payload: { title: "x", modelIds: ["nicht-da"] },
  });
  assert.equal(bad.statusCode, 400);

  // Filter + Zaehler.
  await app.inject({
    method: "PATCH",
    url: "/api/projects/acme/issues/1",
    headers: auth(owner),
    payload: { state: "closed" },
  });
  const listed = JSON.parse(
    (
      await app.inject({
        method: "GET",
        url: "/api/projects/acme/issues?state=open",
        headers: auth(owner),
      })
    ).body,
  );
  assert.equal(listed.issues.length, 0);
  assert.equal(listed.openCount, 0);
  assert.equal(listed.closedCount, 1);

  // Der viewer (Autor) darf sein eigenes Issue aendern, fremde nicht.
  const own = await app.inject({
    method: "PATCH",
    url: "/api/projects/acme/issues/1",
    headers: auth(viewer),
    payload: { state: "open" },
  });
  assert.equal(own.statusCode, 200);
  const foreign = JSON.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/projects/acme/issues",
        headers: auth(owner),
        payload: { title: "Owner-Issue" },
      })
    ).body,
  ).issue;
  const deniedPatch = await app.inject({
    method: "PATCH",
    url: `/api/projects/acme/issues/${foreign.number}`,
    headers: auth(viewer),
    payload: { state: "closed" },
  });
  assert.equal(deniedPatch.statusCode, 403);

  await app.close();
});

test("health reports version and storage mode", async () => {
  const app = await makeApp();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, "ok");
  assert.equal(body.storage, "filesystem");
  assert.ok(body.version);
  await app.close();
});
