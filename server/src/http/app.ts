import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";

import { hashPassword, verifyPassword } from "../auth/passwords";
import {
  ActionRunner,
  isTerminalRunStatus,
  type RunEvent,
} from "../domain/actionRunner";
import {
  buildBcfZip,
  normalizeModelFileName,
  parseBcfZip,
  stripModelFileExt,
  type BcfTopicInput,
  type ParsedBcfTopic,
} from "../domain/bcfService";
import {
  CHANGES_PAGE_LIMIT_DEFAULT,
  changesGuids,
  changesOverview,
  changesPageEntries,
  withDetails,
  type ChangesQuery,
} from "../domain/changesView";
import { CommitService } from "../domain/commitService";
import {
  DIFF_PAGE_LIMIT_DEFAULT,
  diffOverview,
  diffPage,
} from "../domain/diffView";
import { contentTypeForFileName, fileExtension } from "../domain/fileTypes";
import { FragmentsService } from "../domain/fragmentsService";
import { IfcWorkerPool, defaultIfcWorkerPool } from "../domain/ifcWorkerPool";
import type { ObjectStore } from "../storage/objectStore";
import { registerRequestLog } from "./requestLog";
import {
  actionAppliesTo,
  ADMIN_ROLES,
  ALL_ROLES,
  emptyProjectSummary,
  type Action,
  type ActionRun,
  type Commit,
  type Issue,
  type IssueEvent,
  type IssueEventData,
  type IssueEventKind,
  type IssueLinks,
  type Label,
  type Member,
  type Model,
  type ModelKind,
  type Project,
  type RecentQuery,
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
  /** Metadaten-DB für die Admin-Systemübersicht (Standard: "memory"). */
  databaseMode?: "sqlite" | "postgres" | "memory";
  /** Führt Action-Runs aus; ohne Angabe wird ein Standard-Runner gebaut. */
  runner?: ActionRunner;
  /** Worker-Pool für Parsing/Konvertierung; Standard: prozessweiter Pool. */
  workers?: IfcWorkerPool;
  /** Jede Anfrage als Zeile auf stdout protokollieren (Default: an). */
  logRequests?: boolean;
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

type PublicUser = ReturnType<typeof publicUser>;

/** Art eines Eintrags im Aktivitäts-Feed. */
type ActivityType =
  | "commit"
  | "issue_opened"
  | "issue_closed"
  | "issue_reopened"
  | "comment"
  | "run"
  | "project_created";

/** Eintrag im Aktivitäts-Feed (`GET /api/activity`). */
interface ActivityEvent {
  /** Eindeutig über alle Quellen, z. B. `commit:<commitId>`. */
  id: string;
  type: ActivityType;
  /** Zeitpunkt für die Sortierung (neueste zuerst). */
  at: string;
  actor: PublicUser | null;
  project: { slug: string; name: string };
  model?: { slug: string; name: string; kind: ModelKind; folder: string };
  commit?: {
    id: string;
    message: string;
    branchName: string;
    added: number;
    removed: number;
    modified: number;
    schema: string;
  };
  issue?: {
    number: number;
    title: string;
    state: Issue["state"];
    kind: Issue["kind"];
  };
  comment?: { id: string; excerpt: string };
  run?: {
    id: string;
    number: number;
    status: string;
    summary: string;
    actionName: string;
    commitId: string;
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ganzzahliger Query-Parameter, auf [min, max] begrenzt; fehlt/ungültig: `fallback`. */
function intParam(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = raw === undefined || raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Freitext (Beschreibung): String, getrimmt, höchstens `max` Zeichen — sonst null. */
function normalizeText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const text = raw.trim();
  return text.length <= max ? text : null;
}

/**
 * Kurzfassung eines Markdown-Texts für Feeds: Syntax grob entfernt,
 * Leerraum zusammengefasst, höchstens `max` Zeichen (dann mit "…").
 */
function markdownExcerpt(markdown: string, max = 160): string {
  const plain = markdown
    .replace(/```[^\n]*\n?/g, " ") // Code-Fences (Inhalt bleibt)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // Bilder -> Alt-Text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // Links -> Linktext
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "") // Überschriften, Zitate, Listen
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2") // fett, durchgestrichen
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2") // kursiv
    .replace(/`([^`]*)`/g, "$1") // Inline-Code
    .replace(/<[^>]+>/g, " ") // HTML-Tags
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...plain];
  return chars.length > max
    ? `${chars.slice(0, max).join("").trimEnd()}…`
    : plain;
}

/** Jüngster von mehreren ISO-Zeitpunkten; null/undefined zählen nicht. */
function latestTimestamp(...values: (string | null | undefined)[]): string {
  return values.reduce<string>(
    (latest, value) => (value && value > latest ? value : latest),
    "",
  );
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
  const workers = deps.workers ?? defaultIfcWorkerPool();
  const commits = new CommitService(repo, store, workers);
  const fragmentsService = new FragmentsService(store, workers);
  const runner = deps.runner ?? new ActionRunner(repo, store, { workers });

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

  // Hinter Traefik/Dokploy steht die Client-IP in X-Forwarded-For; mit
  // trustProxy liefert request.ip diese statt der Proxy-Adresse.
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 512 * 1024 * 1024,
  });
  registerRequestLog(app, { requests: deps.logRequests ?? true });

  // Beim Start liegengebliebene Runs aufräumen: "running" kann nach einem
  // Neustart nie mehr fertig werden, "queued" wird neu eingereiht.
  app.addHook("onReady", async () => {
    const { interrupted, requeued } = await runner.recover();
    if (interrupted || requeued) {
      console.log(
        `Action-Runs nach Neustart: ${interrupted} unterbrochen markiert, ${requeued} neu eingereiht`,
      );
    }
  });

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
    ["text/plain", "application/x-step", "text/markdown"],
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );
  // PNG-Uploads (Projektbild), Zip-Uploads (BCF-Import) und octet-stream
  // (Rohupload beliebiger Dateien) als Buffer — als String geparst würde
  // Fastify Binärdaten mit FST_ERR_CTP_INVALID_CONTENT_LENGTH abweisen.
  app.addContentTypeParser(
    ["image/png", "application/zip", "application/octet-stream"],
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  // Alle übrigen Typen (PDF, Word, DWG, …) für Datei-Modelle als Rohbytes.
  app.addContentTypeParser(
    "*",
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

  /**
   * Projekte, die der Benutzer sieht: eigene (Mitgliedschaft) plus alle
   * öffentlichen; globale Admins sehen alles.
   */
  async function accessibleProjects(user: User): Promise<Project[]> {
    if (user.isAdmin) {
      return repo.listAllProjects();
    }
    const mine = await repo.listProjectsForUser(user.id);
    const seen = new Set(mine.map((project) => project.id));
    return [
      ...mine,
      ...(await repo.listPublicProjects()).filter(
        (project) => !seen.has(project.id),
      ),
    ];
  }

  /**
   * Projekte für Listen anreichern: Rolle des Benutzers, Kennzahlen,
   * letzte Aktivität (Commit, Issue-Änderung oder Anlage) und Projektbild.
   */
  async function enrichProjects(user: User, projects: Project[]) {
    const summaries = await repo.projectSummaries(
      projects.map((project) => project.id),
    );
    return Promise.all(
      projects.map(async (project) => {
        const member = await repo.getMember(project.id, user.id);
        const summary = summaries.get(project.id) ?? emptyProjectSummary();
        return {
          ...project,
          role: member?.role ?? null,
          modelCount: summary.modelCount,
          memberCount: summary.memberCount,
          openIssueCount: summary.openIssueCount,
          lastActivityAt: latestTimestamp(
            project.createdAt,
            summary.lastCommitAt,
            summary.lastIssueAt,
          ),
          hasImage: await store.exists(projectImageKey(project.id)),
        };
      }),
    );
  }

  /**
   * Geltungsbereich der projektübergreifenden Übersichten: alle zugänglichen
   * Projekte oder nur das per `?project=` gewählte — 404, wenn es fehlt oder
   * nicht zugänglich ist (private Projekte existieren für Fremde nicht).
   * null = Antwort schon gesendet.
   */
  async function projectScope(
    user: User,
    slug: string | undefined,
    reply: FastifyReply,
  ): Promise<Project[] | null> {
    const projects = await accessibleProjects(user);
    if (!slug) {
      return projects;
    }
    const project = projects.find((entry) => entry.slug === slug);
    if (!project) {
      reply.code(404).send({ error: "Project not found" });
      return null;
    }
    return [project];
  }

  /**
   * `?user=` der Übersichten: "me" = der Angemeldete, sonst eine
   * Benutzer-Id; fehlt er, zählen alle. null = 400 schon gesendet.
   */
  function resolveActor(
    user: User,
    raw: string | undefined,
    reply: FastifyReply,
  ): { actorId: string | undefined } | null {
    if (!raw) {
      return { actorId: undefined };
    }
    if (raw === "me") {
      return { actorId: user.id };
    }
    if (!UUID_PATTERN.test(raw)) {
      reply.code(400).send({ error: "user must be 'me' or a user id" });
      return null;
    }
    return { actorId: raw.toLowerCase() };
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

  // Systemübersicht (Version, Speicher, Laufzeit, Warteschlangen, Mengen).
  app.get(`${api}/admin/system`, async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return reply;
    const memory = process.memoryUsage();
    return reply.send({
      version: SERVER_VERSION,
      storage: deps.storageMode ?? "filesystem",
      database: deps.databaseMode ?? "memory",
      node: process.version,
      uptimeSec: Math.floor(process.uptime()),
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
      },
      workers: workers.size,
      runner: {
        queued: runner.queueLength,
        running: runner.isRunning ? 1 : 0,
      },
      counts: await repo.counts(),
    });
  });

  // ---- projects --------------------------------------------------------

  app.get(`${api}/projects`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    // Eigene Projekte plus alle oeffentlichen; globale Admins sehen alles.
    const projects = await accessibleProjects(user);
    return reply.send({ projects: await enrichProjects(user, projects) });
  });

  app.post(`${api}/projects`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const body = (request.body ?? {}) as {
      name?: string;
      slug?: string;
      visibility?: "private" | "public";
      description?: unknown;
    };
    if (!body.name) {
      return reply.code(400).send({ error: "name required" });
    }
    if (body.visibility && !["private", "public"].includes(body.visibility)) {
      return reply.code(400).send({ error: "Invalid visibility" });
    }
    const description =
      body.description === undefined
        ? ""
        : normalizeText(body.description, 500);
    if (description === null) {
      return reply
        .code(400)
        .send({ error: "Description must be text (max 500 characters)" });
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
      description,
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
      project: { ...project, hasImage: await store.exists(projectImageKey(project.id)) },
      members: members.map((m) => {
        const memberUser = users.get(m.userId);
        return { ...m, user: memberUser ? publicUser(memberUser) : null };
      }),
      role: member?.role ?? null,
      folders: await collectFolders(project.id),
    });
  });

  // Kennzahlen für die Projektübersicht (Commits, Beitragende, Dateiarten,
  // Issues, Runs, letzter Commit, Objekte in den Head-Ständen).
  app.get(`${api}/projects/:slug/stats`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const [models, summaries, authorCounts, runCounts, latest, folders] =
      await Promise.all([
        repo.listModels(project.id),
        repo.projectSummaries([project.id]),
        repo.countCommitsByAuthor(project.id),
        repo.countActionRunsByStatus(project.id),
        repo.listRecentCommits([project.id], { limit: 1 }),
        collectFolders(project.id),
      ]);
    const summary = summaries.get(project.id) ?? emptyProjectSummary();

    // Branches zählen; Objekte = Summe der Head-Commits (Standard-Branch)
    // aller IFC-Modelle.
    let branchCount = 0;
    const headIds: string[] = [];
    for (const model of models) {
      const branches = await repo.listBranches(model.id);
      branchCount += branches.length;
      const head = branches.find(
        (branch) => branch.name === model.defaultBranch,
      )?.headCommitId;
      if (model.kind === "ifc" && head) {
        headIds.push(head);
      }
    }
    const heads = await commitsById(headIds);
    const entityCount = headIds.reduce(
      (sum, id) => sum + (heads.get(id)?.entityCount ?? 0),
      0,
    );

    // Dateiarten: IFC/Markdown nach Art, beliebige Dateien nach Endung.
    const kinds = new Map<
      string,
      { kind: ModelKind; extension: string; count: number }
    >();
    for (const model of models) {
      const extension =
        model.kind === "file" ? fileExtension(model.name) : model.kind;
      const key = `${model.kind}:${extension}`;
      const entry = kinds.get(key) ?? { kind: model.kind, extension, count: 0 };
      entry.count += 1;
      kinds.set(key, entry);
    }

    const runs = {
      total: 0,
      success: 0,
      failed: 0,
      error: 0,
      running: 0,
      queued: 0,
      cancelled: 0,
    };
    for (const [status, count] of runCounts) {
      if (status in runs) runs[status] += count;
      runs.total += count;
    }

    const authors = await usersById(authorCounts.map((entry) => entry.authorId));
    const [last] = latest;
    const [lastWithAuthor] = last ? await withAuthors([last.commit]) : [];
    return reply.send({
      commitCount: summary.commitCount,
      branchCount,
      contributors: authorCounts.map((entry) => {
        const author = authors.get(entry.authorId);
        return {
          user: author ? publicUser(author) : null,
          commits: entry.count,
        };
      }),
      kinds: [...kinds.values()].sort(
        (a, b) =>
          b.count - a.count ||
          a.kind.localeCompare(b.kind) ||
          a.extension.localeCompare(b.extension),
      ),
      issues: {
        open: summary.openIssueCount,
        closed: summary.closedIssueCount,
      },
      runs,
      lastCommit:
        last && lastWithAuthor
          ? {
              ...lastWithAuthor,
              model: {
                slug: last.model.slug,
                name: last.model.name,
                kind: last.model.kind,
                folder: last.model.folder,
              },
            }
          : null,
      entityCount,
      modelCount: models.length,
      folderCount: folders.length,
      memberCount: summary.memberCount,
    });
  });

  // ---- Labels + Issues (wie GitHub) ------------------------------------

  const LABEL_COLOR = /^#[0-9a-fA-F]{6}$/;

  interface LabelBody {
    name?: unknown;
    color?: unknown;
    description?: unknown;
  }

  /**
   * Label-Felder prüfen — beim Anlegen (`existing` null) sind Name und Farbe
   * Pflicht, beim Ändern ist alles optional. Name 1..40 Zeichen und im
   * Projekt eindeutig (ohne Groß-/Kleinschreibung, das Label selbst
   * ausgenommen), Farbe #rrggbb, Beschreibung max. 100 Zeichen.
   * null = Antwort schon gesendet.
   */
  async function validateLabelBody(
    project: Project,
    body: LabelBody,
    existing: Label | null,
    reply: FastifyReply,
  ): Promise<Partial<Pick<Label, "name" | "color" | "description">> | null> {
    const fields: Partial<Pick<Label, "name" | "color" | "description">> = {};
    if (existing === null || body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 40) {
        reply.code(400).send({ error: "Label name required (max 40)" });
        return null;
      }
      fields.name = name;
    }
    if (existing === null || body.color !== undefined) {
      if (typeof body.color !== "string" || !LABEL_COLOR.test(body.color)) {
        reply.code(400).send({ error: "Color required (#rrggbb)" });
        return null;
      }
      fields.color = body.color;
    }
    if (body.description !== undefined) {
      const description = normalizeText(body.description, 100);
      if (description === null) {
        reply
          .code(400)
          .send({ error: "Description must be text (max 100 characters)" });
        return null;
      }
      fields.description = description;
    }
    if (fields.name !== undefined) {
      const lower = fields.name.toLowerCase();
      const taken = (await repo.listLabels(project.id)).some(
        (label) => label.id !== existing?.id && label.name.toLowerCase() === lower,
      );
      if (taken) {
        reply.code(409).send({ error: "Label name taken" });
        return null;
      }
    }
    return fields;
  }

  /** Label des Projekts laden; 404, wenn es fehlt oder woanders hingehört. */
  async function resolveLabel(
    project: Project,
    labelId: string,
    reply: FastifyReply,
  ): Promise<Label | null> {
    // Keine UUID: Postgres würde am uuid-Vergleich scheitern (500 statt 404).
    const label = UUID_PATTERN.test(labelId) ? await repo.getLabel(labelId) : null;
    if (!label || label.projectId !== project.id) {
      reply.code(404).send({ error: "Label not found" });
      return null;
    }
    return label;
  }

  app.get(`${api}/projects/:slug/labels`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const [labels, openCounts] = await Promise.all([
      repo.listLabels(project.id),
      repo.countOpenIssuesByLabel(project.id),
    ]);
    // issueCount = offene Issues mit diesem Label.
    return reply.send({
      labels: labels.map((label) => ({
        ...label,
        issueCount: openCounts.get(label.id) ?? 0,
      })),
    });
  });

  app.post(`${api}/projects/:slug/labels`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const fields = await validateLabelBody(
      project,
      (request.body ?? {}) as LabelBody,
      null,
      reply,
    );
    if (!fields) return reply;
    const label = await repo.createLabel({
      projectId: project.id,
      name: fields.name!,
      color: fields.color!,
      description: fields.description,
    });
    return reply.code(201).send({ label });
  });

  app.patch(
    `${api}/projects/:slug/labels/:labelId`,
    async (request, reply) => {
      const { slug, labelId } = request.params as {
        slug: string;
        labelId: string;
      };
      const project = await resolveProject(slug, reply);
      if (!project) return reply;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!(await requireMember(project, user, reply, "write"))) return reply;
      const label = await resolveLabel(project, labelId, reply);
      if (!label) return reply;
      const fields = await validateLabelBody(
        project,
        (request.body ?? {}) as LabelBody,
        label,
        reply,
      );
      if (!fields) return reply;
      const updated = await repo.updateLabel(label.id, fields);
      return reply.send({ label: updated ?? label });
    },
  );

  // Label löschen — verschwindet dabei von allen Issues.
  app.delete(
    `${api}/projects/:slug/labels/:labelId`,
    async (request, reply) => {
      const { slug, labelId } = request.params as {
        slug: string;
        labelId: string;
      };
      const project = await resolveProject(slug, reply);
      if (!project) return reply;
      const user = await requireUser(request, reply);
      if (!user) return reply;
      if (!(await requireMember(project, user, reply, "write"))) return reply;
      const label = await resolveLabel(project, labelId, reply);
      if (!label) return reply;
      await repo.deleteLabel(label.id);
      return reply.code(204).send();
    },
  );

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
    // Unter-Issues: Eltern-Kurzinfo + Zähler (offen/gesamt) je Issue.
    const allIssues = await repo.listIssues(projectId);
    const issueById = new Map(allIssues.map((entry) => [entry.id, entry]));
    const childCounts = new Map<string, { total: number; open: number }>();
    for (const entry of allIssues) {
      if (!entry.parentId) continue;
      const counts = childCounts.get(entry.parentId) ?? { total: 0, open: 0 };
      counts.total += 1;
      if (entry.state === "open") counts.open += 1;
      childCounts.set(entry.parentId, counts);
    }
    const parentRef = (id: string | null) => {
      const parent = id ? issueById.get(id) : undefined;
      return parent
        ? {
            id: parent.id,
            number: parent.number,
            title: parent.title,
            state: parent.state,
          }
        : null;
    };
    // Kommentarzahl je Issue — eine gruppierte Abfrage statt je Issue.
    const commentCounts = await repo.countIssueComments(
      issues.map((issue) => issue.id),
    );
    return issues.map((issue) => {
      const link = links.get(issue.id);
      const author = users.get(issue.authorId);
      const counts = childCounts.get(issue.id) ?? { total: 0, open: 0 };
      return {
        ...issue,
        parent: parentRef(issue.parentId),
        subIssueCount: counts.total,
        openSubIssueCount: counts.open,
        commentCount: commentCounts.get(issue.id) ?? 0,
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

  /**
   * Übergeordnetes Issue aus dem Request prüfen: muss im selben Projekt
   * liegen, darf nicht das Issue selbst sein und keinen Zyklus bilden.
   * null = Top-Level. Gibt undefined zurück, wenn die Antwort schon
   * gesendet wurde.
   */
  async function resolveParentId(
    project: Project,
    raw: unknown,
    selfId: string | null,
    reply: FastifyReply,
  ): Promise<string | null | undefined> {
    if (raw === null) return null;
    if (typeof raw !== "string") {
      reply.code(400).send({ error: "parentId must be an issue id or null" });
      return undefined;
    }
    const parent = await repo.getIssueById(raw);
    if (!parent || parent.projectId !== project.id) {
      reply.code(400).send({ error: "Unknown parent issue" });
      return undefined;
    }
    if (selfId && parent.id === selfId) {
      reply
        .code(400)
        .send({ error: "Issue kann nicht sein eigenes Unter-Issue sein" });
      return undefined;
    }
    // Zyklus: Vorfahren des gewünschten Elternteils dürfen nicht das Issue sein.
    let cursor: Issue | null = parent;
    for (let depth = 0; cursor?.parentId && depth < 100; depth += 1) {
      if (selfId && cursor.parentId === selfId) {
        reply.code(400).send({ error: "Zyklus in Unter-Issues" });
        return undefined;
      }
      cursor = await repo.getIssueById(cursor.parentId);
    }
    return parent.id;
  }

  /**
   * Zeitleisten-Ereignisse einer Issue-Änderung: je tatsächlich geänderter
   * Eigenschaft eines, Namen als Schnappschuss. Reine Body-Änderungen und
   * geänderte Commit-Bezüge (aufgefallen/behoben in) erzeugen keines.
   */
  async function issueChangeEvents(
    project: Project,
    actorId: string,
    before: Issue,
    after: Issue,
    beforeLinks: IssueLinks,
    links: Partial<IssueLinks>,
  ): Promise<Omit<IssueEvent, "id" | "createdAt">[]> {
    const events: Omit<IssueEvent, "id" | "createdAt">[] = [];
    const record = (kind: IssueEventKind, data: IssueEventData = {}) => {
      events.push({ issueId: after.id, projectId: project.id, actorId, kind, data });
    };
    /** Hinzugekommene/entfernte Ids einer (ggf. ersetzten) Zuordnungs-Menge. */
    const changes = (
      previous: string[],
      next: string[] | undefined,
    ): { added: string[]; removed: string[] } => {
      if (next === undefined) {
        return { added: [], removed: [] };
      }
      const was = new Set(previous);
      const now = new Set(next);
      return {
        added: [...now].filter((id) => !was.has(id)),
        removed: [...was].filter((id) => !now.has(id)),
      };
    };

    if (after.title !== before.title) {
      record("renamed", { from: before.title, to: after.title });
    }
    if (after.kind !== before.kind) {
      record("kind_changed", { from: before.kind, to: after.kind });
    }
    if (after.parentId !== before.parentId) {
      const parent = after.parentId
        ? await repo.getIssueById(after.parentId)
        : null;
      record("parent_changed", {
        parent: parent ? { number: parent.number, title: parent.title } : null,
      });
    }

    const labels = changes(beforeLinks.labelIds, links.labelIds);
    if (labels.added.length || labels.removed.length) {
      const byId = new Map(
        (await repo.listLabels(project.id)).map((label) => [label.id, label]),
      );
      const snapshot = (ids: string[]) =>
        ids.flatMap((id) => {
          const label = byId.get(id);
          return label ? [{ id: label.id, name: label.name, color: label.color }] : [];
        });
      if (labels.added.length) {
        record("labeled", { labels: snapshot(labels.added) });
      }
      if (labels.removed.length) {
        record("unlabeled", { labels: snapshot(labels.removed) });
      }
    }

    const assignees = changes(beforeLinks.assigneeIds, links.assigneeIds);
    if (assignees.added.length || assignees.removed.length) {
      const users = await usersById([...assignees.added, ...assignees.removed]);
      const snapshot = (ids: string[]) =>
        ids.map((id) => ({ id, name: users.get(id)?.name ?? "" }));
      if (assignees.added.length) {
        record("assigned", { users: snapshot(assignees.added) });
      }
      if (assignees.removed.length) {
        record("unassigned", { users: snapshot(assignees.removed) });
      }
    }

    const models = changes(
      beforeLinks.models.map((link) => link.modelId),
      links.models?.map((link) => link.modelId),
    );
    if (models.added.length || models.removed.length) {
      const byId = new Map(
        (await repo.listModels(project.id)).map((model) => [model.id, model]),
      );
      const snapshot = (ids: string[]) =>
        ids.flatMap((id) => {
          const model = byId.get(id);
          return model ? [{ id: model.id, slug: model.slug, name: model.name }] : [];
        });
      if (models.added.length) {
        record("linked_model", { models: snapshot(models.added) });
      }
      if (models.removed.length) {
        record("unlinked_model", { models: snapshot(models.removed) });
      }
    }

    if (after.state !== before.state) {
      record(after.state === "closed" ? "closed" : "reopened");
    }
    return events;
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
      parentId?: string | null;
    } & IssueLinksBody;
    const title = body.title?.trim();
    if (!title || title.length > 200) {
      return reply.code(400).send({ error: "Title required (max 200)" });
    }
    if (body.kind !== undefined && !["virtual", "bcf"].includes(body.kind)) {
      return reply.code(400).send({ error: "kind must be 'virtual' or 'bcf'" });
    }
    const parentId =
      body.parentId === undefined
        ? null
        : await resolveParentId(project, body.parentId, null, reply);
    if (parentId === undefined) return reply;
    const links = await validateIssueLinks(project, body, reply);
    if (!links) return reply;
    // Issue + Zuordnungen atomar (inkl. Retry bei Nummern-Races).
    const issue = await repo.createIssueWithLinks(
      {
        projectId: project.id,
        title,
        body: body.body ?? "",
        state: "open",
        kind: (body.kind as Issue["kind"] | undefined) ?? "virtual",
        authorId: user.id,
        parentId,
      },
      links,
    );
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
    const children = (await repo.listIssues(project.id))
      .filter((entry) => entry.parentId === issue.id)
      .sort((a, b) => a.number - b.number);
    // Zeitleiste (geschlossen, umbenannt, Labels, …) mit Akteur.
    const events = await repo.listIssueEvents(issue.id);
    const actors = await usersById(events.map((event) => event.actorId));
    return reply.send({
      issue: enriched,
      subIssues: await enrichIssues(project.id, children),
      comments: await enrichComments(issue.id),
      events: events.map((event) => {
        const actor = actors.get(event.actorId);
        return { ...event, actor: actor ? publicUser(actor) : null };
      }),
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
      parentId?: string | null;
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
    const parentId =
      body.parentId === undefined
        ? undefined
        : await resolveParentId(project, body.parentId, issue.id, reply);
    if (body.parentId !== undefined && parentId === undefined) return reply;
    const links = await validateIssueLinks(project, body, reply);
    if (!links) return reply;
    // Vorher-Stand für die Zeitleiste festhalten — das MemoryRepository
    // ändert das Issue-Objekt beim Update in place.
    const before = { ...issue };
    const beforeLinks = (await repo.getIssueLinks([issue.id])).get(issue.id) ?? {
      assigneeIds: [],
      models: [],
      labelIds: [],
      guids: [],
    };
    // Änderung, Zuordnungen und Zeitleisten-Ereignisse atomar.
    const updated = await repo.transaction(async () => {
      const result = await repo.updateIssue(issue.id, {
        title: body.title?.trim(),
        body: body.body,
        state: body.state as "open" | "closed" | undefined,
        kind: body.kind as Issue["kind"] | undefined,
        parentId,
      });
      await repo.setIssueLinks(issue.id, links);
      const events = await issueChangeEvents(
        project,
        user.id,
        before,
        result ?? before,
        beforeLinks,
        links,
      );
      if (events.length) {
        await repo.createIssueEvents(events);
      }
      return result;
    });
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
    // Modell-Matching über die Header-Dateinamen: Name oder Slug, mit oder
    // ohne Endung, Pfadanteile ignoriert. Ohne Treffer und bei genau einem
    // IFC-Modell im Projekt wird dieses angenommen (Portal-BCFs nennen die
    // Datei meist ohne Endung).
    const models = await repo.listModels(project.id);
    const ifcModels = models.filter((model) => model.kind === "ifc");
    const modelIdByName = new Map<string, string>();
    for (const model of models) {
      modelIdByName.set(normalizeModelFileName(model.name), model.id);
      modelIdByName.set(normalizeModelFileName(model.slug), model.id);
    }
    const fallbackModelId = ifcModels.length === 1 ? ifcModels[0]!.id : null;
    const unmatchedFileNames = new Set<string>();
    const matchModels = (fileNames: string[]): string[] => {
      const ids = new Set<string>();
      for (const name of fileNames) {
        const id = modelIdByName.get(normalizeModelFileName(name));
        if (id) {
          ids.add(id);
        } else {
          unmatchedFileNames.add(name);
        }
      }
      if (!ids.size && fallbackModelId) {
        ids.add(fallbackModelId);
      }
      return [...ids];
    };

    // Head-Stand je Modell: Commit-Bezug ("aufgefallen in") und ein
    // Name→GlobalId-Index aus dem Manifest, damit Topics ohne Viewpoint
    // ("Betroffenes IFC-Objekt: 'US.04'") trotzdem verortet werden.
    interface HeadInfo {
      commitId: string | null;
      guidsByName: Map<string, string[]>;
    }
    const headInfoCache = new Map<string, Promise<HeadInfo>>();
    const headInfo = (modelId: string): Promise<HeadInfo> => {
      let cached = headInfoCache.get(modelId);
      if (!cached) {
        cached = (async () => {
          const model = models.find((entry) => entry.id === modelId);
          const branch = model
            ? await repo.getBranch(model.id, model.defaultBranch)
            : null;
          const commitId = branch?.headCommitId ?? null;
          const guidsByName = new Map<string, string[]>();
          if (commitId) {
            for (const entry of await repo.getManifest(commitId)) {
              const key = entry.name.trim().toLowerCase();
              if (!key) continue;
              const list = guidsByName.get(key) ?? [];
              list.push(entry.globalId);
              guidsByName.set(key, list);
            }
          }
          return { commitId, guidsByName };
        })();
        headInfoCache.set(modelId, cached);
      }
      return cached;
    };

    // Dedupe vorab: Topic-Guid als Issue-Id übernehmen (stabiler Re-Import);
    // bei Kollision im selben Projekt überspringen, sonst neue Id.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const pending: { topic: ParsedBcfTopic; id: string | undefined }[] = [];
    let skipped = 0;
    for (const topic of topics) {
      const existing = UUID.test(topic.guid)
        ? await repo.getIssueById(topic.guid)
        : null;
      if (existing?.projectId === project.id) {
        skipped += 1;
        continue;
      }
      pending.push({
        topic,
        id: UUID.test(topic.guid) && !existing ? topic.guid : undefined,
      });
    }
    if (!pending.length) {
      return reply
        .code(201)
        .send({ imported: 0, skipped, located: 0, parent: null });
    }

    // Alle Topics einer Datei hängen unter EINEM virtuellen Sammel-Issue —
    // das bündelt den Import (wie ein Prüfbericht) und zeigt die Objekte
    // aller Unter-Issues gesammelt im 3D-Viewer.
    const query = (request.query ?? {}) as { name?: string };
    const sourceName =
      (query.name ?? "").trim().slice(0, 120) ||
      topics.find((topic) => topic.fileNames.length)?.fileNames[0] ||
      null;
    const importedAt = new Date();
    const parent = await repo.createIssueWithLinks(
      {
        projectId: project.id,
        title: (sourceName
          ? `BCF-Import: ${stripModelFileExt(sourceName)}`
          : `BCF-Import vom ${importedAt.toLocaleDateString("de-DE")}`
        ).slice(0, 200),
        body: "",
        state: "open",
        kind: "virtual",
        authorId: user.id,
        parentId: null,
      },
      {},
    );

    const parentModelIds = new Set<string>();
    let imported = 0;
    let located = 0;
    for (const { topic, id } of pending) {
      const modelIds = matchModels(topic.fileNames);
      const guids = new Set(topic.guids);
      const modelLinks: IssueLinks["models"] = [];
      for (const modelId of modelIds) {
        const head = await headInfo(modelId);
        parentModelIds.add(modelId);
        modelLinks.push({
          modelId,
          foundCommitId: head.commitId,
          fixedCommitId: null,
        });
        for (const name of topic.objectNames) {
          for (const guid of head.guidsByName.get(name.toLowerCase()) ?? []) {
            guids.add(guid);
          }
        }
      }
      if (guids.size) {
        located += 1;
      }
      const issue = await repo.createIssueWithLinks(
        {
          id,
          projectId: project.id,
          title: topic.title.slice(0, 200),
          body: topic.description,
          state: topic.status,
          kind: "bcf",
          authorId: user.id,
          parentId: parent.id,
        },
        { guids: [...guids].slice(0, 500), models: modelLinks },
      );
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

    // Sammel-Issue: Modelle aller Unter-Issues verknüpfen (Viewer-Quellen)
    // und die Zusammenfassung als Beschreibung nachtragen.
    const parentModelLinks: IssueLinks["models"] = [];
    const modelLines: string[] = [];
    for (const modelId of parentModelIds) {
      const head = await headInfo(modelId);
      const model = models.find((entry) => entry.id === modelId);
      parentModelLinks.push({
        modelId,
        foundCommitId: head.commitId,
        fixedCommitId: null,
      });
      if (model) {
        modelLines.push(
          head.commitId
            ? `${model.name} (Stand \`${head.commitId.slice(0, 8)}\`)`
            : model.name,
        );
      }
    }
    const authors = new Set(
      pending
        .map(({ topic }) => topic.creationAuthor.trim())
        .filter((author) => author.length > 0),
    );
    const summary = [
      `BCF-2.1-Import${sourceName ? ` aus **${sourceName}**` : ""} am ${importedAt.toLocaleDateString("de-DE")} durch ${user.name}.`,
      `Jedes Topic ist ein Unter-Issue dieses Issues; die betroffenen Objekte aller Unter-Issues lassen sich hier gesammelt im 3D-Viewer markieren.`,
      ``,
      `- **Topics:** ${imported} importiert${skipped ? `, ${skipped} übersprungen (bereits vorhanden)` : ""}`,
      `- **3D-Verortung:** ${located} von ${imported} Unter-Issues mit Objekt-GUIDs`,
      authors.size ? `- **Erstellt von:** ${[...authors].join(", ")}` : null,
      modelLines.length
        ? `- **Modelle:** ${modelLines.join(", ")}`
        : `- **Modelle:** keines zugeordnet — Modell in der Sidebar verknüpfen, dann greift die 3D-Verortung der Unter-Issues`,
      unmatchedFileNames.size
        ? `- **Nicht zugeordnete Dateinamen:** ${[...unmatchedFileNames].map((name) => `\`${name}\``).join(", ")}${fallbackModelId ? " (einziges IFC-Modell des Projekts angenommen)" : ""}`
        : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
    await repo.updateIssue(parent.id, { body: summary });
    await repo.setIssueLinks(parent.id, { models: parentModelLinks });

    return reply.code(201).send({
      imported,
      skipped,
      located,
      parent: { id: parent.id, number: parent.number },
    });
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
    const role = body.role ?? "contributor";
    if (!ALL_ROLES.has(role)) {
      return reply.code(400).send({ error: "Invalid role" });
    }
    const target = body.email ? await repo.getUserByEmail(body.email) : null;
    if (!target) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (target.id === project.ownerId && role !== "owner") {
      return reply.code(400).send({ error: "Cannot change the owner's role" });
    }
    // Nur Owner vergeben oder entziehen die Owner-Rolle — sonst könnte sich
    // ein Maintainer selbst zum Owner machen und das Projekt löschen.
    const current = await repo.getMember(project.id, target.id);
    if ((role === "owner" || current?.role === "owner") && member.role !== "owner") {
      return reply.code(403).send({ error: "Only owners can grant or revoke the owner role" });
    }
    const added = await repo.addMember({
      projectId: project.id,
      userId: target.id,
      role,
    });
    return reply.code(201).send({ member: { ...added, user: publicUser(target) } });
  });

  app.delete(`${api}/projects/:slug/members/:userId`, async (request, reply) => {
    const { slug, userId } = request.params as { slug: string; userId: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const member = await requireMember(project, user, reply, "admin");
    if (!member) return reply;
    if (userId === project.ownerId) {
      return reply.code(400).send({ error: "Cannot remove the project owner" });
    }
    const target = await repo.getMember(project.id, userId);
    if (target?.role === "owner" && member.role !== "owner") {
      return reply.code(403).send({ error: "Only owners can remove owners" });
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
    // Wie canReadModel: globale Admins sehen alles, auch ohne Mitgliedschaft.
    const readAll =
      Boolean(member) ||
      Boolean(user?.isAdmin) ||
      (user !== null && project.visibility === "public");
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
      kind?: ModelKind;
    };
    if (!body.name) {
      return reply.code(400).send({ error: "name required" });
    }
    const kind = body.kind ?? "ifc";
    if (!["ifc", "md", "file"].includes(kind)) {
      return reply.code(400).send({ error: "Invalid kind (ifc, md or file)" });
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
  // Projekt-Einstellungen (Name, Sichtbarkeit, Beschreibung) — admin.
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
      description?: unknown;
    };
    if (body.visibility && !["private", "public"].includes(body.visibility)) {
      return reply.code(400).send({ error: "Invalid visibility" });
    }
    if (body.name !== undefined && !body.name.trim()) {
      return reply.code(400).send({ error: "Name must not be empty" });
    }
    // Beschreibung: "" löscht sie.
    const description =
      body.description === undefined
        ? undefined
        : normalizeText(body.description, 500);
    if (description === null) {
      return reply
        .code(400)
        .send({ error: "Description must be text (max 500 characters)" });
    }
    const updated = await repo.updateProject(project.id, {
      name: body.name?.trim(),
      visibility: body.visibility,
      description,
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
    /** Rohbytes — bleibt Buffer, damit 100-MB-IFCs nicht als String kopiert werden. */
    bytes: Buffer | null;
    fields: Record<string, string>;
    /** Dateiname des Multipart-Teils (bei Roh-Bodies unbekannt). */
    fileName: string | null;
  }

  /** Raw STEP body, or multipart with a `file` part plus text fields. */
  async function readIfcUpload(request: FastifyRequest): Promise<IfcUpload> {
    if (request.isMultipart()) {
      const file = await request.file();
      if (!file) return { bytes: null, fields: {}, fileName: null };
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
      return { bytes: buffer, fields, fileName: file.filename || null };
    }
    return {
      bytes:
        typeof request.body === "string"
          ? Buffer.from(request.body, "utf8")
          : Buffer.isBuffer(request.body)
            ? request.body
            : null,
      fields: {},
      fileName: null,
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

      const query = request.query as {
        branch?: string;
        message?: string;
        compact?: string;
        name?: string;
      };
      const upload = await readIfcUpload(request);
      if (upload.bytes === null || upload.bytes.length === 0) {
        return reply.code(400).send({ error: "File content required" });
      }
      if (model.kind === "md") {
        if (upload.bytes.length > 2 * 1024 * 1024) {
          return reply.code(400).send({ error: "Markdown too large (max 2 MB)" });
        }
      } else if (
        model.kind === "ifc" &&
        !upload.bytes.includes("ISO-10303-21")
      ) {
        return reply.code(400).send({ error: "Valid IFC/STEP body required" });
      } else if (model.kind === "file") {
        // Content-Type und Vorschau hängen an der Endung des Modellnamens —
        // eine neue Version muss dieselbe Dateiart sein (z. B. kein PDF in
        // "plan.dwg"). Roh-Bodies können den Namen per ?name= mitgeben.
        const uploadName = upload.fileName ?? query.name ?? null;
        const expected = fileExtension(model.name);
        if (uploadName && expected && fileExtension(uploadName) !== expected) {
          return reply.code(400).send({
            error: `Falsche Dateiart: „${model.name}“ erwartet eine .${expected}-Datei`,
          });
        }
      }

      const branchName =
        query.branch ?? upload.fields.branch ?? model.defaultBranch;
      if (!BRANCH_NAME.test(branchName)) {
        return reply.code(400).send({ error: "Invalid branch name" });
      }

      const result = await commits.createCommit({
        model,
        branchName,
        text: upload.bytes,
        authorId: user.id,
        message: query.message ?? upload.fields.message ?? "",
      });
      // Actions mit "bei Commit ausführen" automatisch starten — nur die,
      // deren Geltungsbereich das Modell abdeckt.
      if (model.kind === "ifc") {
        const autoActions = (await repo.listActions(project.id)).filter(
          (action) => action.runOnCommit && actionAppliesTo(action, model),
        );
        await queueRuns(project, model, result.commit.id, autoActions, user.id);
      }
      const [commit] = await withAuthors([result.commit]);
      if (query.compact) {
        // Web-UI: nur Zähler — der volle Entity-Diff eines großen Modells
        // wäre ein zweistelliges MB-JSON, das niemand anzeigt.
        return reply.code(201).send({
          commit,
          identical: result.diff.identical,
          unchanged: result.changes.unchanged,
        });
      }
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
      const fileName =
        model.kind === "file"
          ? model.name
          : `${modelSlug}-${commitId}.${model.kind === "md" ? "md" : "ifc"}`;
      return reply
        .header("content-type", contentTypeForFileName(fileName))
        .header(
          "content-disposition",
          `attachment; filename="${encodeURIComponent(fileName)}"`,
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
      if (model.kind !== "ifc") {
        return reply.code(400).send({ error: "Only IFC models have a 3D preview" });
      }
      const commit = await repo.getCommit(commitId);
      if (!commit || commit.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      const sendFragments = (buffer: Buffer) =>
        reply
          .header("content-type", "application/octet-stream")
          // Commits sind unveränderlich — der Browser darf hart cachen.
          .header("cache-control", "private, max-age=31536000, immutable")
          .send(buffer);
      const conversionError = (message: string) =>
        reply.code(500).send({
          error: `IFC-zu-Fragments-Konvertierung fehlgeschlagen: ${message}`,
        });

      const query = request.query as { wait?: string };
      if (query.wait === "1") {
        // Blockierende Variante (Skripte/Tests): wartet auf die Konvertierung.
        try {
          return sendFragments(await fragmentsService.getFragments(commit));
        } catch (error) {
          return conversionError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      // Standard: Konvertierung anstoßen und sofort antworten. Die UI fragt
      // per Polling nach — so hängt kein Request minutenlang am Socket, und
      // ein Proxy-Timeout bricht die Konvertierung nicht ab.
      const state = await fragmentsService.start(commit);
      if (state.state === "ready") {
        return sendFragments(await fragmentsService.getFragments(commit));
      }
      if (state.state === "error") {
        return conversionError(state.message || "unbekannter Fehler");
      }
      const startedAt =
        state.state === "converting" ? state.startedAt : new Date().toISOString();
      const elapsedMs = state.state === "converting" ? state.elapsedMs : 0;
      return reply
        .code(202)
        .header("retry-after", "3")
        .header("cache-control", "no-store")
        .send({ status: "converting", startedAt, elapsedMs });
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
    const modelById = new Map(
      (await repo.listModels(project.id)).map((model) => [model.id, model]),
    );
    return reply.send({
      actions: actions.map((action) => ({
        ...publicAction(action),
        libraryName: action.libraryFileId
          ? libraryById.get(action.libraryFileId)?.name ?? null
          : null,
        scopeModelName: action.scopeModelId
          ? modelById.get(action.scopeModelId)?.name ?? null
          : null,
      })),
    });
  });

  /**
   * Geltungsbereich aus dem Request lesen: höchstens eines von
   * scopeFolder/scopeModelId; Ordner normalisiert, Modell muss ein
   * IFC-Modell des Projekts sein. null = Antwort schon gesendet.
   */
  async function resolveActionScope(
    project: Project,
    body: { scopeFolder?: string; scopeModelId?: string },
    reply: FastifyReply,
  ): Promise<{ scopeFolder: string | null; scopeModelId: string | null } | null> {
    if (body.scopeFolder && body.scopeModelId) {
      reply
        .code(400)
        .send({ error: "Entweder Ordner ODER Modell als Geltungsbereich" });
      return null;
    }
    if (body.scopeModelId) {
      const models = await repo.listModels(project.id);
      const model = models.find((entry) => entry.id === body.scopeModelId);
      if (!model || model.kind !== "ifc") {
        reply.code(400).send({ error: "Unknown model id for scope" });
        return null;
      }
      return { scopeFolder: null, scopeModelId: model.id };
    }
    if (body.scopeFolder !== undefined && body.scopeFolder !== "") {
      const folder = normalizeFolderPath(body.scopeFolder);
      if (!folder) {
        reply.code(400).send({ error: "Invalid scope folder path" });
        return null;
      }
      return { scopeFolder: folder, scopeModelId: null };
    }
    return { scopeFolder: null, scopeModelId: null };
  }

  app.post(`${api}/projects/:slug/actions`, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const body = (request.body ?? {}) as ActionPayload & {
      libraryFileId?: string;
      scopeFolder?: string;
      scopeModelId?: string;
    };
    const name = body.name?.trim();
    if (!name || name.length > 100) {
      return reply.code(400).send({ error: "Name required (max 100)" });
    }
    const scope = await resolveActionScope(project, body, reply);
    if (!scope) return reply;
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
        ...scope,
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
        ...scope,
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
      if (model.kind !== "ifc") {
        return reply
          .code(400)
          .send({ error: "Nur IFC-Modelle können validiert werden" });
      }
      const commit = await repo.getCommit(commitId);
      if (!commit || commit.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      const body = (request.body ?? {}) as { actionIds?: string[] };
      // Nur Actions, deren Geltungsbereich dieses Modell abdeckt.
      let actions = (await repo.listActions(project.id)).filter((action) =>
        actionAppliesTo(action, model),
      );
      if (body.actionIds !== undefined) {
        const wanted = new Set(body.actionIds);
        actions = actions.filter((action) => wanted.has(action.id));
        if (actions.length !== wanted.size) {
          return reply
            .code(400)
            .send({ error: "Action unbekannt oder gilt nicht für dieses Modell" });
        }
      }
      if (!actions.length) {
        return reply
          .code(400)
          .send({ error: "Keine passenden Actions für dieses Modell" });
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

  /**
   * Live-Status + Log eines Runs als Server-Sent Events: sofort der aktuelle
   * Stand (inkl. Log), dann jede Ausgabezeile und jeder Statuswechsel, zum
   * Schluss `done`. Der Client liest den Stream per fetch (Bearer-Header
   * statt EventSource, das keine Header kann).
   */
  app.get(`${api}/projects/:slug/runs/:runId/events`, async (request, reply) => {
    const { slug, runId } = request.params as { slug: string; runId: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "read"))) return reply;
    const exists = await repo.getActionRun(runId);
    if (!exists || exists.projectId !== project.id) {
      return reply.code(404).send({ error: "Run not found" });
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let closed = false;
    // Bis der Erst-Snapshot raus ist, werden Ereignisse zurückgehalten —
    // sonst überschreibt der (ältere) Snapshot beim Client bereits
    // empfangene Log-Chunks.
    let snapshotSent = false;
    const backlog: string[] = [];
    const frameOf = (event: string, data: unknown) =>
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const send = (event: string, data: unknown) => {
      if (closed) return;
      if (snapshotSent) {
        raw.write(frameOf(event, data));
      } else {
        backlog.push(frameOf(event, data));
      }
    };
    const finishStream = () => {
      if (closed) return;
      closed = true;
      runner.off("run", listener);
      clearInterval(heartbeat);
      raw.end();
    };
    const sendStatus = async (run: ActionRun, snapshot = false) => {
      const [enriched] = await enrichRuns(project.id, [run]);
      if (snapshot) {
        // Erst-Snapshot: Live-Puffer des Runners ist aktueller als die DB
        // (die nur sekündlich nachgeführt wird). Danach den Rückstau lösen.
        const log = runner.getLiveLog(run.id) ?? run.log;
        if (!closed) raw.write(frameOf("status", { ...enriched, log }));
        snapshotSent = true;
        for (const frame of backlog.splice(0)) {
          if (!closed) raw.write(frame);
        }
      } else {
        send("status", { ...enriched, log: run.log });
      }
      if (isTerminalRunStatus(run.status)) {
        send("done", { status: run.status });
        finishStream();
      }
    };
    const listener = (event: RunEvent) => {
      if (event.type === "log" && event.runId === runId) {
        send("log", { chunk: event.chunk });
      } else if (event.type === "status" && event.run.id === runId) {
        void sendStatus(event.run);
      }
    };
    // Erst abonnieren, dann den Stand lesen — sonst geht ein Statuswechsel
    // zwischen Lesen und Abonnieren verloren.
    runner.on("run", listener);
    const heartbeat = setInterval(() => {
      if (!closed) raw.write(": ping\n\n");
    }, 15_000);
    request.raw.on("close", finishStream);
    const current = await repo.getActionRun(runId);
    if (current) {
      await sendStatus(current, true);
    } else {
      finishStream();
    }
    return reply;
  });

  /** Run abbrechen (wartend oder laufend). */
  app.post(`${api}/projects/:slug/runs/:runId/cancel`, async (request, reply) => {
    const { slug, runId } = request.params as { slug: string; runId: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const run = await repo.getActionRun(runId);
    if (!run || run.projectId !== project.id) {
      return reply.code(404).send({ error: "Run not found" });
    }
    if (isTerminalRunStatus(run.status)) {
      return reply.code(409).send({ error: "Run ist bereits abgeschlossen" });
    }
    const cancelled = (await runner.cancel(runId)) ?? run;
    const [enriched] = await enrichRuns(project.id, [cancelled]);
    return reply.send({ run: enriched });
  });

  /** Run erneut ausführen: neuer Run für dieselbe Action und denselben Commit. */
  app.post(`${api}/projects/:slug/runs/:runId/retry`, async (request, reply) => {
    const { slug, runId } = request.params as { slug: string; runId: string };
    const project = await resolveProject(slug, reply);
    if (!project) return reply;
    const user = await requireUser(request, reply);
    if (!user) return reply;
    if (!(await requireMember(project, user, reply, "write"))) return reply;
    const run = await repo.getActionRun(runId);
    if (!run || run.projectId !== project.id) {
      return reply.code(404).send({ error: "Run not found" });
    }
    if (!isTerminalRunStatus(run.status)) {
      return reply.code(409).send({ error: "Run läuft noch" });
    }
    const action = await repo.getAction(run.actionId);
    const model = (await repo.listModels(project.id)).find((m) => m.id === run.modelId);
    if (!action || !model) {
      return reply.code(410).send({ error: "Action oder Modell existiert nicht mehr" });
    }
    const [created] = await queueRuns(project, model, run.commitId, [action], user.id);
    const [enriched] = await enrichRuns(project.id, [created!]);
    return reply.code(201).send({ run: enriched });
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
    // Nur die Übersicht (Zähler je Status und IFC-Typ) — die Einträge holt
    // die UI seitenweise über /diff/entries, sonst friert der Browser bei
    // 100k+ Änderungen ein.
    return reply.send({ diff: diffOverview(await commits.getDiff(from, to)) });
  });

  // Seitenweise Diff-Einträge, eingegrenzt auf Status/Typ oder Volltext.
  app.get(
    `${api}/projects/:slug/models/:model/diff/entries`,
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
        status?: string;
        type?: string;
        q?: string;
        offset?: string;
        limit?: string;
      };
      if (!query.from || !query.to) {
        return reply.code(400).send({ error: "from and to commit ids required" });
      }
      if (
        query.status !== undefined &&
        !["added", "modified", "removed"].includes(query.status)
      ) {
        return reply.code(400).send({ error: "Invalid status" });
      }
      const from = await repo.getCommit(query.from);
      const to = await repo.getCommit(query.to);
      if (!from || !to || from.modelId !== model.id || to.modelId !== model.id) {
        return reply.code(404).send({ error: "Commit not found" });
      }
      const summary = await commits.getDiff(from, to);
      return reply.send({
        page: diffPage(summary, {
          status: query.status as "added" | "modified" | "removed" | undefined,
          type: query.type || undefined,
          q: query.q || undefined,
          offset: Number(query.offset ?? 0),
          limit: Number(query.limit ?? DIFF_PAGE_LIMIT_DEFAULT),
        }),
      });
    },
  );

  // ---- objektzentrierter Diff ("Änderungen") ------------------------------
  //
  // Anders als /diff (jede gerootete STEP-Entity) fasst /changes alles je
  // OBJEKT zusammen: Attribute, Lage, Geometrie, Eigenschaften, Beziehungen.
  // `from` ist optional — ohne Basis gilt alles als neu (erster Commit).

  interface ChangesRequestQuery {
    from?: string;
    to?: string;
    status?: string;
    type?: string;
    facet?: string;
    container?: string;
    q?: string;
    offset?: string;
    limit?: string;
    globalId?: string;
  }

  async function resolveChanges(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ from: Commit | null; to: Commit; query: ChangesRequestQuery } | null> {
    const { slug, model: modelSlug } = request.params as {
      slug: string;
      model: string;
    };
    const resolved = await resolveModel(slug, modelSlug, reply);
    if (!resolved) return null;
    const { project, model } = resolved;
    if (!(await canReadModel(request, reply, project, model.visibility))) return null;
    const query = request.query as ChangesRequestQuery;
    if (!query.to) {
      reply.code(400).send({ error: "to commit id required" });
      return null;
    }
    const to = await repo.getCommit(query.to);
    const from = query.from ? await repo.getCommit(query.from) : null;
    if (
      !to ||
      to.modelId !== model.id ||
      (query.from && (!from || from.modelId !== model.id))
    ) {
      reply.code(404).send({ error: "Commit not found" });
      return null;
    }
    return { from, to, query };
  }

  function changesFilter(
    query: ChangesRequestQuery,
    reply: FastifyReply,
  ): Omit<ChangesQuery, "offset" | "limit"> | null {
    if (
      query.status !== undefined &&
      !["added", "modified", "removed"].includes(query.status)
    ) {
      reply.code(400).send({ error: "Invalid status" });
      return null;
    }
    if (
      query.facet !== undefined &&
      !["attributes", "placement", "geometry", "properties", "relations"].includes(
        query.facet,
      )
    ) {
      reply.code(400).send({ error: "Invalid facet" });
      return null;
    }
    return {
      status: query.status as ChangesQuery["status"],
      type: query.type || undefined,
      facet: query.facet as ChangesQuery["facet"],
      container: query.container,
      q: query.q || undefined,
    };
  }

  app.get(`${api}/projects/:slug/models/:model/changes`, async (request, reply) => {
    const resolved = await resolveChanges(request, reply);
    if (!resolved) return reply;
    const { from, to } = resolved;
    const summary = await commits.getChanges(from, to);
    return reply.send({
      changes: changesOverview(
        summary,
        from !== null && from.manifestHash === to.manifestHash,
      ),
    });
  });

  // Gefilterte Seite; jede Zeile trägt ihre wichtigsten Vorher/Nachher-Werte.
  app.get(
    `${api}/projects/:slug/models/:model/changes/items`,
    async (request, reply) => {
      const resolved = await resolveChanges(request, reply);
      if (!resolved) return reply;
      const { from, to, query } = resolved;
      const filter = changesFilter(query, reply);
      if (!filter) return reply;
      const summary = await commits.getChanges(from, to);
      const page = changesPageEntries(summary, {
        ...filter,
        offset: Number(query.offset ?? 0),
        limit: Number(query.limit ?? CHANGES_PAGE_LIMIT_DEFAULT),
      });
      const hashes: string[] = [];
      for (const entry of page.entries) {
        if (entry.beforeHash) hashes.push(entry.beforeHash);
        if (entry.afterHash) hashes.push(entry.afterHash);
      }
      const details = await repo.getObjectDetails(hashes);
      return reply.send({
        page: {
          items: withDetails(page.entries, details),
          total: page.total,
          offset: page.offset,
          limit: page.limit,
        },
      });
    },
  );

  // GlobalIds je Status — für die Einfärbung im 3D-Vergleich.
  app.get(
    `${api}/projects/:slug/models/:model/changes/guids`,
    async (request, reply) => {
      const resolved = await resolveChanges(request, reply);
      if (!resolved) return reply;
      const { from, to, query } = resolved;
      const filter = changesFilter(query, reply);
      if (!filter) return reply;
      const summary = await commits.getChanges(from, to);
      return reply.send({ guids: changesGuids(summary, filter) });
    },
  );

  // Alle Vorher/Nachher-Werte eines Objekts (Aufklappen einer Zeile).
  app.get(
    `${api}/projects/:slug/models/:model/changes/item`,
    async (request, reply) => {
      const resolved = await resolveChanges(request, reply);
      if (!resolved) return reply;
      const { from, to, query } = resolved;
      if (!query.globalId) {
        return reply.code(400).send({ error: "globalId required" });
      }
      const detail = await commits.getObjectChange(from, to, query.globalId);
      if (!detail.entry) {
        return reply.code(404).send({ error: "Objekt ist nicht Teil dieses Diffs" });
      }
      return reply.send({ detail });
    },
  );

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

  // ---- Übersichten: Aktivität, Beiträge, Suche, eigene Issues -----------
  // Alle projektübergreifend über die zugänglichen Projekte (eigene +
  // öffentliche, Admins alle).

  const ACTIVITY_LIMIT_DEFAULT = 40;
  const CONTRIBUTION_DAYS_DEFAULT = 371;
  const SEARCH_LIMIT_DEFAULT = 8;
  const MY_ISSUES_LIMIT = 30;
  const DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * Aktivitäts-Feed aus allen Quellen: je Quelle die `limit` neuesten
   * Einträge (Repository), dann gemeinsam absteigend sortiert und gekürzt —
   * die insgesamt neuesten `limit` sind darin sicher enthalten.
   */
  async function activityFeed(
    projects: Project[],
    query: RecentQuery,
  ): Promise<ActivityEvent[]> {
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const projectIds = [...projectById.keys()];
    const [commitRows, openedIssues, stateEvents, commentRows, runs] =
      await Promise.all([
        repo.listRecentCommits(projectIds, query),
        repo.listRecentIssues(projectIds, query),
        repo.listRecentIssueEvents(projectIds, {
          ...query,
          kinds: ["closed", "reopened"],
        }),
        repo.listRecentComments(projectIds, query),
        repo.listRecentRuns(projectIds, query),
      ]);
    const createdProjects = projects
      .filter(
        (project) =>
          (query.before === undefined || project.createdAt < query.before) &&
          (query.actorId === undefined || project.ownerId === query.actorId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, query.limit);

    // Issues der Zustandswechsel und Kommentare (nur die fehlenden) laden.
    const issueById = new Map(openedIssues.map((issue) => [issue.id, issue]));
    const missingIssueIds = new Set(
      [
        ...stateEvents.map((event) => event.issueId),
        ...commentRows.map(({ comment }) => comment.issueId),
      ].filter((id) => !issueById.has(id)),
    );
    for (const id of missingIssueIds) {
      const issue = await repo.getIssueById(id);
      if (issue) issueById.set(id, issue);
    }
    // Modelle + Action-Namen der Runs je beteiligtem Projekt.
    const modelById = new Map<string, Model>();
    const actionNameById = new Map<string, string>();
    for (const projectId of new Set(runs.map((run) => run.projectId))) {
      for (const model of await repo.listModels(projectId)) {
        modelById.set(model.id, model);
      }
      for (const action of await repo.listActions(projectId)) {
        actionNameById.set(action.id, action.name);
      }
    }
    const users = await usersById([
      ...commitRows.map(({ commit }) => commit.authorId),
      ...openedIssues.map((issue) => issue.authorId),
      ...stateEvents.map((event) => event.actorId),
      ...commentRows.map(({ comment }) => comment.authorId),
      ...runs.map((run) => run.triggeredById),
      ...createdProjects.map((project) => project.ownerId),
    ]);

    const actorOf = (userId: string) => {
      const actor = users.get(userId);
      return actor ? publicUser(actor) : null;
    };
    const modelRef = (model: Model) => ({
      slug: model.slug,
      name: model.name,
      kind: model.kind,
      folder: model.folder,
    });
    const issueRef = (issue: Issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      kind: issue.kind,
    });
    const events: ActivityEvent[] = [];
    const add = (projectId: string, event: Omit<ActivityEvent, "project">) => {
      const project = projectById.get(projectId);
      if (project) {
        events.push({ ...event, project: { slug: project.slug, name: project.name } });
      }
    };

    for (const { commit, model } of commitRows) {
      add(model.projectId, {
        id: `commit:${commit.id}`,
        type: "commit",
        at: commit.createdAt,
        actor: actorOf(commit.authorId),
        model: modelRef(model),
        commit: {
          id: commit.id,
          message: commit.message,
          branchName: commit.branchName,
          added: commit.added,
          removed: commit.removed,
          modified: commit.modified,
          schema: commit.schema,
        },
      });
    }
    for (const issue of openedIssues) {
      add(issue.projectId, {
        id: `issue:${issue.id}`,
        type: "issue_opened",
        at: issue.createdAt,
        actor: actorOf(issue.authorId),
        issue: issueRef(issue),
      });
    }
    for (const event of stateEvents) {
      const issue = issueById.get(event.issueId);
      if (!issue) continue;
      add(event.projectId, {
        id: `event:${event.id}`,
        type: event.kind === "closed" ? "issue_closed" : "issue_reopened",
        at: event.createdAt,
        actor: actorOf(event.actorId),
        issue: issueRef(issue),
      });
    }
    for (const { comment, projectId } of commentRows) {
      const issue = issueById.get(comment.issueId);
      if (!issue) continue;
      add(projectId, {
        id: `comment:${comment.id}`,
        type: "comment",
        at: comment.createdAt,
        actor: actorOf(comment.authorId),
        issue: issueRef(issue),
        comment: { id: comment.id, excerpt: markdownExcerpt(comment.body) },
      });
    }
    for (const run of runs) {
      const model = modelById.get(run.modelId);
      add(run.projectId, {
        id: `run:${run.id}`,
        type: "run",
        at: run.createdAt,
        actor: actorOf(run.triggeredById),
        ...(model ? { model: modelRef(model) } : {}),
        run: {
          id: run.id,
          number: run.number,
          status: run.status,
          summary: run.summary,
          actionName: actionNameById.get(run.actionId) ?? "",
          commitId: run.commitId,
        },
      });
    }
    for (const project of createdProjects) {
      add(project.id, {
        id: `project:${project.id}`,
        type: "project_created",
        at: project.createdAt,
        actor: actorOf(project.ownerId),
      });
    }
    return events
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(0, query.limit);
  }

  // Aktivitäts-Feed, neueste zuerst; blättern mit `before` = `nextBefore`.
  app.get(`${api}/activity`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const query = request.query as {
      project?: string;
      user?: string;
      limit?: string;
      before?: string;
    };
    const limit = intParam(query.limit, ACTIVITY_LIMIT_DEFAULT, 1, 100);
    let before: string | undefined;
    if (query.before) {
      const parsed = new Date(query.before);
      if (Number.isNaN(parsed.getTime())) {
        return reply
          .code(400)
          .send({ error: "before must be an ISO timestamp" });
      }
      // Einheitliches ISO-Format — die Zeitstempel werden als Text verglichen.
      before = parsed.toISOString();
    }
    const actor = resolveActor(user, query.user, reply);
    if (!actor) return reply;
    const projects = await projectScope(user, query.project, reply);
    if (!projects) return reply;
    const events = await activityFeed(projects, {
      limit,
      before,
      actorId: actor.actorId,
    });
    return reply.send({
      events,
      nextBefore: events.length === limit ? (events.at(-1)?.at ?? null) : null,
    });
  });

  // Beiträge je UTC-Tag (Heatmap): Commits, eröffnete Issues, Kommentare.
  app.get(`${api}/contributions`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const query = request.query as {
      project?: string;
      user?: string;
      days?: string;
    };
    const dayCount = intParam(query.days, CONTRIBUTION_DAYS_DEFAULT, 7, 400);
    const actor = resolveActor(user, query.user, reply);
    if (!actor) return reply;
    const projects = await projectScope(user, query.project, reply);
    if (!projects) return reply;
    // Lückenlose Tage, der letzte ist heute (UTC).
    const now = new Date();
    const firstDay =
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      (dayCount - 1) * DAY_MS;
    const dates = Array.from({ length: dayCount }, (_, index) =>
      new Date(firstDay + index * DAY_MS).toISOString().slice(0, 10),
    );
    const from = dates[0]!;
    const counts = new Map(
      (
        await repo.activityDayCounts(
          projects.map((project) => project.id),
          { since: from, actorId: actor.actorId },
        )
      ).map((entry) => [entry.day, entry]),
    );
    const days = dates.map((date) => {
      const entry = counts.get(date);
      const commits = entry?.commits ?? 0;
      const issues = entry?.issues ?? 0;
      const comments = entry?.comments ?? 0;
      return { date, commits, issues, comments, total: commits + issues + comments };
    });
    return reply.send({
      days,
      total: days.reduce((sum, day) => sum + day.total, 0),
      from,
      to: dates[dates.length - 1],
    });
  });

  // Befehlspalette: Projekte, Modelle, Issues (Teilstring, Präfix zuerst).
  app.get(`${api}/search`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const query = request.query as { q?: string; limit?: string };
    const text = (query.q ?? "").trim();
    const limit = intParam(query.limit, SEARCH_LIMIT_DEFAULT, 1, 20);
    if (!text) {
      return reply.send({ projects: [], models: [], issues: [] });
    }
    const projects = await accessibleProjects(user);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const projectIds = [...projectById.keys()];
    const projectRef = (projectId: string) => {
      const project = projectById.get(projectId);
      return { slug: project?.slug ?? "", name: project?.name ?? "" };
    };
    const needle = text.toLowerCase();
    const matchedProjects = projects
      .filter((project) =>
        [project.name, project.slug, project.description].some((value) =>
          value.toLowerCase().includes(needle),
        ),
      )
      .map((project) => ({
        project,
        rank:
          project.name.toLowerCase().startsWith(needle) ||
          project.slug.startsWith(needle)
            ? 0
            : 1,
      }))
      .sort(
        (a, b) => a.rank - b.rank || a.project.name.localeCompare(b.project.name),
      )
      .slice(0, limit)
      .map((entry) => entry.project);
    // "#12" oder "12" trifft zusätzlich Issue Nummer 12.
    const numberMatch = /^#?(\d{1,9})$/.exec(text);
    const [models, issues] = await Promise.all([
      repo.searchModels(projectIds, text, limit),
      repo.searchIssues(projectIds, {
        text,
        number: numberMatch ? Number(numberMatch[1]) : undefined,
        limit,
      }),
    ]);
    return reply.send({
      projects: await enrichProjects(user, matchedProjects),
      models: models.map((model) => ({
        id: model.id,
        slug: model.slug,
        name: model.name,
        kind: model.kind,
        folder: model.folder,
        project: projectRef(model.projectId),
      })),
      issues: issues.map((issue) => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        kind: issue.kind,
        createdAt: issue.createdAt,
        project: projectRef(issue.projectId),
      })),
    });
  });

  // Offene Issues, die mir zugewiesen sind bzw. die ich eröffnet habe.
  app.get(`${api}/me/issues`, async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return reply;
    const projects = await accessibleProjects(user);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const projectIds = [...projectById.keys()];
    const [assigned, created] = await Promise.all([
      repo.listIssuesByFilter(projectIds, {
        state: "open",
        assigneeId: user.id,
        limit: MY_ISSUES_LIMIT,
      }),
      repo.listIssuesByFilter(projectIds, {
        state: "open",
        authorId: user.id,
        limit: MY_ISSUES_LIMIT,
      }),
    ]);
    const issueIds = [...new Set([...assigned, ...created].map((issue) => issue.id))];
    const [links, commentCounts, subIssueCounts] = await Promise.all([
      repo.getIssueLinks(issueIds),
      repo.countIssueComments(issueIds),
      repo.countSubIssues(issueIds),
    ]);
    const labelById = new Map<string, Label>();
    for (const projectId of new Set(
      [...assigned, ...created].map((issue) => issue.projectId),
    )) {
      for (const label of await repo.listLabels(projectId)) {
        labelById.set(label.id, label);
      }
    }
    const toMyIssue = (issue: Issue) => {
      const project = projectById.get(issue.projectId);
      return {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        kind: issue.kind,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        project: { slug: project?.slug ?? "", name: project?.name ?? "" },
        labels: (links.get(issue.id)?.labelIds ?? [])
          .map((id) => labelById.get(id))
          .filter((label): label is Label => label !== undefined),
        commentCount: commentCounts.get(issue.id) ?? 0,
        subIssueCount: subIssueCounts.get(issue.id) ?? 0,
      };
    };
    return reply.send({
      assigned: assigned.map(toMyIssue),
      created: created.map(toMyIssue),
    });
  });

  return app;
}
