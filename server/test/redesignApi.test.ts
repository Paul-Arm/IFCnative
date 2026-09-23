import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { hashPassword } from "../src/auth/passwords";
import { buildApp, SERVER_VERSION } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import type { SqlClient } from "../src/repository/sql/sqlClient";
import { SqliteClient } from "../src/repository/sql/sqliteClient";
import { SqlRepository } from "../src/repository/sqlRepository";
import type {
  ActionRunStatus,
  Issue,
  Model,
  Repository,
} from "../src/repository/types";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel } from "./fixtures";

// Die API-Szenarien laufen gegen beide Repository-Varianten des Servers:
// In-Memory (Tests/Dev) und SQLite (Standard im lokalen Betrieb) — so fallen
// SQL-Fehler der neuen Abfragen auf.
type Backend = "memory" | "sqlite";
const BACKENDS: Backend[] = ["memory", "sqlite"];

async function sqliteRepository(): Promise<SqlRepository> {
  const repo = new SqlRepository(new SqliteClient(":memory:"));
  await repo.migrate();
  return repo;
}

/** PGlite (echtes Postgres) — prüft den Postgres-Dialekt der Abfragen. */
async function pgliteRepository(): Promise<SqlRepository> {
  const db = new PGlite();
  // Eine Verbindung, sequenzielle Aufrufe: verschachtelte Transaktionen
  // treten per Tiefenzähler der äußeren bei.
  let txDepth = 0;
  const sql: SqlClient = {
    query: (text, params) =>
      db.query(text, params as unknown[]) as Promise<{ rows: never[] }>,
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (txDepth > 0) {
        return fn();
      }
      txDepth += 1;
      await db.query("begin");
      try {
        const result = await fn();
        await db.query("commit");
        return result;
      } catch (error) {
        await db.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        txDepth -= 1;
      }
    },
  };
  const repo = new SqlRepository(sql);
  await repo.migrate();
  return repo;
}

async function makeApp(backend: Backend) {
  const dir = await mkdtemp(join(tmpdir(), "ifc-hub-redesign-"));
  const repo: Repository =
    backend === "memory" ? new MemoryRepository() : await sqliteRepository();
  const app = buildApp({
    repo,
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
    logRequests: false,
    ...(backend === "sqlite" ? { databaseMode: "sqlite" as const } : {}),
  });
  return { app, repo };
}

type App = Awaited<ReturnType<typeof makeApp>>["app"];

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const utcDay = () => new Date().toISOString().slice(0, 10);

async function register(app: App, email: string, name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, name, password: "pw123456" },
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  return { token: body.token as string, id: body.user.id as string };
}

/** Anfrage (optional mit Token) → Status + geparster Body (null bei 204). */
async function call(
  app: App,
  token: string | null,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) {
  const res = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
  });
  return {
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
  };
}

