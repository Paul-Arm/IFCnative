/**
 * Datei-API für den OpenProject-Speichertyp "IFC Hub"
 * (openproject-plugin/, Storages::IfcHubStorage).
 *
 * OpenProjects Server ruft diese Endpunkte mit einem Speicher-Token auf
 * (HS256, gemeinsames Secret, 5 min) — im Namen des jeweiligen Benutzers,
 * dessen Hub-Rechte gelten, oder als Dienst (nur lesend). Download und
 * Upload laufen dagegen direkt zwischen Browser und Hub über kurzlebige,
 * vom Hub signierte Links.
 *
 * Abbildung auf eine Dateistruktur:
 *   /                          Hub-Projekte des Benutzers (Ordner)
 *   /<projekt>[/<ordner>…]     Ordner eines Projekts — id = Pfad
 *   /<projekt>/…/<datei>       Modell (IFC, Markdown, Datei) — id = "m.<uuid>"
 * Der angezeigte Dateiname trägt die Endung (".ifc", ".md"), damit
 * OpenProject Namensgleichheit beim Hochladen erkennt.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { CreateCommitResult } from "../domain/commitService";
import { contentTypeForFileName, fileExtension } from "../domain/fileTypes";
import type {
  Commit,
  Model,
  ModelKind,
  Project,
  Repository,
  Role,
  User,
} from "../repository/types";
import { WRITE_ROLES } from "../repository/types";
import {
  OPENPROJECT_SYSTEM,
  TicketError,
  findOrCreateUser,
  openProjectIdFor,
  verifyStorageToken,
} from "./openproject";

const PREFIX = "/api/integrations/openproject/storage";
const DIRECTORY_MIME = "application/x-op-directory";
const MODEL_ID_PREFIX = "m.";
const DEFAULT_UPLOAD_MESSAGE = "Hochgeladen aus OpenProject";
const DOWNLOAD_TOKEN = "openproject-download";
const UPLOAD_TOKEN = "openproject-upload";

export interface StorageFileJson {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  createdAt?: string;
  lastModifiedAt?: string;
  createdByName?: string;
  lastModifiedByName?: string;
  location: string;
  permissions: ("readable" | "writeable")[];
}

type CommitUploadOutcome =
  | { ok: true; result: CreateCommitResult }
  | { ok: false; status: 400; error: string };

export interface StorageContext {
  repo: Repository;
  sharedSecret: string;
  /** Alle Ordnerpfade eines Projekts (explizit + implizit aus Modellen). */
  collectFolders(projectId: string): Promise<string[]>;
  commitUpload(input: {
    project: Project;
    model: Model;
    user: User;
    bytes: Buffer;
    fileName: string | null;
    branchName: string;
    message: string;
  }): Promise<CommitUploadOutcome>;
  downloadBlob(commit: Commit): Promise<Buffer>;
  slugify(value: string): string;
  /** Nach Änderungen (Upload) — stößt den Abgleich in OpenProject an. */
  onProjectChanged?(projectId: string): void;
}

/** Aufrufer eines Speicher-Endpunkts. */
type Principal = { kind: "user"; user: User } | { kind: "service" };

// ---- Namen und Pfade --------------------------------------------------

/** Angezeigter Dateiname: IFC- und Markdown-Modelle mit Endung. */
export function displayFileName(model: Model): string {
  const lower = model.name.toLowerCase();
  if (model.kind === "ifc" && !lower.endsWith(".ifc")) return `${model.name}.ifc`;
  if (model.kind === "md" && !lower.endsWith(".md")) return `${model.name}.md`;
  return model.name;
}

function mimeTypeFor(model: Model): string {
  if (model.kind === "ifc") return "application/x-step";
  if (model.kind === "md") return "text/markdown";
  return contentTypeForFileName(model.name);
}

/** Dateiart und Modellname für eine hochgeladene Datei. */
export function modelForUpload(fileName: string): { kind: ModelKind; name: string } {
  const ext = fileExtension(fileName);
  if (ext === "ifc") return { kind: "ifc", name: fileName.replace(/\.ifc$/i, "") };
  if (ext === "md") return { kind: "md", name: fileName };
  return { kind: "file", name: fileName };
}

