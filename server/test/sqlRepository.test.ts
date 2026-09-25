import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { CommitService } from "../src/domain/commitService";
import { SqlRepository } from "../src/repository/sqlRepository";
import type { SqlClient } from "../src/repository/sql/sqlClient";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel, PSET } from "./fixtures";

async function setup() {
  const db = new PGlite();
  // Testclient: eine Verbindung, Tests laufen sequenziell — BEGIN/COMMIT
  // direkt auf der Verbindung reicht (verschachtelt via Tiefenzähler).
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

  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-sql-"));
  const store = new FilesystemObjectStore(dir);
  const service = new CommitService(repo, store);

  const user = await repo.createUser({
    email: "a@b.c",
    name: "A",
    passwordHash: "x",
    isAdmin: false,
  });
  const project = await repo.createProject({
    slug: "p",
    name: "P",
    ownerId: user.id,
    visibility: "public",
  });
  await repo.addMember({ projectId: project.id, userId: user.id, role: "owner" });
  const model = await repo.createModel({
    projectId: project.id,
    slug: "m",
    name: "M",
    visibility: "private",
    defaultBranch: "main",
    folder: "",
    kind: "ifc",
  });
  return { db, repo, service, user, project, model };
}

async function count(db: PGlite, table: string): Promise<number> {
  const res = await db.query<{ n: number | string }>(
    `select count(*)::int as n from ${table}`,
  );
  return Number(res.rows[0].n);
}

test("metadata round-trips through the SQL repository", async () => {
  const { repo, user, project, model } = await setup();
  assert.deepEqual(await repo.getUserByEmail("A@B.C"), user);
  assert.deepEqual(await repo.getProjectBySlug("p"), project);
  assert.deepEqual(await repo.getModel(project.id, "m"), model);
  assert.equal((await repo.listProjectsForUser(user.id)).length, 1);
});

test("access tokens: create, lookup by hash, touch, delete with user", async () => {
  const { db, repo, user } = await setup();
  const token = await repo.createAccessToken({ userId: user.id, name: "Editor", tokenHash: "h1", prefix: "ifch_abcd" });
  assert.equal((await repo.getAccessTokenByHash("h1"))?.id, token.id);
  assert.equal(await repo.getAccessTokenByHash("nope"), null);
  await repo.touchAccessToken(token.id, "2026-09-25T10:00:00.000Z");
  assert.equal((await repo.listAccessTokens(user.id))[0]?.lastUsedAt, "2026-09-25T10:00:00.000Z");
  await repo.deleteAccessToken(token.id);
  assert.equal((await repo.listAccessTokens(user.id)).length, 0);
  // Tokens verschwinden mit ihrem Benutzer (ohne eigene Inhalte löschbar).
  const other = await repo.createUser({ email: "t@b.c", name: "T", passwordHash: "x", isAdmin: false });
  await repo.createAccessToken({ userId: other.id, name: "Zweites", tokenHash: "h2", prefix: "ifch_efgh" });
  await repo.deleteUser(other.id);
  assert.equal(await count(db, "access_tokens"), 0);
});

test("external links: upsert, reverse lookup, cleanup on delete", async () => {
  const { db, repo, user, project } = await setup();
  assert.deepEqual(await repo.getProjectById(project.id), project);
  assert.equal(await repo.getExternalLink("openproject", "project", "7"), null);

  await repo.setExternalLink({ system: "openproject", kind: "project", externalId: "7", localId: project.id });
  await repo.setExternalLink({ system: "openproject", kind: "user", externalId: "16", localId: user.id });
  // Upsert: gleiche externe Id zeigt danach auf dasselbe Objekt, kein Duplikat.
  await repo.setExternalLink({ system: "openproject", kind: "project", externalId: "7", localId: project.id });
  assert.equal(await repo.getExternalLink("openproject", "project", "7"), project.id);
  assert.equal(await repo.getExternalLink("openproject", "user", "16"), user.id);
  assert.deepEqual(await repo.listExternalLinks("project", project.id), [
    { system: "openproject", kind: "project", externalId: "7", localId: project.id },
  ]);

  await repo.deleteProject(project.id);
  assert.equal(await repo.getExternalLink("openproject", "project", "7"), null);
  assert.equal(await count(db, "external_links"), 1);
});

test("commits persist, dedup entity payloads, and cache diffs", async () => {
  const { db, repo, service, user, model } = await setup();

  const v1 = await service.createCommit({
    model,
    branchName: "main",
    text: ifcModel(),
    authorId: user.id,
    message: "init",
  });
  const v2 = await service.createCommit({
    model,
    branchName: "main",
    text: ifcModel({ height: "3200." }),
    authorId: user.id,
    message: "raise",
  });

  // history + branch head
  assert.equal((await repo.listCommits(model.id, "main")).length, 2);
  const branch = await repo.getBranch(model.id, "main");
  assert.equal(branch?.headCommitId, v2.commit.id);

  // manifest reconstructs to 3 rooted entities
  assert.equal((await repo.getManifest(v1.commit.id)).length, 3);

  // dedup: wall + rel payloads shared across both commits; only the pset's
  // payload differs -> 4 unique entity_objects, but 6 commit_entities rows.
  assert.equal(await count(db, "entity_objects"), 4);
  assert.equal(await count(db, "commit_entities"), 6);

  // semantic diff via the repository
  const diff = await service.getDiff(v1.commit, v2.commit);
  assert.equal(diff.modified.length, 1);
  assert.equal(diff.modified[0].globalId, PSET);

  // diff is cached after first computation
  assert.equal(await count(db, "diffs_cache"), 1);
  const again = await service.getDiff(v1.commit, v2.commit);
  assert.equal(again.modified.length, 1);
  assert.equal(again.identical, false);
});
