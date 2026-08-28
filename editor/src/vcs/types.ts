/**
 * Typen für die IFC-Ablage (der Versionskontroll-Server in ../server).
 * Die Response-Formen spiegeln server/src/http/app.ts.
 */

export interface VcsSettings {
  /** Basis-URL des Servers, z. B. "http://localhost:8787". */
  baseUrl: string;
}

export function createDefaultVcsSettings(): VcsSettings {
  return { baseUrl: "http://localhost:8787" };
}

export interface VcsUser {
  id: string;
  email: string;
  name: string;
}

/** Angemeldete Sitzung: JWT-Bearer-Token + Benutzer. */
export interface VcsAuth {
  token: string;
  user: VcsUser;
}

export type VcsRole = "owner" | "maintainer" | "contributor" | "viewer";

export interface VcsProject {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  createdAt: string;
  role?: VcsRole | null;
  modelCount?: number;
}

export interface VcsCommit {
  id: string;
  modelId: string;
  branchName: string;
  parentCommitId: string | null;
  schema: string;
  message: string;
  createdAt: string;
  entityCount: number;
  added: number;
  removed: number;
  modified: number;
  author?: VcsUser | null;
}

export interface VcsModel {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  visibility: "private" | "public";
  defaultBranch: string;
  createdAt: string;
  branchCount?: number;
  head?: VcsCommit | null;
}

export interface VcsBranch {
  id: string;
  modelId: string;
  name: string;
  headCommitId: string | null;
  head?: VcsCommit | null;
}

export interface VcsDiffEntry {
  globalId: string;
  type: string;
  name: string;
  status: "added" | "removed" | "modified";
}

export interface VcsDiffSummary {
  added: VcsDiffEntry[];
  removed: VcsDiffEntry[];
  modified: VcsDiffEntry[];
  unchanged: number;
  identical: boolean;
}

export interface VcsHealth {
  status: string;
  version: string;
  storage: "filesystem" | "azure";
}
