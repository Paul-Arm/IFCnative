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

async function register(app: Awaited<ReturnType<typeof makeApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: "user@example.com", name: "User", password: "pw123456" },
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
) {
  return app.inject({
    method: "POST",
    url: `/projects/acme/models/tower/commits?branch=main&message=${encodeURIComponent(message)}`,
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcText,
  });
}

test("end-to-end: register, project, model, two commits, diff, download", async () => {
  const app = await makeApp();
  const token = await register(app);

  const proj = await app.inject({
    method: "POST",
    url: "/projects",
    headers: auth(token),
    payload: { name: "Acme", slug: "acme" },
  });
  assert.equal(proj.statusCode, 201);

  const model = await app.inject({
    method: "POST",
    url: "/projects/acme/models",
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

  const history = await app.inject({
    method: "GET",
    url: "/projects/acme/models/tower/commits?branch=main",
    headers: auth(token),
  });
  assert.equal(JSON.parse(history.body).commits.length, 2);

  const diff = await app.inject({
    method: "GET",
    url: `/projects/acme/models/tower/diff?from=${c1Body.commit.id}&to=${c2Body.commit.id}`,
    headers: auth(token),
  });
  assert.equal(diff.statusCode, 200);
  assert.equal(JSON.parse(diff.body).diff.modified.length, 1);

  const file = await app.inject({
    method: "GET",
    url: `/projects/acme/models/tower/commits/${c2Body.commit.id}/file`,
    headers: auth(token),
  });
  assert.equal(file.statusCode, 200);
  assert.ok(file.body.includes("ISO-10303-21"));

  await app.close();
});

test("unauthenticated requests are rejected", async () => {
  const app = await makeApp();
  const res = await app.inject({ method: "GET", url: "/projects" });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test("public models are browsable without authentication", async () => {
  const app = await makeApp();
  const token = await register(app);
  await app.inject({
    method: "POST",
    url: "/projects",
    headers: auth(token),
    payload: { name: "Acme", slug: "acme" },
  });
  await app.inject({
    method: "POST",
    url: "/projects/acme/models",
    headers: auth(token),
    payload: { name: "Tower", slug: "tower", visibility: "public" },
  });
  await commitIfc(app, token, ifcModel(), "init");

  // No Authorization header — a client-less visitor.
  const models = await app.inject({
    method: "GET",
    url: "/projects/acme/models",
  });
  assert.equal(models.statusCode, 200);
  assert.equal(JSON.parse(models.body).models.length, 1);

  const history = await app.inject({
    method: "GET",
    url: "/projects/acme/models/tower/commits",
  });
  assert.equal(history.statusCode, 200);
  assert.equal(JSON.parse(history.body).commits.length, 1);

  await app.close();
});
