/**
 * OpenProject-Integration: Anmeldung per signiertem Ticket.
 *
 * Das OpenProject-Plugin (openproject-plugin/, Projektmodul "IFC Hub")
 * bettet den Hub per iframe ein und übergibt ein kurzlebiges HS256-Ticket
 * mit Benutzer, Projekt und Rolle. Der Hub prüft Signatur, Ablauf und
 * Einmaligkeit, legt den Benutzer bei Bedarf an, gleicht Name und Rolle ab
 * und tauscht das Ticket gegen eine normale Hub-Sitzung (JWT).
 *
 * Projekte werden NICHT automatisch angelegt: Beim ersten Öffnen richtet ein
 * Projektadministrator die Verknüpfung ein — neues Hub-Projekt oder ein
 * vorhandenes (samt Modellen und Historie). Die Zuordnung OpenProject-Id <->
 * Hub-Id liegt in `external_links`, damit Umbenennungen und E-Mail-Wechsel
 * nichts trennen.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { hashPassword } from "../auth/passwords";
import type { Project, Repository, Role, User } from "../repository/types";

export const OPENPROJECT_SYSTEM = "openproject";

/** Mindestlänge des gemeinsamen Secrets (Plugin prüft dasselbe). */
export const MIN_SECRET_LENGTH = 32;

/** Maximale Lebensdauer, die der Hub akzeptiert — unabhängig von `exp`. */
const MAX_TICKET_LIFETIME_S = 600;
/** Toleranz für abweichende Uhren zwischen OpenProject und Hub. */
const CLOCK_SKEW_S = 60;

const ROLES: ReadonlySet<Role> = new Set<Role>([
  "owner",
  "maintainer",
  "contributor",
  "viewer",
]);

export interface OpenProjectTicket {
  iss: "openproject";
  aud: "ifc-hub";
  iat: number;
  exp: number;
  jti: string;
  /** Basis-URL der OpenProject-Instanz (für Rück-Links). */
  openproject_url: string;
  user: OpenProjectUser;
  project: { id: string; identifier: string; name: string };
  role: Role;
}

export class TicketError extends Error {}

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Benutzer, wie OpenProject ihn in Tickets und Speicher-Tokens mitschickt. */
export interface OpenProjectUser {
  id: string;
  login: string;
  email: string;
  name: string;
}

function isValidOpenProjectUser(user: unknown): user is OpenProjectUser {
  const candidate = user as Partial<OpenProjectUser> | null | undefined;
  return (
    !!candidate &&
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.email) &&
    candidate.email.includes("@")
  );
}

/**
 * Prüft Signatur (nur HS256), Aussteller, Empfänger und Zeitfenster eines
 * von OpenProject signierten JWT und liefert den Inhalt.
 */
function verifyOpenProjectJwt(
  token: string,
  secret: string,
  audience: string,
  nowS: number,
): Record<string, unknown> & { iat: number; exp: number } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TicketError("Ticket hat kein JWT-Format");
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: unknown };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
  } catch {
    throw new TicketError("Ticket-Header nicht lesbar");
  }
  // Nur HS256 — insbesondere kein "none" und kein Algorithmuswechsel.
  if (header.alg !== "HS256") {
    throw new TicketError("Ticket-Algorithmus nicht unterstützt");
  }

  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = base64UrlDecode(signatureB64);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new TicketError("Ticket-Signatur ungültig");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new TicketError("Ticket-Inhalt nicht lesbar");
  }

  if (payload.iss !== "openproject" || payload.aud !== audience) {
    throw new TicketError("Ticket ist nicht für diesen Zweck ausgestellt");
  }
  const { iat, exp } = payload;
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw new TicketError("Ticket ohne Zeitangaben");
  }
  if (exp - iat > MAX_TICKET_LIFETIME_S) {
    throw new TicketError("Ticket-Lebensdauer zu lang");
  }
  if (iat > nowS + CLOCK_SKEW_S) {
    throw new TicketError("Ticket stammt aus der Zukunft");
  }
  if (exp < nowS - CLOCK_SKEW_S) {
    throw new TicketError("Ticket abgelaufen");
  }
  return { ...payload, iat, exp };
}

/**
 * Prüft ein Anmelde-Ticket (iframe-Einstieg) und liefert seinen Inhalt.
 * Wirft TicketError bei falscher Signatur, falschem Aussteller/Empfänger,
 * Ablauf oder unvollständigem Inhalt. Die Einmaligkeit (jti) prüft
 * `JtiRegistry`.
 */
export function verifyTicket(
  ticket: string,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): OpenProjectTicket {
  const payload = verifyOpenProjectJwt(ticket, secret, "ifc-hub", nowS) as Partial<OpenProjectTicket>;
  if (!isNonEmptyString(payload.jti)) {
    throw new TicketError("Ticket ohne jti");
  }
  const { user, project } = payload;
  if (!isValidOpenProjectUser(user)) {
    throw new TicketError("Ticket ohne gültigen Benutzer");
  }
  if (!project || !isNonEmptyString(project.id) || !isNonEmptyString(project.identifier)) {
    throw new TicketError("Ticket ohne gültiges Projekt");
  }
  if (!payload.role || !ROLES.has(payload.role)) {
    throw new TicketError("Ticket mit unbekannter Rolle");
  }
  return payload as OpenProjectTicket;
}

