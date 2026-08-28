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
  const sql: SqlClient = {
    query: (text, params) =>
      db.query(text, params as unknown[]) as Promise<{ rows: never[] }>,
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
