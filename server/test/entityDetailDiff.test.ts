import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseNativeIfcText } from "../../src/ifc/nativeDocument";
import { diffEntityFields } from "../../src/ifc/versioning/entityFieldDiff";
import { buildApp } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel, PSET, WALL } from "./fixtures";

test("field diff surfaces a changed property value on the pset", () => {
  const before = parseNativeIfcText(ifcModel());
  const after = parseNativeIfcText(ifcModel({ height: "3200." }));

  const detail = diffEntityFields(before, after, PSET);

  assert.deepEqual(detail.present, { before: true, after: true });
  const height = detail.changes.find((c) => c.field === "Height");
  assert.ok(height, "Height change is reported");
  assert.equal(height.group, "Properties");
  assert.equal(height.status, "modified");
  assert.notEqual(height.before, height.after);
  assert.ok(height.before && height.before.includes("3000"));
  assert.ok(height.after && height.after.includes("3200"));
});

test("field diff surfaces an attribute (name) change", () => {
  const before = parseNativeIfcText(ifcModel());
  const after = parseNativeIfcText(ifcModel({ wallName: "Wall B" }));

  const detail = diffEntityFields(before, after, WALL);

  const name = detail.changes.find(
    (c) => c.group === "Attributes" && c.field === "Name",
  );
  assert.ok(name, "Name change is reported");
  assert.equal(name.before, "Wall A");
  assert.equal(name.after, "Wall B");
  assert.equal(name.status, "modified");
});

test("field diff treats a missing 'before' as all-added", () => {
  const after = parseNativeIfcText(ifcModel());
  const detail = diffEntityFields(null, after, WALL);

  assert.deepEqual(detail.present, { before: false, after: true });
  assert.ok(detail.changes.length > 0);
  assert.ok(detail.changes.every((c) => c.status === "added"));
  assert.ok(detail.changes.every((c) => c.before === null));
});

async function makeApp() {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-entdiff-"));
  return buildApp({
    repo: new MemoryRepository(),
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
  });
}

test("HTTP: /diff/entity returns the field-level change", async () => {
  const app = await makeApp();
  const reg = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: "u@e.c", name: "U", password: "pw123456" },
  });
  const token = JSON.parse(reg.body).token as string;
  const auth = { authorization: `Bearer ${token}` };

  await app.inject({
    method: "POST",
    url: "/projects",
    headers: auth,
    payload: { name: "Acme", slug: "acme" },
  });
  await app.inject({
    method: "POST",
    url: "/projects/acme/models",
    headers: auth,
    payload: { name: "Tower", slug: "tower", visibility: "public" },
  });

  const commit = (text: string, message: string) =>
    app.inject({
      method: "POST",
      url: `/projects/acme/models/tower/commits?branch=main&message=${message}`,
      headers: { ...auth, "content-type": "application/x-step" },
      payload: text,
    });

  const c1 = JSON.parse((await commit(ifcModel(), "init")).body);
  const c2 = JSON.parse((await commit(ifcModel({ height: "3200." }), "raise")).body);

  const res = await app.inject({
    method: "GET",
    url:
      `/projects/acme/models/tower/diff/entity?from=${c1.commit.id}` +
      `&to=${c2.commit.id}&globalId=${PSET}`,
  });
  assert.equal(res.statusCode, 200);
  const detail = JSON.parse(res.body).detail;
  assert.equal(detail.globalId, PSET);
  const height = detail.changes.find((c: { field: string }) => c.field === "Height");
  assert.ok(height, "Height change present over HTTP");
  assert.equal(height.status, "modified");

  const bad = await app.inject({
    method: "GET",
    url: `/projects/acme/models/tower/diff/entity?from=${c1.commit.id}&to=${c2.commit.id}`,
  });
  assert.equal(bad.statusCode, 400);

  await app.close();
});
