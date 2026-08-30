import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";

import { buildApp } from "../src/http/app";
import { MemoryRepository } from "../src/repository/memoryRepository";
import { FilesystemObjectStore } from "../src/storage/filesystemObjectStore";
import { ifcModel, WALL } from "./fixtures";

async function makeApp() {
  const dir = await mkdtemp(join(tmpdir(), "ifc-vcs-bcf-"));
  return buildApp({
    repo: new MemoryRepository(),
    store: new FilesystemObjectStore(dir),
    jwtSecret: "test-secret",
  });
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

test("BCF issues: kind selection, export as bcfzip with viewpoint components", async () => {
  const app = await makeApp();
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
  const commit = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/tower/commits?message=init",
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcModel(),
  });
  assert.equal(commit.statusCode, 201);
  const models = await app.inject({
    method: "GET",
    url: "/api/projects/acme/models",
    headers: auth(token),
  });
  const modelId = JSON.parse(models.body).models[0].id as string;

  // Virtuelles Issue (Standard) und echtes BCF-Issue mit GUID-Verortung.
  const virtualIssue = await app.inject({
    method: "POST",
    url: "/api/projects/acme/issues",
    headers: auth(token),
    payload: { title: "Nur intern" },
  });
  assert.equal(JSON.parse(virtualIssue.body).issue.kind, "virtual");

  const bcfIssue = await app.inject({
    method: "POST",
    url: "/api/projects/acme/issues",
    headers: auth(token),
    payload: {
      title: "Wand ohne FireRating",
      body: "Aus der IDS-Prüfung.",
      kind: "bcf",
      modelIds: [modelId],
      guids: [WALL],
    },
  });
  assert.equal(bcfIssue.statusCode, 201);
  const issue = JSON.parse(bcfIssue.body).issue as {
    id: string;
    number: number;
    kind: string;
  };
  assert.equal(issue.kind, "bcf");

  await app.inject({
    method: "POST",
    url: `/api/projects/acme/issues/${issue.number}/comments`,
    headers: auth(token),
    payload: { body: "Bitte nachpflegen." },
  });

  // Virtuelle Issues sind nicht exportierbar.
  const denied = await app.inject({
    method: "GET",
    url: "/api/projects/acme/issues/1/bcf",
    headers: auth(token),
  });
  assert.equal(denied.statusCode, 400);

  // Einzel-Export: bcfzip mit Version, Markup und Viewpoint.
  const single = await app.inject({
    method: "GET",
    url: `/api/projects/acme/issues/${issue.number}/bcf`,
    headers: auth(token),
  });
  assert.equal(single.statusCode, 200);
  assert.match(
    single.headers["content-disposition"] as string,
    /acme-issue-2\.bcfzip/,
  );
  const files = unzipSync(new Uint8Array(single.rawPayload));
  assert.ok(files["bcf.version"], "bcf.version fehlt");
  const markup = strFromU8(files[`${issue.id}/markup.bcf`]!);
  assert.match(markup, /<Title>Wand ohne FireRating<\/Title>/);
  assert.match(markup, /TopicStatus="Active"/);
  assert.match(markup, /<Comment>Bitte nachpflegen\.<\/Comment>/);
  assert.match(markup, /<Filename>Tower<\/Filename>/);
  const viewpoint = strFromU8(files[`${issue.id}/viewpoint.bcfv`]!);
  assert.match(viewpoint, new RegExp(`IfcGuid="${WALL.replace(/\$/g, "\\$")}"`));

  // Projekt-Export enthält nur BCF-Issues (eines).
  const all = await app.inject({
    method: "GET",
    url: "/api/projects/acme/issues/bcf",
    headers: auth(token),
  });
  assert.equal(all.statusCode, 200);
  const allFiles = unzipSync(new Uint8Array(all.rawPayload));
  const topicFolders = new Set(
    Object.keys(allFiles)
      .filter((name) => name.includes("/"))
      .map((name) => name.split("/")[0]),
  );
  assert.equal(topicFolders.size, 1);

  // Geschlossene BCF-Issues exportieren als TopicStatus="Closed";
  // die Art lässt sich per PATCH umstellen.
  await app.inject({
    method: "PATCH",
    url: `/api/projects/acme/issues/${issue.number}`,
    headers: auth(token),
    payload: { state: "closed" },
  });
  const closed = await app.inject({
    method: "GET",
    url: `/api/projects/acme/issues/${issue.number}/bcf`,
    headers: auth(token),
  });
  const closedMarkup = strFromU8(
    unzipSync(new Uint8Array(closed.rawPayload))[`${issue.id}/markup.bcf`]!,
  );
  assert.match(closedMarkup, /TopicStatus="Closed"/);

  const toVirtual = await app.inject({
    method: "PATCH",
    url: `/api/projects/acme/issues/${issue.number}`,
    headers: auth(token),
    payload: { kind: "virtual" },
  });
  assert.equal(JSON.parse(toVirtual.body).issue.kind, "virtual");

  await app.close();
});
