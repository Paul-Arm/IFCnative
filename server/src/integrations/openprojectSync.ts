/**
 * Abgleich IFC-Modelle und BCF-Issues mit OpenProject.
 *
 * Taktgeber ist das OpenProject-Plugin (IfcHub::SyncProjectJob): Es liest
 * hier den Zustand des verknüpften Hub-Projekts, vergleicht mit OpenProject
 * (BCF-Modul: IFC-Modelle, BCF-Themen) und schreibt Änderungen in die
 * jeweils andere Richtung. Diese Datei liefert
 *
 *  - die Sync-API (Speicher-Token von OpenProject, Server-zu-Server) und
 *  - den Melder: Ändert sich im Hub etwas in einem verknüpften Projekt,
 *    bekommt OpenProject einen signierten Webhook und gleicht sofort ab.
 *
 * Abgeglichen werden IFC-Modelle (neuer Stand = neuer Commit) und Issues der
 * Art "bcf" samt GUIDs und Kommentaren. Löschen wird nicht übertragen.
 */
import { createHmac } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { CreateCommitResult } from "../domain/commitService";
import type {
  Commit,
  Issue,
  IssueLinks,
  Model,
  Project,
  Repository,
  User,
} from "../repository/types";
import {
  OPENPROJECT_SYSTEM,
  TicketError,
  findOrCreateUser,
  verifyStorageToken,
  type OpenProjectUser,
} from "./openproject";

const PREFIX = "/api/integrations/openproject/sync/:opProjectId";
/** Autor für Änderungen ohne bekannten OpenProject-Benutzer. */
const SYNC_USER_EMAIL = "openproject-sync@ifc-hub.local";
const MAX_GUIDS = 500;

type CommitUploadOutcome =
  | { ok: true; result: CreateCommitResult }
  | { ok: false; status: 400; error: string };

export interface SyncContext {
  repo: Repository;
  sharedSecret: string;
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
}

class SyncError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

// ---- Melder: Hub -> OpenProject ----------------------------------------

/**
 * Stößt den Abgleich in OpenProject an (POST <openproject>/ifc_hub/webhook,
 * HS256-signiert mit dem gemeinsamen Secret). Entprellt je Projekt, damit
 * ein Upload mit Folge-Änderungen nur einen Abgleich auslöst. Fehler werden
 * nur protokolliert — der periodische Abgleich in OpenProject holt nach.
 */
