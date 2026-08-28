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
  visibility: "private" | "public";
  role?: Role | null;
  modelCount?: number;
  /** Ob ein Projektbild (Szenen-Screenshot) hinterlegt ist. */
  hasImage?: boolean;
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
  /** Ordnerpfad im Projekt ("" = Wurzel), Segmente mit "/" getrennt. */
  folder: string;
  /** "ifc" = IFC-Modell mit semantischem Diff, "md" = Markdown-Dokument. */
  kind: "ifc" | "md";
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

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export type IssueState = "open" | "closed";

export interface IssueModelRef {
  id: string;
  slug: string;
  name: string;
  folder: string;
  kind: "ifc" | "md";
}

export interface Issue {
  id: string;
  projectId: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author: ApiUser | null;
  assignees: ApiUser[];
  models: IssueModelRef[];
  labels: Label[];
}

export interface IssueComment {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: string;
  author: ApiUser | null;
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
