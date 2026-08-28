import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JsonFileRepository } from "../src/repository/jsonFileRepository";

test("JsonFileRepository: catalog survives a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-json-"));
  const path = join(dir, "catalog.json");

  const repo = new JsonFileRepository(path);
  await repo.init();

  const user = await repo.createUser({
    email: "a@b.c",
    name: "A",
    passwordHash: "x:y",
  });
  const project = await repo.createProject({
    slug: "acme",
    name: "Acme",
    ownerId: user.id,
  });
  await repo.addMember({ projectId: project.id, userId: user.id, role: "owner" });
  const model = await repo.createModel({
    projectId: project.id,
    slug: "tower",
    name: "Tower",
    visibility: "private",
    defaultBranch: "main",
  });
  const branch = await repo.createBranch({
    modelId: model.id,
    name: "main",
    headCommitId: null,
  });
  const commit = {
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
  };
  await repo.createCommit(commit);
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
  await repo.flush();

  // "Neustart": frische Instanz liest dieselbe Datei.
  const restarted = new JsonFileRepository(path);
  await restarted.init();

  assert.equal((await restarted.getUserByEmail("a@b.c"))?.id, user.id);
  assert.equal((await restarted.getProjectBySlug("acme"))?.id, project.id);
  assert.equal(
    (await restarted.getMember(project.id, user.id))?.role,
    "owner",
  );
  assert.equal((await restarted.getModel(project.id, "tower"))?.id, model.id);
  assert.equal(
    (await restarted.getBranch(model.id, "main"))?.headCommitId,
    "c1",
  );
  assert.equal((await restarted.getCommit("c1"))?.message, "init");
  const manifest = await restarted.getManifest("c1");
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].globalId, "G1");
  assert.equal(manifest[0].type, "IFCWALL");
  assert.equal((await restarted.getCachedDiff("c0", "c1"))?.unchanged, 1);

  // Entfernen wird ebenfalls persistiert.
  await restarted.removeMember(project.id, user.id);
  await restarted.flush();
  const third = new JsonFileRepository(path);
  await third.init();
  assert.equal(await third.getMember(project.id, user.id), null);
});
