// Mirrors the REST API response shapes of the IFC Hub server (server/src).

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
  /** Kurzbeschreibung („About“), "" = keine. */
  description?: string;
  ownerId: string;
  createdAt: string;
  visibility: "private" | "public";
  role?: Role | null;
  modelCount?: number;
  /** Ob ein Projektbild (Szenen-Screenshot) hinterlegt ist. */
  hasImage?: boolean;
  memberCount?: number;
  openIssueCount?: number;
  /** Letzte Aktivität (Commit, Issue) — für die Sortierung im Dashboard. */
  lastActivityAt?: string;
}

export interface Member {
  projectId: string;
  userId: string;
  role: Role;
  user: ApiUser | null;
}

/** Antwort von GET /projects/:slug */
export interface ProjectDetail {
  project: Project;
  members: Member[];
  role: Role | null;
  folders: string[];
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
  /**
   * "ifc" = IFC-Modell mit semantischem Diff, "md" = Markdown-Dokument,
   * "file" = beliebige Datei (PDF, Word, DWG, …).
   */
  kind: ModelKind;
  branchCount?: number;
  head?: Commit | null;
}

export type ModelKind = "ifc" | "md" | "file";

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
  description?: string;
  /** Nur in GET …/labels: Zahl der offenen Issues mit diesem Label. */
  issueCount?: number;
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
  kind: ModelKind;
  /** Commit, in dem der Fehler aufgefallen ist (optional). */
  foundCommitId: string | null;
  /** Commit, mit dem der Fehler behoben wurde (optional). */
  fixedCommitId: string | null;
  foundCommit: IssueCommitRef | null;
  fixedCommit: IssueCommitRef | null;
}

/** Kurzinfo eines übergeordneten Issues. */
export interface IssueParentRef {
  id: string;
  number: number;
  title: string;
  state: IssueState;
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
  /** Übergeordnetes Issue (Unter-Issue), null = Top-Level. */
  parentId: string | null;
  parent: IssueParentRef | null;
  /** Zahl der direkten Unter-Issues (gesamt / davon offen). */
  subIssueCount: number;
  openSubIssueCount: number;
  createdAt: string;
  updatedAt: string;
  author: ApiUser | null;
  assignees: ApiUser[];
  models: IssueModelRef[];
  labels: Label[];
  /** Betroffene IFC-GlobalIds — verorten das Issue im 3D-Viewer. */
  guids: string[];
  /** Zahl der Kommentare (Listenanzeige). */
  commentCount?: number;
}

export interface IssueComment {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: string;
  author: ApiUser | null;
}

// ---- Issue-Verlauf (Timeline-Ereignisse) --------------------------------

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
  from?: string;
  to?: string;
  labels?: { id: string; name: string; color: string }[];
  users?: { id: string; name: string }[];
  models?: { id: string; slug: string; name: string }[];
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
  actor: ApiUser | null;
}

/** Antwort von GET /projects/:slug/issues/:number */
export interface IssueDetail {
  issue: Issue;
  comments: IssueComment[];
  subIssues: Issue[];
  events?: IssueEvent[];
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
  | "error"
  | "cancelled";

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

// ---- Aktivität, Beiträge, Suche, Statistik ------------------------------

export type ActivityType =
  | "commit"
  | "issue_opened"
  | "issue_closed"
  | "issue_reopened"
  | "comment"
  | "run"
  | "project_created";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  at: string;
  actor: ApiUser | null;
  project: { slug: string; name: string };
  model?: { slug: string; name: string; kind: ModelKind; folder: string };
  commit?: {
    id: string;
    message: string;
    branchName: string;
    added: number;
    removed: number;
    modified: number;
    schema: string;
  };
  issue?: { number: number; title: string; state: IssueState; kind: IssueKind };
  comment?: { id: string; excerpt: string };
  run?: {
    id: string;
    number: number;
    status: ActionRunStatus;
    summary: string;
    actionName: string;
    commitId: string;
  };
}

export interface ActivityPage {
  events: ActivityEvent[];
  nextBefore: string | null;
}

