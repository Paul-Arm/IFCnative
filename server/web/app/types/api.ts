// Mirrors the REST API response shapes of the IFC-VCS server (server/src).

export type Role = "owner" | "maintainer" | "contributor" | "viewer";

export interface ApiUser {
  id: string;
  email: string;
  name: string;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  createdAt: string;
  role?: Role | null;
  modelCount?: number;
}

export interface Member {
  projectId: string;
  userId: string;
  role: Role;
  user: ApiUser | null;
}

export interface Commit {
  id: string;
  modelId: string;
  branchName: string;
  parentCommitId: string | null;
  manifestHash: string;
  schema: string;
  authorId: string;
  message: string;
  createdAt: string;
  entityCount: number;
  added: number;
  removed: number;
  modified: number;
  author?: ApiUser | null;
}

export interface Model {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  visibility: "private" | "public";
  defaultBranch: string;
  createdAt: string;
  branchCount?: number;
  head?: Commit | null;
}

export interface Branch {
  id: string;
  modelId: string;
  name: string;
  headCommitId: string | null;
  head?: Commit | null;
}

export type GuidChangeStatus = "added" | "removed" | "modified";

export interface GuidDiffEntry {
  globalId: string;
  type: string;
  name: string;
  status: GuidChangeStatus;
}

export interface GuidDiffSummary {
  added: GuidDiffEntry[];
  removed: GuidDiffEntry[];
  modified: GuidDiffEntry[];
  unchanged: number;
  identical: boolean;
}

export interface EntityFieldChange {
  group: string;
  field: string;
  before: string | null;
  after: string | null;
  status: GuidChangeStatus;
}

export interface EntityFieldDiff {
  globalId: string;
  type: string | null;
  name: string | null;
  present: { before: boolean; after: boolean };
  changes: EntityFieldChange[];
}