/**
 * Speicher-Token: Damit ruft OpenProjects Server (Speichertyp "IFC Hub")
 * die Datei-API des Hubs auf — im Namen eines Benutzers oder, ohne
 * `user`, als Dienst (nur lesend). Mehrfach verwendbar bis zum Ablauf.
 */
export function verifyStorageToken(
  token: string,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): { user: OpenProjectUser | null } {
  const payload = verifyOpenProjectJwt(token, secret, "ifc-hub-storage", nowS);
  if (payload.user === undefined || payload.user === null) {
    return { user: null };
  }
  if (!isValidOpenProjectUser(payload.user)) {
    throw new TicketError("Token ohne gültigen Benutzer");
  }
  return { user: payload.user };
}

/**
 * Merkt sich eingelöste Tickets bis zu ihrem Ablauf — jedes Ticket gilt
 * genau einmal. Prozesslokal: bei mehreren Hub-Instanzen hinter einem
 * Load-Balancer müsste das in die Datenbank.
 */
export class JtiRegistry {
  private readonly used = new Map<string, number>();

  /** false, wenn die jti schon eingelöst wurde. */
  claim(jti: string, expS: number, nowS = Math.floor(Date.now() / 1000)): boolean {
    for (const [key, exp] of this.used) {
      if (exp + CLOCK_SKEW_S < nowS) {
        this.used.delete(key);
      }
    }
    if (this.used.has(jti)) {
      return false;
    }
    this.used.set(jti, expS);
    return true;
  }
}

/** OpenProject-Identifier -> Hub-Slug (Identifier sind schon fast Slugs). */
function slugFromIdentifier(identifier: string): string {
  return (
    identifier
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "projekt"
  );
}

/** Hub-Benutzer zu einem OpenProject-Benutzer (bei Erstkontakt angelegt). */
export async function findOrCreateUser(repo: Repository, opUser: OpenProjectUser): Promise<User> {
  const name = isNonEmptyString(opUser.name) ? opUser.name : opUser.email;
  const linkedId = await repo.getExternalLink(OPENPROJECT_SYSTEM, "user", opUser.id);
  let user = linkedId ? await repo.getUserById(linkedId) : null;

  if (!user) {
    // Erstkontakt: ein vorhandenes Hub-Konto mit derselben E-Mail übernehmen,
    // sonst anlegen. Das Passwort ist zufällig — Anmeldung läuft über
    // OpenProject; ein Admin kann bei Bedarf eins setzen.
    user =
      (await repo.getUserByEmail(opUser.email)) ??
      (await repo.createUser({
        email: opUser.email,
        name,
        passwordHash: hashPassword(randomBytes(32).toString("base64url")),
        isAdmin: false,
      }));
    await repo.setExternalLink({
      system: OPENPROJECT_SYSTEM,
      kind: "user",
      externalId: opUser.id,
      localId: user.id,
    });
  }
  if (user.name !== name) {
    user = (await repo.updateUser(user.id, { name })) ?? user;
  }
  return user;
}

/** Rollen, die ein noch nicht verknüpftes Projekt einrichten dürfen. */
const SETUP_ROLES: ReadonlySet<Role> = new Set<Role>(["owner", "maintainer"]);

/** Das OpenProject-Projekt, auf das sich Ticket bzw. Einrichtung beziehen. */
export interface OpenProjectProjectRef {
  id: string;
  identifier: string;
  name: string;
}

export type ProvisionResult =
  | { status: "linked"; user: User; project: Project; role: Role }
  | { status: "unlinked"; user: User; role: Role; canSetup: boolean };

function displayName(ref: OpenProjectProjectRef): string {
  return isNonEmptyString(ref.name) ? ref.name : ref.identifier;
}

async function linkedProject(
  repo: Repository,
  opProjectId: string,
): Promise<Project | null> {
  const linkedId = await repo.getExternalLink(OPENPROJECT_SYSTEM, "project", opProjectId);
  return linkedId ? repo.getProjectById(linkedId) : null;
}

/** Ist das Hub-Projekt schon mit (irgend)einem OpenProject-Projekt verknüpft? */
async function isLinkedToOpenProject(repo: Repository, projectId: string): Promise<boolean> {
  const links = await repo.listExternalLinks("project", projectId);
  return links.some((link) => link.system === OPENPROJECT_SYSTEM);
}

