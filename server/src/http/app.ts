import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";

import { hashPassword, verifyPassword } from "../auth/passwords";
import { ActionRunner } from "../domain/actionRunner";
import {
  buildBcfZip,
  parseBcfZip,
  type BcfTopicInput,
} from "../domain/bcfService";
import { CommitService } from "../domain/commitService";
import { FragmentsService } from "../domain/fragmentsService";
import type { ObjectStore } from "../storage/objectStore";
import {
  ADMIN_ROLES,
  type Action,
  type ActionRun,
  type Commit,
  type Issue,
  type IssueLinks,
  type Member,
  type Model,
  type Project,
  type Repository,
  type Role,
  type User,
  WRITE_ROLES,
} from "../repository/types";

export const SERVER_VERSION = "0.2.0";

export interface AppDeps {
  repo: Repository;
  store: ObjectStore;
  jwtSecret: string;
  /** Reported by /api/health so clients can tell the storage mode. */
  storageMode?: "filesystem" | "azure";
  /** Führt Action-Runs aus; ohne Angabe wird ein Standard-Runner gebaut. */
  runner?: ActionRunner;
}

interface JwtPayload {
  sub: string;
  email: string;
}

/** Minimal access level a route demands of a project member. */
type Access = "read" | "write" | "admin";

const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
  };
}

/**
 * Normalisiert einen Ordnerpfad: Segmente trimmen, leere entfernen,
 * mit "/" verbinden. "" ist die Wurzel. null bei ungültigen Segmenten.
 */
