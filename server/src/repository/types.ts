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
} from "../../../src/ifc/versioning/entityDiffByGuid";

export type Role = "owner" | "maintainer" | "contributor" | "viewer";

/** Roles permitted to push commits / mutate a project. */
export const WRITE_ROLES: ReadonlySet<Role> = new Set<Role>([
  "owner",
  "maintainer",
  "contributor",
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
}

export interface Member {
  projectId: string;
  userId: string;
  role: Role;
}

export type Visibility = "private" | "public";

export interface Model {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  visibility: Visibility;
  defaultBranch: string;
  createdAt: string;
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

export interface Repository {
  // Users
  createUser(input: Omit<User, "id" | "createdAt">): Promise<User>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;

  // Projects + membership
  createProject(input: Omit<Project, "id" | "createdAt">): Promise<Project>;
  getProjectBySlug(slug: string): Promise<Project | null>;
  listProjectsForUser(userId: string): Promise<Project[]>;
  addMember(member: Member): Promise<Member>;
  getMember(projectId: string, userId: string): Promise<Member | null>;
  listMembers(projectId: string): Promise<Member[]>;

  // Models
  createModel(input: Omit<Model, "id" | "createdAt">): Promise<Model>;
  getModel(projectId: string, slug: string): Promise<Model | null>;
  listModels(projectId: string): Promise<Model[]>;

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
