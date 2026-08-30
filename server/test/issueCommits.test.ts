import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildApp } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel } from "./fixtures";

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

test("issue model links carry found/fixed commit references", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-issue-commits-"));
  const app = buildApp({
    repo: new MemoryRepository(),
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
  });
  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "user@example.com", name: "User", password: "pw123456" },
  });
  const token = JSON.parse(register.body).token as string;

  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(token),
    payload: { name: "Acme", slug: "acme" },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(token),
    payload: { name: "Tower", slug: "tower" },
  });
  const c1 = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits?message=Fehler drin",
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcModel(),
  });
  const c1Id = JSON.parse(c1.body).commit.id as string;
  const c2 = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits?message=Fehler behoben",
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcModel({ height: "3200." }),
  });
  const c2Id = JSON.parse(c2.body).commit.id as string;
  const models = await app.inject({
    method: "GET",
    url: "/api/projects/acme/models",
    headers: auth(token),
  });
  const modelId = JSON.parse(models.body).models[0].id as string;

  // Issue mit "aufgefallen in" Commit c1 anlegen.
  const created = await app.inject({
    method: "POST",
    url: "/api/projects/acme/issues",
    headers: auth(token),
    payload: {
      title: "Wand zu niedrig",
      modelLinks: [{ modelId, foundCommitId: c1Id }],
    },
  });
  assert.equal(created.statusCode, 201);
  const issue = JSON.parse(created.body).issue as {
    number: number;
    models: {
      foundCommitId: string | null;
      fixedCommitId: string | null;
      foundCommit: { message: string } | null;
      fixedCommit: { message: string } | null;
    }[];
  };
  assert.equal(issue.models[0]?.foundCommitId, c1Id);
  assert.equal(issue.models[0]?.foundCommit?.message, "Fehler drin");
  assert.equal(issue.models[0]?.fixedCommit, null);

  // Kurzform-PATCH (nur modelIds) darf die Commit-Bezüge nicht auslöschen.
  const kept = await app.inject({
    method: "PATCH",
    url: `/api/projects/acme/issues/${issue.number}`,
    headers: auth(token),
    payload: { modelIds: [modelId] },
  });
  assert.equal(
    (JSON.parse(kept.body).issue as typeof issue).models[0]?.foundCommitId,
    c1Id,
  );

  // "Behoben in" Commit c2 setzen.
  const fixed = await app.inject({
    method: "PATCH",
    url: `/api/projects/acme/issues/${issue.number}`,
    headers: auth(token),
    payload: {
      modelLinks: [{ modelId, foundCommitId: c1Id, fixedCommitId: c2Id }],
    },
  });
  const fixedIssue = JSON.parse(fixed.body).issue as typeof issue;
  assert.equal(fixedIssue.models[0]?.fixedCommitId, c2Id);
  assert.equal(fixedIssue.models[0]?.fixedCommit?.message, "Fehler behoben");

  // Commit eines fremden Modells wird abgelehnt.
  await app.inject({
    method: "POST",
    url: "/api/projects/acme/models",
    headers: auth(token),
    payload: { name: "Other", slug: "other" },
  });
  const otherModels = await app.inject({
    method: "GET",
    url: "/api/projects/acme/models",
    headers: auth(token),
  });
  const otherId = (
    JSON.parse(otherModels.body).models as { id: string; slug: string }[]
  ).find((m) => m.slug === "other")!.id;
  const invalid = await app.inject({
    method: "PATCH",
    url: `/api/projects/acme/issues/${issue.number}`,
    headers: auth(token),
    payload: { modelLinks: [{ modelId: otherId, foundCommitId: c1Id }] },
  });
  assert.equal(invalid.statusCode, 400);

  await app.close();
});
