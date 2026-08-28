import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteClient } from "../src/repository/sql/sqliteClient";
import { SqlRepository } from "../src/repository/sqlRepository";

test("SQLite: Katalog-Roundtrip inkl. Ordner, Diff-Cache und Neustart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ifc-sqlite-"));
  const path = join(dir, "catalog.sqlite");
  const repo = new SqlRepository(new SqliteClient(path));
  await repo.migrate();

  const user = await repo.createUser({
    email: "a@b.c",
    name: "A",
    passwordHash: "x:y",
    isAdmin: false,
  });
  const project = await repo.createProject({
    slug: "acme",
    name: "Acme",
    ownerId: user.id,
    visibility: "public",
  });
  await repo.addMember({ projectId: project.id, userId: user.id, role: "owner" });
  await repo.addFolder(project.id, "Hochbau/EG");
  const model = await repo.createModel({
    projectId: project.id,
    slug: "tower",
    name: "Tower",
    visibility: "private",
    defaultBranch: "main",
    folder: "Hochbau",
    kind: "ifc",
  });
  const branch = await repo.createBranch({
    modelId: model.id,
    name: "main",
    headCommitId: null,
  });
  await repo.createCommit({
    id: "c1",
    modelId: model.id,
    branchName: "main",
    parentCommitId: null,
    manifestHash: "mh",
    blobKey: "models/m/commits/c1.ifc",
    schema: "IFC4",
    authorId: user.id,
    message: "init",
    createdAt: new Date().toISOString(),
    entityCount: 1,
    added: 1,
    removed: 0,
    modified: 0,
  });
  await repo.saveManifest("c1", [
    { globalId: "G1", hash: "h1", type: "IFCWALL", name: "Wand", payload: "p" },
  ]);
  await repo.setBranchHead(branch.id, "c1");
  await repo.saveCachedDiff("c0", "c1", {
    added: [],
    removed: [],
    modified: [],
    unchanged: 1,
    beforeManifestHash: "a",
    afterManifestHash: "b",
    identical: false,
  });

  // "Neustart": neue Client-Instanz auf derselben Datei.
  const restarted = new SqlRepository(new SqliteClient(path));
  await restarted.migrate();

  assert.equal((await restarted.getUserByEmail("a@b.c"))?.id, user.id);
  assert.equal((await restarted.getProjectBySlug("acme"))?.id, project.id);
  assert.deepEqual(await restarted.listFolders(project.id), ["Hochbau/EG"]);
  const loadedModel = await restarted.getModel(project.id, "tower");
  assert.equal(loadedModel?.folder, "Hochbau");
  assert.equal(loadedModel?.kind, "ifc");
  assert.equal((await restarted.getBranch(model.id, "main"))?.headCommitId, "c1");
  assert.equal((await restarted.getCommit("c1"))?.message, "init");
  assert.equal((await restarted.getManifest("c1")).length, 1);
  // jsonb-Summary kommt aus SQLite als TEXT und wird geparst.
  assert.equal((await restarted.getCachedDiff("c0", "c1"))?.unchanged, 1);
});

test("SQLite: Issues + Labels + Zuordnungen", async () => {
  const repo = new SqlRepository(new SqliteClient(":memory:"));
  await repo.migrate();

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
  const model = await repo.createModel({
    projectId: project.id,
    slug: "m",
    name: "M",
    visibility: "private",
    defaultBranch: "main",
    folder: "",
    kind: "ifc",
  });
  const label = await repo.createLabel({
    projectId: project.id,
    name: "bug",
    color: "#d73a4a",
  });

  const first = await repo.createIssue({
    projectId: project.id,
    title: "Wand kollidiert",
    body: "Details …",
    state: "open",
    authorId: user.id,
  });
  assert.equal(first.number, 1);
  const second = await repo.createIssue({
    projectId: project.id,
    title: "Zweites",
    body: "",
    state: "open",
    authorId: user.id,
  });
  assert.equal(second.number, 2);

  await repo.setIssueLinks(first.id, {
    assigneeIds: [user.id],
    modelIds: [model.id],
    labelIds: [label.id],
  });
  const links = (await repo.getIssueLinks([first.id, second.id])).get(first.id);
  assert.deepEqual(links, {
    assigneeIds: [user.id],
    modelIds: [model.id],
    labelIds: [label.id],
  });

  // Teil-Update: nur Labels ersetzen, Rest bleibt.
  await repo.setIssueLinks(first.id, { labelIds: [] });
  const afterUpdate = (await repo.getIssueLinks([first.id])).get(first.id);
  assert.deepEqual(afterUpdate?.labelIds, []);
  assert.deepEqual(afterUpdate?.assigneeIds, [user.id]);

  const closed = await repo.updateIssue(first.id, { state: "closed" });
  assert.equal(closed?.state, "closed");
  assert.equal(closed?.title, "Wand kollidiert");

  const list = await repo.listIssues(project.id);
  assert.deepEqual(
    list.map((issue) => issue.number),
    [2, 1],
  );
  assert.equal((await repo.getIssue(project.id, 1))?.id, first.id);

  // Kaskade: Projekt löschen räumt Issues + Labels mit ab.
  await repo.deleteProject(project.id);
  assert.equal((await repo.listIssues(project.id)).length, 0);
  assert.equal((await repo.listLabels(project.id)).length, 0);
});
