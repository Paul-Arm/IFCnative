/**
 * Metadata domain model + Repository interface.
 *
 * The in-memory implementation (memoryRepository.ts) backs local dev and tests.
 * For production swap in a Postgres / Azure SQL implementation of `Repository`
 * — the object store (Azure Blob) holds the heavy IFC blobs and manifests, this
 * layer only holds metadata (projects, models, commits, branches, members).
 */

import type {
  GuidDiffSummary,
  ObjectDetail,
  ObjectIndexEntry,
  ObjectRecord,
  VersionManifestEntry,
} from "../ifc";

export type Role = "owner" | "maintainer" | "contributor" | "viewer";

/** Roles permitted to push commits / mutate a project. */
export const WRITE_ROLES: ReadonlySet<Role> = new Set<Role>([
  "owner",
  "maintainer",
  "contributor",
]);

/** Roles permitted to manage members and project settings. */
export const ADMIN_ROLES: ReadonlySet<Role> = new Set<Role>([
  "owner",
  "maintainer",
]);

/** All valid roles (validates request input). */
export const ALL_ROLES: ReadonlySet<string> = new Set<Role>([
  "owner",
  "maintainer",
  "contributor",
  "viewer",
]);

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  /** Globaler Admin: voller Zugriff auf alle Projekte + Benutzerverwaltung. */
  isAdmin: boolean;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  /** Kurzbeschreibung (max. 500 Zeichen); "" = keine. */
  description: string;
  ownerId: string;
  createdAt: string;
  /**
   * "public" (Standard): jeder ANGEMELDETE Benutzer sieht das Projekt
   * lesend (implizite viewer-Rolle). "private": nur Mitglieder.
   */
  visibility: Visibility;
}

export interface Member {
  projectId: string;
  userId: string;
  role: Role;
}

export type Visibility = "private" | "public";

/**
 * Dateiart eines Modells: "ifc" = IFC-Modell mit semantischem GlobalId-Diff,
 * "md" = Markdown-Dokument (z. B. README), versioniert ohne Objekt-Diff,
 * "file" = beliebige Datei (PDF, Word, DWG, …), versioniert als Binärblob.
 */
export type ModelKind = "ifc" | "md" | "file";

export interface Model {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  visibility: Visibility;
  defaultBranch: string;
  createdAt: string;
  /** Ordnerpfad im Projekt, Segmente mit "/" getrennt; "" = Wurzel. */
  folder: string;
  kind: ModelKind;
}

export interface Branch {
  id: string;
  modelId: string;
  name: string;
  headCommitId: string | null;
}

export interface Commit {
  id: string;
  modelId: string;
  branchName: string;
  parentCommitId: string | null;
  manifestHash: string;
  blobKey: string;
  schema: string;
  authorId: string;
  message: string;
  createdAt: string;
  entityCount: number;
  added: number;
  removed: number;
  modified: number;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  /** Hex-Farbe wie "#d73a4a". */
  color: string;
  /** Kurzbeschreibung (max. 100 Zeichen); "" = keine. */
  description: string;
}

export type IssueState = "open" | "closed";

/**
 * Art des Issues: "virtual" = nur im Server (wie GitHub-Issues),
 * "bcf" = echtes IFC-Issue im buildingSMART-BCF-Standard — als BCF-Topic
 * exportierbar (.bcfzip mit Markup, Kommentaren und Viewpoint-Komponenten
 * aus den verorteten GlobalIds). Die Issue-Id (UUID) ist die Topic-Guid.
 */
export type IssueKind = "virtual" | "bcf";

