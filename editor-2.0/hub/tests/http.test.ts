/**
 * HTTP-Ebene über `fastify.inject()` — prüft die Antwortformen gegen den
 * Vertrag in `app/src/domain/hub/types.ts` sowie die Token-Pflicht.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { FilesystemStore } from "../src/storage/filesystem.js";
import { HubService } from "../src/service.js";
import { buildServer } from "../src/http/server.js";
import { HUB_VERSION } from "../src/config.js";
import {
  buildModel,
  CHANGED_WALL,
  tempDataDir,
  toBytes,
  withChangedProperty,
} from "./helpers.js";

let cleanup: () => Promise<void>;

async function startHub(token = ""): Promise<FastifyInstance> {
  const temp = await tempDataDir();
  cleanup = temp.cleanup;
  const service = new HubService(new FilesystemStore(temp.dir));
  await service.init();
  return buildServer({ service, token });
}

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
  await cleanup?.();
});

/** Legt Projekt + Modell an und gibt beide Ids zurück. */
async function seed(
  instance: FastifyInstance,
): Promise<{ pid: string; mid: string }> {
  const project = await instance.inject({
    method: "POST",
    url: "/api/projects",
    payload: { name: "Projekt" },
  });
  const pid = project.json<{ id: string }>().id;
  const model = await instance.inject({
    method: "POST",
    url: `/api/projects/${pid}/models`,
    payload: { name: "Modell" },
  });
  return { pid, mid: model.json<{ id: string }>().id };
}

function commit(
  instance: FastifyInstance,
  pid: string,
  mid: string,
  text: string,
  query = "",
) {
  return instance.inject({
    method: "POST",
    url: `/api/projects/${pid}/models/${mid}/versions${query}`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.from(toBytes(text)),
  });
}

