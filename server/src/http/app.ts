import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";

import { hashPassword, verifyPassword } from "../auth/passwords";
import { CommitService } from "../domain/commitService";
import { FragmentsService } from "../domain/fragmentsService";
import type { ObjectStore } from "../storage/objectStore";
import {
  ADMIN_ROLES,
  type Commit,
  type Member,
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
  return { id: user.id, email: user.email, name: user.name };
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

  /** Vorschaubild eines Projekts (aus der 3D-Szene der Web-UI). */
  const projectImageKey = (projectId: string) => `projects/${projectId}/image.png`;

  /** Blob + zugehörigen Fragments-Cache löschen (best effort). */
  function deleteBlobsWithFragments(blobKeys: string[]): Promise<unknown> {
    return Promise.allSettled(
      blobKeys.flatMap((key) => [
        store.delete(key),
        store.delete(FragmentsService.fragKey(key)),
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
  // PNG-Uploads (Projektbild) als Buffer.
  app.addContentTypeParser(
    "image/png",
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
    const member = await repo.getMember(project.id, user.id);
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
  // Legacy path, kept for probes that predate the /api prefix.
  app.get("/health", async () => ({ status: "ok" }));

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

  // ---- projects --------------------------------------------------------

  app.get(`${api}/projects`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const projects = await repo.listProjectsForUser(user.id);
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
    const body = (request.body ?? {}) as { name?: string; slug?: string };
    if (!body.name) {
      return reply.code(400).send({ error: "name required" });
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
    const user = await optionalUser(request);
    const member = user ? await repo.getMember(project.id, user.id) : null;
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
   * Read access to a model: members always; everyone if it's public.
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
    const visible = member ? models : models.filter((m) => m.visibility === "public");
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
