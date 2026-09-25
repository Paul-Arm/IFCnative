import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildApp } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-tokens-"));
  const app = buildApp({
    repo: new MemoryRepository(),
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
    logRequests: false,
  });
  const register = async (email: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, name: email, password: "pw123456" },
    });
    return { authorization: `Bearer ${JSON.parse(res.body).token}` };
  };
  return { app, register };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

test("Zugangstoken: anlegen, damit arbeiten, widerrufen", async () => {
  const { app, register } = await setup();
  const session = await register("paul@example.com");

  const created = await app.inject({ method: "POST", url: "/api/me/tokens", headers: session, payload: { name: "Editor Laptop" } });
  assert.equal(created.statusCode, 201, created.body);
  const { token, entry } = JSON.parse(created.body);
  assert.match(token, /^ifch_[A-Za-z0-9_-]{40,}$/);
  assert.equal(entry.name, "Editor Laptop");
  assert.equal(entry.prefix, token.slice(0, 9));

  // Mit dem Token wie mit einer Sitzung arbeiten.
  const me = await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) });
  assert.equal(JSON.parse(me.body).user.email, "paul@example.com");
  const project = await app.inject({ method: "POST", url: "/api/projects", headers: bearer(token), payload: { name: "Acme" } });
  assert.equal(project.statusCode, 201);

  // Liste zeigt "zuletzt benutzt", aber nie das Token selbst.
  const list = JSON.parse((await app.inject({ method: "GET", url: "/api/me/tokens", headers: session })).body);
  assert.equal(list.tokens.length, 1);
  assert.ok(list.tokens[0].lastUsedAt);
  assert.equal(JSON.stringify(list).includes(token), false);

  // Tokens verwalten nur Sitzungen.
  assert.equal((await app.inject({ method: "GET", url: "/api/me/tokens", headers: bearer(token) })).statusCode, 403);

  const removed = await app.inject({ method: "DELETE", url: `/api/me/tokens/${entry.id}`, headers: session });
  assert.equal(removed.statusCode, 204);
  const after = await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) });
  assert.equal(after.statusCode, 401);
});

test("Zugangstoken: fremde und unbekannte Tokens", async () => {
  const { app, register } = await setup();
  const paul = await register("paul@example.com");
  const eve = await register("eve@example.com");
  const created = JSON.parse(
    (await app.inject({ method: "POST", url: "/api/me/tokens", headers: paul, payload: { name: "x" } })).body,
  );
  assert.equal((await app.inject({ method: "DELETE", url: `/api/me/tokens/${created.entry.id}`, headers: eve })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/me", headers: bearer("ifch_erfunden") })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/me/tokens", headers: paul, payload: {} })).statusCode, 400);
});