describe("HTTP-API ohne Token", () => {
  beforeEach(async () => {
    app = await startHub();
  });

  it("GET /api/health meldet ok und Version", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, version: HUB_VERSION });
  });

  it("legt Projekte und Modelle an und liefert nackte Listen", async () => {
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json())
      .toEqual([]);

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Bürogebäude" },
    });
    expect(created.statusCode).toBe(201);
    const pid = created.json<{ id: string; name: string }>().id;
    expect(created.json<{ name: string }>().name).toBe("Bürogebäude");

    const projects = (
      await app.inject({ method: "GET", url: "/api/projects" })
    ).json<Array<{ id: string }>>();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.map((entry) => entry.id)).toEqual([pid]);

    const model = await app.inject({
      method: "POST",
      url: `/api/projects/${pid}/models`,
      payload: { name: "Architektur" },
    });
    expect(model.statusCode).toBe(201);
    const models = (
      await app.inject({ method: "GET", url: `/api/projects/${pid}/models` })
    ).json<Array<{ name: string }>>();
    expect(models.map((entry) => entry.name)).toEqual(["Architektur"]);
  });

  it("meldet Fehler als {error} mit passendem Status", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/api/projects/unbekannt/models",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: string }>().error).toContain("nicht gefunden");

    const empty = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "" },
    });
    expect(empty.statusCode).toBe(400);
    expect(typeof empty.json<{ error: string }>().error).toBe("string");

    const unknownRoute = await app.inject({ method: "GET", url: "/gibt-es-nicht" });
    expect(unknownRoute.statusCode).toBe(404);
    expect(unknownRoute.json<{ error: string }>().error).toContain("gibt es nicht");
  });

  it("committet einen Stand und liefert die Datei byte-identisch zurück", async () => {
    const { pid, mid } = await seed(app);
    const text = buildModel();

    const created = await commit(
      app,
      pid,
      mid,
      text,
      "?message=Erster%20Stand&author=Paul",
    );
    expect(created.statusCode).toBe(201);
    const version = created.json<{
      id: string;
      message: string;
      author: string;
      schema: string;
      entityCount: number;
      byteSize: number;
      blobHash: string;
      createdAt: string;
    }>();
    expect(version.message).toBe("Erster Stand");
    expect(version.author).toBe("Paul");
    expect(version.schema).toBe("IFC4");
    expect(version.entityCount).toBeGreaterThan(0);
    expect(version.byteSize).toBe(toBytes(text).byteLength);
    expect(version.blobHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isNaN(Date.parse(version.createdAt))).toBe(false);

    const file = await app.inject({
      method: "GET",
      url: `/api/projects/${pid}/models/${mid}/versions/${version.id}/file`,
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("application/octet-stream");
    expect(Buffer.compare(file.rawPayload, Buffer.from(toBytes(text)))).toBe(0);
  });

  it("listet Stände neueste zuerst", async () => {
    const { pid, mid } = await seed(app);
    const base = buildModel();
    const first = (await commit(app, pid, mid, base, "?message=eins")).json<{
      id: string;
    }>();
    const second = (
      await commit(app, pid, mid, withChangedProperty(base), "?message=zwei")
    ).json<{ id: string }>();

    const versions = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${pid}/models/${mid}/versions`,
      })
    ).json<Array<{ id: string; message: string }>>();
    expect(versions.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(versions[0]?.message).toBe("zwei");
  });

  it("vergleicht zwei Stände und meldet das geänderte Objekt", async () => {
    const { pid, mid } = await seed(app);
    const base = buildModel();
    const v1 = (await commit(app, pid, mid, base)).json<{ id: string }>();
    const v2 = (
      await commit(app, pid, mid, withChangedProperty(base))
    ).json<{ id: string }>();

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${pid}/models/${mid}/versions/${v1.id}/diff/${v2.id}`,
    });
    expect(response.statusCode).toBe(200);
    const diff = response.json<{
      added: unknown[];
      removed: unknown[];
      modified: Array<{ globalId: string; label?: string }>;
      summary: { added: number; removed: number; modified: number };
      base: string;
      head: string;
    }>();

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0]?.label).toBe(`IfcWall · ${CHANGED_WALL}`);
    expect(diff.modified[0]?.globalId).toMatch(/^\S{22}$/);
    expect(diff.summary).toMatchObject({ added: 0, removed: 0, modified: 1 });
    expect(diff.base).toBe(v1.id);
    expect(diff.head).toBe(v2.id);
  });

  it("meldet einen identischen Re-Export als leeren Diff", async () => {
    const { pid, mid } = await seed(app);
    const text = buildModel();
    const v1 = (await commit(app, pid, mid, text)).json<{ id: string }>();
    const v2 = (await commit(app, pid, mid, text)).json<{ id: string }>();
    expect(v1.id).not.toBe(v2.id);

    const diff = (
      await app.inject({
        method: "GET",
        url: `/api/projects/${pid}/models/${mid}/versions/${v1.id}/diff/${v2.id}`,
      })
    ).json<{ summary: { added: number; removed: number; modified: number } }>();
    expect(diff.summary).toMatchObject({ added: 0, removed: 0, modified: 0 });
  });

  it("weist unbrauchbare IFC-Bytes mit 422 ab", async () => {
    const { pid, mid } = await seed(app);
    const response = await commit(app, pid, mid, "kein IFC");
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: string }>().error).toContain("IFC");
  });
});

describe("HTTP-API mit HUB_TOKEN", () => {
  const token = "geheim-123";

  beforeEach(async () => {
    app = await startHub(token);
  });

  it("lässt /api/health ohne Token durch", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ ok: boolean }>().ok).toBe(true);
  });

  it("verweigert /api-Routen ohne oder mit falschem Token", async () => {
    const without = await app.inject({ method: "GET", url: "/api/projects" });
    expect(without.statusCode).toBe(401);
    expect(without.json<{ error: string }>().error).toContain("Zugriff verweigert");

    const wrong = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { authorization: "Bearer falsch" },
    });
    expect(wrong.statusCode).toBe(401);

    const noScheme = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { authorization: token },
    });
    expect(noScheme.statusCode).toBe(401);
  });

  it("lässt mit gültigem Bearer-Token alles durch", async () => {
    const headers = { authorization: `Bearer ${token}` };
    const projects = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers,
    });
    expect(projects.statusCode).toBe(200);
    expect(projects.json()).toEqual([]);

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers,
      payload: { name: "Geschützt" },
    });
    expect(created.statusCode).toBe(201);
  });
});
