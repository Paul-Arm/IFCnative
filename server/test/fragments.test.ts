import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FragmentsService } from "../src/domain/fragmentsService";
import type { Commit } from "../src/repository/types";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModelWithGeometry } from "./fixtures";

function fakeCommit(blobKey: string): Commit {
  return {
    id: "c1",
    modelId: "m1",
    branchName: "main",
    parentCommitId: null,
    manifestHash: "x",
    blobKey,
    schema: "IFC4",
    authorId: "u1",
    message: "",
    createdAt: new Date().toISOString(),
    entityCount: 1,
    added: 1,
    removed: 0,
    modified: 0,
  };
}

test("IFC -> Fragments: Konvertierung in Node + Cache im Object Store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ifc-frag-"));
  const store = new FilesystemObjectStore(dir);
  const blobKey = "models/m1/commits/c1.ifc";
  await store.put(blobKey, ifcModelWithGeometry());

  const service = new FragmentsService(store);
  const commit = fakeCommit(blobKey);

  const first = await service.getFragments(commit);
  assert.ok(first.length > 0, "Fragments-Bytes erzeugt");
  assert.ok(
    await store.exists("models/m1/commits/c1.frag"),
    "Fragments im Store gecacht",
  );

  // Zweiter Abruf kommt aus dem Cache: wir überschreiben den Cache-Eintrag
  // mit einem Marker und erwarten exakt diesen zurück (keine Neukonvertierung).
  await store.put("models/m1/commits/c1.frag", Buffer.from("CACHED"));
  const second = await service.getFragments(commit);
  assert.equal(second.toString("utf8"), "CACHED");
});