function normalizeFolderPath(input: string): string | null {
  const segments = input
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length > 10) {
    return null;
  }
  for (const segment of segments) {
    if (segment.length > 64 || segment === "." || segment === "..") {
      return null;
    }
    const hasForbiddenChar = [...segment].some(
      (ch) => ch === "<" || ch === ">" || ch === "\\" || ch.charCodeAt(0) < 32,
    );
    if (hasForbiddenChar) {
      return null;
    }
  }
  return segments.join("/");
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { repo, store, jwtSecret } = deps;
  const commits = new CommitService(repo, store);
  const fragmentsService = new FragmentsService(store);
  const runner = deps.runner ?? new ActionRunner(repo, store);

  /** Vorschaubild eines Projekts (aus der 3D-Szene der Web-UI). */
  const projectImageKey = (projectId: string) => `projects/${projectId}/image.png`;

  /** Blob + zugehörige Fragments-Caches (alle Generationen) löschen. */
  function deleteBlobsWithFragments(blobKeys: string[]): Promise<unknown> {
    return Promise.allSettled(
      blobKeys.flatMap((key) => [
        store.delete(key),
        ...FragmentsService.allFragKeys(key).map((frag) => store.delete(frag)),
      ]),
    );
  }

  const app = Fastify({ logger: false, bodyLimit: 512 * 1024 * 1024 });

  // The API is consumed cross-origin by the editor (Vite dev server / Tauri
  // webview) and the Nuxt dev server. Auth is via Bearer tokens, not cookies,
  // so a permissive CORS policy is safe here.
  app.register(cors, { origin: true });
  app.register(jwt, { secret: jwtSecret, sign: { expiresIn: "30d" } });
  app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024 } });

  // Serve the built web UI (server/public) at the root.
  app.register(fastifyStatic, {
    root: join(dirname(fileURLToPath(import.meta.url)), "../../public"),
    prefix: "/",
  });

  // SPA fallback: unknown non-API GET routes belong to the client-side router.
  app.setNotFoundHandler((request, reply) => {
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      !request.url.startsWith("/api")
    ) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });

  // Accept raw IFC/STEP and Markdown request bodies as strings.
  app.addContentTypeParser(
    ["text/plain", "application/octet-stream", "application/x-step", "text/markdown"],
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );
  // PNG-Uploads (Projektbild) und Zip-Uploads (BCF-Import) als Buffer.
  app.addContentTypeParser(
    ["image/png", "application/zip"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );

  // ---- auth helpers ----------------------------------------------------

  async function requireUser(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<User | null> {
    try {
      const payload = await request.jwtVerify<JwtPayload>();
      const user = await repo.getUserById(payload.sub);
      if (!user) {
        reply.code(401).send({ error: "Unknown user" });
        return null;
      }
      return user;
    } catch {
      reply.code(401).send({ error: "Authentication required" });
      return null;
    }
  }

  async function optionalUser(request: FastifyRequest): Promise<User | null> {
    try {
      const payload = await request.jwtVerify<JwtPayload>();
      return await repo.getUserById(payload.sub);
    } catch {
      return null;
    }
  }

  async function resolveProject(
    slug: string,
    reply: FastifyReply,
  ): Promise<Project | null> {
    const project = await repo.getProjectBySlug(slug);
    if (!project) {
      reply.code(404).send({ error: "Project not found" });
      return null;
    }
    return project;
  }

  async function requireMember(
    project: Project,
    user: User | null,
    reply: FastifyReply,
    access: Access,
  ): Promise<Member | null> {
    if (!user) {
      reply.code(401).send({ error: "Authentication required" });
      return null;
    }
    // Globale Admins haben Owner-Rechte auf allen Projekten.
    if (user.isAdmin) {
      return { projectId: project.id, userId: user.id, role: "owner" };
    }
    let member = await repo.getMember(project.id, user.id);
    // Öffentliche Projekte: jeder angemeldete Benutzer ist implizit viewer.
    if (!member && access === "read" && project.visibility === "public") {
      member = { projectId: project.id, userId: user.id, role: "viewer" };
    }
    if (!member) {
      reply.code(403).send({ error: "Not a project member" });
      return null;
    }
    if (access === "write" && !WRITE_ROLES.has(member.role)) {
      reply.code(403).send({ error: "Insufficient role" });
      return null;
    }
    if (access === "admin" && !ADMIN_ROLES.has(member.role)) {
      reply.code(403).send({ error: "Insufficient role" });
      return null;
    }
    return member;
  }

  // ---- response enrichment --------------------------------------------

  async function usersById(ids: Iterable<string>): Promise<Map<string, User>> {
    const users = new Map<string, User>();
    for (const id of new Set(ids)) {
      const user = await repo.getUserById(id);
      if (user) {
        users.set(id, user);
      }
    }
    return users;
  }

  /**
   * Alle Ordner eines Projekts: explizit angelegte plus implizite aus den
   * `folder`-Pfaden der Modelle — jeweils inklusive aller Eltern-Pfade.
   */
  async function collectFolders(projectId: string): Promise<string[]> {
    const set = new Set<string>();
    const addWithAncestors = (path: string) => {
      let current = path;
      while (current) {
        set.add(current);
        const idx = current.lastIndexOf("/");
        current = idx === -1 ? "" : current.slice(0, idx);
      }
    };
    for (const path of await repo.listFolders(projectId)) {
      addWithAncestors(path);
    }
    for (const model of await repo.listModels(projectId)) {
      addWithAncestors(model.folder);
    }
    return [...set].sort();
  }

  /** Commit + `author: {id, email, name} | null` for UI display. */
  async function withAuthors(list: Commit[]) {
    const users = await usersById(list.map((c) => c.authorId));
    return list.map((commit) => {
      const author = users.get(commit.authorId);
      return { ...commit, author: author ? publicUser(author) : null };
    });
  }

  // ---- routes ----------------------------------------------------------

  const api = "/api";

  app.get(`${api}/health`, async () => ({
    status: "ok",
    version: SERVER_VERSION,
    storage: deps.storageMode ?? "filesystem",
  }));

  // ---- auth ------------------------------------------------------------

  app.post(`${api}/auth/register`, async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: string;
      name?: string;
      password?: string;
    };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: "email and password required" });
    }
    if (body.password.length < 8) {
      return reply.code(400).send({ error: "password must be at least 8 characters" });
    }
    if (await repo.getUserByEmail(body.email)) {
      return reply.code(409).send({ error: "Email already registered" });
    }
    const user = await repo.createUser({
      email: body.email,
      name: body.name ?? body.email,
      passwordHash: hashPassword(body.password),
      isAdmin: false,
    });
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return reply.code(201).send({ token, user: publicUser(user) });
  });

  app.post(`${api}/auth/login`, async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string; password?: string };
    const user = body.email ? await repo.getUserByEmail(body.email) : null;
    if (!user || !body.password || !verifyPassword(body.password, user.passwordHash)) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return reply.send({ token, user: publicUser(user) });
  });

  app.get(`${api}/me`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    return reply.send({ user: publicUser(user) });
  });

  // ---- Benutzerverwaltung (nur globale Admins) -------------------------

  async function requireAdmin(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<User | null> {
    const user = await requireUser(request, reply);
    if (!user) return null;
    if (!user.isAdmin) {
      reply.code(403).send({ error: "Admin required" });
      return null;
    }
    return user;
  }

  app.get(`${api}/admin/users`, async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    const users = await repo.listUsers();
    return reply.send({
      users: users.map((user) => ({
        ...publicUser(user),
        createdAt: user.createdAt,
      })),
    });
  });

  app.post(`${api}/admin/users`, async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    const body = (request.body ?? {}) as {
      email?: string;
      name?: string;
      password?: string;
      isAdmin?: boolean;
    };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: "email and password required" });
    }
    if (body.password.length < 8) {
      return reply
        .code(400)
        .send({ error: "password must be at least 8 characters" });
    }
    if (await repo.getUserByEmail(body.email)) {
      return reply.code(409).send({ error: "Email already registered" });
    }
    const user = await repo.createUser({
      email: body.email,
      name: body.name?.trim() || body.email,
      passwordHash: hashPassword(body.password),
      isAdmin: Boolean(body.isAdmin),
    });
    return reply
      .code(201)
      .send({ user: { ...publicUser(user), createdAt: user.createdAt } });
  });

  app.patch(`${api}/admin/users/:userId`, async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    const { userId } = request.params as { userId: string };
    const target = await repo.getUserById(userId);
    if (!target) {
      return reply.code(404).send({ error: "User not found" });
    }
    const body = (request.body ?? {}) as {
      name?: string;
      isAdmin?: boolean;
      password?: string;
    };
    // Selbst-Aussperrung verhindern: eigenen Admin-Status nicht entziehen.
    if (body.isAdmin === false && target.id === admin.id) {
      return reply
        .code(400)
        .send({ error: "Cannot remove your own admin status" });
    }
    if (body.password !== undefined && body.password.length < 8) {
      return reply
        .code(400)
        .send({ error: "password must be at least 8 characters" });
    }
    const updated = await repo.updateUser(userId, {
      name: body.name?.trim() || undefined,
      isAdmin: body.isAdmin,
      passwordHash:
        body.password !== undefined ? hashPassword(body.password) : undefined,
    });
    return reply.send({
      user: updated
        ? { ...publicUser(updated), createdAt: updated.createdAt }
        : null,
    });
  });

  app.delete(`${api}/admin/users/:userId`, async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    const { userId } = request.params as { userId: string };
    if (userId === admin.id) {
      return reply.code(400).send({ error: "Cannot delete yourself" });
    }
    const target = await repo.getUserById(userId);
    if (!target) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (await repo.userHasContent(userId)) {
      return reply.code(409).send({
        error:
          "User has authored content (commits/issues/comments) and cannot be deleted",
      });
    }
    await repo.deleteUser(userId);
    return reply.code(204).send();
  });

  // ---- projects --------------------------------------------------------

  app.get(`${api}/projects`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    // Eigene Projekte plus alle oeffentlichen; globale Admins sehen alles.
    let projects;
    if (user.isAdmin) {
      projects = await repo.listAllProjects();
    } else {
      const mine = await repo.listProjectsForUser(user.id);
      const seen = new Set(mine.map((project) => project.id));
      projects = [
        ...mine,
        ...(await repo.listPublicProjects()).filter(
          (project) => !seen.has(project.id),
        ),
      ];
    }
    const enriched = await Promise.all(
      projects.map(async (project) => {
        const member = await repo.getMember(project.id, user.id);
        const models = await repo.listModels(project.id);
        return {
          ...project,
          role: member?.role ?? null,
          modelCount: models.length,
          hasImage: await store.exists(projectImageKey(project.id)),
        };
      }),
    );
    return reply.send({ projects: enriched });
  });

  app.post(`${api}/projects`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const body = (request.body ?? {}) as {
      name?: string;
      slug?: string;
      visibility?: "private" | "public";
    };
    if (!body.name) {
      return reply.code(400).send({ error: "name required" });
    }
    if (body.visibility && !["private", "public"].includes(body.visibility)) {
      return reply.code(400).send({ error: "Invalid visibility" });
    }
    const slug = slugify(body.slug ?? body.name);
    if (!slug) {
      return reply.code(400).send({ error: "name must contain letters or digits" });
    }
    if (await repo.getProjectBySlug(slug)) {
      return reply.code(409).send({ error: "Project slug taken" });
    }
    const project = await repo.createProject({
      slug,
      name: body.name,
      ownerId: user.id,
      // Neu angelegte Projekte sind fuer alle angemeldeten Benutzer sichtbar.
      visibility: body.visibility ?? "public",
    });
    await repo.addMember({
      projectId: project.id,
      userId: user.id,
      role: "owner",
    });
    return reply.code(201).send({ project });
  });

  app.get(`${api}/projects/:slug`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const member = await repo.getMember(project.id, user.id);
    // Private Projekte existieren fuer Nicht-Mitglieder nicht (wie GitHub).
    if (project.visibility === "private" && !member && !user.isAdmin) {
      return reply.code(404).send({ error: "Project not found" });
    }
    const members = await repo.listMembers(project.id);
    const users = await usersById(members.map((m) => m.userId));
    return reply.send({
      project,
      members: members.map((m) => {
        const memberUser = users.get(m.userId);
        return { ...m, user: memberUser ? publicUser(memberUser) : null };
      }),
      role: member?.role ?? null,
      folders: await collectFolders(project.id),
    });
  });

  // ---- Labels + Issues (wie GitHub) ------------------------------------

  const LABEL_COLOR = /^#[0-9a-fA-F]{6}$/;

  app.get(`${api}/projects/:slug/labels`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    return reply.send({ labels: await repo.listLabels(project.id) });
  });

  app.post(`${api}/projects/:slug/labels`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const body = (request.body ?? {}) as { name?: string; color?: string };
    const name = body.name?.trim();
    if (!name || name.length > 40) {
      return reply.code(400).send({ error: "Label name required (max 40)" });
    }
    if (!body.color || !LABEL_COLOR.test(body.color)) {
      return reply.code(400).send({ error: "Color required (#rrggbb)" });
    }
    const existing = await repo.listLabels(project.id);
    if (existing.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
      return reply.code(409).send({ error: "Label name taken" });
    }
    const label = await repo.createLabel({
      projectId: project.id,
      name,
      color: body.color,
    });
    return reply.code(201).send({ label });
  });

  /** Issues mit Autor/Assignees/Modellen/Labels für die UI anreichern. */
  async function enrichIssues(projectId: string, issues: Issue[]) {
    const links = await repo.getIssueLinks(issues.map((issue) => issue.id));
    const labelById = new Map(
      (await repo.listLabels(projectId)).map((label) => [label.id, label]),
    );
    const modelById = new Map(
      (await repo.listModels(projectId)).map((model) => [model.id, model]),
    );
    const userIds = new Set<string>();
    for (const issue of issues) {
      userIds.add(issue.authorId);
      for (const id of links.get(issue.id)?.assigneeIds ?? []) {
        userIds.add(id);
      }
    }
    const users = await usersById(userIds);
    // Referenzierte Commits (aufgefallen/behoben in) für die Anzeige laden.
    const commits = await commitsById(
      [...links.values()].flatMap((link) =>
        link.models.flatMap((m) => [m.foundCommitId, m.fixedCommitId]),
      ),
    );
    const commitRef = (id: string | null) => {
      const commit = id ? commits.get(id) : undefined;
      return commit
        ? {
            id: commit.id,
            message: commit.message,
            branchName: commit.branchName,
            createdAt: commit.createdAt,
          }
        : null;
    };
    return issues.map((issue) => {
      const link = links.get(issue.id);
      const author = users.get(issue.authorId);
      return {
        ...issue,
        author: author ? publicUser(author) : null,
        assignees: (link?.assigneeIds ?? [])
          .map((id) => users.get(id))
          .filter((entry): entry is User => Boolean(entry))
          .map(publicUser),
        models: (link?.models ?? [])
          .filter((m) => modelById.has(m.modelId))
          .map((m) => {
            const model = modelById.get(m.modelId)!;
            return {
              id: model.id,
              slug: model.slug,
              name: model.name,
              folder: model.folder,
              kind: model.kind,
              foundCommitId: m.foundCommitId,
              fixedCommitId: m.fixedCommitId,
              foundCommit: commitRef(m.foundCommitId),
              fixedCommit: commitRef(m.fixedCommitId),
            };
          }),
        labels: (link?.labelIds ?? [])
          .map((id) => labelById.get(id))
          .filter((entry) => entry !== undefined),
        guids: link?.guids ?? [],
      };
    });
  }

  interface IssueLinksBody {
    assigneeIds?: string[];
    /** Modell-Verknüpfungen mit Versionsbezug (aufgefallen/behoben in Commit). */
    modelLinks?: {
      modelId?: string;
      foundCommitId?: string | null;
      fixedCommitId?: string | null;
    }[];
    labelIds?: string[];
    guids?: string[];
  }

  /**
   * Zuordnungs-Ids aus dem Request validieren: Assignees müssen Mitglieder
   * sein, Modelle/Labels zum Projekt und Commit-Bezüge zum jeweiligen
   * Modell gehören. Gibt null zurück, wenn die Antwort schon gesendet wurde.
   */
  async function validateIssueLinks(
    project: Project,
    body: IssueLinksBody,
    reply: FastifyReply,
  ): Promise<Partial<IssueLinks> | null> {
    const links: Partial<IssueLinks> = {};
    if (body.assigneeIds !== undefined) {
      for (const id of body.assigneeIds) {
        if (!(await repo.getMember(project.id, id))) {
          reply.code(400).send({ error: "Assignee is not a project member" });
          return null;
        }
      }
      links.assigneeIds = body.assigneeIds;
    }
    if (body.modelLinks !== undefined) {
      const known = new Set(
        (await repo.listModels(project.id)).map((model) => model.id),
      );
      const models: IssueLinks["models"] = [];
      for (const raw of body.modelLinks) {
        if (!raw.modelId || !known.has(raw.modelId)) {
          reply.code(400).send({ error: "Unknown model id" });
          return null;
        }
        // Commit-Bezüge müssen zum jeweiligen Modell gehören.
        for (const commitId of [raw.foundCommitId, raw.fixedCommitId]) {
          if (!commitId) continue;
          const commit = await repo.getCommit(commitId);
          if (!commit || commit.modelId !== raw.modelId) {
            reply
              .code(400)
              .send({ error: "Commit gehört nicht zum verknüpften Modell" });
            return null;
          }
        }
        models.push({
          modelId: raw.modelId,
          foundCommitId: raw.foundCommitId ?? null,
          fixedCommitId: raw.fixedCommitId ?? null,
        });
      }
      links.models = models;
    }
    if (body.labelIds !== undefined) {
      const known = new Set(
        (await repo.listLabels(project.id)).map((label) => label.id),
      );
      if (body.labelIds.some((id) => !known.has(id))) {
        reply.code(400).send({ error: "Unknown label id" });
        return null;
      }
      links.labelIds = body.labelIds;
    }
    if (body.guids !== undefined) {
      const cleaned = body.guids
        .map((guid) => (typeof guid === "string" ? guid.trim() : ""))
        .filter((guid) => guid.length > 0 && guid.length <= 64);
      if (cleaned.length > 500) {
        reply.code(400).send({ error: "Too many GUIDs (max 500)" });
        return null;
      }
      links.guids = cleaned;
    }
    return links;
  }

  app.get(`${api}/projects/:slug/issues`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const query = request.query as { state?: string };
    const all = await repo.listIssues(project.id);
    const filtered =
      query.state === "open" || query.state === "closed"
        ? all.filter((issue) => issue.state === query.state)
        : all;
    return reply.send({
      issues: await enrichIssues(project.id, filtered),
      openCount: all.filter((issue) => issue.state === "open").length,
      closedCount: all.filter((issue) => issue.state === "closed").length,
    });
  });

  // Issues eröffnen darf jedes Mitglied (auch viewer) — wie bei GitHub.
  app.post(`${api}/projects/:slug/issues`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const body = (request.body ?? {}) as {
      title?: string;
      body?: string;
      kind?: string;
    } & IssueLinksBody;
    const title = body.title?.trim();
    if (!title || title.length > 200) {
      return reply.code(400).send({ error: "Title required (max 200)" });
    }
    if (body.kind !== undefined && !["virtual", "bcf"].includes(body.kind)) {
      return reply.code(400).send({ error: "kind must be 'virtual' or 'bcf'" });
    }
    const links = await validateIssueLinks(project, body, reply);
    if (!links) return reply;
    const issue = await repo.createIssue({
      projectId: project.id,
      title,
      body: body.body ?? "",
      state: "open",
      kind: (body.kind as Issue["kind"] | undefined) ?? "virtual",
      authorId: user.id,
    });
    await repo.setIssueLinks(issue.id, links);
    const [enriched] = await enrichIssues(project.id, [issue]);
    return reply.code(201).send({ issue: enriched });
  });

  /** Kommentare eines Issues mit Autor-Objekt für die UI. */
  async function enrichComments(issueId: string) {
    const comments = await repo.listIssueComments(issueId);
    const users = await usersById(comments.map((comment) => comment.authorId));
    return comments.map((comment) => {
      const author = users.get(comment.authorId);
      return { ...comment, author: author ? publicUser(author) : null };
    });
  }

  app.get(`${api}/projects/:slug/issues/:number`, async (request, reply) => {
    const { slug, number } = request.params as { slug: string; number: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const issue = await repo.getIssue(project.id, Number(number));
    if (!issue) {
      return reply.code(404).send({ error: "Issue not found" });
    }
    const [enriched] = await enrichIssues(project.id, [issue]);
    return reply.send({
      issue: enriched,
      comments: await enrichComments(issue.id),
    });
  });

  // Kommentieren darf jedes Mitglied — wie bei GitHub, auch auf geschlossenen.
  app.post(
    `${api}/projects/:slug/issues/:number/comments`,
    async (request, reply) => {
      const { slug, number } = request.params as {
        slug: string;
        number: string;
      };
      const project = await resolveProject(slug, reply);
      if (!project) return reply;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!(await requireMember(project, user, reply, "read"))) return reply;
      const issue = await repo.getIssue(project.id, Number(number));
      if (!issue) {
        return reply.code(404).send({ error: "Issue not found" });
      }
      const body = (request.body ?? {}) as { body?: string };
      const text = body.body?.trim();
      if (!text || text.length > 20_000) {
        return reply
          .code(400)
          .send({ error: "Comment body required (max 20000)" });
      }
      const comment = await repo.createIssueComment({
        issueId: issue.id,
        authorId: user.id,
        body: text,
      });
      // Aktivität am Issue sichtbar machen (updatedAt).
      await repo.updateIssue(issue.id, {});
      return reply
        .code(201)
        .send({ comment: { ...comment, author: publicUser(user) } });
    },
  );

  app.delete(
    `${api}/projects/:slug/issues/:number/comments/:commentId`,
    async (request, reply) => {
      const { slug, number, commentId } = request.params as {
        slug: string;
        number: string;
        commentId: string;
      };
      const project = await resolveProject(slug, reply);
      if (!project) return reply;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      const member = await requireMember(project, user, reply, "read");
      if (!member) return reply;
      const issue = await repo.getIssue(project.id, Number(number));
      const comment = await repo.getIssueComment(commentId);
      if (!issue || !comment || comment.issueId !== issue.id) {
        return reply.code(404).send({ error: "Comment not found" });
      }
      // Löschen darf der Kommentar-Autor oder jedes Mitglied mit Schreibrecht.
      if (comment.authorId !== user.id && !WRITE_ROLES.has(member.role)) {
        return reply.code(403).send({ error: "Insufficient role" });
      }
      await repo.deleteIssueComment(commentId);
      return reply.code(204).send();
    },
  );

  app.patch(`${api}/projects/:slug/issues/:number`, async (request, reply) => {
    const { slug, number } = request.params as { slug: string; number: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const member = await requireMember(project, user, reply, "read");
    if (!member) return reply;
    const issue = await repo.getIssue(project.id, Number(number));
    if (!issue) {
      return reply.code(404).send({ error: "Issue not found" });
    }
    // Ändern darf der Autor oder jedes Mitglied mit Schreibrecht.
    if (issue.authorId !== user.id && !WRITE_ROLES.has(member.role)) {
      return reply.code(403).send({ error: "Insufficient role" });
    }
    const body = (request.body ?? {}) as {
      title?: string;
      body?: string;
      state?: string;
      kind?: string;
    } & IssueLinksBody;
    if (body.state && !["open", "closed"].includes(body.state)) {
      return reply.code(400).send({ error: "Invalid state" });
    }
    if (body.kind !== undefined && !["virtual", "bcf"].includes(body.kind)) {
      return reply.code(400).send({ error: "kind must be 'virtual' or 'bcf'" });
    }
    if (body.title !== undefined && !body.title.trim()) {
      return reply.code(400).send({ error: "Title must not be empty" });
    }
    const links = await validateIssueLinks(project, body, reply);
    if (!links) return reply;
    const updated = await repo.updateIssue(issue.id, {
      title: body.title?.trim(),
      body: body.body,
      state: body.state as "open" | "closed" | undefined,
      kind: body.kind as Issue["kind"] | undefined,
    });
    await repo.setIssueLinks(issue.id, links);
    const [enriched] = await enrichIssues(project.id, [updated ?? issue]);
    return reply.send({ issue: enriched });
  });

  // ---- BCF-Export (echte IFC-Issues, buildingSMART BCF 2.1) ------------

  async function bcfTopicsFor(
    project: Project,
    issues: Issue[],
  ): Promise<BcfTopicInput[]> {
    const links = await repo.getIssueLinks(issues.map((issue) => issue.id));
    const modelById = new Map(
      (await repo.listModels(project.id)).map((model) => [model.id, model]),
    );
    const userIds = new Set<string>();
    const commentsByIssue = new Map<string, Awaited<ReturnType<typeof repo.listIssueComments>>>();
    for (const issue of issues) {
      userIds.add(issue.authorId);
      const comments = await repo.listIssueComments(issue.id);
      commentsByIssue.set(issue.id, comments);
      for (const comment of comments) {
        userIds.add(comment.authorId);
      }
    }
    const users = await usersById(userIds);
    return issues.map((issue) => {
      const link = links.get(issue.id);
      return {
        issue,
        comments: commentsByIssue.get(issue.id) ?? [],
        guids: link?.guids ?? [],
        modelFileNames: (link?.models ?? [])
          .map((m) => modelById.get(m.modelId)?.name)
          .filter((name): name is string => Boolean(name)),
        usersById: users,
      };
    });
  }

  function sendBcfZip(reply: FastifyReply, fileName: string, zip: Buffer) {
    return reply
      .header("content-type", "application/octet-stream")
      .header("content-disposition", `attachment; filename="${fileName}"`)
      .send(zip);
  }

  // Alle BCF-Issues des Projekts als eine .bcfzip (Austausch mit BIM-Tools).
  app.get(`${api}/projects/:slug/issues/bcf`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const issues = (await repo.listIssues(project.id)).filter(
      (issue) => issue.kind === "bcf",
    );
    if (!issues.length) {
      return reply.code(404).send({ error: "Keine BCF-Issues im Projekt" });
    }
    const zip = buildBcfZip(await bcfTopicsFor(project, issues));
    return sendBcfZip(reply, `${project.slug}-issues.bcfzip`, zip);
  });

  // BCF-Import: .bcfzip hochladen (Content-Type application/zip) —
  // jedes Topic wird ein "bcf"-Issue mit Beschreibung, Status, Kommentaren
  // und den Viewpoint-GUIDs (3D-Verortung). Bereits importierte Topics
  // (gleiche Topic-Guid) werden übersprungen.
  app.post(`${api}/projects/:slug/issues/bcf`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply
        .code(400)
        .send({ error: "BCF-Zip als Body (application/zip) erforderlich" });
    }
    if (body.length > 50 * 1024 * 1024) {
      return reply.code(400).send({ error: "Datei zu groß (max 50 MB)" });
    }
    let topics;
    try {
      topics = parseBcfZip(new Uint8Array(body));
    } catch {
      return reply.code(400).send({ error: "Keine lesbare BCF-Zip-Datei" });
    }
    if (!topics.length) {
      return reply
        .code(400)
        .send({ error: "Kein BCF-Topic in der Datei gefunden" });
    }
    // Modell-Matching über die Header-Dateinamen (Name bzw. Name + .ifc).
    const models = await repo.listModels(project.id);
    const modelIdByName = new Map<string, string>();
    for (const model of models) {
      modelIdByName.set(model.name.toLowerCase(), model.id);
      modelIdByName.set(`${model.name.toLowerCase()}.ifc`, model.id);
      modelIdByName.set(`${model.slug.toLowerCase()}.ifc`, model.id);
    }
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let imported = 0;
    let skipped = 0;
    for (const topic of topics) {
      // Topic-Guid als Issue-Id übernehmen (stabiler Re-Import); bei
      // Kollision im selben Projekt überspringen, sonst neue Id.
      const existing = UUID.test(topic.guid)
        ? await repo.getIssueById(topic.guid)
        : null;
      if (existing?.projectId === project.id) {
        skipped += 1;
        continue;
      }
      const issue = await repo.createIssue({
        id: UUID.test(topic.guid) && !existing ? topic.guid : undefined,
        projectId: project.id,
        title: topic.title.slice(0, 200),
        body: topic.description,
        state: topic.status,
        kind: "bcf",
        authorId: user.id,
      });
      const modelIds = [
        ...new Set(
          topic.fileNames
            .map((name) => modelIdByName.get(name.toLowerCase()))
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      await repo.setIssueLinks(issue.id, {
        guids: topic.guids,
        models: modelIds.map((modelId) => ({
          modelId,
          foundCommitId: null,
          fixedCommitId: null,
        })),
      });
      for (const comment of topic.comments) {
        // Fremde Autoren gibt es hier nicht als Benutzer — Original-Autor
        // und -Datum wandern in den Kommentartext.
        const meta = [comment.author, comment.date].filter(Boolean).join(", ");
        await repo.createIssueComment({
          issueId: issue.id,
          authorId: user.id,
          body: meta ? `**${meta}:**\n\n${comment.text}` : comment.text,
        });
      }
      imported += 1;
    }
    return reply.code(201).send({ imported, skipped });
  });

  app.get(
    `${api}/projects/:slug/issues/:number/bcf`,
    async (request, reply) => {
      const { slug, number } = request.params as {
        slug: string;
        number: string;
      };
      const project = await resolveProject(slug, reply);
      if (!project) return reply;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!(await requireMember(project, user, reply, "read"))) return reply;
      const issue = await repo.getIssue(project.id, Number(number));
      if (!issue) {
        return reply.code(404).send({ error: "Issue not found" });
      }
      if (issue.kind !== "bcf") {
        return reply
          .code(400)
          .send({ error: "Nur BCF-Issues sind exportierbar (Art umstellen)" });
      }
      const zip = buildBcfZip(await bcfTopicsFor(project, [issue]));
      return sendBcfZip(
        reply,
        `${project.slug}-issue-${issue.number}.bcfzip`,
        zip,
      );
    },
  );

  // ---- Projektbild (Screenshot aus der 3D-Szene) -----------------------

  app.put(`${api}/projects/:slug/image`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: "PNG body (image/png) required" });
    }
    if (body.length > 5 * 1024 * 1024) {
      return reply.code(400).send({ error: "Image too large (max 5 MB)" });
    }
    await store.put(projectImageKey(project.id), body, "image/png");
    return reply.code(204).send();
  });

  app.get(`${api}/projects/:slug/image`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const key = projectImageKey(project.id);
    if (!(await store.exists(key))) {
      return reply.code(404).send({ error: "No project image" });
    }
    return reply
      .header("content-type", "image/png")
      .header("cache-control", "private, max-age=60")
      .send(await store.get(key));
  });

  // ---- folders ---------------------------------------------------------

  app.post(`${api}/projects/:slug/folders`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const body = (request.body ?? {}) as { path?: string };
    const path = body.path === undefined ? null : normalizeFolderPath(body.path);
    if (!path) {
      return reply.code(400).send({ error: "Valid folder path required" });
    }
    await repo.addFolder(project.id, path);
    return reply.code(201).send({ folder: path });
  });

  app.delete(`${api}/projects/:slug/folders`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const query = request.query as { path?: string };
    const path = query.path === undefined ? null : normalizeFolderPath(query.path);
    if (!path) {
      return reply.code(400).send({ error: "Valid folder path required" });
    }
    const models = await repo.listModels(project.id);
    const occupied = models.some(
      (model) => model.folder === path || model.folder.startsWith(`${path}/`),
    );
    if (occupied) {
      return reply
        .code(409)
        .send({ error: "Folder is not empty (contains models)" });
    }
    await repo.removeFolder(project.id, path);
    return reply.code(204).send();
  });

  // Add a member or change their role (upsert by email).
  app.post(`${api}/projects/:slug/members`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const member = await requireMember(project, user, reply, "admin");
    if (!member) return reply;
    const body = (request.body ?? {}) as { email?: string; role?: Role };
    const target = body.email ? await repo.getUserByEmail(body.email) : null;
    if (!target) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (target.id === project.ownerId && body.role && body.role !== "owner") {
      return reply.code(400).send({ error: "Cannot change the owner's role" });
    }
    const added = await repo.addMember({
      projectId: project.id,
      userId: target.id,
      role: body.role ?? "contributor",
    });
    return reply.code(201).send({ member: { ...added, user: publicUser(target) } });
  });

  app.delete(`${api}/projects/:slug/members/:userId`, async (request, reply) => {
    const { slug, userId } = request.params as { slug: string; userId: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "admin"))) return reply;
    if (userId === project.ownerId) {
      return reply.code(400).send({ error: "Cannot remove the project owner" });
    }
    await repo.removeMember(project.id, userId);
    return reply.code(204).send();
  });

  // ---- models ----------------------------------------------------------

  async function resolveModel(
    slug: string,
    modelSlug: string,
    reply: FastifyReply,
  ) {
    const project = await resolveProject(slug, reply);
    if (!project) return null;
    const model = await repo.getModel(project.id, modelSlug);
    if (!model) {
      reply.code(404).send({ error: "Model not found" });
      return null;
    }
    return { project, model };
  }

  /**
   * Read access to a model: public models for everyone (auch anonym);
   * sonst Mitglieder — oder jeder Angemeldete, wenn das PROJEKT public ist.
   * Sends the error response and returns false when access is denied.
   */
  async function canReadModel(
    request: FastifyRequest,
    reply: FastifyReply,
    project: Project,
    modelVisibility: "private" | "public",
  ): Promise<boolean> {
    if (modelVisibility === "public") return true;
    const user = await optionalUser(request);
    if (user?.isAdmin) return true;
    if (user && project.visibility === "public") return true;
    const member = user ? await repo.getMember(project.id, user.id) : null;
    if (!member) {
      reply.code(403).send({ error: "Private model" });
      return false;
    }
    return true;
  }

  app.get(`${api}/projects/:slug/models`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await optionalUser(request);
    const member = user ? await repo.getMember(project.id, user.id) : null;
    const models = await repo.listModels(project.id);
    const readAll =
      Boolean(member) || (user !== null && project.visibility === "public");
    const visible = readAll
      ? models
      : models.filter((m) => m.visibility === "public");
    const enriched = await Promise.all(
      visible.map(async (model) => {
        const branches = await repo.listBranches(model.id);
        const defaultBranch = branches.find((b) => b.name === model.defaultBranch);
        const head = defaultBranch?.headCommitId
          ? await repo.getCommit(defaultBranch.headCommitId)
          : null;
        const [headWithAuthor] = head ? await withAuthors([head]) : [null];
        return { ...model, branchCount: branches.length, head: headWithAuthor };
      }),
    );
    return reply.send({ models: enriched });
  });

  app.post(`${api}/projects/:slug/models`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const body = (request.body ?? {}) as {
      name?: string;
      slug?: string;
      visibility?: "private" | "public";
      folder?: string;
      kind?: "ifc" | "md";
    };
    if (!body.name) {
      return reply.code(400).send({ error: "name required" });
    }
    const kind = body.kind ?? "ifc";
    if (!["ifc", "md"].includes(kind)) {
      return reply.code(400).send({ error: "Invalid kind (ifc or md)" });
    }
    const folder = normalizeFolderPath(body.folder ?? "");
    if (folder === null) {
      return reply.code(400).send({ error: "Invalid folder path" });
    }
    const modelSlug = slugify(body.slug ?? body.name);
    if (!modelSlug) {
      return reply.code(400).send({ error: "name must contain letters or digits" });
    }
    if (await repo.getModel(project.id, modelSlug)) {
      return reply.code(409).send({ error: "Model slug taken" });
    }
    const model = await repo.createModel({
      projectId: project.id,
      slug: modelSlug,
      name: body.name,
      visibility: body.visibility ?? "private",
      defaultBranch: "main",
      folder,
      kind,
    });
    return reply.code(201).send({ model });
  });

  app.get(`${api}/projects/:slug/models/:model`, async (request, reply) => {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return reply;
    const { project, model } = resolved;
    if (!(await canReadModel(request, reply, project, model.visibility))) return reply;
    const branches = await repo.listBranches(model.id);
    const heads = await commitsById(branches.map((b) => b.headCommitId));
    const enriched = await Promise.all(
      branches.map(async (branch) => {
        const head = branch.headCommitId ? heads.get(branch.headCommitId) ?? null : null;
        const [headWithAuthor] = head ? await withAuthors([head]) : [null];
        return { ...branch, head: headWithAuthor };
      }),
    );
    return reply.send({ model, branches: enriched });
  });

  /** Batch-load commits by id (nulls skipped). */
  async function commitsById(
    commitIds: (string | null)[],
  ): Promise<Map<string, Commit>> {
    const map = new Map<string, Commit>();
    for (const id of new Set(commitIds)) {
      if (!id) continue;
      const commit = await repo.getCommit(id);
      if (commit) {
        map.set(id, commit);
      }
    }
    return map;
  }

  // Modell-Einstellungen (Name, Sichtbarkeit, Standard-Branch) — admin.
  app.patch(`${api}/projects/:slug/models/:model`, async (request, reply) => {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return reply;
    const { project, model } = resolved;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "admin"))) return reply;
    const body = (request.body ?? {}) as {
      name?: string;
      visibility?: "private" | "public";
      defaultBranch?: string;
      folder?: string;
    };
    if (body.visibility && !["private", "public"].includes(body.visibility)) {
      return reply.code(400).send({ error: "Invalid visibility" });
    }
    if (body.defaultBranch) {
      if (!(await repo.getBranch(model.id, body.defaultBranch))) {
        return reply.code(400).send({ error: "Branch does not exist" });
      }
    }
    let folder: string | undefined;
    if (body.folder !== undefined) {
      const normalized = normalizeFolderPath(body.folder);
      if (normalized === null) {
        return reply.code(400).send({ error: "Invalid folder path" });
      }
      folder = normalized;
    }
    const updated = await repo.updateModel(model.id, {
      name: body.name,
      visibility: body.visibility,
      defaultBranch: body.defaultBranch,
      folder,
    });
    return reply.send({ model: updated });
  });

  // Modell löschen (admin): Metadaten sofort, Blobs best-effort.
  app.delete(`${api}/projects/:slug/models/:model`, async (request, reply) => {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return reply;
    const { project, model } = resolved;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "admin"))) return reply;
    const blobKeys = await repo.deleteModel(model.id);
    await deleteBlobsWithFragments(blobKeys);
    return reply.code(204).send();
  });

  // Projekt löschen — nur der Owner.
  // Projekt-Einstellungen (Name, Sichtbarkeit) — admin.
  app.patch(`${api}/projects/:slug`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "admin"))) return reply;
    const body = (request.body ?? {}) as {
      name?: string;
      visibility?: "private" | "public";
    };
    if (body.visibility && !["private", "public"].includes(body.visibility)) {
      return reply.code(400).send({ error: "Invalid visibility" });
    }
    if (body.name !== undefined && !body.name.trim()) {
      return reply.code(400).send({ error: "Name must not be empty" });
    }
    const updated = await repo.updateProject(project.id, {
      name: body.name?.trim(),
      visibility: body.visibility,
    });
    return reply.send({ project: updated });
  });

  app.delete(`${api}/projects/:slug`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const member = await requireMember(project, user, reply, "admin");
    if (!member) return reply;
    if (member.role !== "owner") {
      return reply
        .code(403)
        .send({ error: "Only the project owner can delete it" });
    }
    const blobKeys = await repo.deleteProject(project.id);
    await deleteBlobsWithFragments(blobKeys);
    await store.delete(projectImageKey(project.id)).catch(() => undefined);
    return reply.code(204).send();
  });

  // ---- branches --------------------------------------------------------

  app.post(
    `${api}/projects/:slug/models/:model/branches`,
    async (request, reply) => {
      const { slug, model: modelSlug } = request.params as {
        slug: string;
        model: string;
      };
      const resolved = await resolveModel(slug, modelSlug, reply);
      if (!resolved) return reply;
      const { project, model } = resolved;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!(await requireMember(project, user, reply, "write"))) return reply;
      const body = (request.body ?? {}) as { name?: string; from?: string };
      if (!body.name || !BRANCH_NAME.test(body.name)) {
        return reply
          .code(400)
          .send({ error: "Branch name required (letters, digits, . _ / -)" });
      }
      if (await repo.getBranch(model.id, body.name)) {
        return reply.code(409).send({ error: "Branch already exists" });
      }
      // A new branch starts at the head of `from` (default: the default
      // branch), so its first commit diffs against that head — like git.
      const fromName = body.from ?? model.defaultBranch;
      const fromBranch = await repo.getBranch(model.id, fromName);
      const branch = await repo.createBranch({
        modelId: model.id,
        name: body.name,
        headCommitId: fromBranch?.headCommitId ?? null,
      });
      return reply.code(201).send({ branch });
    },
  );

  // ---- commits (the core) ----------------------------------------------

  interface IfcUpload {
    text: string | null;
    fields: Record<string, string>;
  }

  /** Raw STEP body, or multipart with a `file` part plus text fields. */
  async function readIfcUpload(request: FastifyRequest): Promise<IfcUpload> {
    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) return { text: null, fields: {} };
      const buffer = await file.toBuffer();
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(file.fields)) {
        const first = Array.isArray(value) ? value[0] : value;
        if (
          first &&
          typeof first === "object" &&
          "value" in first &&
          typeof first.value === "string"
        ) {
          fields[key] = first.value;
        }
      }
      return { text: buffer.toString("utf8"), fields };
    }
    return {
      text: typeof request.body === "string" ? request.body : null,
      fields: {},
    };
  }

  app.post(
    `${api}/projects/:slug/models/:model/commits`,
    async (request, reply) => {
      const { slug, model: modelSlug } = request.params as {
        slug: string;
        model: string;
      };
      const resolved = await resolveModel(slug, modelSlug, reply);
      if (!resolved) return reply;
      const { project, model } = resolved;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!(await requireMember(project, user, reply, "write"))) return reply;

      const query = request.query as { branch?: string; message?: string };
      const upload = await readIfcUpload(request);
      if (upload.text === null || upload.text === "") {
        return reply.code(400).send({ error: "File content required" });
      }
      if (model.kind === "md") {
        if (upload.text.length > 2 * 1024 * 1024) {
          return reply.code(400).send({ error: "Markdown too large (max 2 MB)" });
        }
      } else if (!upload.text.includes("ISO-10303-21")) {
        return reply.code(400).send({ error: "Valid IFC/STEP body required" });
      }

      const branchName =
        query.branch ?? upload.fields.branch ?? model.defaultBranch;
      if (!BRANCH_NAME.test(branchName)) {
        return reply.code(400).send({ error: "Invalid branch name" });
      }

      const result = await commits.createCommit({
        model,
        branchName,
        text: upload.text,
        authorId: user.id,
        message: query.message ?? upload.fields.message ?? "",
      });
      // Actions mit "bei Commit ausführen" automatisch starten.
      if (model.kind === "ifc") {
        const autoActions = (await repo.listActions(project.id)).filter(
          (action) => action.runOnCommit,
        );
        await queueRuns(project, model, result.commit.id, autoActions, user.id);
      }
      const [commit] = await withAuthors([result.commit]);
      return reply.code(201).send({ commit, diff: result.diff });
    },
  );

  app.get(`${api}/projects/:slug/models/:model/commits`, async (request, reply) => {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return reply;
    const { project, model } = resolved;
    if (!(await canReadModel(request, reply, project, model.visibility))) return reply;
    const query = request.query as { branch?: string };
    const list = await repo.listCommits(model.id, query.branch);
    return reply.send({ commits: await withAuthors(list) });
  });

  app.get(
    `${api}/projects/:slug/models/:model/commits/:commitId`,
    async (request, reply) => {
      const { slug, model: modelSlug, commitId } = request.params as {
        slug: string;
        model: string;
        commitId: string;
      };
      const resolved = await resolveModel(slug, modelSlug, reply);
      if (!resolved) return reply;
      const { project, model } = resolved;
      if (!(await canReadModel(request, reply, project, model.visibility))) return reply;
      const commit = await repo.getCommit(commitId);
      if (!commit || commit.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      const [enriched] = await withAuthors([commit]);
      return reply.send({ commit: enriched });
    },
  );

  app.get(
    `${api}/projects/:slug/models/:model/commits/:commitId/file`,
    async (request, reply) => {
      const { slug, model: modelSlug, commitId } = request.params as {
        slug: string;
        model: string;
        commitId: string;
      };
      const resolved = await resolveModel(slug, modelSlug, reply);
      if (!resolved) return reply;
      const { project, model } = resolved;
      if (!(await canReadModel(request, reply, project, model.visibility))) return reply;
      const commit = await repo.getCommit(commitId);
      if (!commit || commit.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      const buffer = await commits.downloadIfc(commit);
      const isMd = model.kind === "md";
      return reply
        .header(
          "content-type",
          isMd ? "text/markdown; charset=utf-8" : "application/x-step",
        )
        .header(
          "content-disposition",
          `attachment; filename="${modelSlug}-${commitId}.${isMd ? "md" : "ifc"}"`,
        )
        .send(buffer);
    },
  );

  // ThatOpen-Fragments für die 3D-Vorschau: beim ersten Abruf wird die IFC
  // serverseitig konvertiert und das Ergebnis im Object Store gecacht.
  app.get(
    `${api}/projects/:slug/models/:model/commits/:commitId/fragments`,
    async (request, reply) => {
      const { slug, model: modelSlug, commitId } = request.params as {
        slug: string;
        model: string;
        commitId: string;
      };
      const resolved = await resolveModel(slug, modelSlug, reply);
      if (!resolved) return reply;
      const { project, model } = resolved;
      if (!(await canReadModel(request, reply, project, model.visibility))) return reply;
      if (model.kind === "md") {
        return reply.code(400).send({ error: "Markdown files have no 3D preview" });
      }
      const commit = await repo.getCommit(commitId);
      if (!commit || commit.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      try {
        const buffer = await fragmentsService.getFragments(commit);
        return reply
          .header("content-type", "application/octet-stream")
          // Commits sind unveränderlich — der Browser darf hart cachen.
          .header("cache-control", "private, max-age=31536000, immutable")
          .send(buffer);
      } catch (error) {
        return reply.code(500).send({
          error: `IFC-zu-Fragments-Konvertierung fehlgeschlagen: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
  );

  // ---- Actions (Prüf-Workflows wie bei GitHub) -------------------------
  // Die Prüfdatei einer Action kommt entweder als eigener Upload oder aus
  // der zentralen, projektübergreifenden Bibliothek (libraryFileId).

  const ACTION_KINDS = new Set(["ids", "python"]);
  const ACTION_FILE_LIMIT = 5 * 1024 * 1024;

  const actionFileKey = (projectId: string, actionId: string) =>
    `projects/${projectId}/actions/${actionId}`;

  const libraryFileKey = (fileId: string) => `library/${fileId}`;

  function publicAction(action: Action) {
    const { fileKey: _fileKey, ...rest } = action;
    return rest;
  }

  interface ActionPayload {
    name?: string;
    kind?: string;
    fileName?: string;
    content?: string;
    runOnCommit?: boolean;
  }

  /**
   * Neue Action validieren; bei Fehler ist die Antwort schon gesendet
   * (null zurück). Wird von der Projekt- und der Global-Route geteilt.
   */
  function validateNewAction(
    body: ActionPayload,
    reply: FastifyReply,
  ): { name: string; kind: Action["kind"]; fileName: string; content: string } | null {
    const name = body.name?.trim();
    if (!name || name.length > 100) {
      reply.code(400).send({ error: "Name required (max 100)" });
      return null;
    }
    if (!body.kind || !ACTION_KINDS.has(body.kind)) {
      reply.code(400).send({ error: "kind must be 'ids' or 'python'" });
      return null;
    }
    if (!body.content) {
      reply.code(400).send({ error: "content (file text) required" });
      return null;
    }
    if (body.content.length > ACTION_FILE_LIMIT) {
      reply.code(400).send({ error: "File too large (max 5 MB)" });
      return null;
    }
    if (body.kind === "ids" && !body.content.includes("<ids")) {
      reply.code(400).send({ error: "Not an IDS XML file" });
      return null;
    }
    return {
      name,
      kind: body.kind as Action["kind"],
      fileName:
        body.fileName?.trim() ||
        (body.kind === "ids" ? "specification.ids" : "check.py"),
      content: body.content,
    };
  }

  /**
   * Action ändern (Name, runOnCommit, optional neuer Dateiinhalt); bei
   * Validierungsfehlern ist die Antwort schon gesendet (null zurück).
   */
  async function patchActionWithFile(
    action: Action,
    body: ActionPayload,
    reply: FastifyReply,
  ): Promise<Action | null> {
    if (body.name !== undefined && (!body.name.trim() || body.name.length > 100)) {
      reply.code(400).send({ error: "Name must not be empty (max 100)" });
      return null;
    }
    if (body.content !== undefined) {
      if (action.libraryFileId) {
        reply.code(400).send({
          error:
            "Datei kommt aus der Bibliothek — dort aktualisieren, nicht an der Action",
        });
        return null;
      }
      if (!body.content || body.content.length > ACTION_FILE_LIMIT) {
        reply.code(400).send({ error: "File empty or too large (max 5 MB)" });
        return null;
      }
      if (action.kind === "ids" && !body.content.includes("<ids")) {
        reply.code(400).send({ error: "Not an IDS XML file" });
        return null;
      }
      await store.put(
        action.fileKey,
        body.content,
        action.kind === "ids" ? "application/xml" : "text/x-python",
      );
    }
    const updated = await repo.updateAction(action.id, {
      name: body.name?.trim(),
      runOnCommit: body.runOnCommit,
      fileName: body.fileName?.trim() || undefined,
    });
    return updated ?? action;
  }

  /** Prüfdatei (Action oder Bibliothek) als Download ausliefern. */
  function sendCheckFile(
    file: { kind: Action["kind"]; fileName: string; fileKey: string },
    reply: FastifyReply,
  ) {
    return store.get(file.fileKey).then((buffer) =>
      reply
        .header(
          "content-type",
          file.kind === "ids" ? "application/xml" : "text/x-python",
        )
        .header("content-disposition", `attachment; filename="${file.fileName}"`)
        .send(buffer),
    );
  }

  /** Runs für die UI anreichern: Action, Modell, Auslöser — ohne Log. */
  async function enrichRuns(projectId: string, runs: ActionRun[]) {
    const actionById = new Map(
      (await repo.listActions(projectId)).map((action) => [action.id, action]),
    );
    const modelById = new Map(
      (await repo.listModels(projectId)).map((model) => [model.id, model]),
    );
    const users = await usersById(runs.map((run) => run.triggeredById));
    return runs.map((run) => {
      const { log: _log, ...rest } = run;
      const action = actionById.get(run.actionId);
      const model = modelById.get(run.modelId);
      const triggeredBy = users.get(run.triggeredById);
      return {
        ...rest,
        action: action
          ? { id: action.id, name: action.name, kind: action.kind }
          : null,
        model: model
          ? { id: model.id, slug: model.slug, name: model.name }
          : null,
        triggeredBy: triggeredBy ? publicUser(triggeredBy) : null,
      };
    });
  }

  /** Runs für die gegebenen Actions anlegen und einreihen. */
  async function queueRuns(
    project: Project,
    model: Model,
    commitId: string,
    actions: Action[],
    userId: string,
  ): Promise<ActionRun[]> {
    const runs: ActionRun[] = [];
    for (const action of actions) {
      const run = await repo.createActionRun({
        projectId: project.id,
        actionId: action.id,
        modelId: model.id,
        commitId,
        status: "queued",
        summary: "",
        log: "",
        failedGuids: [],
        triggeredById: userId,
        startedAt: null,
        finishedAt: null,
      });
      runner.enqueue(run.id);
      runs.push(run);
    }
    return runs;
  }

  app.get(`${api}/projects/:slug/actions`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const actions = await repo.listActions(project.id);
    const libraryById = new Map(
      (await repo.listLibraryFiles()).map((file) => [file.id, file]),
    );
    return reply.send({
      actions: actions.map((action) => ({
        ...publicAction(action),
        libraryName: action.libraryFileId
          ? libraryById.get(action.libraryFileId)?.name ?? null
          : null,
      })),
    });
  });

  app.post(`${api}/projects/:slug/actions`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const body = (request.body ?? {}) as ActionPayload & {
      libraryFileId?: string;
    };
    const name = body.name?.trim();
    if (!name || name.length > 100) {
      return reply.code(400).send({ error: "Name required (max 100)" });
    }
    const actionId = randomUUID();
    let action: Action;
    if (body.libraryFileId) {
      // Datei aus der zentralen Bibliothek referenzieren.
      const libraryFile = await repo.getLibraryFile(body.libraryFileId);
      if (!libraryFile) {
        return reply.code(400).send({ error: "Unknown library file id" });
      }
      action = await repo.createAction({
        id: actionId,
        projectId: project.id,
        name,
        kind: libraryFile.kind,
        fileKey: libraryFile.fileKey,
        fileName: libraryFile.fileName,
        libraryFileId: libraryFile.id,
        runOnCommit: Boolean(body.runOnCommit),
      });
    } else {
      const payload = validateNewAction(body, reply);
      if (!payload) return reply;
      const fileKey = actionFileKey(project.id, actionId);
      await store.put(
        fileKey,
        payload.content,
        payload.kind === "ids" ? "application/xml" : "text/x-python",
      );
      action = await repo.createAction({
        id: actionId,
        projectId: project.id,
        name: payload.name,
        kind: payload.kind,
        fileKey,
        fileName: payload.fileName,
        libraryFileId: null,
        runOnCommit: Boolean(body.runOnCommit),
      });
    }
    return reply.code(201).send({ action: publicAction(action) });
  });

  app.get(
    `${api}/projects/:slug/actions/:actionId/file`,
    async (request, reply) => {
      const { slug, actionId } = request.params as {
        slug: string;
        actionId: string;
      };
      const project = await resolveProject(slug, reply);
      if (!project) return reply;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!(await requireMember(project, user, reply, "read"))) return reply;
      const action = await repo.getAction(actionId);
      if (!action || action.projectId !== project.id) {
        return reply.code(404).send({ error: "Action not found" });
      }
      return sendCheckFile(action, reply);
    },
  );

  app.patch(`${api}/projects/:slug/actions/:actionId`, async (request, reply) => {
    const { slug, actionId } = request.params as {
      slug: string;
      actionId: string;
    };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const action = await repo.getAction(actionId);
    if (!action || action.projectId !== project.id) {
      return reply.code(404).send({ error: "Action not found" });
    }
    const updated = await patchActionWithFile(
      action,
      (request.body ?? {}) as ActionPayload,
      reply,
    );
    if (!updated) return reply;
    return reply.send({ action: publicAction(updated) });
  });

  app.delete(
    `${api}/projects/:slug/actions/:actionId`,
    async (request, reply) => {
      const { slug, actionId } = request.params as {
        slug: string;
        actionId: string;
      };
      const project = await resolveProject(slug, reply);
      if (!project) return reply;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!(await requireMember(project, user, reply, "write"))) return reply;
      const action = await repo.getAction(actionId);
      if (!action || action.projectId !== project.id) {
        return reply.code(404).send({ error: "Action not found" });
      }
      await repo.deleteAction(actionId);
      // Bibliotheksdateien gehören der Bibliothek — nur eigene Blobs löschen.
      if (!action.libraryFileId) {
        await store.delete(action.fileKey).catch(() => undefined);
      }
      return reply.code(204).send();
    },
  );

  // ---- Zentrale Skript-/IDS-Bibliothek (projektübergreifend) -----------
  // Jeder angemeldete Benutzer kann lesen und hochladen; ändern/löschen darf
  // der Eigentümer oder ein globaler Admin. Aktualisiert jemand die Datei,
  // gilt der neue Stand sofort in allen referenzierenden Actions.

  async function libraryUsage(fileIds: string[]): Promise<Map<string, number>> {
    const usage = new Map<string, number>();
    for (const id of fileIds) {
      usage.set(id, await repo.countActionsUsingLibraryFile(id));
    }
    return usage;
  }

  app.get(`${api}/library`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const files = await repo.listLibraryFiles();
    const usage = await libraryUsage(files.map((file) => file.id));
    const owners = await usersById(files.map((file) => file.ownerId));
    return reply.send({
      files: files.map(({ fileKey: _fileKey, ...file }) => ({
        ...file,
        usageCount: usage.get(file.id) ?? 0,
        owner: owners.get(file.ownerId)
          ? publicUser(owners.get(file.ownerId) as User)
          : null,
      })),
    });
  });

  app.post(`${api}/library`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const body = (request.body ?? {}) as ActionPayload;
    const payload = validateNewAction(body, reply);
    if (!payload) return reply;
    const fileId = randomUUID();
    const fileKey = libraryFileKey(fileId);
    await store.put(
      fileKey,
      payload.content,
      payload.kind === "ids" ? "application/xml" : "text/x-python",
    );
    const file = await repo.createLibraryFile({
      id: fileId,
      name: payload.name,
      kind: payload.kind,
      fileKey,
      fileName: payload.fileName,
      ownerId: user.id,
    });
    const { fileKey: _fileKey, ...rest } = file;
    return reply.code(201).send({ file: { ...rest, usageCount: 0 } });
  });

  /** Bibliotheksdatei laden + Schreibrecht (Eigentümer/Admin) prüfen. */
  async function resolveLibraryFile(
    fileId: string,
    user: User,
    reply: FastifyReply,
    forWrite: boolean,
  ) {
    const file = await repo.getLibraryFile(fileId);
    if (!file) {
      reply.code(404).send({ error: "Library file not found" });
      return null;
    }
    if (forWrite && file.ownerId !== user.id && !user.isAdmin) {
      reply.code(403).send({ error: "Only the owner or an admin may modify" });
      return null;
    }
    return file;
  }

  app.get(`${api}/library/:fileId/file`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const { fileId } = request.params as { fileId: string };
    const file = await resolveLibraryFile(fileId, user, reply, false);
    if (!file) return reply;
    return sendCheckFile(file, reply);
  });

  app.patch(`${api}/library/:fileId`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const { fileId } = request.params as { fileId: string };
    const file = await resolveLibraryFile(fileId, user, reply, true);
    if (!file) return reply;
    const body = (request.body ?? {}) as {
      name?: string;
      fileName?: string;
      content?: string;
    };
    if (body.name !== undefined && (!body.name.trim() || body.name.length > 100)) {
      return reply.code(400).send({ error: "Name must not be empty (max 100)" });
    }
    if (body.content !== undefined) {
      if (!body.content || body.content.length > ACTION_FILE_LIMIT) {
        return reply
          .code(400)
          .send({ error: "File empty or too large (max 5 MB)" });
      }
      if (file.kind === "ids" && !body.content.includes("<ids")) {
        return reply.code(400).send({ error: "Not an IDS XML file" });
      }
      await store.put(
        file.fileKey,
        body.content,
        file.kind === "ids" ? "application/xml" : "text/x-python",
      );
    }
    const updated = await repo.updateLibraryFile(fileId, {
      name: body.name?.trim(),
      fileName: body.fileName?.trim() || undefined,
    });
    if (!updated) {
      return reply.code(404).send({ error: "Library file not found" });
    }
    const { fileKey: _fileKey, ...rest } = updated;
    return reply.send({
      file: {
        ...rest,
        usageCount: await repo.countActionsUsingLibraryFile(fileId),
      },
    });
  });

  app.delete(`${api}/library/:fileId`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const { fileId } = request.params as { fileId: string };
    const file = await resolveLibraryFile(fileId, user, reply, true);
    if (!file) return reply;
    const usage = await repo.countActionsUsingLibraryFile(fileId);
    if (usage > 0) {
      return reply.code(409).send({
        error: `Datei wird von ${usage} Action(s) verwendet — erst dort entfernen`,
      });
    }
    await repo.deleteLibraryFile(fileId);
    await store.delete(file.fileKey).catch(() => undefined);
    return reply.code(204).send();
  });

  // Commit auf Knopfdruck prüfen: legt Runs für alle (oder die gewählten)
  // Actions des Projekts an und reiht sie ein.
  app.post(
    `${api}/projects/:slug/models/:model/commits/:commitId/validate`,
    async (request, reply) => {
      const { slug, model: modelSlug, commitId } = request.params as {
        slug: string;
        model: string;
        commitId: string;
      };
      const resolved = await resolveModel(slug, modelSlug, reply);
      if (!resolved) return reply;
      const { project, model } = resolved;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!(await requireMember(project, user, reply, "write"))) return reply;
      if (model.kind === "md") {
        return reply
          .code(400)
          .send({ error: "Markdown-Dateien können nicht validiert werden" });
      }
      const commit = await repo.getCommit(commitId);
      if (!commit || commit.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      const body = (request.body ?? {}) as { actionIds?: string[] };
      let actions = await repo.listActions(project.id);
      if (body.actionIds !== undefined) {
        const wanted = new Set(body.actionIds);
        actions = actions.filter((action) => wanted.has(action.id));
        if (actions.length !== wanted.size) {
          return reply.code(400).send({ error: "Unknown action id" });
        }
      }
      if (!actions.length) {
        return reply
          .code(400)
          .send({ error: "Keine Actions im Projekt konfiguriert" });
      }
      const runs = await queueRuns(project, model, commit.id, actions, user.id);
      return reply.code(201).send({ runs: await enrichRuns(project.id, runs) });
    },
  );

  app.get(`${api}/projects/:slug/runs`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const query = request.query as {
      commit?: string;
      action?: string;
      model?: string;
    };
    const runs = await repo.listActionRuns(project.id, {
      commitId: query.commit,
      actionId: query.action,
      modelId: query.model,
    });
    return reply.send({ runs: await enrichRuns(project.id, runs) });
  });

  app.get(`${api}/projects/:slug/runs/:runId`, async (request, reply) => {
    const { slug, runId } = request.params as { slug: string; runId: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const run = await repo.getActionRun(runId);
    if (!run || run.projectId !== project.id) {
      return reply.code(404).send({ error: "Run not found" });
    }
    const [enriched] = await enrichRuns(project.id, [run]);
    return reply.send({ run: { ...enriched, log: run.log } });
  });

  // ---- semantic diff ---------------------------------------------------

  app.get(`${api}/projects/:slug/models/:model/diff`, async (request, reply) => {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return reply;
    const { project, model } = resolved;
    if (!(await canReadModel(request, reply, project, model.visibility))) return reply;
    const query = request.query as { from?: string; to?: string };
    if (!query.from || !query.to) {
      return reply.code(400).send({ error: "from and to commit ids required" });
    }
    const from = await repo.getCommit(query.from);
    const to = await repo.getCommit(query.to);
    if (
      !from ||
      !to ||
      from.modelId !== model.id ||
      to.modelId !== model.id
    ) {
      return reply.code(404).send({ error: "Commit not found" });
    }
    return reply.send({ diff: await commits.getDiff(from, to) });
  });

  // Field-level detail for a single changed entity (what actually changed).
  app.get(
    `${api}/projects/:slug/models/:model/diff/entity`,
    async (request, reply) => {
      const { slug, model: modelSlug } = request.params as {
        slug: string;
        model: string;
      };
      const resolved = await resolveModel(slug, modelSlug, reply);
      if (!resolved) return reply;
      const { project, model } = resolved;
      if (!(await canReadModel(request, reply, project, model.visibility))) return reply;
      const query = request.query as {
        from?: string;
        to?: string;
        globalId?: string;
      };
      if (!query.from || !query.to || !query.globalId) {
        return reply
          .code(400)
          .send({ error: "from, to and globalId are required" });
      }
      const from = await repo.getCommit(query.from);
      const to = await repo.getCommit(query.to);
      if (!from || !to || from.modelId !== model.id || to.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      return reply.send({
        detail: await commits.getEntityDiff(from, to, query.globalId),
      });
    },
  );

  return app;
}
