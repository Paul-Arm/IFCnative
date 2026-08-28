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

export interface Issue {
  id: string;
  projectId: string;
  /** Laufende Nummer je Projekt (wie GitHub "#12"). */
  number: number;
  title: string;
  body: string;
  state: IssueState;
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

/** Zuordnungen eines Issues: Bearbeiter, Modelle, Labels (jeweils 0..n). */
export interface IssueLinks {
  assigneeIds: string[];
  modelIds: string[];
  labelIds: string[];
}

export interface Repository {
  // Users
  createUser(input: Omit<User, "id" | "createdAt">): Promise<User>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;

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
    input: Omit<Issue, "id" | "number" | "createdAt" | "updatedAt">,
  ): Promise<Issue>;
  getIssue(projectId: string, number: number): Promise<Issue | null>;
  listIssues(projectId: string): Promise<Issue[]>;
  updateIssue(
    issueId: string,
    patch: Partial<Pick<Issue, "title" | "body" | "state">>,
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