export interface ContributionDay {
  date: string;
  commits: number;
  issues: number;
  comments: number;
  total: number;
}

export interface Contributions {
  days: ContributionDay[];
  total: number;
  from: string;
  to: string;
}

export interface SearchResults {
  projects: Project[];
  models: {
    id: string;
    slug: string;
    name: string;
    kind: ModelKind;
    folder: string;
    project: { slug: string; name: string };
  }[];
  issues: {
    id: string;
    number: number;
    title: string;
    state: IssueState;
    kind: IssueKind;
    createdAt: string;
    project: { slug: string; name: string };
  }[];
}

export interface ProjectStats {
  commitCount: number;
  branchCount: number;
  contributors: { user: ApiUser | null; commits: number }[];
  kinds: { kind: ModelKind; extension: string; count: number }[];
  issues: { open: number; closed: number };
  runs: {
    total: number;
    success: number;
    failed: number;
    error: number;
    running: number;
    queued: number;
    cancelled: number;
  };
  lastCommit:
    | (Commit & {
        author: ApiUser | null;
        model: { slug: string; name: string; kind: ModelKind; folder: string };
      })
    | null;
  entityCount: number;
  modelCount: number;
  folderCount: number;
  memberCount: number;
}

export interface MyIssue {
  id: string;
  number: number;
  title: string;
  state: IssueState;
  kind: IssueKind;
  createdAt: string;
  updatedAt: string;
  project: { slug: string; name: string };
  labels: Label[];
  commentCount: number;
  subIssueCount: number;
}

export interface SystemInfo {
  version: string;
  storage: "filesystem" | "azure";
  database: "sqlite" | "postgres" | "memory";
  node: string;
  uptimeSec: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  workers: number;
  runner: { queued: number; running: number };
  counts: {
    users: number;
    projects: number;
    models: number;
    commits: number;
    issues: number;
    runs: number;
  };
}

// ---- Diffs --------------------------------------------------------------

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

/** Diff-Übersicht (GET …/diff): nur Zähler je Status und IFC-Typ. */
export interface DiffTypeCount {
  type: string;
  count: number;
}

export interface DiffStatusOverview {
  count: number;
  types: DiffTypeCount[];
}

export interface DiffOverview {
  identical: boolean;
  unchanged: number;
  added: DiffStatusOverview;
  modified: DiffStatusOverview;
  removed: DiffStatusOverview;
}

/** Seite von Diff-Einträgen (GET …/diff/entries). */
export interface DiffPage {
  entries: GuidDiffEntry[];
  total: number;
  offset: number;
  limit: number;
}

// ---- Objektzentrierter Diff (GET …/changes*) ---------------------------

export type ChangeFacet =
  | "attributes"
  | "placement"
  | "geometry"
  | "properties"
  | "relations";

export interface ChangesStatusOverview {
  count: number;
  types: DiffTypeCount[];
}

/** Übersicht (GET …/changes): Zähler je Status, Typ, Facette, Container. */
export interface ChangesOverview {
  identical: boolean;
  unchanged: number;
  added: ChangesStatusOverview;
  modified: ChangesStatusOverview;
  removed: ChangesStatusOverview;
  facets: Record<ChangeFacet, number>;
  containers: { name: string; count: number }[];
}

export interface ObjectFieldChange {
  facet: ChangeFacet;
  group: string;
  field: string;
  before: string | null;
  after: string | null;
  status: GuidChangeStatus;
}

/** Zeile der Änderungsliste — trägt ihre wichtigsten Werte gleich mit. */
export interface ChangeItem {
  globalId: string;
  type: string;
  name: string;
  container: string;
  status: GuidChangeStatus;
  facets: ChangeFacet[];
  highlights: ObjectFieldChange[];
  changeCount: number;
  facts: { label: string; value: string }[];
}

export interface ChangesPage {
  items: ChangeItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface ChangesGuids {
  added: string[];
  modified: string[];
  removed: string[];
  truncated: boolean;
}

export interface ObjectChangeDetail {
  entry: ChangeItem;
  changes: ObjectFieldChange[];
}