/**
 * Meldet den Benutzer an und gleicht das verknüpfte Projekt ab (Name,
 * Rolle). Die Rolle kommt immer aus OpenProject — wer dort Rechte verliert,
 * verliert sie beim nächsten Öffnen auch im Hub.
 *
 * Ist das OpenProject-Projekt noch mit keinem Hub-Projekt verknüpft, wird
 * NICHTS angelegt: Einrichten (neu anlegen oder vorhandenes verknüpfen)
 * darf nur, wer in OpenProject "IFC Hub verwalten" hat — siehe
 * `setupOpenProjectLink`.
 */
export async function provisionFromTicket(
  repo: Repository,
  ticket: OpenProjectTicket,
): Promise<ProvisionResult> {
  return repo.transaction(async () => {
    const user = await findOrCreateUser(repo, ticket.user);
    let project = await linkedProject(repo, ticket.project.id);
    if (!project) {
      return { status: "unlinked", user, role: ticket.role, canSetup: SETUP_ROLES.has(ticket.role) };
    }
    const name = displayName(ticket.project);
    if (project.name !== name) {
      project = (await repo.updateProject(project.id, { name })) ?? project;
    }
    await repo.addMember({ projectId: project.id, userId: user.id, role: ticket.role });
    return { status: "linked", user, project, role: ticket.role };
  });
}

/**
 * Hub-Projekte, die der Benutzer mit einem OpenProject-Projekt verknüpfen
 * darf: selbst verwaltet (owner/maintainer, globale Admins alle) und noch
 * mit keinem OpenProject-Projekt verknüpft.
 */
export async function linkCandidates(repo: Repository, user: User): Promise<Project[]> {
  const projects = user.isAdmin
    ? await repo.listAllProjects()
    : await repo.listProjectsForUser(user.id);
  const candidates: Project[] = [];
  for (const project of projects) {
    if (!user.isAdmin) {
      const member = await repo.getMember(project.id, user.id);
      if (!member || !SETUP_ROLES.has(member.role)) continue;
    }
    if (await isLinkedToOpenProject(repo, project.id)) continue;
    candidates.push(project);
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export class SetupError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
  }
}

/**
 * Richtet die Verknüpfung ein: `slug` verknüpft ein vorhandenes Hub-Projekt
 * (der Benutzer muss es verwalten dürfen), ohne `slug` wird ein neues,
 * privates Hub-Projekt angelegt. War das OpenProject-Projekt inzwischen
 * schon verknüpft (zweiter Admin war schneller), gilt diese Verknüpfung.
 */
export async function setupOpenProjectLink(
  repo: Repository,
  user: User,
  opProject: OpenProjectProjectRef,
  role: Role,
  slug?: string,
): Promise<Project> {
  if (!SETUP_ROLES.has(role)) {
    throw new SetupError("Nur Projektadministratoren können den IFC Hub einrichten", 403);
  }
  return repo.transaction(async () => {
    let project = await linkedProject(repo, opProject.id);
    if (!project && slug) {
      project = await repo.getProjectBySlug(slug);
      if (!project) {
        throw new SetupError("Hub-Projekt nicht gefunden", 404);
      }
      const allowed = (await linkCandidates(repo, user)).some((p) => p.id === project!.id);
      if (!allowed) {
        throw new SetupError(
          "Dieses Hub-Projekt kann nicht verknüpft werden (keine Verwaltungsrechte oder schon verknüpft)",
          409,
        );
      }
    }
    if (!project) {
      // Freien Slug suchen: "test", "test-2", … — ein gleichnamiges, aber
      // nicht verknüpftes Hub-Projekt wird bewusst NICHT stillschweigend
      // übernommen; dafür gibt es die Auswahl "vorhandenes verknüpfen".
      const base = slugFromIdentifier(opProject.identifier);
      let candidate = base;
      for (let n = 2; await repo.getProjectBySlug(candidate); n += 1) {
        candidate = `${base}-${n}`;
      }
      project = await repo.createProject({
        slug: candidate,
        name: displayName(opProject),
        ownerId: user.id,
        // Zugriff steuert OpenProject — im Hub nur für Mitglieder sichtbar.
        visibility: "private",
      });
    }
    await repo.setExternalLink({
      system: OPENPROJECT_SYSTEM,
      kind: "project",
      externalId: opProject.id,
      localId: project.id,
    });
    await repo.addMember({ projectId: project.id, userId: user.id, role });
    return project;
  });
}

/** Verknüpfung eines Hub-Projekts mit OpenProject lösen (Inhalte bleiben). */
export async function unlinkOpenProject(repo: Repository, projectId: string): Promise<boolean> {
  const links = (await repo.listExternalLinks("project", projectId)).filter(
    (link) => link.system === OPENPROJECT_SYSTEM,
  );
  for (const link of links) {
    await repo.deleteExternalLink(link.system, link.kind, link.externalId);
  }
  return links.length > 0;
}

/** OpenProject-Projekt-Id, mit der ein Hub-Projekt verknüpft ist, oder null. */
export async function openProjectIdFor(repo: Repository, projectId: string): Promise<string | null> {
  const links = await repo.listExternalLinks("project", projectId);
  return links.find((link) => link.system === OPENPROJECT_SYSTEM)?.externalId ?? null;
}