async function commitFile(
  app: App,
  token: string,
  project: string,
  model: string,
  content: string,
  contentType: "text/markdown" | "application/x-step",
  message = "Stand",
  branch = "main",
) {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${project}/models/${model}/commits?branch=${branch}&message=${encodeURIComponent(message)}`,
    headers: { authorization: `Bearer ${token}`, "content-type": contentType },
    payload: content,
  });
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body).commit as {
    id: string;
    createdAt: string;
    entityCount: number;
  };
}

/** Action + Run direkt im Repository (ohne Ausführung durch den Runner). */
async function insertRun(
  repo: Repository,
  projectSlug: string,
  modelId: string,
  commitId: string,
  status: ActionRunStatus,
  triggeredById: string,
  actionName = "IDS Hochbau",
) {
  const project = await repo.getProjectBySlug(projectSlug);
  assert.ok(project);
  const action =
    (await repo.listActions(project.id)).find((a) => a.name === actionName) ??
    (await repo.createAction({
      id: randomUUID(),
      projectId: project.id,
      name: actionName,
      kind: "ids",
      fileKey: `projects/${project.id}/actions/x`,
      fileName: "hochbau.ids",
      libraryFileId: null,
      scopeFolder: null,
      scopeModelId: null,
      runOnCommit: false,
    }));
  return repo.createActionRun({
    projectId: project.id,
    actionId: action.id,
    modelId,
    commitId,
    status,
    summary: `Ergebnis ${status}`,
    log: "Protokoll …",
    failedGuids: [],
    triggeredById,
    startedAt: null,
    finishedAt: null,
  });
}

for (const backend of BACKENDS) {
  test(`${backend}: Projektbeschreibung anlegen/ändern/prüfen + Kennzahlen der Projektliste`, async () => {
    const { app } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    const bob = await register(app, "bob@example.com", "Bob");

    const created = await call(app, alice.token, "POST", "/api/projects", {
      name: "Acme",
      slug: "acme",
      description: "  Neubau Brücke Nord  ",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.project.description, "Neubau Brücke Nord");
    const plain = await call(app, alice.token, "POST", "/api/projects", {
      name: "Plain",
    });
    assert.equal(plain.body.project.description, "");
    const tooLong = await call(app, alice.token, "POST", "/api/projects", {
      name: "Lang",
      description: "x".repeat(501),
    });
    assert.equal(tooLong.status, 400);
    const notText = await call(app, alice.token, "POST", "/api/projects", {
      name: "Zahl",
      description: 42,
    });
    assert.equal(notText.status, 400);
    const limit = await call(app, alice.token, "POST", "/api/projects", {
      name: "Grenze",
      description: "y".repeat(500),
    });
    assert.equal(limit.status, 201);

    const patched = await call(app, alice.token, "PATCH", "/api/projects/acme", {
      description: " Neu ",
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.project.description, "Neu");
    const renamed = await call(app, alice.token, "PATCH", "/api/projects/acme", {
      name: "Acme GmbH",
    });
    assert.equal(renamed.body.project.name, "Acme GmbH");
    assert.equal(renamed.body.project.description, "Neu");
    const badPatch = await call(app, alice.token, "PATCH", "/api/projects/acme", {
      description: "z".repeat(501),
    });
    assert.equal(badPatch.status, 400);
    const cleared = await call(app, alice.token, "PATCH", "/api/projects/acme", {
      description: "",
    });
    assert.equal(cleared.body.project.description, "");
    const detail = await call(app, alice.token, "GET", "/api/projects/acme");
    assert.equal(detail.body.project.description, "");

    // Kennzahlen: Mitglieder, offene Issues (inkl. Unter-Issues), letzte Aktivität.
    await call(app, alice.token, "POST", "/api/projects/acme/members", {
      email: "bob@example.com",
      role: "contributor",
    });
    const first = await call(app, alice.token, "POST", "/api/projects/acme/issues", {
      title: "Eins",
    });
    await call(app, bob.token, "POST", "/api/projects/acme/issues", {
      title: "Unter",
      parentId: first.body.issue.id,
    });
    const third = await call(app, alice.token, "POST", "/api/projects/acme/issues", {
      title: "Zu",
    });
    await call(app, alice.token, "PATCH", `/api/projects/acme/issues/${third.body.issue.number}`, {
      state: "closed",
    });
    const model = (
      await call(app, alice.token, "POST", "/api/projects/acme/models", {
        name: "README.md",
        kind: "md",
      })
    ).body.model;
    await sleep(5);
    const commit = await commitFile(app, alice.token, "acme", model.slug, "# Hallo", "text/markdown");

    const list = await call(app, bob.token, "GET", "/api/projects");
    assert.equal(list.status, 200);
    const acme = list.body.projects.find((p: { slug: string }) => p.slug === "acme");
    assert.equal(acme.description, "");
    assert.equal(acme.role, "contributor");
    assert.equal(acme.memberCount, 2);
    assert.equal(acme.modelCount, 1);
    assert.equal(acme.openIssueCount, 2);
    assert.equal(acme.hasImage, false);
    assert.equal(acme.lastActivityAt, commit.createdAt);
    const plainItem = list.body.projects.find((p: { slug: string }) => p.slug === "plain");
    assert.equal(plainItem.memberCount, 1);
    assert.equal(plainItem.openIssueCount, 0);
    assert.equal(plainItem.lastActivityAt, plainItem.createdAt);

    await app.close();
  });

  test(`${backend}: Labels ändern und löschen (409 bei Namensdopplung, Entfernen von Issues)`, async () => {
    const { app } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    const vera = await register(app, "vera@example.com", "Vera");
    await call(app, alice.token, "POST", "/api/projects", { name: "Acme", slug: "acme" });
    await call(app, alice.token, "POST", "/api/projects", { name: "Zweit", slug: "zweit" });
    await call(app, alice.token, "POST", "/api/projects/acme/members", {
      email: "vera@example.com",
      role: "viewer",
    });
    const labels = (url: string) => `/api/projects/acme/labels${url}`;

    const bug = (
      await call(app, alice.token, "POST", labels(""), {
        name: "bug",
        color: "#d73a4a",
        description: " Fehler im Modell ",
      })
    ).body.label;
    assert.equal(bug.description, "Fehler im Modell");
    const feature = (
      await call(app, alice.token, "POST", labels(""), { name: "feature", color: "#00aa00" })
    ).body.label;
    assert.equal(feature.description, "");
    const longDescription = await call(app, alice.token, "POST", labels(""), {
      name: "lang",
      color: "#000000",
      description: "d".repeat(101),
    });
    assert.equal(longDescription.status, 400);
    const foreign = (
      await call(app, alice.token, "POST", "/api/projects/zweit/labels", {
        name: "fremd",
        color: "#123456",
      })
    ).body.label;

    // issueCount zählt nur offene Issues.
    await call(app, alice.token, "POST", "/api/projects/acme/issues", {
      title: "Offen",
      labelIds: [bug.id, feature.id],
    });
    const closed = await call(app, alice.token, "POST", "/api/projects/acme/issues", {
      title: "Zu",
      labelIds: [bug.id],
    });
    await call(app, alice.token, "PATCH", `/api/projects/acme/issues/${closed.body.issue.number}`, {
      state: "closed",
    });
    const listed = (await call(app, vera.token, "GET", labels(""))).body.labels;
    const countOf = (list: { id: string; issueCount: number }[], id: string) =>
      list.find((entry) => entry.id === id)?.issueCount;
    assert.equal(countOf(listed, bug.id), 1);
    assert.equal(countOf(listed, feature.id), 1);

    // PATCH: Validierung wie beim Anlegen.
    const duplicate = await call(app, alice.token, "PATCH", labels(`/${bug.id}`), {
      name: "FEATURE",
    });
    assert.equal(duplicate.status, 409);
    const sameName = await call(app, alice.token, "PATCH", labels(`/${bug.id}`), {
      name: "Bug",
    });
    assert.equal(sameName.status, 200);
    assert.equal(sameName.body.label.name, "Bug");
    for (const bad of [{ color: "rot" }, { name: "  " }, { description: "d".repeat(101) }]) {
      const res = await call(app, alice.token, "PATCH", labels(`/${bug.id}`), bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
    const updated = await call(app, alice.token, "PATCH", labels(`/${bug.id}`), {
      name: "Fehler",
      color: "#aa0000",
      description: "Etwas kaputt",
    });
    assert.deepEqual(updated.body.label, {
      id: bug.id,
      projectId: bug.projectId,
      name: "Fehler",
      color: "#aa0000",
      description: "Etwas kaputt",
    });
    const colorOnly = await call(app, alice.token, "PATCH", labels(`/${bug.id}`), {
      color: "#bb0000",
    });
    assert.equal(colorOnly.body.label.name, "Fehler");
    assert.equal(colorOnly.body.label.description, "Etwas kaputt");
    assert.equal(
      (await call(app, alice.token, "PATCH", labels(`/${randomUUID()}`), { name: "x" })).status,
      404,
    );
    assert.equal(
      (await call(app, alice.token, "DELETE", labels("/keine-uuid"))).status,
      404,
    );
    assert.equal(
      (await call(app, alice.token, "PATCH", labels(`/${foreign.id}`), { name: "x" })).status,
      404,
    );
    assert.equal(
      (await call(app, vera.token, "PATCH", labels(`/${bug.id}`), { name: "x" })).status,
      403,
    );

    // DELETE entfernt das Label auch von den Issues.
    assert.equal((await call(app, vera.token, "DELETE", labels(`/${feature.id}`))).status, 403);
    assert.equal((await call(app, alice.token, "DELETE", labels(`/${feature.id}`))).status, 204);
    assert.equal((await call(app, alice.token, "DELETE", labels(`/${feature.id}`))).status, 404);
    const issue = (await call(app, alice.token, "GET", "/api/projects/acme/issues/1")).body.issue;
    assert.deepEqual(
      issue.labels.map((label: { name: string }) => label.name),
      ["Fehler"],
    );
    const remaining = (await call(app, alice.token, "GET", labels(""))).body.labels;
    assert.deepEqual(
      remaining.map((label: { name: string; issueCount: number }) => [label.name, label.issueCount]),
      [["Fehler", 1]],
    );

    await app.close();
  });

  test(`${backend}: Issue-Zeitleiste — PATCH erzeugt Ereignisse, GET liefert sie mit Akteur`, async () => {
    const { app } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    const bob = await register(app, "bob@example.com", "Bob");
    await call(app, alice.token, "POST", "/api/projects", { name: "Acme", slug: "acme" });
    await call(app, alice.token, "POST", "/api/projects/acme/members", {
      email: "bob@example.com",
      role: "contributor",
    });
    const label = (
      await call(app, alice.token, "POST", "/api/projects/acme/labels", {
        name: "bug",
        color: "#d73a4a",
      })
    ).body.label;
    const model = (
      await call(app, alice.token, "POST", "/api/projects/acme/models", {
        name: "Notizen.md",
        kind: "md",
      })
    ).body.model;
    const commit = await commitFile(app, alice.token, "acme", model.slug, "# v1", "text/markdown");
    const issue = (
      await call(app, alice.token, "POST", "/api/projects/acme/issues", { title: "Wand" })
    ).body.issue;
    const url = "/api/projects/acme/issues/1";
    const patch = async (payload: Record<string, unknown>) => {
      const res = await call(app, alice.token, "PATCH", url, payload);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      await sleep(3);
    };

    await patch({ state: "closed" });
    await patch({ state: "open" });
    await patch({ title: "Wand verschoben" });
    await patch({ labelIds: [label.id] });
    await patch({ labelIds: [] });
    await patch({ assigneeIds: [bob.id] });
    await patch({ assigneeIds: [] });
    await patch({ modelLinks: [{ modelId: model.id }] });
    // Keine Ereignisse: nur Beschreibung, unveränderter Zustand, gleiche
    // Mengen, nur Commit-Bezug ("aufgefallen in").
    await patch({ body: "Nur **Text**" });
    await patch({ state: "open", labelIds: [] });
    await patch({ modelLinks: [{ modelId: model.id, foundCommitId: commit.id }] });
    await patch({ kind: "bcf" });
    await patch({ modelLinks: [] });
    // Mehrere Änderungen in einem PATCH teilen sich den Zeitstempel.
    await patch({ title: "Wand final", labelIds: [label.id], state: "closed" });

    const detail = (await call(app, bob.token, "GET", url)).body;
    const events = detail.events as {
      id: string;
      issueId: string;
      projectId: string;
      actorId: string;
      kind: string;
      data: unknown;
      createdAt: string;
      actor: { email: string } | null;
    }[];
    assert.deepEqual(
      events.map((event) => event.kind),
      [
        "closed",
        "reopened",
        "renamed",
        "labeled",
        "unlabeled",
        "assigned",
        "unassigned",
        "linked_model",
        "kind_changed",
        "unlinked_model",
        "renamed",
        "labeled",
        "closed",
      ],
    );
    assert.deepEqual(events[0]!.data, {});
    assert.equal(events[0]!.actorId, alice.id);
    assert.equal(events[0]!.actor?.email, "alice@example.com");
    assert.equal(events[0]!.issueId, issue.id);
    assert.deepEqual(events[2]!.data, { from: "Wand", to: "Wand verschoben" });
    assert.deepEqual(events[3]!.data, {
      labels: [{ id: label.id, name: "bug", color: "#d73a4a" }],
    });
    assert.deepEqual(events[4]!.data, {
      labels: [{ id: label.id, name: "bug", color: "#d73a4a" }],
    });
    assert.deepEqual(events[5]!.data, { users: [{ id: bob.id, name: "Bob" }] });
    assert.deepEqual(events[6]!.data, { users: [{ id: bob.id, name: "Bob" }] });
    assert.deepEqual(events[7]!.data, {
      models: [{ id: model.id, slug: model.slug, name: "Notizen.md" }],
    });
    assert.deepEqual(events[8]!.data, { from: "virtual", to: "bcf" });
    assert.deepEqual(events[10]!.data, { from: "Wand verschoben", to: "Wand final" });
    assert.equal(new Set(events.slice(-3).map((event) => event.createdAt)).size, 1);
    for (let index = 1; index < events.length; index += 1) {
      assert.ok(events[index - 1]!.createdAt <= events[index]!.createdAt);
    }

    // Unter-Issue: parent_changed trägt das neue Eltern-Issue bzw. null.
    await call(app, alice.token, "POST", "/api/projects/acme/issues", { title: "Kind" });
    await call(app, alice.token, "PATCH", "/api/projects/acme/issues/2", { parentId: issue.id });
    await sleep(3);
    await call(app, alice.token, "PATCH", "/api/projects/acme/issues/2", { parentId: null });
    const childEvents = (await call(app, alice.token, "GET", "/api/projects/acme/issues/2")).body
      .events;
    assert.deepEqual(
      childEvents.map((event: { kind: string; data: unknown }) => [event.kind, event.data]),
      [
        ["parent_changed", { parent: { number: 1, title: "Wand final" } }],
        ["parent_changed", { parent: null }],
      ],
    );

    // Schnappschuss: spätere Umbenennung des Labels ändert die Historie nicht.
    await call(app, alice.token, "PATCH", `/api/projects/acme/labels/${label.id}`, {
      name: "defect",
    });
    const again = (await call(app, alice.token, "GET", url)).body.events;
    assert.equal(again[3].data.labels[0].name, "bug");

    await app.close();
  });

  test(`${backend}: Aktivitäts-Feed — Reihenfolge, Filter, Blättern, fremde private Projekte unsichtbar`, async () => {
    const { app, repo } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    const bob = await register(app, "bob@example.com", "Bob");
    const carol = await register(app, "carol@example.com", "Carol");
    const step = () => sleep(4);

    const acme = (
      await call(app, alice.token, "POST", "/api/projects", { name: "Acme", slug: "acme" })
    ).body.project;
    await call(app, alice.token, "POST", "/api/projects/acme/members", {
      email: "bob@example.com",
      role: "contributor",
    });
    await step();
    await call(app, carol.token, "POST", "/api/projects", {
      name: "Geheim",
      slug: "geheim",
      visibility: "private",
    });
    await step();
    await call(app, carol.token, "POST", "/api/projects/geheim/issues", { title: "Geheimes Issue" });
    await step();
    const model = (
      await call(app, alice.token, "POST", "/api/projects/acme/models", {
        name: "Plan.md",
        kind: "md",
        folder: "Doku",
      })
    ).body.model;
    const commit = await commitFile(
      app,
      alice.token,
      "acme",
      model.slug,
      "# Plan",
      "text/markdown",
      "Erster Stand",
    );
    await step();
    await call(app, bob.token, "POST", "/api/projects/acme/issues", { title: "Fuge prüfen" });
    await step();
    const comment = (
      await call(app, alice.token, "POST", "/api/projects/acme/issues/1/comments", {
        body: "**Wichtig:** siehe [Plan](https://example.com/plan)\n\n- Punkt eins",
      })
    ).body.comment;
    await step();
    await call(app, alice.token, "PATCH", "/api/projects/acme/issues/1", { state: "closed" });
    await step();
    await call(app, bob.token, "PATCH", "/api/projects/acme/issues/1", {
      state: "open",
      title: "Fuge prüfen!",
    });
    await step();
    const run = await insertRun(repo, "acme", model.id, commit.id, "success", bob.id);

    const feed = await call(app, alice.token, "GET", "/api/activity");
    assert.equal(feed.status, 200);
    const events = feed.body.events as {
      id: string;
      type: string;
      at: string;
      actor: { id: string; email: string } | null;
      project: { slug: string; name: string };
      [key: string]: unknown;
    }[];
    assert.deepEqual(
      events.map((event) => event.type),
      [
        "run",
        "issue_reopened",
        "issue_closed",
        "comment",
        "issue_opened",
        "commit",
        "project_created",
      ],
    );
    assert.equal(feed.body.nextBefore, null);
    assert.ok(events.every((event) => event.project.slug === "acme"));
    for (let index = 1; index < events.length; index += 1) {
      assert.ok(events[index - 1]!.at > events[index]!.at);
    }
    const byType = Object.fromEntries(events.map((event) => [event.type, event]));
    assert.deepEqual(byType.commit!.project, { slug: "acme", name: "Acme" });
    assert.equal(byType.commit!.id, `commit:${commit.id}`);
    assert.equal(byType.commit!.at, commit.createdAt);
    assert.equal(byType.commit!.actor?.email, "alice@example.com");
    assert.deepEqual(byType.commit!.model, {
      slug: model.slug,
      name: "Plan.md",
      kind: "md",
      folder: "Doku",
    });
    assert.deepEqual(byType.commit!.commit, {
      id: commit.id,
      message: "Erster Stand",
      branchName: "main",
      added: 0,
      removed: 0,
      modified: 0,
      schema: "markdown",
    });
    assert.deepEqual(byType.issue_opened!.issue, {
      number: 1,
      title: "Fuge prüfen!",
      state: "open",
      kind: "virtual",
    });
    assert.equal(byType.issue_opened!.actor?.id, bob.id);
    assert.equal(byType.issue_closed!.actor?.id, alice.id);
    assert.equal(byType.issue_reopened!.actor?.id, bob.id);
    assert.ok(byType.issue_reopened!.id.startsWith("event:"));
    assert.deepEqual(byType.comment!.comment, {
      id: comment.id,
      excerpt: "Wichtig: siehe Plan Punkt eins",
    });
    assert.equal((byType.comment!.issue as { number: number }).number, 1);
    assert.deepEqual(byType.run!.run, {
      id: run.id,
      number: run.number,
      status: "success",
      summary: "Ergebnis success",
      actionName: "IDS Hochbau",
      commitId: commit.id,
    });
    assert.equal((byType.run!.model as { slug: string }).slug, model.slug);
    assert.equal(byType.run!.actor?.id, bob.id);
    assert.equal(byType.project_created!.id, `project:${acme.id}`);
    assert.equal(byType.project_created!.at, acme.createdAt);
    assert.equal(byType.project_created!.actor?.id, alice.id);

    // Filter: Projekt (fremdes privates = 404) und Akteur.
    const onlyAcme = await call(app, alice.token, "GET", "/api/activity?project=acme");
    assert.deepEqual(
      onlyAcme.body.events.map((event: { id: string }) => event.id),
      events.map((event) => event.id),
    );
    assert.equal((await call(app, alice.token, "GET", "/api/activity?project=geheim")).status, 404);
    assert.equal((await call(app, alice.token, "GET", "/api/activity?project=fehlt")).status, 404);
    const carolFeed = (await call(app, carol.token, "GET", "/api/activity")).body.events;
    assert.deepEqual(
      carolFeed
        .filter((event: { project: { slug: string } }) => event.project.slug === "geheim")
        .map((event: { type: string }) => event.type),
      ["issue_opened", "project_created"],
    );
    const bobsOwn = (await call(app, bob.token, "GET", "/api/activity?user=me")).body.events;
    assert.deepEqual(
      bobsOwn.map((event: { type: string }) => event.type),
      ["run", "issue_reopened", "issue_opened"],
    );
    const bobsById = (await call(app, alice.token, "GET", `/api/activity?user=${bob.id}`)).body
      .events;
    assert.deepEqual(bobsById, bobsOwn);
    assert.equal((await call(app, alice.token, "GET", "/api/activity?user=niemand")).status, 400);
    assert.equal((await call(app, alice.token, "GET", "/api/activity?before=kaputt")).status, 400);
    assert.equal((await call(app, null, "GET", "/api/activity")).status, 401);

    // Blättern: before = nextBefore der vorigen Seite, bis nextBefore null ist.
    const paged: string[] = [];
    let before: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const query = before ? `&before=${encodeURIComponent(before)}` : "";
      const res = await call(app, alice.token, "GET", `/api/activity?limit=2${query}`);
      paged.push(...res.body.events.map((event: { id: string }) => event.id));
      if (res.body.nextBefore === null) break;
      assert.equal(res.body.events.length, 2);
      assert.equal(res.body.nextBefore, res.body.events[1].at);
      before = res.body.nextBefore;
    }
    assert.deepEqual(paged, events.map((event) => event.id));

    // Lange Kommentare werden als Auszug gekürzt.
    await step();
    await call(app, alice.token, "POST", "/api/projects/acme/issues/1/comments", {
      body: `# Titel\n\n${"Wort ".repeat(60)}`,
    });
    const newest = (await call(app, alice.token, "GET", "/api/activity?limit=1")).body;
    const excerpt = newest.events[0].comment.excerpt as string;
    assert.ok(excerpt.startsWith("Titel Wort Wort"));
    assert.ok(excerpt.endsWith("…"));
    assert.equal([...excerpt].length, 161);
    assert.equal(newest.nextBefore, newest.events[0].at);

    await app.close();
  });

  test(`${backend}: Beiträge je Tag — lückenlos bis heute, Zählung, Filter`, async () => {
    const { app } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    const bob = await register(app, "bob@example.com", "Bob");
    const carol = await register(app, "carol@example.com", "Carol");
    const dayOfCreation = utcDay();

    await call(app, alice.token, "POST", "/api/projects", { name: "Acme", slug: "acme" });
    await call(app, alice.token, "POST", "/api/projects/acme/members", {
      email: "bob@example.com",
      role: "contributor",
    });
    const model = (
      await call(app, alice.token, "POST", "/api/projects/acme/models", {
        name: "README.md",
        kind: "md",
      })
    ).body.model;
    await commitFile(app, alice.token, "acme", model.slug, "# v1", "text/markdown");
    await commitFile(app, alice.token, "acme", model.slug, "# v2", "text/markdown");
    await call(app, alice.token, "POST", "/api/projects/acme/issues", { title: "Eins" });
    await call(app, alice.token, "POST", "/api/projects/acme/issues", { title: "Zwei" });
    await call(app, alice.token, "POST", "/api/projects/acme/issues/1/comments", { body: "Hallo" });
    await call(app, bob.token, "POST", "/api/projects/acme/issues", { title: "Drei" });
    await call(app, bob.token, "POST", "/api/projects/acme/issues/1/comments", { body: "Moin" });
    await call(app, carol.token, "POST", "/api/projects", {
      name: "Geheim",
      slug: "geheim",
      visibility: "private",
    });
    await call(app, carol.token, "POST", "/api/projects/geheim/issues", { title: "Privat 1" });
    await call(app, carol.token, "POST", "/api/projects/geheim/issues", { title: "Privat 2" });

    const mine = await call(app, alice.token, "GET", "/api/contributions?user=me&days=7");
    assert.equal(mine.status, 200);
    const days = mine.body.days as {
      date: string;
      commits: number;
      issues: number;
      comments: number;
      total: number;
    }[];
    assert.equal(days.length, 7);
    assert.equal(mine.body.from, days[0]!.date);
    assert.equal(mine.body.to, days[6]!.date);
    assert.ok(mine.body.to === dayOfCreation || mine.body.to === utcDay());
    for (let index = 1; index < days.length; index += 1) {
      assert.equal(Date.parse(days[index]!.date) - Date.parse(days[index - 1]!.date), 86_400_000);
    }
    assert.ok(days.every((day) => day.total === day.commits + day.issues + day.comments));
    assert.equal(mine.body.total, 5);
    if (utcDay() === dayOfCreation) {
      assert.deepEqual(days[6], {
        date: dayOfCreation,
        commits: 2,
        issues: 2,
        comments: 1,
        total: 5,
      });
    }

    // Ohne Benutzerfilter: alle zugänglichen Projekte (Carols privates nicht).
    const everyone = await call(app, alice.token, "GET", "/api/contributions?days=7");
    assert.equal(everyone.body.total, 7);
    const carolView = await call(app, carol.token, "GET", "/api/contributions?days=7");
    assert.equal(carolView.body.total, 9);
    const bobInAcme = await call(
      app,
      alice.token,
      "GET",
      `/api/contributions?project=acme&user=${bob.id}&days=7`,
    );
    assert.equal(bobInAcme.body.total, 2);
    assert.equal(
      (await call(app, alice.token, "GET", "/api/contributions?project=geheim")).status,
      404,
    );

    // days: Standard 371, auf 7..400 begrenzt.
    const standard = await call(app, alice.token, "GET", "/api/contributions");
    assert.equal(standard.body.days.length, 371);
    assert.equal(standard.body.total, 7);
    const clampedLow = await call(app, alice.token, "GET", "/api/contributions?days=1");
    assert.equal(clampedLow.body.days.length, 7);
    const clampedHigh = await call(app, alice.token, "GET", "/api/contributions?days=9999");
    assert.equal(clampedHigh.body.days.length, 400);
    assert.equal((await call(app, null, "GET", "/api/contributions")).status, 401);

    await app.close();
  });

  test(`${backend}: Suche — Projekte, Modelle, Issues, #Nummer, fremde private Projekte ausgeschlossen`, async () => {
    const { app } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    const carol = await register(app, "carol@example.com", "Carol");
    await call(app, alice.token, "POST", "/api/projects", {
      name: "Brücke Nord",
      slug: "bruecke-nord",
      description: "Überbau aus Stahlbeton",
    });
    await call(app, alice.token, "POST", "/api/projects", { name: "Acme", slug: "acme" });
    const models: [string, string, string][] = [
      ["Überbau", "Tragwerk", "ifc"],
      ["Lager", "Unterbau", "ifc"],
      ["Widerlager", "Unterbau", "ifc"],
      ["Plan_B.pdf", "", "file"],
      ["Plan BB.pdf", "", "file"],
    ];
    for (const [name, folder, kind] of models) {
      const res = await call(app, alice.token, "POST", "/api/projects/bruecke-nord/models", {
        name,
        folder,
        kind,
      });
      assert.equal(res.status, 201);
    }
    for (const title of ["Überbau Fuge prüfen", "Lager tauschen", "Fuge 2 dokumentieren"]) {
      await call(app, alice.token, "POST", "/api/projects/bruecke-nord/issues", { title });
      await sleep(3);
    }
    await call(app, carol.token, "POST", "/api/projects", {
      name: "Geheim Überbau",
      slug: "geheim",
      visibility: "private",
    });
    await call(app, carol.token, "POST", "/api/projects/geheim/models", { name: "Überbau Geheim" });
    await call(app, carol.token, "POST", "/api/projects/geheim/issues", { title: "Überbau geheim" });

    const search = async (q: string, extra = "") =>
      (await call(app, alice.token, "GET", `/api/search?q=${encodeURIComponent(q)}${extra}`)).body;
    const names = (list: { name: string }[]) => list.map((entry) => entry.name);

    // Groß-/Kleinschreibung auch bei Umlauten ("über" findet "Überbau").
    const ueber = await search("über");
    assert.deepEqual(ueber.projects.map((p: { slug: string }) => p.slug), ["bruecke-nord"]);
    assert.deepEqual(names(ueber.models), ["Überbau"]);
    assert.deepEqual(ueber.models[0].project, { slug: "bruecke-nord", name: "Brücke Nord" });
    assert.deepEqual(Object.keys(ueber.models[0]).sort(), [
      "folder",
      "id",
      "kind",
      "name",
      "project",
      "slug",
    ]);
    assert.deepEqual(
      ueber.issues.map((issue: { title: string }) => issue.title),
      ["Überbau Fuge prüfen"],
    );
    assert.deepEqual(ueber.issues[0].project, { slug: "bruecke-nord", name: "Brücke Nord" });
    assert.equal(ueber.issues[0].state, "open");
    assert.equal(ueber.issues[0].kind, "virtual");
    assert.ok(ueber.issues[0].createdAt);
    // Projekt-Treffer haben die Form der Projektliste.
    const project = ueber.projects[0];
    assert.equal(project.role, "owner");
    assert.equal(project.modelCount, 5);
    assert.equal(project.openIssueCount, 3);
    assert.equal(project.hasImage, false);
    assert.equal(project.description, "Überbau aus Stahlbeton");
    assert.ok(project.lastActivityAt);

    // Präfix-Treffer zuerst, dann alphabetisch; Ordner zählen mit.
    assert.deepEqual(names((await search("lager")).models), ["Lager", "Widerlager"]);
    assert.deepEqual(names((await search("unterbau")).models).sort(), ["Lager", "Widerlager"]);
    assert.deepEqual(names((await search("BRÜCKE")).projects), ["Brücke Nord"]);
    // LIKE-Sonderzeichen gelten wörtlich.
    assert.deepEqual(names((await search("n_b")).models), ["Plan_B.pdf"]);
    assert.deepEqual((await search("%")).models, []);
    // "#2" = genau Issue 2; "2" zusätzlich Titel mit "2" (exakte Nummer zuerst).
    assert.deepEqual(
      (await search("#2")).issues.map((issue: { number: number }) => issue.number),
      [2],
    );
    assert.deepEqual(
      (await search("2")).issues.map((issue: { number: number }) => issue.number),
      [2, 3],
    );
    // Titel-Präfix vor Teilstring; bei gleichem Rang neueste zuerst.
    assert.deepEqual(
      (await search("fuge")).issues.map((issue: { number: number }) => issue.number),
      [3, 1],
    );
    assert.deepEqual(
      (await search("e")).issues.map((issue: { number: number }) => issue.number),
      [3, 2, 1],
    );
    assert.deepEqual(await search("   "), { projects: [], models: [], issues: [] });
    const limited = await search("a", "&limit=1");
    assert.equal(limited.models.length, 1);
    assert.equal(limited.projects.length, 1);

    // Fremdes privates Projekt: für Alice unsichtbar, für Carol nicht.
    assert.deepEqual(await search("geheim"), { projects: [], models: [], issues: [] });
    const carolHits = (await call(app, carol.token, "GET", "/api/search?q=geheim")).body;
    assert.deepEqual(carolHits.projects.map((p: { slug: string }) => p.slug), ["geheim"]);
    assert.deepEqual(names(carolHits.models), ["Überbau Geheim"]);
    assert.equal(carolHits.issues.length, 1);
    assert.equal((await call(app, null, "GET", "/api/search?q=a")).status, 401);

    await app.close();
  });

  test(`${backend}: Projekt-Kennzahlen (stats)`, async () => {
    const { app, repo } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    const bob = await register(app, "bob@example.com", "Bob");
    const carol = await register(app, "carol@example.com", "Carol");
    await call(app, alice.token, "POST", "/api/projects", { name: "Acme", slug: "acme" });
    await call(app, alice.token, "POST", "/api/projects/acme/members", {
      email: "bob@example.com",
      role: "contributor",
    });
    await call(app, alice.token, "POST", "/api/projects/acme/folders", { path: "Leer" });
    const newModel = async (payload: Record<string, unknown>) =>
      (await call(app, alice.token, "POST", "/api/projects/acme/models", payload)).body.model;
    const tower = await newModel({ name: "Tower", folder: "Hochbau/EG" });
    const readme = await newModel({ name: "README.md", kind: "md" });
    await newModel({ name: "Plan.pdf", kind: "file" });
    await newModel({ name: "Schnitt.PDF", kind: "file" });
    await newModel({ name: "Notiz", kind: "file" });

    const ifc = "application/x-step" as const;
    const c1 = await commitFile(app, alice.token, "acme", tower.slug, ifcModel(), ifc, "init");
    await call(app, alice.token, "POST", `/api/projects/acme/models/${tower.slug}/branches`, {
      name: "variante",
    });
    const c2 = await commitFile(
      app,
      bob.token,
      "acme",
      tower.slug,
      ifcModel({ height: "3200." }),
      ifc,
      "höher",
    );
    await commitFile(
      app,
      alice.token,
      "acme",
      tower.slug,
      ifcModel({ wallName: "Wand B" }),
      ifc,
      "Variante",
      "variante",
    );
    await sleep(3);
    const c4 = await commitFile(app, alice.token, "acme", readme.slug, "# Readme", "text/markdown");

    for (const title of ["Eins", "Zwei", "Drei"]) {
      await call(app, alice.token, "POST", "/api/projects/acme/issues", { title });
    }
    await call(app, alice.token, "PATCH", "/api/projects/acme/issues/3", { state: "closed" });
    await insertRun(repo, "acme", tower.id, c1.id, "success", alice.id);
    await insertRun(repo, "acme", tower.id, c2.id, "success", alice.id);
    await insertRun(repo, "acme", tower.id, c2.id, "failed", bob.id);

    const res = await call(app, bob.token, "GET", "/api/projects/acme/stats");
    assert.equal(res.status, 200);
    const stats = res.body;
    assert.equal(stats.commitCount, 4);
    assert.equal(stats.branchCount, 3);
    assert.deepEqual(
      stats.contributors.map((entry: { user: { email: string }; commits: number }) => [
        entry.user.email,
        entry.commits,
      ]),
      [
        ["alice@example.com", 3],
        ["bob@example.com", 1],
      ],
    );
    assert.deepEqual(stats.kinds, [
      { kind: "file", extension: "pdf", count: 2 },
      { kind: "file", extension: "", count: 1 },
      { kind: "ifc", extension: "ifc", count: 1 },
      { kind: "md", extension: "md", count: 1 },
    ]);
    assert.deepEqual(stats.issues, { open: 2, closed: 1 });
    assert.deepEqual(stats.runs, {
      total: 3,
      success: 2,
      failed: 1,
      error: 0,
      running: 0,
      queued: 0,
      cancelled: 0,
    });
    assert.equal(stats.lastCommit.id, c4.id);
    assert.equal(stats.lastCommit.author.email, "alice@example.com");
    assert.deepEqual(stats.lastCommit.model, {
      slug: readme.slug,
      name: "README.md",
      kind: "md",
      folder: "",
    });
    // Objekte = Head des Standard-Branches (c2), nicht der Variante.
    assert.ok(c2.entityCount > 0);
    assert.equal(stats.entityCount, c2.entityCount);
    assert.equal(stats.modelCount, 5);
    assert.equal(stats.folderCount, 3);
    assert.equal(stats.memberCount, 2);

    // Öffentliches Projekt: jeder Angemeldete darf lesen; privates nicht.
    assert.equal((await call(app, carol.token, "GET", "/api/projects/acme/stats")).status, 200);
    await call(app, carol.token, "POST", "/api/projects", {
      name: "Geheim",
      slug: "geheim",
      visibility: "private",
    });
    const empty = await call(app, carol.token, "GET", "/api/projects/geheim/stats");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.lastCommit, null);
    assert.equal(empty.body.commitCount, 0);
    assert.deepEqual(empty.body.contributors, []);
    assert.equal((await call(app, alice.token, "GET", "/api/projects/geheim/stats")).status, 403);

    await app.close();
  });

  test(`${backend}: Meine Issues — zugewiesen/eröffnet, nur offene, nur zugängliche Projekte`, async () => {
    const { app } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    const bob = await register(app, "bob@example.com", "Bob");
    const carol = await register(app, "carol@example.com", "Carol");
    await call(app, alice.token, "POST", "/api/projects", { name: "Acme", slug: "acme" });
    await call(app, alice.token, "POST", "/api/projects/acme/members", {
      email: "bob@example.com",
      role: "contributor",
    });
    const bug = (
      await call(app, alice.token, "POST", "/api/projects/acme/labels", {
        name: "bug",
        color: "#d73a4a",
      })
    ).body.label;
    // Privates Projekt, in dem Alice (noch) Mitglied ist.
    await call(app, carol.token, "POST", "/api/projects", {
      name: "Geheim",
      slug: "geheim",
      visibility: "private",
    });
    await call(app, carol.token, "POST", "/api/projects/geheim/members", {
      email: "alice@example.com",
      role: "contributor",
    });
    await call(app, carol.token, "POST", "/api/projects/geheim/issues", {
      title: "Geheim zugewiesen",
      assigneeIds: [alice.id],
    });

    const newIssue = async (token: string, payload: Record<string, unknown>) => {
      const res = await call(app, token, "POST", "/api/projects/acme/issues", payload);
      await sleep(3);
      return res.body.issue as Issue;
    };
    const a = await newIssue(bob.token, {
      title: "A",
      assigneeIds: [alice.id],
      labelIds: [bug.id],
    });
    const d = await newIssue(bob.token, { title: "D", assigneeIds: [alice.id] });
    const b = await newIssue(alice.token, { title: "B" });
    const c = await newIssue(alice.token, { title: "C", assigneeIds: [alice.id] });
    await call(app, alice.token, "PATCH", `/api/projects/acme/issues/${c.number}`, {
      state: "closed",
    });
    await newIssue(bob.token, { title: "S", parentId: a.id });
    await call(app, bob.token, "POST", `/api/projects/acme/issues/${a.number}/comments`, {
      body: "eins",
    });
    await call(app, alice.token, "POST", `/api/projects/acme/issues/${a.number}/comments`, {
      body: "zwei",
    });

    // Neueste Aktivität zuerst: A wurde zuletzt kommentiert.
    const whileMember = (await call(app, alice.token, "GET", "/api/me/issues")).body;
    assert.deepEqual(
      whileMember.assigned.map((issue: { title: string }) => issue.title),
      ["A", "D", "Geheim zugewiesen"],
    );

    // Nach dem Entfernen aus dem privaten Projekt ist dessen Issue weg.
    await call(app, carol.token, "DELETE", `/api/projects/geheim/members/${alice.id}`);
    const mine = await call(app, alice.token, "GET", "/api/me/issues");
    assert.equal(mine.status, 200);
    assert.deepEqual(
      mine.body.assigned.map((issue: { id: string }) => issue.id),
      [a.id, d.id],
    );
    assert.deepEqual(
      mine.body.created.map((issue: { id: string }) => issue.id),
      [b.id],
    );
    const itemA = mine.body.assigned[0];
    assert.deepEqual(Object.keys(itemA).sort(), [
      "commentCount",
      "createdAt",
      "id",
      "kind",
      "labels",
      "number",
      "project",
      "state",
      "subIssueCount",
      "title",
      "updatedAt",
    ]);
    assert.equal(itemA.number, a.number);
    assert.equal(itemA.state, "open");
    assert.equal(itemA.kind, "virtual");
    assert.deepEqual(itemA.project, { slug: "acme", name: "Acme" });
    assert.deepEqual(itemA.labels, [bug]);
    assert.equal(itemA.commentCount, 2);
    assert.equal(itemA.subIssueCount, 1);
    assert.ok(itemA.updatedAt > itemA.createdAt);
    assert.equal(mine.body.assigned[1].commentCount, 0);

    const bobs = (await call(app, bob.token, "GET", "/api/me/issues")).body;
    assert.deepEqual(bobs.assigned, []);
    assert.deepEqual(
      bobs.created.map((issue: { title: string }) => issue.title).sort(),
      ["A", "D", "S"],
    );
    assert.equal((await call(app, null, "GET", "/api/me/issues")).status, 401);

    await app.close();
  });

  test(`${backend}: Admin-Systemübersicht nur für globale Admins`, async () => {
    const { app, repo } = await makeApp(backend);
    const user = await register(app, "user@example.com", "User");
    await repo.createUser({
      email: "admin@ifc-hub.local",
      name: "Admin",
      passwordHash: hashPassword("adminpass123"),
      isAdmin: true,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@ifc-hub.local", password: "adminpass123" },
    });
    const admin = JSON.parse(login.body).token as string;
    await call(app, user.token, "POST", "/api/projects", { name: "Acme", slug: "acme" });
    const model = (
      await call(app, user.token, "POST", "/api/projects/acme/models", {
        name: "README.md",
        kind: "md",
      })
    ).body.model;
    await commitFile(app, user.token, "acme", model.slug, "# Hallo", "text/markdown");
    await call(app, user.token, "POST", "/api/projects/acme/issues", { title: "Eins" });

    assert.equal((await call(app, null, "GET", "/api/admin/system")).status, 401);
    assert.equal((await call(app, user.token, "GET", "/api/admin/system")).status, 403);
    const res = await call(app, admin, "GET", "/api/admin/system");
    assert.equal(res.status, 200);
    const system = res.body;
    assert.equal(system.version, SERVER_VERSION);
    assert.equal(system.storage, "filesystem");
    assert.equal(system.database, backend);
    assert.equal(system.node, process.version);
    assert.ok(Number.isInteger(system.uptimeSec) && system.uptimeSec >= 0);
    assert.ok(system.memory.rss > 0 && system.memory.heapUsed > 0 && system.memory.heapTotal > 0);
    assert.ok(system.workers >= 1);
    assert.deepEqual(system.runner, { queued: 0, running: 0 });
    assert.deepEqual(system.counts, {
      users: 2,
      projects: 1,
      models: 1,
      commits: 1,
      issues: 1,
      runs: 0,
    });

    await app.close();
  });

  test(`${backend}: Rollen — nur Owner vergeben/entziehen Owner, ungültige Rollen abgelehnt`, async () => {
    const { app } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice"); // legt das Projekt an
    const mara = await register(app, "mara@example.com", "Mara");
    const olga = await register(app, "olga@example.com", "Olga");
    await register(app, "carl@example.com", "Carl");
    await call(app, alice.token, "POST", "/api/projects", { name: "Acme", slug: "acme" });
    const setRole = (token: string, email: string, role?: string) =>
      call(app, token, "POST", "/api/projects/acme/members", role ? { email, role } : { email });
    const removeMember = (token: string, userId: string) =>
      call(app, token, "DELETE", `/api/projects/acme/members/${userId}`);

    assert.equal((await setRole(alice.token, "mara@example.com", "maintainer")).status, 201);
    assert.equal((await setRole(alice.token, "olga@example.com", "owner")).status, 201);
    assert.equal((await setRole(alice.token, "carl@example.com", "contributor")).status, 201);

    // Maintainer: sich selbst oder andere zum Owner machen, Owner herabstufen
    // oder entfernen → 403 (sonst Weg zum Projekt-Löschen).
    assert.equal((await setRole(mara.token, "mara@example.com", "owner")).status, 403);
    assert.equal((await setRole(mara.token, "carl@example.com", "owner")).status, 403);
    assert.equal((await setRole(mara.token, "olga@example.com", "viewer")).status, 403);
    assert.equal((await removeMember(mara.token, olga.id)).status, 403);
    // Übrige Rollen darf ein Maintainer verwalten.
    assert.equal((await setRole(mara.token, "carl@example.com", "viewer")).status, 201);
    // Ungültige Rolle → 400; Projekt-Owner ohne Rollenangabe nicht zurückstufen.
    assert.equal((await setRole(alice.token, "carl@example.com", "superuser")).status, 400);
    assert.equal((await setRole(alice.token, "alice@example.com")).status, 400);

    // Owner dürfen befördern und andere Owner entfernen.
    assert.equal((await setRole(olga.token, "mara@example.com", "owner")).status, 201);
    assert.equal((await removeMember(alice.token, olga.id)).status, 204);

    const detail = (await call(app, alice.token, "GET", "/api/projects/acme")).body;
    const roles = Object.fromEntries(
      detail.members.map((m: { user: { email: string }; role: string }) => [m.user.email, m.role]),
    );
    assert.deepEqual(roles, {
      "alice@example.com": "owner",
      "mara@example.com": "owner",
      "carl@example.com": "viewer",
    });

    await app.close();
  });

  test(`${backend}: Projektdetail meldet hasImage; globale Admins sehen private Modelle`, async () => {
    const { app, repo } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    await repo.createUser({
      email: "admin@ifc-hub.local",
      name: "Admin",
      passwordHash: hashPassword("adminpass123"),
      isAdmin: true,
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "admin@ifc-hub.local", password: "adminpass123" },
    });
    const admin = JSON.parse(login.body).token as string;
    await call(app, alice.token, "POST", "/api/projects", {
      name: "Acme",
      slug: "acme",
      visibility: "private",
    });
    await call(app, alice.token, "POST", "/api/projects/acme/models", { name: "Notizen.md", kind: "md" });

    assert.equal((await call(app, alice.token, "GET", "/api/projects/acme")).body.project.hasImage, false);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const upload = await app.inject({
      method: "PUT",
      url: "/api/projects/acme/image",
      headers: { authorization: `Bearer ${alice.token}`, "content-type": "image/png" },
      payload: png,
    });
    assert.equal(upload.statusCode, 204, upload.body);
    assert.equal((await call(app, alice.token, "GET", "/api/projects/acme")).body.project.hasImage, true);

    // Admin ohne Mitgliedschaft: Owner-Rechte → auch das private Modell in der Liste.
    const models = await call(app, admin, "GET", "/api/projects/acme/models");
    assert.equal(models.status, 200);
    assert.deepEqual(
      models.body.models.map((m: { name: string }) => m.name),
      ["Notizen.md"],
    );

    await app.close();
  });

  test(`${backend}: Issues tragen commentCount (Liste, Detail, Unter-Issues)`, async () => {
    const { app } = await makeApp(backend);
    const alice = await register(app, "alice@example.com", "Alice");
    await call(app, alice.token, "POST", "/api/projects", { name: "Acme", slug: "acme" });
    const parent = (
      await call(app, alice.token, "POST", "/api/projects/acme/issues", { title: "Eltern" })
    ).body.issue;
    assert.equal(parent.commentCount, 0);
    await call(app, alice.token, "POST", "/api/projects/acme/issues", {
      title: "Kind",
      parentId: parent.id,
    });
    await call(app, alice.token, "POST", "/api/projects/acme/issues", { title: "Ohne" });
    const comment = async (number: number, body: string) =>
      (
        await call(app, alice.token, "POST", `/api/projects/acme/issues/${number}/comments`, {
          body,
        })
      ).body.comment;
    await comment(1, "eins");
    const second = await comment(1, "zwei");
    await comment(2, "drei");

    const list = (await call(app, alice.token, "GET", "/api/projects/acme/issues")).body.issues;
    assert.deepEqual(
      Object.fromEntries(
        list.map((issue: { number: number; commentCount: number }) => [
          issue.number,
          issue.commentCount,
        ]),
      ),
      { 1: 2, 2: 1, 3: 0 },
    );
    const detail = (await call(app, alice.token, "GET", "/api/projects/acme/issues/1")).body;
    assert.equal(detail.issue.commentCount, 2);
    assert.equal(detail.subIssues[0].commentCount, 1);
    assert.equal(detail.comments.length, 2);

    await call(app, alice.token, "DELETE", `/api/projects/acme/issues/1/comments/${second.id}`);
    const patched = await call(app, alice.token, "PATCH", "/api/projects/acme/issues/1", {
      title: "Eltern!",
    });
    assert.equal(patched.body.issue.commentCount, 1);

    await app.close();
  });
}

