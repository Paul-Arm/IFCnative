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
 * "md" = Markdown-Dokument (z. B. README), versioniert ohne Objekt-Diff.
 */
export type ModelKind = "ifc" | "md";

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
 * Zuordnungen eines Issues: Bearbeiter, Modelle, Labels, betroffene
 * IFC-GlobalIds (jeweils 0..n). Die GlobalIds verorten das Issue im
 * 3D-Viewer — z. B. die Verstöße einer fehlgeschlagenen Prüfung.
 */
export interface IssueLinks {
  assigneeIds: string[];
  modelIds: string[];
  labelIds: string[];
  guids: string[];
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

/** Projektgebundene Prüf-Action (wie ein GitHub-Actions-Workflow). */
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
  /** Bei jedem neuen IFC-Commit automatisch ausführen. */
  runOnCommit: boolean;
  createdAt: string;
}

export type ActionRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "error";

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

export interface Repository {
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
  createProject(input: Omit<Project, "id" | "createdAt">): Promise<Project>;
  getProjectBySlug(slug: string): Promise<Project | null>;
  listProjectsForUser(userId: string): Promise<Project[]>;
  listPublicProjects(): Promise<Project[]>;
  updateProject(
    projectId: string,
    patch: Partial<Pick<Project, "name" | "visibility">>,
  ): Promise<Project | null>;
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
  createLabel(input: Omit<Label, "id">): Promise<Label>;
  listLabels(projectId: string): Promise<Label[]>;

  // Issues
  createIssue(
    input: Omit<Issue, "id" | "number" | "createdAt" | "updatedAt"> & {
      /** Feste Id (z. B. BCF-Topic-Guid beim Import); sonst zufällig. */
      id?: string;
    },
  ): Promise<Issue>;
  getIssue(projectId: string, number: number): Promise<Issue | null>;
  /** Issue direkt über die Id (projektübergreifend, für BCF-Dedupe). */
  getIssueById(issueId: string): Promise<Issue | null>;
  listIssues(projectId: string): Promise<Issue[]>;
  updateIssue(
    issueId: string,
    patch: Partial<Pick<Issue, "title" | "body" | "state" | "kind">>,
  ): Promise<Issue | null>;
  /** Ersetzt die jeweils übergebenen Zuordnungs-Mengen komplett. */
  setIssueLinks(issueId: string, links: Partial<IssueLinks>): Promise<void>;
  getIssueLinks(issueIds: string[]): Promise<Map<string, IssueLinks>>;

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

  // Version manifests (content-addressable, deduped entity store)
  saveManifest(
    commitId: string,
    entries: VersionManifestEntry[],
  ): Promise<void>;
  getManifest(commitId: string): Promise<VersionManifestEntry[]>;

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