function joinLocation(...segments: string[]): string {
  const parts = segments.flatMap((s) => s.split("/")).filter((s) => s.length > 0);
  return `/${parts.join("/")}`;
}

/** "/projekt/a/b" -> { slug: "projekt", folder: "a/b" }; "/" -> null. */
export function parseLocation(location: string): { slug: string; folder: string } | null {
  const parts = location.split("/").filter((s) => s.length > 0);
  if (parts.some((s) => s === "." || s === "..")) {
    throw new StorageError(400, "Ungültiger Pfad");
  }
  if (parts.length === 0) return null;
  const [slug, ...rest] = parts as [string, ...string[]];
  return { slug, folder: rest.join("/") };
}

function modelLocation(project: Project, model: Model): string {
  return joinLocation(project.slug, model.folder, displayFileName(model));
}

class StorageError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

// ---- Registrierung der Routen ----------------------------------------

export function registerOpenProjectStorageRoutes(app: FastifyInstance, ctx: StorageContext): void {
  const { repo } = ctx;

  async function principalOf(request: FastifyRequest): Promise<Principal> {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new StorageError(401, "Speicher-Token fehlt");
    try {
      const { user } = verifyStorageToken(token, ctx.sharedSecret);
      if (!user) return { kind: "service" };
      return { kind: "user", user: await findOrCreateUser(repo, user) };
    } catch (error) {
      if (error instanceof TicketError) throw new StorageError(401, error.message);
      throw error;
    }
  }

  /** Effektive Hub-Rolle; null = kein Zugriff. Dienst: nur lesend. */
  async function roleFor(principal: Principal, project: Project): Promise<Role | null> {
    if (principal.kind === "service") return "viewer";
    const { user } = principal;
    if (user.isAdmin) return "owner";
    const member = await repo.getMember(project.id, user.id);
    if (member) return member.role;
    return project.visibility === "public" ? "viewer" : null;
  }

  async function readableProject(principal: Principal, slug: string) {
    const project = await repo.getProjectBySlug(slug);
    const role = project ? await roleFor(principal, project) : null;
    // Nicht sichtbare Projekte existieren für den Aufrufer nicht.
    if (!project || !role) throw new StorageError(404, "Nicht gefunden");
    return { project, role };
  }

  function permissions(role: Role): StorageFileJson["permissions"] {
    return WRITE_ROLES.has(role) ? ["readable", "writeable"] : ["readable"];
  }

  async function headCommit(model: Model): Promise<Commit | null> {
    const branch = await repo.getBranch(model.id, model.defaultBranch);
    return branch?.headCommitId ? repo.getCommit(branch.headCommitId) : null;
  }

  const userNames = new Map<string, string>();
  async function userName(userId: string): Promise<string | undefined> {
    if (!userNames.has(userId)) {
      const user = await repo.getUserById(userId);
      if (!user) return undefined;
      userNames.set(userId, user.name);
    }
    return userNames.get(userId);
  }

  async function modelFile(project: Project, model: Model, role: Role): Promise<StorageFileJson> {
    const head = await headCommit(model);
    const headAuthor = head ? await userName(head.authorId) : undefined;
    return {
      id: `${MODEL_ID_PREFIX}${model.id}`,
      name: displayFileName(model),
      mimeType: mimeTypeFor(model),
      createdAt: model.createdAt,
      lastModifiedAt: head?.createdAt ?? model.createdAt,
      lastModifiedByName: headAuthor,
      location: modelLocation(project, model),
      permissions: permissions(role),
    };
  }

  function folderFile(location: string, name: string, role: Role | null): StorageFileJson {
    return {
      id: location,
      name,
      mimeType: DIRECTORY_MIME,
      location,
      permissions: role ? permissions(role) : ["readable"],
    };
  }

  async function visibleProjects(principal: Principal): Promise<Project[]> {
    if (principal.kind === "service" || principal.user.isAdmin) {
      return repo.listAllProjects();
    }
    const own = await repo.listProjectsForUser(principal.user.id);
    const seen = new Set(own.map((p) => p.id));
    const publicOnes = (await repo.listPublicProjects()).filter((p) => !seen.has(p.id));
    return [...own, ...publicOnes];
  }

  /** Modell zu "m.<uuid>" samt Projekt und Rolle — sonst 404. */
  async function resolveModelId(principal: Principal, id: string) {
    if (!id.startsWith(MODEL_ID_PREFIX)) throw new StorageError(404, "Nicht gefunden");
    const model = await repo.getModelById(id.slice(MODEL_ID_PREFIX.length));
    const project = model ? await repo.getProjectById(model.projectId) : null;
    const role = project ? await roleFor(principal, project) : null;
    if (!model || !project || !role) throw new StorageError(404, "Nicht gefunden");
    return { model, project, role };
  }

  async function fileInfo(principal: Principal, id: string): Promise<StorageFileJson> {
    if (id.startsWith(MODEL_ID_PREFIX)) {
      const { model, project, role } = await resolveModelId(principal, id);
      return modelFile(project, model, role);
    }
    const parsed = parseLocation(id);
    if (!parsed) return folderFile("/", "IFC Hub", null);
    const { project, role } = await readableProject(principal, parsed.slug);
    const name = parsed.folder ? parsed.folder.split("/").pop()! : project.name;
    return folderFile(joinLocation(project.slug, parsed.folder), name, role);
  }

  async function listFolder(principal: Principal, location: string) {
    const parsed = parseLocation(location);
    const root = { name: "IFC Hub", location: "/" };
    if (!parsed) {
      const projects = await visibleProjects(principal);
      const files: StorageFileJson[] = [];
      for (const project of projects.sort((a, b) => a.name.localeCompare(b.name, "de"))) {
        files.push(folderFile(`/${project.slug}`, project.name, await roleFor(principal, project)));
      }
      return { parent: folderFile("/", "IFC Hub", null), ancestors: [], files };
    }

    const { project, role } = await readableProject(principal, parsed.slug);
    const folder = parsed.folder;
    const allFolders = await ctx.collectFolders(project.id);
    if (folder && !allFolders.includes(folder)) throw new StorageError(404, "Ordner nicht gefunden");

    const prefix = folder ? `${folder}/` : "";
    const subfolders = allFolders
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .filter((path) => path !== folder)
      .sort((a, b) => a.localeCompare(b, "de"));
    const models = (await repo.listModels(project.id))
      .filter((model) => model.folder === folder)
      .sort((a, b) => a.name.localeCompare(b.name, "de"));

    const files: StorageFileJson[] = [
      ...subfolders.map((path) =>
        folderFile(joinLocation(project.slug, path), path.split("/").pop()!, role),
      ),
    ];
    for (const model of models) {
      files.push(await modelFile(project, model, role));
    }

    // Vorfahren: Wurzel, Projekt, übergeordnete Ordner (ohne den Ordner selbst).
    const ancestors = [root];
    const segments = folder ? folder.split("/") : [];
    if (segments.length > 0) {
      ancestors.push({ name: project.name, location: `/${project.slug}` });
      for (let i = 1; i < segments.length; i += 1) {
        ancestors.push({
          name: segments[i - 1]!,
          location: joinLocation(project.slug, segments.slice(0, i).join("/")),
        });
      }
    }
    const parentName = segments.length > 0 ? segments[segments.length - 1]! : project.name;
    return {
      parent: folderFile(joinLocation(project.slug, folder), parentName, role),
      ancestors,
      files,
    };
  }

  /** Fehlerbehandlung für alle Speicher-Routen. */
  function handler(
    fn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, reply);
      } catch (error) {
        if (error instanceof StorageError) {
          return reply.code(error.status).send({ error: error.message });
        }
        throw error;
      }
    };
  }

  // ---- Endpunkte (Server-zu-Server, Speicher-Token) -------------------

  app.get(
    `${PREFIX}/user`,
    handler(async (request, reply) => {
      const principal = await principalOf(request);
      if (principal.kind !== "user") throw new StorageError(400, "Kein Benutzer-Token");
      const { user } = principal;
      return reply.send({ id: user.id, email: user.email, name: user.name });
    }),
  );

  app.get(
    `${PREFIX}/files`,
    handler(async (request, reply) => {
      const principal = await principalOf(request);
      const { location } = request.query as { location?: string };
      return reply.send(await listFolder(principal, location || "/"));
    }),
  );

  app.get(
    `${PREFIX}/files/info`,
    handler(async (request, reply) => {
      const principal = await principalOf(request);
      const { id } = request.query as { id?: string };
      if (!id) throw new StorageError(400, "id fehlt");
      return reply.send(await fileInfo(principal, id));
    }),
  );

  app.post(
    `${PREFIX}/files/info`,
    handler(async (request, reply) => {
      const principal = await principalOf(request);
      const { ids } = (request.body ?? {}) as { ids?: unknown };
      if (!Array.isArray(ids)) throw new StorageError(400, "ids fehlt");
      const infos = [];
      for (const id of ids.map(String)) {
        try {
          infos.push({ status: "ok", statusCode: 200, ...(await fileInfo(principal, id)) });
        } catch (error) {
          if (!(error instanceof StorageError)) throw error;
          infos.push({ id, status: "not_found", statusCode: error.status });
        }
      }
      return reply.send({ files: infos });
    }),
  );

  /** Pfad -> id für alle Dateien/Ordner unter `location` (Projekt kopieren). */
  app.get(
    `${PREFIX}/paths`,
    handler(async (request, reply) => {
      const principal = await principalOf(request);
      const { location = "/", depth } = request.query as { location?: string; depth?: string };
      const maxDepth = depth ? Number(depth) : Number.POSITIVE_INFINITY;
      const result: Record<string, string> = {};
      const queue: [string, number][] = [[location, 0]];
      while (queue.length > 0) {
        const [current, level] = queue.shift()!;
        const listing = await listFolder(principal, current);
        result[listing.parent.location] = listing.parent.id;
        if (level >= maxDepth) continue;
        for (const file of listing.files) {
          result[file.location] = file.id;
          if (file.mimeType === DIRECTORY_MIME) queue.push([file.location, level + 1]);
        }
      }
      return reply.send({ paths: result });
    }),
  );

  app.get(
    `${PREFIX}/open`,
    handler(async (request, reply) => {
      const principal = await principalOf(request);
      const { id = "/", location } = request.query as { id?: string; location?: string };
      if (id.startsWith(MODEL_ID_PREFIX)) {
        const { model, project } = await resolveModelId(principal, id);
        // "Ordner öffnen" landet auf der Projektseite, sonst auf dem Modell.
        const subPath = location === "true" ? "" : `/m/${model.slug}`;
        return reply.send({
          hubPath: `/p/${project.slug}${subPath}`,
          subPath,
          openprojectProjectId: await openProjectIdFor(repo, project.id),
        });
      }
      const parsed = parseLocation(id);
      if (!parsed) return reply.send({ hubPath: "/", subPath: "", openprojectProjectId: null });
      const { project } = await readableProject(principal, parsed.slug);
      return reply.send({
        hubPath: `/p/${project.slug}`,
        subPath: "",
        openprojectProjectId: await openProjectIdFor(repo, project.id),
      });
    }),
  );

  /**
   * Welches Hub-Projekt gehört zu einem OpenProject-Projekt? Damit aktiviert
   * das Plugin den Speicher im Projekt mit passendem Projektordner.
   */
  app.get(
    `${PREFIX}/project-link`,
    handler(async (request, reply) => {
      await principalOf(request);
      const { openprojectProjectId } = request.query as { openprojectProjectId?: string };
      if (!openprojectProjectId) throw new StorageError(400, "openprojectProjectId fehlt");
      const localId = await repo.getExternalLink(OPENPROJECT_SYSTEM, "project", openprojectProjectId);
      const project = localId ? await repo.getProjectById(localId) : null;
      if (!project) throw new StorageError(404, "Nicht verknüpft");
      return reply.send({ slug: project.slug, name: project.name, location: `/${project.slug}` });
    }),
  );

  app.get(
    `${PREFIX}/download-link`,
    handler(async (request, reply) => {
      const principal = await principalOf(request);
      const { id = "" } = request.query as { id?: string };
      const { model } = await resolveModelId(principal, id);
      const head = await headCommit(model);
      if (!head) throw new StorageError(404, "Noch keine Version vorhanden");
      const token = app.jwt.sign(
        { typ: DOWNLOAD_TOKEN, mid: model.id, cid: head.id },
        { expiresIn: "5m" },
      );
      return reply.send({ path: `${PREFIX}/download?t=${encodeURIComponent(token)}` });
    }),
  );

  app.post(
    `${PREFIX}/upload-link`,
    handler(async (request, reply) => {
      const principal = await principalOf(request);
      if (principal.kind !== "user") throw new StorageError(403, "Hochladen nur als Benutzer");
      const body = (request.body ?? {}) as { folderId?: unknown; fileName?: unknown };
      const fileName = String(body.fileName ?? "").trim();
      if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
        throw new StorageError(400, "Ungültiger Dateiname");
      }
      const parsed = parseLocation(String(body.folderId ?? "/"));
      if (!parsed) throw new StorageError(400, "Bitte einen Projektordner wählen");
      const { project, role } = await readableProject(principal, parsed.slug);
      if (!WRITE_ROLES.has(role)) throw new StorageError(403, "Keine Schreibrechte im Hub-Projekt");
      const token = app.jwt.sign(
        {
          typ: UPLOAD_TOKEN,
          sub: principal.user.id,
          pid: project.id,
          folder: parsed.folder,
          name: fileName,
        },
        { expiresIn: "15m" },
      );
      return reply.send({ path: `${PREFIX}/upload?t=${encodeURIComponent(token)}`, method: "post" });
    }),
  );

  // ---- Endpunkte für den Browser (signierte Links, ohne Header) -------

  app.get(
    `${PREFIX}/download`,
    handler(async (request, reply) => {
      const { t: token = "" } = request.query as { t?: string };
      let claims: { typ?: string; mid?: string; cid?: string };
      try {
        claims = app.jwt.verify(token);
      } catch {
        throw new StorageError(401, "Download-Link abgelaufen");
      }
      if (claims.typ !== DOWNLOAD_TOKEN || !claims.mid || !claims.cid) {
        throw new StorageError(401, "Ungültiger Download-Link");
      }
      const model = await repo.getModelById(claims.mid);
      const commit = await repo.getCommit(claims.cid);
      if (!model || !commit || commit.modelId !== model.id) throw new StorageError(404, "Nicht gefunden");
      const bytes = await ctx.downloadBlob(commit);
      const fileName = displayFileName(model);
      return reply
        .header("content-type", mimeTypeFor(model))
        .header(
          "content-disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        )
        .send(bytes);
    }),
  );

  app.post(
    `${PREFIX}/upload`,
    handler(async (request, reply) => {
      const { t: token = "" } = request.query as { t?: string };
      let claims: { typ?: string; sub?: string; pid?: string; folder?: string; name?: string };
      try {
        claims = app.jwt.verify(token);
      } catch {
        throw new StorageError(401, "Upload-Link abgelaufen");
      }
      if (claims.typ !== UPLOAD_TOKEN || !claims.sub || !claims.pid || !claims.name) {
        throw new StorageError(401, "Ungültiger Upload-Link");
      }
      const user = await repo.getUserById(claims.sub);
      const project = await repo.getProjectById(claims.pid);
      if (!user || !project) throw new StorageError(404, "Nicht gefunden");
      // Rechte beim Hochladen erneut prüfen (Link gilt 15 min).
      const role = await roleFor({ kind: "user", user }, project);
      if (!role || !WRITE_ROLES.has(role)) throw new StorageError(403, "Keine Schreibrechte im Hub-Projekt");

      const { bytes, overwrite, message, target } = await readUpload(request);
      if (!bytes || bytes.length === 0) throw new StorageError(400, "Datei fehlt");

      const folder = claims.folder ?? "";
      const fileName = claims.name;
      const { kind, name } = modelForUpload(fileName);
      const siblings = (await repo.listModels(project.id)).filter((m) => m.folder === folder);
      const existing = siblings.find(
        (m) => displayFileName(m).toLowerCase() === fileName.toLowerCase(),
      );

      // Ziel ausdrücklich gewählt (Datei in der Ordnerauswahl angehakt):
      // neue Version genau dieses Modells — auch bei anderem Dateinamen.
      // Gleicher Name ohne Ziel: neue Version (Standard); "beide behalten"
      // legt ein weiteres Modell mit Zähler an, wie Nextcloud es tut.
      let model: Model;
      if (target) {
        const chosen = target.startsWith(MODEL_ID_PREFIX)
          ? await repo.getModelById(target.slice(MODEL_ID_PREFIX.length))
          : null;
        if (!chosen || chosen.projectId !== project.id) {
          throw new StorageError(404, "Zielmodell nicht gefunden");
        }
        model = chosen;
      } else if (existing && overwrite !== false) {
        model = existing;
      } else {
        let modelName = name;
        if (existing) {
          const taken = new Set(siblings.map((m) => m.name.toLowerCase()));
          const dot = kind === "file" ? name.lastIndexOf(".") : -1;
          const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
          for (let n = 2; taken.has(modelName.toLowerCase()); n += 1) {
            modelName = `${stem} (${n})${ext}`;
          }
        }
        const base = ctx.slugify(modelName) || "datei";
        let slug = base;
        for (let n = 2; await repo.getModel(project.id, slug); n += 1) {
          slug = `${base}-${n}`;
        }
        model = await repo.createModel({
          projectId: project.id,
          slug,
          name: modelName,
          visibility: "private",
          defaultBranch: "main",
          folder,
          kind,
        });
      }

      const outcome = await ctx.commitUpload({
        project,
        model,
        user,
        bytes,
        fileName,
        branchName: model.defaultBranch,
        // Commit-Nachricht aus dem Upload-Dialog des Plugin-Frontends.
        message: message || DEFAULT_UPLOAD_MESSAGE,
      });
      if (!outcome.ok) throw new StorageError(outcome.status, outcome.error);
      ctx.onProjectChanged?.(project.id);
      return reply.code(201).send({
        id: `${MODEL_ID_PREFIX}${model.id}`,
        name: displayFileName(model),
        mimeType: mimeTypeFor(model),
        size: bytes.length,
      });
    }),
  );

  /**
   * Multipart ("file" + optional "overwrite", "message", "target") oder
   * Roh-Body (?overwrite=&message=&target=). "target" = Id des Modells,
   * das eine neue Version bekommen soll.
   */
  async function readUpload(request: FastifyRequest): Promise<{
    bytes: Buffer | null;
    overwrite: boolean | undefined;
    message: string;
    target: string;
  }> {
    const parseFlag = (value: unknown) =>
      value === "true" ? true : value === "false" ? false : undefined;
    const parseMessage = (value: unknown) =>
      typeof value === "string" ? value.trim().slice(0, 2000) : "";
    if (request.isMultipart()) {
      // Alle Teile lesen: Felder dürfen vor oder nach der Datei stehen.
      let bytes: Buffer | null = null;
      let overwrite: boolean | undefined;
      let message = "";
      let target = "";
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const buffer = await part.toBuffer();
          bytes ??= buffer;
        } else if (part.fieldname === "overwrite") {
          overwrite = parseFlag(part.value);
        } else if (part.fieldname === "message") {
          message = parseMessage(part.value);
        } else if (part.fieldname === "target" && typeof part.value === "string") {
          target = part.value.trim();
        }
      }
      return { bytes, overwrite, message, target };
    }
    const query = request.query as { overwrite?: string; message?: string; target?: string };
    const body = request.body;
    const bytes = Buffer.isBuffer(body)
      ? body
      : typeof body === "string"
        ? Buffer.from(body, "utf8")
        : null;
    return {
      bytes,
      overwrite: parseFlag(query.overwrite),
      message: parseMessage(query.message),
      target: (query.target ?? "").trim(),
    };
  }
}