// ---- Repository-Ebene: gleiche Ergebnisse für Memory, SQLite, Postgres ----

const REPOSITORIES: [string, () => Promise<Repository>][] = [
  ["memory", async () => new MemoryRepository()],
  ["sqlite", sqliteRepository],
  ["pglite", pgliteRepository],
];

for (const [name, createRepository] of REPOSITORIES) {
  test(`${name}: Repository — Ordner löschen trifft Unterordner auch bei _ und % im Namen`, async () => {
    const repo = await createRepository();
    const owner = await repo.createUser({
      email: "owner@example.com",
      name: "Owner",
      passwordHash: "x",
      isAdmin: false,
    });
    const project = await repo.createProject({
      slug: "acme",
      name: "Acme",
      ownerId: owner.id,
      visibility: "public",
    });
    for (const path of [
      "Hochbau_EG",
      "Hochbau_EG/Raum 1",
      "HochbauXEG",
      "HochbauXEG/Raum 2",
      "100%",
      "100%/Plan",
      "1000/Plan",
    ]) {
      await repo.addFolder(project.id, path);
    }

    // `_` und `%` sind LIKE-Platzhalter: Unterordner müssen mit, ähnlich
    // benannte Nachbarn („HochbauXEG“, „1000“) dürfen nicht mitgelöscht werden.
    await repo.removeFolder(project.id, "Hochbau_EG");
    await repo.removeFolder(project.id, "100%");
    assert.deepEqual([...(await repo.listFolders(project.id))].sort(), [
      "1000/Plan",
      "HochbauXEG",
      "HochbauXEG/Raum 2",
    ]);
  });

  test(`${name}: Repository — Beschreibungen, Labels, Zeitleiste, Feed-Quellen, Zähler, Suche`, async () => {
    const repo = await createRepository();
    const alice = await repo.createUser({
      email: "alice@example.com",
      name: "Alice",
      passwordHash: "x",
      isAdmin: false,
    });
    const bob = await repo.createUser({
      email: "bob@example.com",
      name: "Bob",
      passwordHash: "x",
      isAdmin: false,
    });

    // Projekte mit Beschreibung.
    const project = await repo.createProject({
      slug: "bruecke",
      name: "Brücke",
      ownerId: alice.id,
      visibility: "public",
      description: "Überbau",
    });
    assert.equal(project.description, "Überbau");
    const other = await repo.createProject({
      slug: "andere",
      name: "Andere",
      ownerId: bob.id,
      visibility: "private",
    });
    assert.equal(other.description, "");
    assert.equal((await repo.getProjectBySlug("bruecke"))?.description, "Überbau");
    assert.equal((await repo.updateProject(project.id, { name: "Brücke Nord" }))?.description, "Überbau");
    assert.equal((await repo.updateProject(project.id, { description: "" }))?.description, "");
    await repo.addMember({ projectId: project.id, userId: alice.id, role: "owner" });
    await repo.addMember({ projectId: project.id, userId: bob.id, role: "contributor" });

    // Modelle + Commits mit festen Zeitstempeln.
    const newModel = (projectId: string, slug: string, modelName: string, folder: string) =>
      repo.createModel({
        projectId,
        slug,
        name: modelName,
        visibility: "private",
        defaultBranch: "main",
        folder,
        kind: "ifc",
      });
    const ueberbau = await newModel(project.id, "ueberbau", "Überbau_A", "Tragwerk");
    const lager = await newModel(project.id, "lager", "Lager", "Unterbau");
    await newModel(project.id, "widerlager", "Widerlager", "Unterbau");
    await newModel(project.id, "plan-b", "Plan_B", "");
    await newModel(project.id, "plan-bb", "Plan BB", "");
    const fremd = await newModel(other.id, "fremd", "Überbau X", "");
    const commitAt = (model: Model, authorId: string, createdAt: string) =>
      repo.createCommit({
        id: randomUUID(),
        modelId: model.id,
        branchName: "main",
        parentCommitId: null,
        manifestHash: "mh",
        blobKey: "b",
        schema: "IFC4",
        authorId,
        message: `Stand ${createdAt}`,
        createdAt,
        entityCount: 1,
        added: 1,
        removed: 0,
        modified: 0,
      });
    const c1 = await commitAt(ueberbau, alice.id, "2026-01-15T08:00:00.000Z");
    const c2 = await commitAt(ueberbau, alice.id, "2026-01-15T09:00:00.000Z");
    const c3 = await commitAt(lager, bob.id, "2026-01-16T10:00:00.000Z");
    const c4 = await commitAt(fremd, bob.id, "2026-01-17T10:00:00.000Z");

    const commitIds = (rows: { commit: { id: string } }[]) => rows.map((row) => row.commit.id);
    const recent = await repo.listRecentCommits([project.id], { limit: 10 });
    assert.deepEqual(commitIds(recent), [c3.id, c2.id, c1.id]);
    assert.deepEqual(recent[0]!.model, lager);
    assert.deepEqual(recent[0]!.commit, c3);
    assert.deepEqual(commitIds(await repo.listRecentCommits([project.id], { limit: 1 })), [c3.id]);
    assert.deepEqual(
      commitIds(await repo.listRecentCommits([project.id], { limit: 10, before: c3.createdAt })),
      [c2.id, c1.id],
    );
    assert.deepEqual(
      commitIds(
        await repo.listRecentCommits([project.id, other.id], { limit: 10, actorId: bob.id }),
      ),
      [c4.id, c3.id],
    );
    assert.deepEqual(await repo.listRecentCommits([], { limit: 10 }), []);
    assert.deepEqual(await repo.countCommitsByAuthor(project.id), [
      { authorId: alice.id, count: 2 },
      { authorId: bob.id, count: 1 },
    ]);

    // Labels.
    const bug = await repo.createLabel({
      projectId: project.id,
      name: "bug",
      color: "#d73a4a",
      description: "Fehler",
    });
    const feature = await repo.createLabel({
      projectId: project.id,
      name: "feature",
      color: "#00aa00",
    });
    assert.equal(feature.description, "");
    assert.deepEqual(await repo.getLabel(bug.id), {
      id: bug.id,
      projectId: project.id,
      name: "bug",
      color: "#d73a4a",
      description: "Fehler",
    });
    assert.equal(await repo.getLabel(randomUUID()), null);
    assert.deepEqual(await repo.updateLabel(bug.id, { name: "defect" }), {
      id: bug.id,
      projectId: project.id,
      name: "defect",
      color: "#d73a4a",
      description: "Fehler",
    });
    assert.equal((await repo.updateLabel(bug.id, { description: "" }))?.description, "");
    assert.equal(await repo.updateLabel(randomUUID(), { name: "x" }), null);

    // Issues, Zuordnungen, Kommentare (Zeitstempel nacheinander).
    const newIssue = async (title: string, authorId: string, parentId: string | null) => {
      const issue = await repo.createIssue({
        projectId: project.id,
        title,
        body: "",
        state: "open",
        kind: "virtual",
        authorId,
        parentId,
      });
      await sleep(3);
      return issue;
    };
    const i1 = await newIssue("Überbau Fuge", alice.id, null);
    const i2 = await newIssue("Lager tauschen", bob.id, i1.id);
    const i3 = await newIssue("Fuge 2", alice.id, null);
    await repo.updateIssue(i3.id, { state: "closed" });
    const i3Updated = await repo.getIssueById(i3.id);
    await repo.setIssueLinks(i1.id, { assigneeIds: [bob.id], labelIds: [bug.id, feature.id] });
    await repo.setIssueLinks(i2.id, { labelIds: [bug.id] });
    await repo.setIssueLinks(i3.id, { labelIds: [bug.id] });
    assert.deepEqual(Object.fromEntries(await repo.countOpenIssuesByLabel(project.id)), {
      [bug.id]: 2,
      [feature.id]: 1,
    });
    await repo.deleteLabel(feature.id);
    assert.equal(await repo.getLabel(feature.id), null);
    assert.deepEqual((await repo.getIssueLinks([i1.id])).get(i1.id)?.labelIds, [bug.id]);

    await sleep(3);
    const k1 = await repo.createIssueComment({ issueId: i1.id, authorId: bob.id, body: "eins" });
    await sleep(3);
    const k2 = await repo.createIssueComment({ issueId: i1.id, authorId: alice.id, body: "zwei" });
    assert.deepEqual(Object.fromEntries(await repo.countIssueComments([i1.id, i2.id])), {
      [i1.id]: 2,
      [i2.id]: 0,
    });
    assert.deepEqual(Object.fromEntries(await repo.countSubIssues([i1.id, i2.id])), {
      [i1.id]: 1,
      [i2.id]: 0,
    });
    assert.equal((await repo.countIssueComments([])).size, 0);
    assert.equal((await repo.countSubIssues([])).size, 0);

    const issueIds = (issues: Issue[]) => issues.map((issue) => issue.id);
    assert.deepEqual(
      issueIds(
        await repo.listIssuesByFilter([project.id], { state: "open", assigneeId: bob.id, limit: 10 }),
      ),
      [i1.id],
    );
    assert.deepEqual(
      issueIds(await repo.listIssuesByFilter([project.id], { authorId: alice.id, limit: 10 })),
      [i3.id, i1.id],
    );
    assert.deepEqual(
      issueIds(await repo.listIssuesByFilter([project.id], { state: "open", limit: 1 })),
      [i2.id],
    );
    assert.deepEqual(await repo.listIssuesByFilter([], { limit: 10 }), []);

    // Zeitleiste: ein Aufruf = ein Zeitstempel, feste Reihenfolge.
    const events = await repo.createIssueEvents([
      { issueId: i1.id, projectId: project.id, actorId: alice.id, kind: "closed", data: {} },
      {
        issueId: i1.id,
        projectId: project.id,
        actorId: alice.id,
        kind: "renamed",
        data: { from: "Fuge", to: "Überbau Fuge" },
      },
      {
        issueId: i1.id,
        projectId: project.id,
        actorId: alice.id,
        kind: "labeled",
        data: { labels: [{ id: bug.id, name: "defect", color: "#d73a4a" }] },
      },
    ]);
    assert.equal(new Set(events.map((event) => event.createdAt)).size, 1);
    const timeline = await repo.listIssueEvents(i1.id);
    assert.deepEqual(
      timeline.map((event) => event.kind),
      ["renamed", "labeled", "closed"],
    );
    assert.deepEqual(timeline[1]!.data, {
      labels: [{ id: bug.id, name: "defect", color: "#d73a4a" }],
    });
    assert.deepEqual(timeline[2], events[0]);
    await sleep(3);
    const [reopened] = await repo.createIssueEvents([
      { issueId: i1.id, projectId: project.id, actorId: bob.id, kind: "reopened", data: {} },
    ]);
    assert.deepEqual(await repo.createIssueEvents([]), []);
    const stateKinds = ["closed", "reopened"] as const;
    assert.deepEqual(
      (await repo.listRecentIssueEvents([project.id], { limit: 10, kinds: [...stateKinds] })).map(
        (event) => event.kind,
      ),
      ["reopened", "closed"],
    );
    assert.deepEqual(
      (
        await repo.listRecentIssueEvents([project.id], {
          limit: 10,
          kinds: [...stateKinds],
          actorId: bob.id,
        })
      ).map((event) => event.id),
      [reopened!.id],
    );
    assert.deepEqual(await repo.listRecentIssueEvents([project.id], { limit: 10, kinds: [] }), []);
    assert.equal((await repo.listRecentIssueEvents([project.id], { limit: 10 })).length, 4);
    assert.deepEqual(await repo.listRecentIssueEvents([other.id], { limit: 10 }), []);

    // Feed-Quellen: Issues, Kommentare, Runs (ohne Protokoll).
    assert.deepEqual(issueIds(await repo.listRecentIssues([project.id], { limit: 10 })), [
      i3.id,
      i2.id,
      i1.id,
    ]);
    assert.deepEqual(
      issueIds(
        await repo.listRecentIssues([project.id], {
          limit: 10,
          actorId: alice.id,
          before: i3.createdAt,
        }),
      ),
      [i1.id],
    );
    const comments = await repo.listRecentComments([project.id], { limit: 10 });
    assert.deepEqual(
      comments.map((row) => [row.comment.id, row.projectId]),
      [
        [k2.id, project.id],
        [k1.id, project.id],
      ],
    );
    assert.deepEqual(comments[1]!.comment, k1);
    assert.deepEqual(
      (await repo.listRecentComments([project.id], { limit: 10, actorId: bob.id })).map(
        (row) => row.comment.body,
      ),
      ["eins"],
    );
    assert.deepEqual(await repo.listRecentComments([other.id], { limit: 10 }), []);

    const action = await repo.createAction({
      id: randomUUID(),
      projectId: project.id,
      name: "IDS",
      kind: "ids",
      fileKey: "k",
      fileName: "a.ids",
      libraryFileId: null,
      scopeFolder: null,
      scopeModelId: null,
      runOnCommit: false,
    });
    const newRun = (status: ActionRunStatus, triggeredById: string) =>
      repo.createActionRun({
        projectId: project.id,
        actionId: action.id,
        modelId: ueberbau.id,
        commitId: c1.id,
        status,
        summary: status,
        log: "sehr langes Protokoll",
        failedGuids: ["G1"],
        triggeredById,
        startedAt: null,
        finishedAt: null,
      });
    const r1 = await newRun("success", alice.id);
    await sleep(3);
    const r2 = await newRun("failed", bob.id);
    const runs = await repo.listRecentRuns([project.id], { limit: 10 });
    assert.deepEqual(
      runs.map((run) => run.id),
      [r2.id, r1.id],
    );
    const { log: _log, ...r2WithoutLog } = r2;
    assert.deepEqual(runs[0], r2WithoutLog);
    assert.deepEqual(
      (await repo.listRecentRuns([project.id], { limit: 10, actorId: alice.id })).map((run) => run.id),
      [r1.id],
    );
    assert.deepEqual(Object.fromEntries(await repo.countActionRunsByStatus(project.id)), {
      success: 1,
      failed: 1,
    });

    // Beiträge je UTC-Tag.
    const days = await repo.activityDayCounts([project.id], { since: "2026-01-15" });
    assert.deepEqual(
      days.map((day) => day.day),
      [...days.map((day) => day.day)].sort(),
    );
    const byDay = new Map(days.map((day) => [day.day, day]));
    assert.deepEqual(byDay.get("2026-01-15"), {
      day: "2026-01-15",
      commits: 2,
      issues: 0,
      comments: 0,
    });
    assert.deepEqual(byDay.get("2026-01-16"), {
      day: "2026-01-16",
      commits: 1,
      issues: 0,
      comments: 0,
    });
    assert.equal(byDay.has("2026-01-17"), false);
    const sumOf = (list: typeof days, key: "commits" | "issues" | "comments") =>
      list
        .filter((day) => !day.day.startsWith("2026-01"))
        .reduce((sum, day) => sum + day[key], 0);
    assert.equal(sumOf(days, "issues"), 3);
    assert.equal(sumOf(days, "comments"), 2);
    const bobsDays = await repo.activityDayCounts([project.id], {
      since: "2026-01-16",
      actorId: bob.id,
    });
    assert.equal(bobsDays.some((day) => day.day === "2026-01-15"), false);
    assert.equal(bobsDays.find((day) => day.day === "2026-01-16")?.commits, 1);
    assert.equal(sumOf(bobsDays, "issues"), 1);
    assert.equal(sumOf(bobsDays, "comments"), 1);
    assert.deepEqual(await repo.activityDayCounts([], { since: "2026-01-01" }), []);

    // Kennzahlen je Projekt.
    const summaries = await repo.projectSummaries([project.id, other.id]);
    assert.deepEqual(summaries.get(project.id), {
      memberCount: 2,
      modelCount: 5,
      openIssueCount: 2,
      closedIssueCount: 1,
      commitCount: 3,
      lastCommitAt: c3.createdAt,
      lastIssueAt: i3Updated?.updatedAt,
    });
    assert.deepEqual(summaries.get(other.id), {
      memberCount: 0,
      modelCount: 1,
      openIssueCount: 0,
      closedIssueCount: 0,
      commitCount: 1,
      lastCommitAt: c4.createdAt,
      lastIssueAt: null,
    });
    assert.equal((await repo.projectSummaries([])).size, 0);

    // Suche: Unicode-Kleinschreibung, Präfix zuerst, LIKE-Zeichen wörtlich.
    const names = (models: Model[]) => models.map((model) => model.name);
    assert.deepEqual(names(await repo.searchModels([project.id, other.id], "über", 10)).sort(), [
      "Überbau X",
      "Überbau_A",
    ]);
    assert.deepEqual(names(await repo.searchModels([project.id], "ÜBER", 10)), ["Überbau_A"]);
    assert.deepEqual(names(await repo.searchModels([project.id], "lager", 10)), [
      "Lager",
      "Widerlager",
    ]);
    assert.deepEqual(names(await repo.searchModels([project.id], "trag", 10)), ["Überbau_A"]);
    assert.deepEqual(names(await repo.searchModels([project.id], "n_b", 10)), ["Plan_B"]);
    assert.deepEqual(await repo.searchModels([project.id], "%", 10), []);
    assert.equal((await repo.searchModels([project.id], "a", 2)).length, 2);
    assert.deepEqual(await repo.searchModels([], "a", 10), []);
    const titles = (issues: Issue[]) => issues.map((issue) => issue.title);
    assert.deepEqual(titles(await repo.searchIssues([project.id], { text: "fuge", limit: 10 })), [
      "Fuge 2",
      "Überbau Fuge",
    ]);
    assert.deepEqual(
      titles(await repo.searchIssues([project.id], { text: "2", number: 2, limit: 10 })),
      ["Lager tauschen", "Fuge 2"],
    );
    assert.deepEqual(titles(await repo.searchIssues([project.id], { text: "über", limit: 10 })), [
      "Überbau Fuge",
    ]);
    assert.deepEqual(await repo.searchIssues([], { text: "x", limit: 10 }), []);

    assert.deepEqual(await repo.counts(), {
      users: 2,
      projects: 2,
      models: 6,
      commits: 4,
      issues: 3,
      runs: 2,
    });

    // Projekt löschen räumt die Zeitleiste mit ab.
    await repo.deleteProject(project.id);
    assert.deepEqual(await repo.listIssueEvents(i1.id), []);
    assert.deepEqual(await repo.listRecentIssueEvents([project.id], { limit: 10 }), []);
    assert.equal(await repo.getLabel(bug.id), null);
    assert.equal((await repo.counts()).projects, 1);
  });
}
