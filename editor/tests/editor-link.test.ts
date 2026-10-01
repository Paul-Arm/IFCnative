import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import {
  normalizeHubUrl,
  parseEditorLink,
  readDesktopStartupEditorLink,
} from "../src/desktop/editorLink";
import { VcsApiError } from "../src/vcs/client";
import { EditorLinkError, loadLinkedHubDocument } from "../src/vcs/openFromLink";

Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
afterEach(() => clearMocks());

const HUB = "http://ifc-hub.dokploy.local";
const link = (query: string) => `ifcnative://open?${query}`;
const base = `hub=${encodeURIComponent(HUB)}&project=bestand-bogenbruecke&model=turm-01`;

test("editor link: minimal link opens the default branch", () => {
  assert.deepEqual(parseEditorLink(link(base)), {
    hub: HUB,
    project: "bestand-bogenbruecke",
    model: "turm-01",
    branch: null,
    commit: null,
  });
});

test("editor link: branch, commit, trailing slashes and browser-added path are accepted", () => {
  const commit = "3f2c1a9e-8b7d-4c6e-9f00-1234567890ab";
  const parsed = parseEditorLink(
    `ifcnative://open/?hub=${encodeURIComponent(`${HUB}:8787/`)}&project=p&model=m&branch=feature/dach&commit=${commit}`,
  );
  assert.equal(parsed?.hub, `${HUB}:8787`);
  assert.equal(parsed?.branch, "feature/dach");
  assert.equal(parsed?.commit, commit);
});

test("editor link: anything unexpected is rejected", () => {
  const rejected = [
    "https://example.com/open?" + base,
    "ifcnative://delete?" + base,
    "ifcnative://open/extra?" + base,
    link(`hub=${encodeURIComponent("file:///C:/x")}&project=p&model=m`),
    link(`hub=${encodeURIComponent("javascript:alert(1)")}&project=p&model=m`),
    link(`hub=${encodeURIComponent("http://user:pw@hub.local")}&project=p&model=m`),
    link(`hub=${encodeURIComponent("http://hub.local/?token=x")}&project=p&model=m`),
    link(`project=p&model=m`),
    link(`hub=${encodeURIComponent(HUB)}&project=../admin&model=m`),
    link(`hub=${encodeURIComponent(HUB)}&project=P&model=m`),
    link(`hub=${encodeURIComponent(HUB)}&project=p&model=m&branch=-rf`),
    link(`hub=${encodeURIComponent(HUB)}&project=p&model=m&commit=zzz`),
    link(`${base}&commit=${"a".repeat(3000)}`),
    `${link(base)}#fragment`,
    "not a url",
  ];
  for (const value of rejected) {
    assert.equal(parseEditorLink(value), null, value.slice(0, 120));
  }
});

test("editor link: hub URLs compare independent of a trailing slash", () => {
  assert.equal(normalizeHubUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.equal(normalizeHubUrl(" https://hub.example.com/ifc/ "), "https://hub.example.com/ifc");
  assert.equal(normalizeHubUrl("ftp://hub"), null);
});

test("editor link: read from the native command line and parsed in the frontend", async () => {
  mockIPC((command) => {
    assert.equal(command, "startup_editor_link");
    return link(base);
  });
  assert.equal((await readDesktopStartupEditorLink())?.model, "turm-01");
  clearMocks();
  mockIPC(() => link("hub=nope&project=p&model=m"));
  assert.equal(await readDesktopStartupEditorLink(), null);
});

function fakeClient(overrides: Partial<Record<"getProject" | "getModel" | "downloadCommitText", unknown>> = {}) {
  const calls: string[] = [];
  const client = {
    getProject: async (slug: string) => {
      calls.push(`project:${slug}`);
      return { id: "p1", slug, name: "Bestand Bogenbrücke", ownerId: "u", createdAt: "" };
    },
    getModel: async (_project: string, slug: string) => {
      calls.push(`model:${slug}`);
      return {
        model: { id: "m1", slug, name: "Turm 01", kind: "ifc", defaultBranch: "main" },
        branches: [
          { id: "b1", name: "main", headCommitId: "aaaaaaaa-1111" },
          { id: "b2", name: "entwurf", headCommitId: "bbbbbbbb-2222" },
          { id: "b3", name: "leer", headCommitId: null },
        ],
      };
    },
    downloadCommitText: async (_project: string, _model: string, commit: string) => {
      calls.push(`download:${commit}`);
      return `ISO-10303-21; /* ${commit} */`;
    },
    ...overrides,
  };
  return { client: client as unknown as Parameters<typeof loadLinkedHubDocument>[0], calls };
}

const request = { hub: HUB, project: "bestand-bogenbruecke", model: "turm-01", branch: null, commit: null };

test("open from link: default branch head with origin for committing back", async () => {
  const { client, calls } = fakeClient();
  const document = await loadLinkedHubDocument(client, request);
  assert.deepEqual(calls, ["project:bestand-bogenbruecke", "model:turm-01", "download:aaaaaaaa-1111"]);
  assert.equal(document.fileName, "Turm 01.ifc");
  assert.deepEqual(document.origin, {
    branch: "main",
    commitId: "aaaaaaaa-1111",
    modelName: "Turm 01",
    modelSlug: "turm-01",
    projectName: "Bestand Bogenbrücke",
    projectSlug: "bestand-bogenbruecke",
  });
});

test("open from link: branch head, or the branch a given commit belongs to", async () => {
  const { client } = fakeClient();
  assert.equal((await loadLinkedHubDocument(client, { ...request, branch: "entwurf" })).origin.commitId, "bbbbbbbb-2222");
  const pinned = await loadLinkedHubDocument(client, { ...request, commit: "bbbbbbbb-2222" });
  assert.equal(pinned.origin.branch, "entwurf");
  const older = await loadLinkedHubDocument(client, { ...request, commit: "cccccccc-3333" });
  assert.equal(older.origin.branch, "main");
  assert.equal(older.origin.commitId, "cccccccc-3333");
});

test("open from link: clear errors for empty or unknown branches, other kinds, access and login", async () => {
  const { client } = fakeClient();
  await assert.rejects(loadLinkedHubDocument(client, { ...request, branch: "leer" }), /noch keine Commits/);
  await assert.rejects(loadLinkedHubDocument(client, { ...request, branch: "gibtsnicht" }), /gibt es/);

  const markdown = fakeClient({
    getModel: async () => ({ model: { slug: "m", name: "Notizen", kind: "md", defaultBranch: "main" }, branches: [] }),
  });
  await assert.rejects(loadLinkedHubDocument(markdown.client, request), /kein IFC-Modell/);

  const forbidden = fakeClient({ getProject: async () => { throw new VcsApiError("Project not found", 404); } });
  await assert.rejects(loadLinkedHubDocument(forbidden.client, request), /nicht gefunden/);

  const expired = fakeClient({ getModel: async () => { throw new VcsApiError("Unauthorized", 401); } });
  await assert.rejects(
    loadLinkedHubDocument(expired.client, request),
    (error: unknown) => error instanceof EditorLinkError && error.unauthorized,
  );

  const blocked = fakeClient({ getProject: async () => { throw new Error("url not allowed on the configured scope"); } });
  await assert.rejects(loadLinkedHubDocument(blocked.client, request), /nicht freigegeben/);
});
