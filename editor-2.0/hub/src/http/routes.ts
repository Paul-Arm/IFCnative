/**
 * HTTP-Routen des Hubs. Die Antwortformen entsprechen exakt dem Vertrag in
 * `app/src/domain/hub/types.ts`:
 *  - Listen sind nackte JSON-Arrays,
 *  - Einzelressourcen nackte Objekte,
 *  - Fehler `{ error: "…" }` mit passendem Statuscode.
 */
import type { FastifyInstance } from "fastify";
import type { HubService } from "../service.js";
import { HUB_VERSION } from "../config.js";
import { badRequest } from "../errors.js";

interface ProjectParams {
  pid: string;
}
interface ModelParams extends ProjectParams {
  mid: string;
}
interface VersionParams extends ModelParams {
  vid: string;
}
interface DiffParams extends VersionParams {
  otherVid: string;
}
interface NameBody {
  name?: unknown;
}
interface CommitQuery {
  message?: string;
  author?: string;
}

function asBytes(body: unknown): Uint8Array {
  if (Buffer.isBuffer(body)) return new Uint8Array(body);
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  throw badRequest(
    "Erwartet werden IFC-Bytes als „application/octet-stream“ im Rumpf.",
  );
}

export function registerRoutes(app: FastifyInstance, service: HubService): void {
  app.get("/api/health", async () => ({ ok: true, version: HUB_VERSION }));

  app.get("/api/projects", async () => service.listProjects());

  app.post<{ Body: NameBody }>("/api/projects", async (request, reply) => {
    const project = await service.createProject(request.body?.name);
    reply.code(201);
    return project;
  });

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:pid/models",
    async (request) => service.listModels(request.params.pid),
  );

  app.post<{ Params: ProjectParams; Body: NameBody }>(
    "/api/projects/:pid/models",
    async (request, reply) => {
      const model = await service.createModel(
        request.params.pid,
        request.body?.name,
      );
      reply.code(201);
      return model;
    },
  );

  app.get<{ Params: ModelParams }>(
    "/api/projects/:pid/models/:mid/versions",
    async (request) =>
      service.listVersions(request.params.pid, request.params.mid),
  );

  app.post<{ Params: ModelParams; Querystring: CommitQuery }>(
    "/api/projects/:pid/models/:mid/versions",
    async (request, reply) => {
      const version = await service.createVersion(
        request.params.pid,
        request.params.mid,
        asBytes(request.body),
        {
          message: request.query.message,
          author: request.query.author,
        },
      );
      reply.code(201);
      return version;
    },
  );

  app.get<{ Params: VersionParams }>(
    "/api/projects/:pid/models/:mid/versions/:vid",
    async (request) =>
      service.getVersion(
        request.params.pid,
        request.params.mid,
        request.params.vid,
      ),
  );

  app.get<{ Params: VersionParams }>(
    "/api/projects/:pid/models/:mid/versions/:vid/file",
    async (request, reply) => {
      const { version, bytes } = await service.readVersionFile(
        request.params.pid,
        request.params.mid,
        request.params.vid,
      );
      reply
        .header("content-type", "application/octet-stream")
        .header("content-disposition", `attachment; filename="${version.id}.ifc"`)
        .header("x-hub-blob-hash", version.blobHash);
      return Buffer.from(bytes);
    },
  );

  app.get<{ Params: DiffParams }>(
    "/api/projects/:pid/models/:mid/versions/:vid/diff/:otherVid",
    async (request) =>
      service.diffVersions(
        request.params.pid,
        request.params.mid,
        request.params.vid,
        request.params.otherVid,
      ),
  );
}
