import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildApp } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { WALL, ifcModel } from "./fixtures";

const SECRET = "q".repeat(40);
const OP_PROJECT = "7";
const BASE = `/api/integrations/openproject/sync/${OP_PROJECT}`;
const PAUL = { id: "16", login: "paul", email: "paul@example.com", name: "Paul" };

function serviceToken(secret = SECRET) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "openproject", aud: "ifc-hub-storage", iat: now, exp: now + 300, user: null })}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

const auth = () => ({ authorization: `Bearer ${serviceToken()}` });

/** Multipart-Body inkl. Speicher-Token im Header. */
function multipart(fields: Record<string, string>, file: { name: string; content: string }) {
  const boundary = "----ifchubsync";
  const parts = Object.entries(fields).map(
    ([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}`,
  );
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n${file.content}`,
  );
  return {
    payload: `${parts.join("\r\n")}\r\n--${boundary}--\r\n`,
    headers: { ...auth(), "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function setup(internalUrl?: string) {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-opsync-"));
  const repo = new MemoryRepository();
  const app = buildApp({
    repo,
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
    logRequests: false,
    openproject: { sharedSecret: SECRET, internalUrl },
  });
  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "owner@example.com", name: "Owner", password: "pw123456" },
  });
  const session = { authorization: `Bearer ${JSON.parse(reg.body).token}` };
  await app.inject({ method: "POST", url: "/api/projects", headers: session, payload: { name: "Acme", slug: "acme" } });
  const project = await repo.getProjectBySlug("acme");
  await repo.setExternalLink({ system: "openproject", kind: "project", externalId: OP_PROJECT, localId: project!.id });
  return { app, repo, session, project: project! };
}

test("Sync: Modelle anlegen, neue Version, Datei und Zustand", async () => {
  const { app, repo } = await setup();
  const created = await app.inject({
    method: "POST",
    url: `${BASE}/models`,
    ...multipart(
      { name: "Krankenhaus Struktur.ifc", message: "Aus OpenProject", author: JSON.stringify(PAUL) },
      { name: "struktur.ifc", content: ifcModel() },
    ),
  });
  assert.equal(created.statusCode, 201, created.body);
  const { id: modelId, head } = JSON.parse(created.body);

  const next = await app.inject({
    method: "POST",
    url: `${BASE}/models/${modelId}/commits`,
    ...multipart(
      { message: "Neue Datei in OpenProject", author: JSON.stringify(PAUL) },
      { name: "struktur.ifc", content: ifcModel({ wallName: "Neu" }) },
    ),
  });
  assert.equal(next.statusCode, 201, next.body);
  const newHead = JSON.parse(next.body).head.id;
  assert.notEqual(newHead, head.id);

  const file = await app.inject({ method: "GET", url: `${BASE}/models/${modelId}/file`, headers: auth() });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers["x-ifc-hub-commit"], newHead);
  assert.ok(file.body.includes("ISO-10303-21"));

  const state = JSON.parse((await app.inject({ method: "GET", url: `${BASE}/state`, headers: auth() })).body);
  assert.equal(state.models.length, 1);
  assert.equal(state.models[0].name, "Krankenhaus Struktur");
  assert.equal(state.models[0].head.id, newHead);
  // Autor wurde über die OpenProject-Id zugeordnet.
  assert.equal(state.models[0].head.author.openprojectUserId, "16");
  const commits = await repo.listCommits(modelId, "main");
  assert.deepEqual(commits.map((c) => c.message).sort(), ["Aus OpenProject", "Neue Datei in OpenProject"]);
});

test("Sync: BCF-Issues mit Topic-Guid, GUID-Verortung, Status und Kommentaren", async () => {
  const { app, repo, session, project } = await setup();
  // IFC-Modell mit der Wand WALL, damit die Verortung ein Modell findet.
  await app.inject({ method: "POST", url: "/api/projects/acme/models", headers: session, payload: { name: "Tower", slug: "tower" } });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits",
    headers: { ...session, "content-type": "application/x-step" },
    payload: ifcModel(),
  });

  const topicGuid = "00efc0da-b4d5-4933-bcb6-e01513ee2bcc";
  const created = await app.inject({
    method: "POST",
    url: `${BASE}/issues`,
    headers: auth(),
    payload: { id: topicGuid, title: "Clash Wand/Fassade", body: "Bitte prüfen", state: "open", guids: [WALL, "kaputt"], author: PAUL },
  });
  assert.equal(created.statusCode, 201, created.body);
  const issue = JSON.parse(created.body).issue;
  assert.equal(issue.id, topicGuid);
  assert.deepEqual(issue.guids, [WALL]);
  const links = await repo.getIssueLinks([topicGuid]);
  assert.equal(links.get(topicGuid)?.models.length, 1);

  // Zweites Anlegen mit derselben Topic-Guid -> vorhandenes Issue.
  const again = await app.inject({ method: "POST", url: `${BASE}/issues`, headers: auth(), payload: { id: topicGuid, title: "X" } });
  assert.equal(JSON.parse(again.body).existing, true);

  const patched = await app.inject({
    method: "PATCH",
    url: `${BASE}/issues/${topicGuid}`,
    headers: auth(),
    payload: { state: "closed", title: "Clash behoben" },
  });
  assert.equal(JSON.parse(patched.body).issue.state, "closed");

  const comment = await app.inject({
    method: "POST",
    url: `${BASE}/issues/${topicGuid}/comments`,
    headers: auth(),
    payload: { body: "Erledigt in LPH 5", author: PAUL },
  });
  assert.equal(comment.statusCode, 201, comment.body);

  // Virtuelle Issues gehören nicht zum Abgleich.
  await repo.createIssue({ projectId: project.id, title: "Nur im Hub", body: "", state: "open", kind: "virtual", authorId: project.ownerId, parentId: null });
  const state = JSON.parse((await app.inject({ method: "GET", url: `${BASE}/state`, headers: auth() })).body);
  assert.equal(state.issues.length, 1);
  assert.equal(state.issues[0].title, "Clash behoben");
  assert.equal(state.issues[0].comments[0].body, "Erledigt in LPH 5");
  assert.equal(state.issues[0].comments[0].author.openprojectUserId, "16");
});

test("Sync: ohne Token 401, nicht verknüpftes Projekt 404", async () => {
  const { app } = await setup();
  assert.equal((await app.inject({ method: "GET", url: `${BASE}/state` })).statusCode, 401);
  assert.equal(
    (await app.inject({ method: "GET", url: `${BASE}/state`, headers: { authorization: `Bearer ${serviceToken("x".repeat(40))}` } })).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/integrations/openproject/sync/999/state", headers: auth() })).statusCode,
    404,
  );
});

test("Melder: Änderung im Hub stößt Webhook bei OpenProject an", async () => {
  const received: { url?: string; auth?: string }[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    received.push({ url: req.url, auth: req.headers.authorization });
    res.writeHead(202).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const { app, session } = await setup(`http://127.0.0.1:${port}`);
    await app.inject({
      method: "POST",
      url: "/api/projects/acme/issues",
      headers: session,
      payload: { title: "Neu im Hub", kind: "bcf" },
    });
    await new Promise((resolve) => setTimeout(resolve, 2200));
    assert.equal(received.length, 1);
    assert.equal(received[0]!.url, "/ifc_hub/webhook");
    const [, payloadB64] = received[0]!.auth!.slice(7).split(".");
    const payload = JSON.parse(Buffer.from(payloadB64!, "base64url").toString());
    assert.equal(payload.project_id, OP_PROJECT);
    assert.equal(payload.aud, "openproject");
  } finally {
    server.close();
  }
});