export class OpenProjectNotifier {
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly repo: Repository,
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly delayMs = 1500,
  ) {}

  notifyHubProject(hubProjectId: string): void {
    clearTimeout(this.pending.get(hubProjectId));
    this.pending.set(
      hubProjectId,
      setTimeout(() => {
        this.pending.delete(hubProjectId);
        void this.send(hubProjectId);
      }, this.delayMs).unref(),
    );
  }

  private async send(hubProjectId: string): Promise<void> {
    const links = await this.repo.listExternalLinks("project", hubProjectId);
    const opProjectId = links.find((link) => link.system === OPENPROJECT_SYSTEM)?.externalId;
    if (!opProjectId) return;
    const now = Math.floor(Date.now() / 1000);
    const token = signHs256(
      { iss: "ifc-hub", aud: "openproject", iat: now, exp: now + 120, project_id: opProjectId },
      this.secret,
    );
    try {
      const response = await fetch(`${this.baseUrl}/ifc_hub/webhook`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        console.warn(`OpenProject-Webhook für Projekt ${opProjectId}: HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn(`OpenProject-Webhook für Projekt ${opProjectId} fehlgeschlagen: ${(error as Error).message}`);
    }
  }
}

export function signHs256(payload: Record<string, unknown>, secret: string): string {
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

// ---- Sync-API: OpenProject -> Hub ---------------------------------------

export function registerOpenProjectSyncRoutes(app: FastifyInstance, ctx: SyncContext): void {
  const { repo } = ctx;

  function authorize(request: FastifyRequest): void {
    const header = request.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    try {
      verifyStorageToken(token, ctx.sharedSecret);
    } catch (error) {
      if (error instanceof TicketError) throw new SyncError(401, error.message);
      throw error;
    }
  }

  async function linkedProject(request: FastifyRequest): Promise<Project> {
    authorize(request);
    const { opProjectId } = request.params as { opProjectId: string };
    const localId = await repo.getExternalLink(OPENPROJECT_SYSTEM, "project", opProjectId);
    const project = localId ? await repo.getProjectById(localId) : null;
    if (!project) throw new SyncError(404, "Projekt ist nicht mit dem Hub verknüpft");
    return project;
  }

  /** Autor aus OpenProject (bei Erstkontakt angelegt) oder Sync-Benutzer. */
  async function authorFrom(value: unknown): Promise<User> {
    const opUser = value as Partial<OpenProjectUser> | null | undefined;
    if (opUser && typeof opUser.id === "string" && typeof opUser.email === "string" && opUser.email.includes("@")) {
      return findOrCreateUser(repo, {
        id: opUser.id,
        login: String(opUser.login ?? ""),
        email: opUser.email,
        name: String(opUser.name ?? opUser.email),
      });
    }
    const existing = await repo.getUserByEmail(SYNC_USER_EMAIL);
    // Passworthash "!" passt zu keinem Passwort: kein Login mit diesem Konto.
    return (
      existing ??
      repo.createUser({ email: SYNC_USER_EMAIL, name: "OpenProject", passwordHash: "!", isAdmin: false })
    );
  }

  const opUserIds = new Map<string, string | null>();
  async function authorInfo(userId: string) {
    if (!opUserIds.has(userId)) {
      const links = await repo.listExternalLinks("user", userId);
      opUserIds.set(userId, links.find((l) => l.system === OPENPROJECT_SYSTEM)?.externalId ?? null);
    }
    const user = await repo.getUserById(userId);
    return { name: user?.name ?? "unbekannt", openprojectUserId: opUserIds.get(userId) ?? null };
  }

  async function headCommit(model: Model): Promise<Commit | null> {
    const branch = await repo.getBranch(model.id, model.defaultBranch);
    return branch?.headCommitId ? repo.getCommit(branch.headCommitId) : null;
  }

  async function ifcModels(project: Project): Promise<Model[]> {
    return (await repo.listModels(project.id)).filter((m) => m.kind === "ifc");
  }

  /** Modelle, deren aktueller Stand eine der GUIDs enthält (3D-Verortung). */
  async function modelLinksFor(project: Project, guids: string[]): Promise<IssueLinks["models"]> {
    if (!guids.length) return [];
    const wanted = new Set(guids);
    const links: IssueLinks["models"] = [];
    for (const model of await ifcModels(project)) {
      const head = await headCommit(model);
      if (!head) continue;
      const manifest = await repo.getManifest(head.id);
      if (manifest.some((entry) => wanted.has(entry.globalId))) {
        links.push({ modelId: model.id, foundCommitId: head.id, fixedCommitId: null });
      }
    }
    return links;
  }

  function cleanGuids(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return [...new Set(value.filter((g): g is string => typeof g === "string" && /^[0-9A-Za-z_$]{22}$/.test(g)))]
      .slice(0, MAX_GUIDS);
  }

  function handler(fn: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, reply);
      } catch (error) {
        if (error instanceof SyncError) {
          return reply.code(error.status).send({ error: error.message });
        }
        throw error;
      }
    };
  }

  async function readFileUpload(request: FastifyRequest) {
    if (!request.isMultipart()) throw new SyncError(400, "Multipart mit Datei erwartet");
    let bytes: Buffer | null = null;
    const fields: Record<string, string> = {};
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        bytes ??= buffer;
      } else if (typeof part.value === "string") {
        fields[part.fieldname] = part.value;
      }
    }
    if (!bytes || bytes.length === 0) throw new SyncError(400, "Datei fehlt");
    let author: unknown = null;
    try {
      author = fields.author ? JSON.parse(fields.author) : null;
    } catch {
      author = null;
    }
    return { bytes, fields, author };
  }

  async function commitTo(project: Project, model: Model, user: User, bytes: Buffer, message: string) {
    const outcome = await ctx.commitUpload({
      project,
      model,
      user,
      bytes,
      fileName: `${model.name}.ifc`,
      branchName: model.defaultBranch,
      message: message.trim().slice(0, 2000) || "Aktualisiert in OpenProject",
    });
    if (!outcome.ok) throw new SyncError(outcome.status, outcome.error);
    return outcome.result.commit;
  }

  async function serializeIssue(issue: Issue, links: IssueLinks | undefined) {
    const comments = await repo.listIssueComments(issue.id);
    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      guids: links?.guids ?? [],
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      author: await authorInfo(issue.authorId),
      comments: await Promise.all(
        comments.map(async (comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          author: await authorInfo(comment.authorId),
        })),
      ),
    };
  }

  // Zustand des verknüpften Hub-Projekts: IFC-Modelle und BCF-Issues.
  app.get(
    `${PREFIX}/state`,
    handler(async (request, reply) => {
      const project = await linkedProject(request);
      const models = [];
      for (const model of await ifcModels(project)) {
        const head = await headCommit(model);
        models.push({
          id: model.id,
          name: model.name,
          slug: model.slug,
          folder: model.folder,
          head: head && {
            id: head.id,
            createdAt: head.createdAt,
            message: head.message,
            author: await authorInfo(head.authorId),
          },
        });
      }
      const issues = (await repo.listIssues(project.id)).filter((issue) => issue.kind === "bcf");
      const links = await repo.getIssueLinks(issues.map((issue) => issue.id));
      return reply.send({
        project: { id: project.id, slug: project.slug, name: project.name },
        models,
        issues: await Promise.all(issues.map((issue) => serializeIssue(issue, links.get(issue.id)))),
      });
    }),
  );

  // Aktueller Stand eines Modells (Hub -> OpenProject).
  app.get(
    `${PREFIX}/models/:modelId/file`,
    handler(async (request, reply) => {
      const project = await linkedProject(request);
      const { modelId } = request.params as { modelId: string };
      const model = await repo.getModelById(modelId);
      if (!model || model.projectId !== project.id) throw new SyncError(404, "Modell nicht gefunden");
      const head = await headCommit(model);
      if (!head) throw new SyncError(404, "Noch keine Version");
      return reply
        .header("content-type", "application/x-step")
        .header("x-ifc-hub-commit", head.id)
        .send(await ctx.downloadBlob(head));
    }),
  );

  // Neues Modell aus OpenProject (Multipart: file, name, message, author).
  app.post(
    `${PREFIX}/models`,
    handler(async (request, reply) => {
      const project = await linkedProject(request);
      const { bytes, fields, author } = await readFileUpload(request);
      const name = (fields.name ?? "").trim().replace(/\.ifc$/i, "").slice(0, 200);
      if (!name) throw new SyncError(400, "name fehlt");
      const user = await authorFrom(author);
      const base = ctx.slugify(name) || "modell";
      let slug = base;
      for (let n = 2; await repo.getModel(project.id, slug); n += 1) {
        slug = `${base}-${n}`;
      }
      const model = await repo.createModel({
        projectId: project.id,
        slug,
        name,
        visibility: "private",
        defaultBranch: "main",
        folder: "",
        kind: "ifc",
      });
      const commit = await commitTo(project, model, user, bytes, fields.message ?? "");
      return reply.code(201).send({ id: model.id, head: { id: commit.id, createdAt: commit.createdAt } });
    }),
  );

  // Neuer Stand eines Modells aus OpenProject.
  app.post(
    `${PREFIX}/models/:modelId/commits`,
    handler(async (request, reply) => {
      const project = await linkedProject(request);
      const { modelId } = request.params as { modelId: string };
      const model = await repo.getModelById(modelId);
      if (!model || model.projectId !== project.id) throw new SyncError(404, "Modell nicht gefunden");
      const { bytes, fields, author } = await readFileUpload(request);
      const commit = await commitTo(project, model, await authorFrom(author), bytes, fields.message ?? "");
      return reply.code(201).send({ head: { id: commit.id, createdAt: commit.createdAt } });
    }),
  );

  // BCF-Thema aus OpenProject als Hub-Issue (Art "bcf"). `id` = BCF-Topic-
  // Guid aus OpenProject — so tragen beide Seiten dieselbe Topic-Guid.
  app.post(
    `${PREFIX}/issues`,
    handler(async (request, reply) => {
      const project = await linkedProject(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const title = String(body.title ?? "").trim().slice(0, 200);
      if (!title) throw new SyncError(400, "title fehlt");
      const id = typeof body.id === "string" && body.id ? body.id : undefined;
      if (id) {
        const existing = await repo.getIssueById(id);
        if (existing) {
          if (existing.projectId !== project.id) throw new SyncError(409, "Issue-Id gehört zu einem anderen Projekt");
          const links = await repo.getIssueLinks([existing.id]);
          return reply.send({ existing: true, issue: await serializeIssue(existing, links.get(existing.id)) });
        }
      }
      const guids = cleanGuids(body.guids) ?? [];
      const user = await authorFrom(body.author);
      const issue = await repo.createIssueWithLinks(
        {
          id,
          projectId: project.id,
          title,
          body: String(body.body ?? ""),
          state: body.state === "closed" ? "closed" : "open",
          kind: "bcf",
          authorId: user.id,
          parentId: null,
        },
        { guids, models: await modelLinksFor(project, guids) },
      );
      const links = await repo.getIssueLinks([issue.id]);
      return reply.code(201).send({ existing: false, issue: await serializeIssue(issue, links.get(issue.id)) });
    }),
  );

  app.patch(
    `${PREFIX}/issues/:issueId`,
    handler(async (request, reply) => {
      const project = await linkedProject(request);
      const { issueId } = request.params as { issueId: string };
      const existing = await repo.getIssueById(issueId);
      if (!existing || existing.projectId !== project.id) throw new SyncError(404, "Issue nicht gefunden");
      const body = (request.body ?? {}) as Record<string, unknown>;
      const patch: Partial<Pick<Issue, "title" | "body" | "state">> = {};
      if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
      if (typeof body.body === "string") patch.body = body.body;
      if (body.state === "open" || body.state === "closed") patch.state = body.state;
      const guids = cleanGuids(body.guids);
      let issue = existing;
      if (Object.keys(patch).length) {
        issue = (await repo.updateIssue(existing.id, patch)) ?? existing;
      }
      if (guids) {
        await repo.setIssueLinks(existing.id, { guids, models: await modelLinksFor(project, guids) });
      }
      const links = await repo.getIssueLinks([issue.id]);
      return reply.send({ issue: await serializeIssue(issue, links.get(issue.id)) });
    }),
  );

  app.post(
    `${PREFIX}/issues/:issueId/comments`,
    handler(async (request, reply) => {
      const project = await linkedProject(request);
      const { issueId } = request.params as { issueId: string };
      const issue = await repo.getIssueById(issueId);
      if (!issue || issue.projectId !== project.id) throw new SyncError(404, "Issue nicht gefunden");
      const body = (request.body ?? {}) as Record<string, unknown>;
      const text = String(body.body ?? "").trim();
      if (!text) throw new SyncError(400, "body fehlt");
      const user = await authorFrom(body.author);
      const comment = await repo.createIssueComment({ issueId: issue.id, authorId: user.id, body: text });
      return reply.code(201).send({ id: comment.id, createdAt: comment.createdAt });
    }),
  );
}
