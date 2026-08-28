import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CommitService } from "../src/domain/commitService";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel, PSET } from "./fixtures";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-svc-"));
  const repo = new MemoryRepository();
  const store = new FilesystemObjectStore(dir);
  const service = new CommitService(repo, store);
  const user = await repo.createUser({
    email: "a@b.c",
    name: "A",
    passwordHash: "x",
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
  return { repo, store, service, user, model };
}

test("first commit reports every rooted entity as added", async () => {
  const { service, model, user } = await setup();
  const result = await service.createCommit({
    model,
    branchName: "main",
    text: ifcModel(),
    authorId: user.id,
    message: "init",
  });
  assert.equal(result.commit.parentCommitId, null);
  assert.equal(result.diff.added.length, 3);
  assert.equal(result.commit.entityCount, 3);
});

test("second commit diffs semantically against parent", async () => {
  const { service, model, user, repo } = await setup();
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
    message: "raise wall",
  });

  assert.equal(v2.commit.parentCommitId, v1.commit.id);
  assert.equal(v2.diff.added.length, 0);
  assert.equal(v2.diff.removed.length, 0);
  assert.equal(v2.diff.modified.length, 1);
  assert.equal(v2.diff.modified[0].globalId, PSET);

  // explicit diff between the two commits
  const diff = await service.getDiff(v1.commit, v2.commit);
  assert.equal(diff.modified.length, 1);
  assert.equal(diff.identical, false);

  // branch head advanced; history has both commits
  const history = await repo.listCommits(model.id, "main");
  assert.equal(history.length, 2);
});

test("download returns the exact stored IFC text", async () => {
  const { service, model, user } = await setup();
  const text = ifcModel();
  const v1 = await service.createCommit({
    model,
    branchName: "main",
    text: text,
    authorId: user.id,
    message: "init",
  });
  const buffer = await service.downloadIfc(v1.commit);
  assert.equal(buffer.toString("utf8"), text);
});
