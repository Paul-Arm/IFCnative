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

/**
 * Herkunft eines im Editor geöffneten Dokuments aus dem IFC Hub. Dokumente
 * mit Origin bieten beim Speichern zusätzlich "auf den Hub committen" an.
 */
export interface VcsDocumentOrigin {
  projectSlug: string;
  projectName: string;
  modelSlug: string;
  modelName: string;
  branch: string;
  /** Commit, von dem der Stand geladen wurde (null = Branch war leer). */
  commitId: string | null;
}

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
  /** Ordnerpfad im Projekt ("" = Wurzel). */
  folder: string;
  /** "ifc" oder "md" (Markdown-Dokument, für den Editor irrelevant). */
  kind: "ifc" | "md";
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

// ---- Actions (Prüf-Workflows) + Runs -----------------------------------

export type VcsActionKind = "ids" | "python";

export interface VcsAction {
  id: string;
  projectId: string;
  name: string;
  kind: VcsActionKind;
  fileName: string;
  libraryFileId: string | null;
  libraryName?: string | null;
  /** Geltungsbereich: beide null = alle Modelle; sonst Ordner ODER Modell. */
  scopeFolder: string | null;
  scopeModelId: string | null;
  scopeModelName?: string | null;
  runOnCommit: boolean;
  createdAt: string;
}

/** Gilt die Action für dieses Modell? (Spiegel der Server-Logik.) */
export function vcsActionAppliesTo(
  action: VcsAction,
  model: Pick<VcsModel, "id" | "folder">,
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

export type VcsRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "error";

export interface VcsActionRun {
  id: string;
  projectId: string;
  actionId: string;
  modelId: string;
  commitId: string;
  number: number;
  status: VcsRunStatus;
  summary: string;
  /** GlobalIds der beanstandeten Objekte (3D-Verortung / Issues). */
  failedGuids: string[];
  createdAt: string;
  action: { id: string; name: string; kind: VcsActionKind } | null;
  model: { id: string; slug: string; name: string } | null;
  triggeredBy: VcsUser | null;
  /** Nur im Run-Detail enthalten. */
  log?: string;
}

// ---- Issues -------------------------------------------------------------

export type VcsIssueKind = "virtual" | "bcf";

export interface VcsIssueCommitRef {
  id: string;
  message: string;
  branchName: string;
  createdAt: string;
}

export interface VcsIssueModelRef {
  id: string;
  slug: string;
  name: string;
  folder: string;
  kind: "ifc" | "md";
  foundCommitId: string | null;
  fixedCommitId: string | null;
  foundCommit: VcsIssueCommitRef | null;
  fixedCommit: VcsIssueCommitRef | null;
}

export interface VcsIssue {
  id: string;
  projectId: string;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  kind: VcsIssueKind;
  createdAt: string;
  updatedAt: string;
  author: VcsUser | null;
  assignees: VcsUser[];
  models: VcsIssueModelRef[];
  /** Betroffene IFC-GlobalIds — im Editor direkt auswählbar. */
  guids: string[];
}

/** Eingabe für ein neues Issue aus dem Editor heraus. */
export interface VcsIssueInput {
  title: string;
  body?: string;
  kind?: VcsIssueKind;
  modelLinks?: {
    modelId: string;
    foundCommitId?: string | null;
    fixedCommitId?: string | null;
  }[];
  guids?: string[];
}
