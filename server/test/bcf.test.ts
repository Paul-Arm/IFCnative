import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

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
    logRequests: false,
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
      modelLinks: [{ modelId }],
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
  await app.inject({
    method: "PATCH",
    url: `/api/projects/acme/issues/${issue.number}`,
    headers: auth(token),
    payload: { kind: "bcf", state: "open" },
  });

  // ---- Import: Export in ein zweites Projekt einspielen ----------------

  const exportAgain = await app.inject({
    method: "GET",
    url: `/api/projects/acme/issues/${issue.number}/bcf`,
    headers: auth(token),
  });
  const zip = exportAgain.rawPayload;

  await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(token),
    payload: { name: "Beta", slug: "beta" },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects/beta/models",
    headers: auth(token),
    payload: { name: "Tower", slug: "tower" },
  });

  const imported = await app.inject({
    method: "POST",
    url: "/api/projects/beta/issues/bcf",
    headers: { ...auth(token), "content-type": "application/zip" },
    payload: zip,
  });
  assert.equal(imported.statusCode, 201);
  const importResult = JSON.parse(imported.body) as {
    imported: number;
    skipped: number;
    located: number;
    parent: { id: string; number: number } | null;
  };
  assert.equal(importResult.imported, 1);
  assert.equal(importResult.skipped, 0);
  assert.equal(importResult.located, 1);
  assert.ok(importResult.parent, "Sammel-Issue fehlt");

  const betaIssues = await app.inject({
    method: "GET",
    url: "/api/projects/beta/issues",
    headers: auth(token),
  });
  // Neuestes zuerst: das importierte Topic (#2) vor dem Sammel-Issue (#1).
  const [betaIssue, betaParent] = JSON.parse(betaIssues.body).issues as {
    id: string;
    number: number;
    title: string;
    kind: string;
    state: string;
    body: string;
    guids: string[];
    models: { name: string }[];
    parentId: string | null;
    parent: { number: number } | null;
    subIssueCount: number;
    openSubIssueCount: number;
  }[];
  assert.equal(betaParent!.kind, "virtual");
  assert.equal(betaParent!.number, importResult.parent!.number);
  assert.equal(betaParent!.subIssueCount, 1);
  assert.equal(betaParent!.openSubIssueCount, 1);
  assert.deepEqual(betaParent!.models.map((model) => model.name), ["Tower"]);
  assert.equal(betaIssue!.parentId, betaParent!.id);
  assert.equal(betaIssue!.parent?.number, betaParent!.number);
  assert.equal(betaIssue!.title, "Wand ohne FireRating");
  assert.equal(betaIssue!.kind, "bcf");
  assert.equal(betaIssue!.state, "open");
  assert.equal(betaIssue!.body, "Aus der IDS-Prüfung.");
  assert.deepEqual(betaIssue!.guids, [WALL]);
  // Header-Filename "Tower" matcht das gleichnamige Modell im Zielprojekt.
  assert.deepEqual(
    betaIssue!.models.map((model) => model.name),
    ["Tower"],
  );

  // Kommentare kommen mit (Original-Autor im Text).
  const betaDetail = await app.inject({
    method: "GET",
    url: `/api/projects/beta/issues/${betaIssue!.number}`,
    headers: auth(token),
  });
  const betaComments = JSON.parse(betaDetail.body).comments as {
    body: string;
  }[];
  assert.equal(betaComments.length, 1);
  assert.match(betaComments[0]!.body, /Bitte nachpflegen\./);
  assert.match(betaComments[0]!.body, /user@example\.com/);

  // Re-Import ins Quellprojekt: Topic-Guid existiert dort -> übersprungen.
  const reimport = await app.inject({
    method: "POST",
    url: "/api/projects/acme/issues/bcf",
    headers: { ...auth(token), "content-type": "application/zip" },
    payload: zip,
  });
  const reimportResult = JSON.parse(reimport.body) as {
    imported: number;
    skipped: number;
    parent: unknown;
  };
  assert.equal(reimportResult.imported, 0);
  assert.equal(reimportResult.skipped, 1);
  // Ohne neue Topics entsteht auch kein leeres Sammel-Issue.
  assert.equal(reimportResult.parent, null);

  await app.close();
});

