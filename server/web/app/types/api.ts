// Mirrors the REST API response shapes of the IFC-VCS server (server/src).

export type Role = "owner" | "maintainer" | "contributor" | "viewer";

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean;
}

export interface AdminUser extends ApiUser {
  createdAt: string;
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

/** "virtual" = nur im Server; "bcf" = echtes IFC-Issue (BCF-exportierbar). */
export type IssueKind = "virtual" | "bcf";

/** Kurzinfo eines referenzierten Commits (aufgefallen/behoben in). */
export interface IssueCommitRef {
  id: string;
  message: string;
  branchName: string;
  createdAt: string;
}

export interface IssueModelRef {
  id: string;
  slug: string;
  name: string;
  folder: string;
  kind: "ifc" | "md";
  /** Commit, in dem der Fehler aufgefallen ist (optional). */
  foundCommitId: string | null;
  /** Commit, mit dem der Fehler behoben wurde (optional). */
  fixedCommitId: string | null;
  foundCommit: IssueCommitRef | null;
  fixedCommit: IssueCommitRef | null;
}

export interface Issue {
  id: string;
  projectId: string;
  number: number;
  title: string;
  body: string;
  state: IssueState;
  kind: IssueKind;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author: ApiUser | null;
  assignees: ApiUser[];
  models: IssueModelRef[];
  labels: Label[];
  /** Betroffene IFC-GlobalIds — verorten das Issue im 3D-Viewer. */
  guids: string[];
}

export interface IssueComment {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: string;
  author: ApiUser | null;
}

// ---- Actions (Prüf-Workflows) -----------------------------------------

export type ActionKind = "ids" | "python";

export interface Action {
  id: string;
  projectId: string;
  name: string;
  kind: ActionKind;
  fileName: string;
  /** Gesetzt, wenn die Prüfdatei aus der zentralen Bibliothek kommt. */
  libraryFileId: string | null;
  /** Name des Bibliothekseintrags (nur im Projekt-Listing enthalten). */
  libraryName?: string | null;
  /** Geltungsbereich: beide null = alle Modelle; sonst Ordner ODER Modell. */
  scopeFolder: string | null;
  scopeModelId: string | null;
  /** Name des Geltungsbereich-Modells (nur im Projekt-Listing). */
  scopeModelName?: string | null;
  runOnCommit: boolean;
  createdAt: string;
}

/** Gilt die Action für dieses Modell? (Spiegel der Server-Logik.) */
export function actionAppliesTo(
  action: Action,
  model: { id: string; folder: string },
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

/** Eintrag der zentralen Skript-/IDS-Bibliothek (projektübergreifend). */
export interface LibraryFile {
  id: string;
  name: string;
  kind: ActionKind;
  fileName: string;
  ownerId: string;
  createdAt: string;
  usageCount: number;
  owner: ApiUser | null;
}

export type ActionRunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "error";

export interface ActionRun {
  id: string;
  projectId: string;
  actionId: string;
  modelId: string;
  commitId: string;
  number: number;
  status: ActionRunStatus;
  summary: string;
  /** GlobalIds der beanstandeten Objekte (für Issues + 3D-Verortung). */
  failedGuids: string[];
  triggeredById: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  action: { id: string; name: string; kind: ActionKind } | null;
  model: { id: string; slug: string; name: string } | null;
  triggeredBy: ApiUser | null;
  /** Nur im Run-Detail (/runs/:id) enthalten. */
  log?: string;
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
