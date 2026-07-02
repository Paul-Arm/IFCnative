import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";

import { hashPassword, verifyPassword } from "../auth/passwords";
import { CommitService } from "../domain/commitService";
import type { ObjectStore } from "../storage/objectStore";
import {
  type Member,
  type Project,
  type Repository,
  type Role,
  type User,
  WRITE_ROLES,
} from "../repository/types";

export interface AppDeps {
  repo: Repository;
  store: ObjectStore;
  jwtSecret: string;
}

interface JwtPayload {
  sub: string;
  email: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { repo, store, jwtSecret } = deps;
  const commits = new CommitService(repo, store);

  const app = Fastify({ logger: false });

  app.register(jwt, { secret: jwtSecret });
  app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024 } });

  // Serve the standalone web portal (client-less access) from server/public.
  app.register(fastifyStatic, {
    root: join(dirname(fileURLToPath(import.meta.url)), "../../public"),
    prefix: "/",
  });

  // Accept raw IFC/STEP request bodies as strings.
  app.addContentTypeParser(
    ["text/plain", "application/octet-stream", "application/x-step"],
    { parseAs: "string" },
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
    write: boolean,
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
    if (write && !WRITE_ROLES.has(member.role)) {
      reply.code(403).send({ error: "Insufficient role" });
      return null;
    }
    return member;
  }

  // ---- auth routes -----------------------------------------------------

  app.post("/auth/register", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: string;
      name?: string;
      password?: string;
    };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: "email and password required" });
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

  app.post("/auth/login", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string; password?: string };
    const user = body.email ? await repo.getUserByEmail(body.email) : null;
    if (!user || !body.password || !verifyPassword(body.password, user.passwordHash)) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    const token = app.jwt.sign({ sub: user.id, email: user.email });
    return reply.send({ token, user: publicUser(user) });
  });

  app.get("/me", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    return reply.send({ user: publicUser(user) });
  });

  // ---- projects --------------------------------------------------------

  app.get("/projects", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    return reply.send({ projects: await repo.listProjectsForUser(user.id) });
  });

  app.post("/projects", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const body = (request.body ?? {}) as { name?: string; slug?: string };
    if (!body.name) {
      return reply.code(400).send({ error: "name required" });
    }
    const slug = slugify(body.slug ?? body.name);
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

  app.get("/projects/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await optionalUser(request);
    const member = user ? await repo.getMember(project.id, user.id) : null;
    return reply.send({
      project,
      members: await repo.listMembers(project.id),
      role: member?.role ?? null,
    });
  });

  app.post("/projects/:slug/members", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const member = await requireMember(project, user, reply, true);
    if (!member) return reply;
    const body = (request.body ?? {}) as { email?: string; role?: Role };
    const target = body.email ? await repo.getUserByEmail(body.email) : null;
    if (!target) {
      return reply.code(404).send({ error: "User not found" });
    }
    const added = await repo.addMember({
      projectId: project.id,
      userId: target.id,
      role: body.role ?? "contributor",
    });
    return reply.code(201).send({ member: added });
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

  app.get("/projects/:slug/models", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await optionalUser(request);
    const member = user ? await repo.getMember(project.id, user.id) : null;
    const models = await repo.listModels(project.id);
    return reply.send({
      models: member ? models : models.filter((m) => m.visibility === "public"),
    });
  });

  app.post("/projects/:slug/models", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, true))) return reply;
    const body = (request.body ?? {}) as {
      name?: string;
      slug?: string;
      visibility?: "private" | "public";
    };
    if (!body.name) {
      return reply.code(400).send({ error: "name required" });
    }
    const modelSlug = slugify(body.slug ?? body.name);
    if (await repo.getModel(project.id, modelSlug)) {
      return reply.code(409).send({ error: "Model slug taken" });
    }
    const model = await repo.createModel({
      projectId: project.id,
      slug: modelSlug,
      name: body.name,
      visibility: body.visibility ?? "private",
      defaultBranch: "main",
    });
    return reply.code(201).send({ model });
  });

  app.get("/projects/:slug/models/:model", async (request, reply) => {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return reply;
    const { project, model } = resolved;
    const user = await optionalUser(request);
    const member = user ? await repo.getMember(project.id, user.id) : null;
    if (model.visibility !== "public" && !member) {
      return reply.code(403).send({ error: "Private model" });
    }
    return reply.send({
      model,
      branches: await repo.listBranches(model.id),
    });
  });

  // ---- commits (the core) ----------------------------------------------

  async function readIfcBody(request: FastifyRequest): Promise<string | null> {
    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) return null;
      const buffer = await file.toBuffer();
      return buffer.toString("utf8");
    }
    return typeof request.body === "string" ? request.body : null;
  }

  app.post(
    "/projects/:slug/models/:model/commits",
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
      if (!(await requireMember(project, user, reply, true))) return reply;

      const query = request.query as { branch?: string; message?: string };
      const ifcText = await readIfcBody(request);
      if (!ifcText || !ifcText.includes("ISO-10303-21")) {
        return reply.code(400).send({ error: "Valid IFC/STEP body required" });
      }

      const result = await commits.createCommit({
        model,
        branchName: query.branch ?? model.defaultBranch,
        ifcText,
        authorId: user.id,
        message: query.message ?? "",
      });
      return reply.code(201).send(result);
    },
  );

  app.get("/projects/:slug/models/:model/commits", async (request, reply) => {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return reply;
    const { project, model } = resolved;
    const user = await optionalUser(request);
    const member = user ? await repo.getMember(project.id, user.id) : null;
    if (model.visibility !== "public" && !member) {
      return reply.code(403).send({ error: "Private model" });
    }
    const query = request.query as { branch?: string };
    return reply.send({
      commits: await repo.listCommits(model.id, query.branch),
    });
  });

  app.get(
    "/projects/:slug/models/:model/commits/:commitId",
    async (request, reply) => {
      const { slug, model: modelSlug, commitId } = request.params as {
        slug: string;
        model: string;
        commitId: string;
      };
      const resolved = await resolveModel(slug, modelSlug, reply);
      if (!resolved) return reply;
      const { project, model } = resolved;
      const user = await optionalUser(request);
      const member = user ? await repo.getMember(project.id, user.id) : null;
      if (model.visibility !== "public" && !member) {
        return reply.code(403).send({ error: "Private model" });
      }
      const commit = await repo.getCommit(commitId);
      if (!commit || commit.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      return reply.send({ commit });
    },
  );

  app.get(
    "/projects/:slug/models/:model/commits/:commitId/file",
    async (request, reply) => {
      const { slug, model: modelSlug, commitId } = request.params as {
        slug: string;
        model: string;
        commitId: string;
      };
      const resolved = await resolveModel(slug, modelSlug, reply);
      if (!resolved) return reply;
      const { project, model } = resolved;
      const user = await optionalUser(request);
      const member = user ? await repo.getMember(project.id, user.id) : null;
      if (model.visibility !== "public" && !member) {
        return reply.code(403).send({ error: "Private model" });
      }
      const commit = await repo.getCommit(commitId);
      if (!commit || commit.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      const buffer = await commits.downloadIfc(commit);
      return reply
        .header("content-type", "application/x-step")
        .header(
          "content-disposition",
          `attachment; filename="${modelSlug}-${commitId}.ifc"`,
        )
        .send(buffer);
    },
  );

  // ---- semantic diff ---------------------------------------------------

  app.get("/projects/:slug/models/:model/diff", async (request, reply) => {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return reply;
    const { project, model } = resolved;
    const user = await optionalUser(request);
    const member = user ? await repo.getMember(project.id, user.id) : null;
    if (model.visibility !== "public" && !member) {
      return reply.code(403).send({ error: "Private model" });
    }
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
  app.get("/projects/:slug/models/:model/diff/entity", async (request, reply) => {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return reply;
    const { project, model } = resolved;
    const user = await optionalUser(request);
    const member = user ? await repo.getMember(project.id, user.id) : null;
    if (model.visibility !== "public" && !member) {
      return reply.code(403).send({ error: "Private model" });
    }
    const query = request.query as { from?: string; to?: string; globalId?: string };
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
  });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