/** Portal-artige BCF: Topics nennen das Objekt meist nur im Text. */
function portalBcf(options: {
  fileName: string;
  topics: {
    guid: string;
    title: string;
    description: string;
    viewpointGuid?: string;
  }[];
}): Buffer {
  const files: Record<string, Uint8Array> = {
    "bcf.version": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Version VersionId="2.1"><DetailedVersion>2.1</DetailedVersion></Version>`,
    ),
  };
  for (const topic of options.topics) {
    const viewpoint = topic.viewpointGuid
      ? `<Viewpoints Guid="vp-${topic.guid}"><Viewpoint>viewpoint.bcfv</Viewpoint></Viewpoints>`
      : "";
    files[`${topic.guid}/markup.bcf`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Markup>
  <Header><File isExternal="true"><Filename>${options.fileName}</Filename></File></Header>
  <Topic Guid="${topic.guid}" TopicType="Error" TopicStatus="Open">
    <Title>${topic.title}</Title>
    <CreationDate>2026-09-03T07:33:02.711Z</CreationDate>
    <CreationAuthor>MKP Portal</CreationAuthor>
    <Description>${topic.description}</Description>
  </Topic>
  ${viewpoint}
</Markup>`,
    );
    if (topic.viewpointGuid) {
      files[`${topic.guid}/viewpoint.bcfv`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisualizationInfo Guid="vp-${topic.guid}"><Components><Selection><Component IfcGuid="${topic.viewpointGuid}" /></Selection></Components></VisualizationInfo>`,
      );
    }
  }
  return Buffer.from(zipSync(files));
}

test("BCF import: Sammel-Issue, Unter-Issues und Verortung per Objektname", async () => {
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
    payload: { name: "BROKEN_DIA_UP_10_Fehler.ifc", slug: "broken" },
  });
  const commit = await app.inject({
    method: "POST",
    url: "/api/projects/acme/models/broken/commits?message=init",
    headers: { ...auth(token), "content-type": "application/x-step" },
    payload: ifcModel({ wallName: "US.04" }),
  });
  const commitId = JSON.parse(commit.body).commit.id as string;

  const zip = portalBcf({
    // Header nennt die Datei ohne Endung — matcht das Modell "…Fehler.ifc".
    fileName: "BROKEN_DIA_UP_10_Fehler",
    topics: [
      {
        guid: "54d9e67d-374e-49b7-b4b9-8394dd260dcc",
        title: "Importfehler 1: BauteilID fehlt",
        description: `Betroffenes IFC-Objekt: &apos;US.04&apos;, IfcWall, GUID: ${WALL}`,
        viewpointGuid: WALL,
      },
      {
        guid: "6dfcaeab-2d4e-4d7f-b1b1-e44d94b96c86",
        title: "Importfehler 3: Pflichtfeld ID fehlt",
        // Kein Viewpoint, keine GUID — nur der Objektname.
        description:
          "Das Pflichtfeld fehlt.\nBetroffenes IFC-Objekt: &apos;US.04&apos;",
      },
      {
        guid: "5e022456-5e68-41da-839f-d63f2faa68ce",
        title: "Importfehler 2: Projekt-Bezeichnung fehlt",
        description: "Betroffenes IFC-Objekt: &apos;gibt-es-nicht&apos;",
      },
    ],
  });
  const imported = await app.inject({
    method: "POST",
    url: "/api/projects/acme/issues/bcf?name=BROKEN_DIA_UP_10_Fehler-fehler.bcf",
    headers: { ...auth(token), "content-type": "application/zip" },
    payload: zip,
  });
  assert.equal(imported.statusCode, 201, imported.body);
  const result = JSON.parse(imported.body) as {
    imported: number;
    skipped: number;
    located: number;
    parent: { id: string; number: number };
  };
  assert.equal(result.imported, 3);
  assert.equal(result.located, 2);
  assert.equal(result.parent.number, 1);

  const detail = await app.inject({
    method: "GET",
    url: `/api/projects/acme/issues/${result.parent.number}`,
    headers: auth(token),
  });
  const parentDetail = JSON.parse(detail.body) as {
    issue: {
      kind: string;
      title: string;
      body: string;
      parentId: string | null;
      subIssueCount: number;
      models: { slug: string; foundCommitId: string | null }[];
    };
    subIssues: {
      id: string;
      number: number;
      kind: string;
      parentId: string;
      guids: string[];
      models: { slug: string; foundCommitId: string | null }[];
    }[];
  };
  assert.equal(parentDetail.issue.kind, "virtual");
  assert.equal(
    parentDetail.issue.title,
    "BCF-Import: BROKEN_DIA_UP_10_Fehler-fehler",
  );
  assert.equal(parentDetail.issue.parentId, null);
  assert.equal(parentDetail.issue.subIssueCount, 3);
  assert.match(parentDetail.issue.body, /3 importiert/);
  assert.match(parentDetail.issue.body, /2 von 3 Unter-Issues/);
  assert.deepEqual(
    parentDetail.issue.models.map((model) => [model.slug, model.foundCommitId]),
    [["broken", commitId]],
  );
  assert.equal(parentDetail.subIssues.length, 3);
  assert.deepEqual(
    parentDetail.subIssues.map((issue) => issue.number),
    [2, 3, 4],
  );
  for (const sub of parentDetail.subIssues) {
    assert.equal(sub.kind, "bcf");
    assert.equal(sub.parentId, result.parent.id);
    assert.deepEqual(
      sub.models.map((model) => [model.slug, model.foundCommitId]),
      [["broken", commitId]],
    );
  }
  // Viewpoint + Text-GUID (dedupliziert), Name über das Manifest aufgelöst,
  // unbekannter Name bleibt ohne Verortung.
  assert.deepEqual(parentDetail.subIssues[0]!.guids, [WALL]);
  assert.deepEqual(parentDetail.subIssues[1]!.guids, [WALL]);
  assert.deepEqual(parentDetail.subIssues[2]!.guids, []);

  // Eltern-Beziehung ist per PATCH änderbar; Zyklen und Selbstbezug nicht.
  const detach = await app.inject({
    method: "PATCH",
    url: "/api/projects/acme/issues/4",
    headers: auth(token),
    payload: { parentId: null },
  });
  assert.equal(JSON.parse(detach.body).issue.parentId, null);
  const selfRef = await app.inject({
    method: "PATCH",
    url: "/api/projects/acme/issues/1",
    headers: auth(token),
    payload: { parentId: result.parent.id },
  });
  assert.equal(selfRef.statusCode, 400);
  const cycle = await app.inject({
    method: "PATCH",
    url: "/api/projects/acme/issues/1",
    headers: auth(token),
    payload: { parentId: parentDetail.subIssues[0]!.id },
  });
  assert.equal(cycle.statusCode, 400);
  const manual = await app.inject({
    method: "POST",
    url: "/api/projects/acme/issues",
    headers: auth(token),
    payload: { title: "Manuell untergeordnet", parentId: result.parent.id },
  });
  assert.equal(manual.statusCode, 201);
  assert.equal(JSON.parse(manual.body).issue.parent.number, 1);

  await app.close();
});
