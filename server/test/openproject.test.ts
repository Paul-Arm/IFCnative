import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildApp } from "../src/http/app";
import { TicketError, verifyTicket } from "../src/integrations/openproject";
import { MemoryRepository } from "../src/repository/memoryRepository";
import type { Role } from "../src/repository/types";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";

const SECRET = "x".repeat(40);
const OP_ORIGIN = "http://openproject.test";

/** Stellt ein Ticket aus wie das Ruby-Plugin (OpenProject::IfcHub::Ticket). */
function issueTicket(
  overrides: {
    userId?: string;
    email?: string;
    name?: string;
    projectId?: string;
    identifier?: string;
    projectName?: string;
    role?: Role;
    iat?: number;
    exp?: number;
    alg?: string;
  } = {},
  secret = SECRET,
): string {
  const now = Math.floor(Date.now() / 1000);
  const iat = overrides.iat ?? now;
  const payload = {
    iss: "openproject",
    aud: "ifc-hub",
    iat,
    exp: overrides.exp ?? iat + 120,
    jti: randomUUID(),
    openproject_url: OP_ORIGIN,
    user: {
      id: overrides.userId ?? "16",
      login: "paul",
      email: overrides.email ?? "paul@example.com",
      name: overrides.name ?? "Paul A.",
    },
    project: {
      id: overrides.projectId ?? "7",
      identifier: overrides.identifier ?? "test",
      name: overrides.projectName ?? "Test",
    },
    role: overrides.role ?? "contributor",
  };
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${b64({ alg: overrides.alg ?? "HS256", typ: "JWT" })}.${b64(payload)}`;
  const signature = createHmac("sha256", secret).update(input).digest("base64url");
  return `${input}.${signature}`;
}

async function makeApp(repo = new MemoryRepository()) {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-op-"));
  const app = buildApp({
    repo,
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
    logRequests: false,
    openproject: { sharedSecret: SECRET, origin: OP_ORIGIN },
  });
  return { app, repo };
}

function session(app: Awaited<ReturnType<typeof makeApp>>["app"], ticket: string) {
  return app.inject({
    method: "POST",
    url: "/api/integrations/openproject/session",
    payload: { ticket },
  });
}

type App = Awaited<ReturnType<typeof makeApp>>["app"];

async function sessionBody(app: App, ticket: string) {
  const res = await session(app, ticket);
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

function setup(app: App, token: string, grant: string, slug?: string) {
  return app.inject({
    method: "POST",
    url: "/api/integrations/openproject/setup",
    headers: { authorization: `Bearer ${token}` },
    payload: { grant, slug },
  });
}

/** Maintainer öffnet erstmals und legt ein neues Hub-Projekt an. */
async function setupNewProject(app: App, overrides: Parameters<typeof issueTicket>[0] = {}) {
  const first = await sessionBody(app, issueTicket({ role: "maintainer", ...overrides }));
  assert.equal(first.status, "unlinked");
  const res = await setup(app, first.token, first.setup.grant);
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body).project as { slug: string; name: string };
}

test("Erstes Öffnen durch Projektadmin: Auswahl, dann neues privates Hub-Projekt", async () => {
  const { app, repo } = await makeApp();
  const first = await sessionBody(app, issueTicket({ role: "maintainer" }));
  assert.equal(first.status, "unlinked");
  assert.equal(first.canSetup, true);
  assert.equal(first.user.email, "paul@example.com");
  assert.deepEqual(first.setup.candidates, []);
  // Beim bloßen Öffnen wird noch nichts angelegt.
  assert.equal(await repo.getProjectBySlug("test"), null);

  const created = await setup(app, first.token, first.setup.grant);
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(JSON.parse(created.body).project.slug, "test");
  const project = await repo.getProjectBySlug("test");
  assert.equal(project?.visibility, "private");

  // Ab jetzt: direkt verknüpft, Sitzung funktioniert für die normale API.
  const linked = await sessionBody(app, issueTicket({ role: "contributor" }));
  assert.equal(linked.status, "linked");
  assert.equal(linked.project.slug, "test");
  assert.equal(linked.openproject.url, OP_ORIGIN);
  assert.equal((await repo.getMember(project!.id, linked.user.id))?.role, "contributor");
  const detail = await app.inject({
    method: "GET",
    url: "/api/projects/test",
    headers: { authorization: `Bearer ${linked.token}` },
  });
  assert.equal(detail.statusCode, 200, detail.body);
});

test("Normale Mitglieder richten nichts ein und bekommen keine Sitzung", async () => {
  const { app, repo } = await makeApp();
  const body = await sessionBody(app, issueTicket({ role: "contributor" }));
  assert.equal(body.status, "unlinked");
  assert.equal(body.canSetup, false);
  assert.equal(body.token, undefined);
  assert.equal(await repo.getProjectBySlug("test"), null);
});

test("Vorhandenes Hub-Projekt samt Inhalt verknüpfen", async () => {
  const { app, repo } = await makeApp();
  // Paul verwaltet im Hub schon "Bogenbrücke" (Konto per E-Mail zugeordnet).
  const paul = await repo.createUser({
    email: "paul@example.com",
    name: "Paul",
    passwordHash: "x",
    isAdmin: false,
  });
  const bogen = await repo.createProject({
    slug: "bogenbruecke",
    name: "Bogenbrücke",
    ownerId: paul.id,
    visibility: "public",
  });
  await repo.addMember({ projectId: bogen.id, userId: paul.id, role: "owner" });
  // Fremdes Projekt, in dem Paul nur liest: kein Kandidat.
  const other = await repo.createUser({ email: "o@example.com", name: "O", passwordHash: "x", isAdmin: false });
  const foreign = await repo.createProject({ slug: "fremd", name: "Fremd", ownerId: other.id, visibility: "public" });
  await repo.addMember({ projectId: foreign.id, userId: paul.id, role: "viewer" });

  const first = await sessionBody(app, issueTicket({ role: "maintainer", identifier: "brucke-bim-test" }));
  assert.equal(first.user.id, paul.id);
  assert.deepEqual(
    first.setup.candidates.map((c: { slug: string }) => c.slug),
    ["bogenbruecke"],
  );
  assert.equal((await setup(app, first.token, first.setup.grant, "fremd")).statusCode, 409);
  const linked = await setup(app, first.token, first.setup.grant, "bogenbruecke");
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal(JSON.parse(linked.body).project.slug, "bogenbruecke");

  // Nächstes Öffnen landet in Bogenbrücke; Name folgt OpenProject.
  const again = await sessionBody(app, issueTicket({ role: "viewer", projectName: "Bogenbrücke BIM" }));
  assert.equal(again.status, "linked");
  assert.equal(again.project.slug, "bogenbruecke");
  assert.equal(again.project.name, "Bogenbrücke BIM");
  // Schon verknüpft -> für andere OpenProject-Projekte kein Kandidat mehr.
  const otherOp = await sessionBody(app, issueTicket({ role: "maintainer", projectId: "99", identifier: "x" }));
  assert.deepEqual(otherOp.setup.candidates, []);
});

test("Einrichtungs-Berechtigung: nur für ihren Benutzer, nicht als Sitzung", async () => {
  const { app } = await makeApp();
  const paul = await sessionBody(app, issueTicket({ role: "maintainer" }));
  const eve = await sessionBody(
    app,
    issueTicket({ role: "maintainer", userId: "99", email: "eve@example.com", projectId: "8", identifier: "eve" }),
  );
  assert.equal((await setup(app, eve.token, paul.setup.grant)).statusCode, 403);
  const asSession = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: { authorization: `Bearer ${paul.setup.grant}` },
  });
  assert.equal(asSession.statusCode, 401);
});

test("Jedes Ticket gilt nur einmal", async () => {
  const { app } = await makeApp();
  const ticket = issueTicket({ role: "maintainer" });
  assert.equal((await session(app, ticket)).statusCode, 200);
  const replay = await session(app, ticket);
  assert.equal(replay.statusCode, 401);
  assert.match(JSON.parse(replay.body).error, /bereits verwendet/);
});

test("Falsche Signatur, alg none und abgelaufene Tickets werden abgewiesen", async () => {
  const { app } = await makeApp();
  assert.equal((await session(app, issueTicket({}, "y".repeat(40)))).statusCode, 401);
  assert.equal((await session(app, issueTicket({ alg: "none" }))).statusCode, 401);
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.equal((await session(app, issueTicket({ iat: old, exp: old + 120 }))).statusCode, 401);
  assert.equal((await session(app, "kein.jwt")).statusCode, 401);
  assert.throws(
    () => verifyTicket(issueTicket({ exp: Math.floor(Date.now() / 1000) + 3600 }), SECRET),
    TicketError,
  );
});

test("Rolle und Name folgen OpenProject bei jedem Öffnen", async () => {
  const { app, repo } = await makeApp();
  await setupNewProject(app);
  const second = await sessionBody(app, issueTicket({ role: "viewer", name: "Paul Armerling" }));
  assert.equal(second.user.name, "Paul Armerling");
  const project = await repo.getProjectBySlug("test");
  assert.equal((await repo.getMember(project!.id, second.user.id))?.role, "viewer");
});

test("Neues Projekt weicht fremdem Slug aus", async () => {
  const { app, repo } = await makeApp();
  const owner = await repo.createUser({ email: "other@example.com", name: "Other", passwordHash: "x", isAdmin: false });
  await repo.createProject({ slug: "test", name: "Fremd", ownerId: owner.id, visibility: "private" });
  assert.equal((await setupNewProject(app)).slug, "test-2");
  assert.equal((await sessionBody(app, issueTicket())).project.slug, "test-2");
});

test("Verknüpfung lösen: Inhalte bleiben, nächstes Öffnen fragt neu", async () => {
  const { app, repo } = await makeApp();
  await setupNewProject(app);
  const linked = await sessionBody(app, issueTicket({ role: "maintainer" }));
  const auth = { authorization: `Bearer ${linked.token}` };
  const status = await app.inject({ method: "GET", url: "/api/projects/test/integrations/openproject", headers: auth });
  assert.deepEqual(JSON.parse(status.body), {
    linked: true,
    openprojectProjectId: "7",
    openprojectProjectUrl: `${OP_ORIGIN}/projects/7`,
  });

  const removed = await app.inject({ method: "DELETE", url: "/api/projects/test/integrations/openproject", headers: auth });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.ok(await repo.getProjectBySlug("test"));
  const again = await sessionBody(app, issueTicket({ role: "maintainer" }));
  assert.equal(again.status, "unlinked");
  assert.deepEqual(
    again.setup.candidates.map((c: { slug: string }) => c.slug),
    ["test"],
  );
});

test("HTML darf nur von OpenProject eingebettet werden, ohne Konfiguration 404", async () => {
  const { app } = await makeApp();
  // SPA-Fallback liefert index.html (eingecheckter Build in server/public).
  const page = await app.inject({ method: "GET", url: "/embed" });
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers["content-security-policy"], `frame-ancestors 'self' ${OP_ORIGIN}`);
  const api = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(api.headers["content-security-policy"], undefined);

  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-op-"));
  const plain = buildApp({
    repo: new MemoryRepository(),
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
    logRequests: false,
  });
  assert.equal((await session(plain, issueTicket())).statusCode, 404);
});