export interface Issue {
  id: string;
  projectId: string;
  /** Laufende Nummer je Projekt (wie GitHub "#12"). */
  number: number;
  title: string;
  body: string;
  state: IssueState;
  kind: IssueKind;
  authorId: string;
  /**
   * Übergeordnetes Issue (Unter-Issue wie bei GitHub "sub-issues"), null =
   * Top-Level. Der BCF-Import hängt alle Topics einer Datei unter ein
   * virtuelles Sammel-Issue.
   */
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueComment {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

/**
 * Modell-Verknüpfung eines Issues mit Versionsbezug: in welchem Commit ist
 * der Fehler aufgefallen, mit welchem Commit wurde er behoben (beides
 * optional, nachträglich setzbar).
 */
export interface IssueModelLink {
  modelId: string;
  foundCommitId: string | null;
  fixedCommitId: string | null;
}

/**
 * Zuordnungen eines Issues: Bearbeiter, Modelle (mit Versionsbezug), Labels,
 * betroffene IFC-GlobalIds (jeweils 0..n). Die GlobalIds verorten das Issue
 * im 3D-Viewer — z. B. die Verstöße einer fehlgeschlagenen Prüfung.
 */
export interface IssueLinks {
  assigneeIds: string[];
  models: IssueModelLink[];
  labelIds: string[];
  guids: string[];
}

/**
 * Zeitleisten-Ereignis eines Issues (wie GitHub "closed this", "added the
 * bug label"). Entsteht beim Ändern eines Issues, je tatsächlicher Änderung
 * eines; `data` hält Namen als Schnappschuss zum Ereigniszeitpunkt, damit
 * spätere Umbenennungen die Historie nicht verfälschen.
 */
export type IssueEventKind =
  | "closed"
  | "reopened"
  | "renamed"
  | "labeled"
  | "unlabeled"
  | "assigned"
  | "unassigned"
  | "linked_model"
  | "unlinked_model"
  | "parent_changed"
  | "kind_changed";

export interface IssueEventData {
  /** renamed: alter/neuer Titel; kind_changed: "virtual"/"bcf". */
  from?: string;
  to?: string;
  /** labeled/unlabeled — Schnappschuss zum Ereigniszeitpunkt. */
  labels?: { id: string; name: string; color: string }[];
  /** assigned/unassigned — Schnappschuss. */
  users?: { id: string; name: string }[];
  /** linked_model/unlinked_model — Schnappschuss. */
  models?: { id: string; slug: string; name: string }[];
  /** parent_changed: das NEUE übergeordnete Issue (null = gelöst). */
  parent?: { number: number; title: string } | null;
}

export interface IssueEvent {
  id: string;
  issueId: string;
  projectId: string;
  actorId: string;
  kind: IssueEventKind;
  data: IssueEventData;
  createdAt: string;
}

/**
 * Reihenfolge gleichzeitiger Ereignisse — alle Ereignisse einer Änderung
 * teilen sich `createdAt`; so zeigen alle Repository-Varianten sie gleich.
 */
const ISSUE_EVENT_ORDER: readonly IssueEventKind[] = [
  "renamed",
  "kind_changed",
  "parent_changed",
  "labeled",
  "unlabeled",
  "assigned",
  "unassigned",
  "linked_model",
  "unlinked_model",
  "closed",
  "reopened",
];

/** Sortierung der Zeitleiste: chronologisch, gleichzeitige in fester Folge. */
export function compareIssueEvents(a: IssueEvent, b: IssueEvent): number {
  return (
    a.createdAt.localeCompare(b.createdAt) ||
    ISSUE_EVENT_ORDER.indexOf(a.kind) - ISSUE_EVENT_ORDER.indexOf(b.kind)
  );
}

/**
 * Art einer Action: "ids" = IDS-Prüfung (buildingSMART-XML, läuft im Server),
 * "python" = beliebiges Python-Prüfskript (läuft als Kindprozess; Exit-Code 0
 * = bestanden).
 */
export type ActionKind = "ids" | "python";

/**
 * Zentraler Bibliothekseintrag: eine IDS-XML oder ein Python-Prüfskript,
 * projektübergreifend gespeichert. Projekt-Actions können statt einer
 * eigenen Datei einen Bibliothekseintrag referenzieren — Aktualisierungen
 * der Bibliotheksdatei gelten dann sofort in allen referenzierenden Actions.
 */
export interface LibraryFile {
  id: string;
  name: string;
  kind: ActionKind;
  /** Blob-Key der Datei im Object Store. */
  fileKey: string;
  fileName: string;
  ownerId: string;
  createdAt: string;
}

/**
 * Projektgebundene Prüf-Action (wie ein GitHub-Actions-Workflow).
 *
 * Geltungsbereich: beide Scope-Felder null = gilt für ALLE IFC-Modelle des
 * Projekts; `scopeFolder` = nur Modelle in diesem Ordner (inkl. Unterordner);
 * `scopeModelId` = nur genau dieses Modell. Es ist höchstens eines gesetzt.
 */
export interface Action {
  id: string;
  projectId: string;
  name: string;
  kind: ActionKind;
  /** Blob-Key der Datei (bei Bibliotheks-Actions der der Bibliotheksdatei). */
  fileKey: string;
  fileName: string;
  /** Gesetzt, wenn die Datei aus der zentralen Bibliothek kommt. */
  libraryFileId: string | null;
  scopeFolder: string | null;
  scopeModelId: string | null;
  /** Bei jedem neuen IFC-Commit (im Geltungsbereich) automatisch ausführen. */
  runOnCommit: boolean;
  createdAt: string;
}

/** Gilt die Action für dieses Modell? */
export function actionAppliesTo(
  action: Action,
  model: Pick<Model, "id" | "folder">,
): boolean {
  if (action.scopeModelId !== null) {
    return action.scopeModelId === model.id;
  }
  if (action.scopeFolder !== null) {
    return (
      model.folder === action.scopeFolder ||
      model.folder.startsWith(`${action.scopeFolder}/`)
    );
  }
  return true;
}

export type ActionRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "error"
  /** Vom Benutzer abgebrochen (wartend oder laufend). */
  | "cancelled";

/** Eine Ausführung einer Action gegen einen konkreten Commit. */
export interface ActionRun {
  id: string;
  projectId: string;
  actionId: string;
  modelId: string;
  commitId: string;
  /** Laufende Nummer je Projekt (wie GitHub-Run "#12"). */
  number: number;
  status: ActionRunStatus;
  /** Kurzfazit, z. B. "3/5 Spezifikationen bestanden". */
  summary: string;
  /** Vollständiges Ausführungsprotokoll (Report bzw. stdout/stderr). */
  log: string;
  /**
   * GlobalIds der beanstandeten Objekte (IDS: Verstöße; Python: Zeilen
   * "GUID: <id>" auf stdout) — Grundlage für "Issue erstellen" + 3D-Verortung.
   */
  failedGuids: string[];
  triggeredById: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Filter der projektübergreifenden "neueste zuerst"-Abfragen (Aktivitäts-
 * Feed): höchstens `limit` Zeilen je Quelle, nach `createdAt` absteigend.
 */
export interface RecentQuery {
  limit: number;
  /** Nur Einträge strikt vor diesem Zeitpunkt (ISO-8601). */
  before?: string;
  /** Nur Einträge dieses Benutzers (Autor bzw. Auslöser). */
  actorId?: string;
}

/** Commit samt seinem Modell (das Modell trägt die Projekt-Id). */
export interface CommitWithModel {
  commit: Commit;
  model: Model;
}

/** Issue-Kommentar samt Projekt-Id seines Issues. */
export interface CommentWithProject {
  comment: IssueComment;
  projectId: string;
}

/** Kennzahlen eines Projekts für Listen und Übersichten. */
export interface ProjectSummary {
  memberCount: number;
  modelCount: number;
  /** Offene Issues inkl. Unter-Issues. */
  openIssueCount: number;
  closedIssueCount: number;
  commitCount: number;
  /** Jüngster Commit eines Modells im Projekt (null = keiner). */
  lastCommitAt: string | null;
  /** Jüngstes `updatedAt` eines Issues (null = keine Issues). */
  lastIssueAt: string | null;
}

export function emptyProjectSummary(): ProjectSummary {
  return {
    memberCount: 0,
    modelCount: 0,
    openIssueCount: 0,
    closedIssueCount: 0,
    commitCount: 0,
    lastCommitAt: null,
    lastIssueAt: null,
  };
}

/** Beiträge eines UTC-Tages (Heatmap). */
export interface ActivityDayCount {
  /** "YYYY-MM-DD" (UTC). */
  day: string;
  commits: number;
  issues: number;
  comments: number;
}

/** Filter für Issue-Listen über mehrere Projekte. */
export interface IssueFilter {
  state?: IssueState;
  authorId?: string;
  assigneeId?: string;
  limit: number;
}

/** Gesamtzahlen für die Admin-Systemübersicht. */
export interface RepositoryCounts {
  users: number;
  projects: number;
  models: number;
  commits: number;
  issues: number;
  runs: number;
}

export interface Repository {
  /**
   * Führt `fn` atomar aus (SQL: BEGIN/COMMIT mit Rollback bei Fehler;
   * In-Memory: direkter Aufruf). Verschachtelte Aufrufe treten der äußeren
   * Transaktion bei.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  // Users
  createUser(input: Omit<User, "id" | "createdAt">): Promise<User>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  updateUser(
    userId: string,
    patch: Partial<Pick<User, "name" | "isAdmin" | "passwordHash">>,
  ): Promise<User | null>;
  /** Löscht den Benutzer samt Mitgliedschaften/Zuweisungen. */
  deleteUser(userId: string): Promise<void>;
  /** Hat der Benutzer Inhalte verfasst (Commits, Issues, Kommentare)? */
  userHasContent(userId: string): Promise<boolean>;
  listAllProjects(): Promise<Project[]>;

  // Projects + membership
  createProject(
    input: Omit<Project, "id" | "createdAt" | "description"> & {
      /** Standard: "" (keine Beschreibung). */
      description?: string;
    },
  ): Promise<Project>;
  getProjectBySlug(slug: string): Promise<Project | null>;
  listProjectsForUser(userId: string): Promise<Project[]>;
  listPublicProjects(): Promise<Project[]>;
  updateProject(
    projectId: string,
    patch: Partial<Pick<Project, "name" | "visibility" | "description">>,
  ): Promise<Project | null>;
  /**
   * Kennzahlen je Projekt (Mitglieder, Modelle, Issues, Commits, letzte
   * Aktivität) in wenigen gruppierten Abfragen statt je Projekt einzeln.
   */
  projectSummaries(projectIds: string[]): Promise<Map<string, ProjectSummary>>;
  addMember(member: Member): Promise<Member>;
  getMember(projectId: string, userId: string): Promise<Member | null>;
  listMembers(projectId: string): Promise<Member[]>;
  removeMember(projectId: string, userId: string): Promise<void>;

  // Models
  createModel(input: Omit<Model, "id" | "createdAt">): Promise<Model>;
  getModel(projectId: string, slug: string): Promise<Model | null>;
  listModels(projectId: string): Promise<Model[]>;
  updateModel(
    modelId: string,
    patch: Partial<
      Pick<Model, "name" | "visibility" | "defaultBranch" | "folder">
    >,
  ): Promise<Model | null>;
  /**
   * Delete a model with its branches, commits, manifests and cached diffs.
   * Returns the blob keys of the deleted commits so the caller can clean up
   * the object store. Shared entity payloads (content-addressed) stay.
   */
  deleteModel(modelId: string): Promise<string[]>;

  /** Delete a project with members and all its models; returns all blob keys. */
  deleteProject(projectId: string): Promise<string[]>;

  // Folders (explizit angelegte, ggf. leere Ordner; Modelle können daneben
  // implizit Ordner über ihr `folder`-Feld definieren)
  listFolders(projectId: string): Promise<string[]>;
  addFolder(projectId: string, path: string): Promise<void>;
  removeFolder(projectId: string, path: string): Promise<void>;

  // Labels
  createLabel(
    input: Omit<Label, "id" | "description"> & { description?: string },
  ): Promise<Label>;
  listLabels(projectId: string): Promise<Label[]>;
  getLabel(labelId: string): Promise<Label | null>;
  updateLabel(
    labelId: string,
    patch: Partial<Pick<Label, "name" | "color" | "description">>,
  ): Promise<Label | null>;
  /** Löscht das Label und entfernt es von allen Issues. */
  deleteLabel(labelId: string): Promise<void>;
  /** Anzahl OFFENER Issues je Label-Id (Labels ohne offene Issues fehlen). */
  countOpenIssuesByLabel(projectId: string): Promise<Map<string, number>>;

  // Issues
  createIssue(
    input: Omit<Issue, "id" | "number" | "createdAt" | "updatedAt"> & {
      /** Feste Id (z. B. BCF-Topic-Guid beim Import); sonst zufällig. */
      id?: string;
    },
  ): Promise<Issue>;
  /** Issue + Zuordnungen atomar anlegen (inkl. Retry bei Nummern-Races). */
  createIssueWithLinks(
    input: Omit<Issue, "id" | "number" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
    links: Partial<IssueLinks>,
  ): Promise<Issue>;
  getIssue(projectId: string, number: number): Promise<Issue | null>;
  /** Issue direkt über die Id (projektübergreifend, für BCF-Dedupe). */
  getIssueById(issueId: string): Promise<Issue | null>;
  listIssues(projectId: string): Promise<Issue[]>;
  updateIssue(
    issueId: string,
    patch: Partial<
      Pick<Issue, "title" | "body" | "state" | "kind" | "parentId">
    >,
  ): Promise<Issue | null>;
  /** Ersetzt die jeweils übergebenen Zuordnungs-Mengen komplett. */
  setIssueLinks(issueId: string, links: Partial<IssueLinks>): Promise<void>;
  getIssueLinks(issueIds: string[]): Promise<Map<string, IssueLinks>>;
  /** Issues mehrerer Projekte nach Filter, jüngste Aktivität (updatedAt) zuerst. */
  listIssuesByFilter(projectIds: string[], filter: IssueFilter): Promise<Issue[]>;
  /** Kommentare je Issue zählen (jede angefragte Id ist enthalten, ggf. 0). */
  countIssueComments(issueIds: string[]): Promise<Map<string, number>>;
  /** Direkte Unter-Issues je Issue zählen (jede angefragte Id ist enthalten). */
  countSubIssues(issueIds: string[]): Promise<Map<string, number>>;

  // Issue-Zeitleiste (alle Ereignisse eines Aufrufs teilen sich createdAt)
  createIssueEvents(
    events: Omit<IssueEvent, "id" | "createdAt">[],
  ): Promise<IssueEvent[]>;
  /** Ereignisse eines Issues, chronologisch (siehe compareIssueEvents). */
  listIssueEvents(issueId: string): Promise<IssueEvent[]>;

  // Issue-Kommentare
  createIssueComment(
    input: Omit<IssueComment, "id" | "createdAt">,
  ): Promise<IssueComment>;
  listIssueComments(issueId: string): Promise<IssueComment[]>;
  getIssueComment(commentId: string): Promise<IssueComment | null>;
  deleteIssueComment(commentId: string): Promise<void>;

  // Actions (Prüf-Workflows) + Runs
  // Die Id kommt vom Aufrufer (wie bei createCommit), weil der Blob-Key der
  // hinterlegten Datei die Action-Id enthält.
  createAction(input: Omit<Action, "createdAt">): Promise<Action>;
  getAction(actionId: string): Promise<Action | null>;
  listActions(projectId: string): Promise<Action[]>;

  // Zentrale Skript-/IDS-Bibliothek (projektübergreifend)
  createLibraryFile(
    input: Omit<LibraryFile, "createdAt">,
  ): Promise<LibraryFile>;
  getLibraryFile(fileId: string): Promise<LibraryFile | null>;
  listLibraryFiles(): Promise<LibraryFile[]>;
  updateLibraryFile(
    fileId: string,
    patch: Partial<Pick<LibraryFile, "name" | "fileName">>,
  ): Promise<LibraryFile | null>;
  deleteLibraryFile(fileId: string): Promise<void>;
  /** Wie viele Actions (über alle Projekte) referenzieren die Datei? */
  countActionsUsingLibraryFile(fileId: string): Promise<number>;
  updateAction(
    actionId: string,
    patch: Partial<Pick<Action, "name" | "runOnCommit" | "fileName">>,
  ): Promise<Action | null>;
  /** Löscht die Action samt ihrer Runs. */
  deleteAction(actionId: string): Promise<void>;

  createActionRun(
    input: Omit<ActionRun, "id" | "number" | "createdAt">,
  ): Promise<ActionRun>;
  getActionRun(runId: string): Promise<ActionRun | null>;
  listActionRuns(
    projectId: string,
    filter?: { actionId?: string; modelId?: string; commitId?: string },
  ): Promise<ActionRun[]>;
  /** Alle Runs mit Status queued/running (projektübergreifend, älteste zuerst) — für die Recovery beim Start. */
  listUnfinishedActionRuns(): Promise<ActionRun[]>;
  /** Runs eines Projekts je Status zählen (ohne Protokolle zu laden). */
  countActionRunsByStatus(
    projectId: string,
  ): Promise<Map<ActionRunStatus, number>>;
  updateActionRun(
    runId: string,
    patch: Partial<
      Pick<
        ActionRun,
        "status" | "summary" | "log" | "failedGuids" | "startedAt" | "finishedAt"
      >
    >,
  ): Promise<ActionRun | null>;

  // Branches
  createBranch(input: Omit<Branch, "id">): Promise<Branch>;
  getBranch(modelId: string, name: string): Promise<Branch | null>;
  listBranches(modelId: string): Promise<Branch[]>;
  setBranchHead(branchId: string, headCommitId: string): Promise<void>;

  // Commits
  createCommit(commit: Commit): Promise<Commit>;
  getCommit(id: string): Promise<Commit | null>;
  listCommits(modelId: string, branchName?: string): Promise<Commit[]>;
  /** Commits aller Modelle eines Projekts je Autor zählen (meiste zuerst). */
  countCommitsByAuthor(
    projectId: string,
  ): Promise<{ authorId: string; count: number }[]>;

  // Aktivitäts-Feed: projektübergreifend, neueste zuerst, je Quelle
  // höchstens `limit` Zeilen (der Aufrufer mischt und kürzt).
  listRecentCommits(
    projectIds: string[],
    query: RecentQuery,
  ): Promise<CommitWithModel[]>;
  /** Eröffnete Issues (actorId = Autor). */
  listRecentIssues(projectIds: string[], query: RecentQuery): Promise<Issue[]>;
  listRecentIssueEvents(
    projectIds: string[],
    query: RecentQuery & { kinds?: IssueEventKind[] },
  ): Promise<IssueEvent[]>;
  listRecentComments(
    projectIds: string[],
    query: RecentQuery,
  ): Promise<CommentWithProject[]>;
  /** Runs ohne Protokoll (actorId = Auslöser). */
  listRecentRuns(
    projectIds: string[],
    query: RecentQuery,
  ): Promise<Omit<ActionRun, "log">[]>;
  /** Commits, eröffnete Issues und Kommentare je UTC-Tag ab `since` ("YYYY-MM-DD"). */
  activityDayCounts(
    projectIds: string[],
    query: { since: string; actorId?: string },
  ): Promise<ActivityDayCount[]>;

  // Suche (Befehlspalette): Teilstring ohne Groß-/Kleinschreibung,
  // Präfix-Treffer zuerst.
  /** Modelle nach Name/Slug/Ordner; danach alphabetisch nach Name. */
  searchModels(
    projectIds: string[],
    text: string,
    limit: number,
  ): Promise<Model[]>;
  /** Issues nach Titel oder exakter Nummer (die zuerst); danach neueste zuerst. */
  searchIssues(
    projectIds: string[],
    query: { text: string; number?: number; limit: number },
  ): Promise<Issue[]>;

  /** Gesamtzahlen für die Admin-Systemübersicht. */
  counts(): Promise<RepositoryCounts>;

  // Version manifests (content-addressable, deduped entity store)
  saveManifest(
    commitId: string,
    entries: VersionManifestEntry[],
  ): Promise<void>;
  getManifest(commitId: string): Promise<VersionManifestEntry[]>;

  // Objekt-Records (objektzentrierter Diff: Attribute, Lage, Geometrie,
  // Eigenschaften, Beziehungen) — Details dedupliziert über record_hash.
  saveObjectRecords(commitId: string, records: ObjectRecord[]): Promise<void>;
  /** false = Commit stammt aus der Zeit vor den Records (Backfill nötig). */
  hasObjectIndex(commitId: string): Promise<boolean>;
  getObjectIndex(commitId: string): Promise<ObjectIndexEntry[]>;
  getObjectDetails(recordHashes: string[]): Promise<Map<string, ObjectDetail>>;
  /** Diff-Zähler eines Commits nachziehen (Backfill alter Commits). */
  updateCommitStats(
    commitId: string,
    stats: { added: number; removed: number; modified: number },
  ): Promise<void>;

  // Diff cache (commits are immutable, so cached diffs never go stale)
  getCachedDiff(
    fromCommitId: string,
    toCommitId: string,
  ): Promise<GuidDiffSummary | null>;
  saveCachedDiff(
    fromCommitId: string,
    toCommitId: string,
    summary: GuidDiffSummary,
  ): Promise<void>;
}
