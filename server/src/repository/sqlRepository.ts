import { randomUUID } from "node:crypto";

import type {
  GuidDiffSummary,
  VersionManifestEntry,
} from "../ifc";
import { schemaStatements } from "./sql/schema";
import type { SqlClient } from "./sql/sqlClient";
import type {
  Action,
  ActionKind,
  ActionRun,
  ActionRunStatus,
  Branch,
  LibraryFile,
  Commit,
  Issue,
  IssueComment,
  IssueLinks,
  IssueState,
  Label,
  Member,
  Model,
  ModelKind,
  Project,
  Repository,
  Role,
  User,
  Visibility,
} from "./types";

/** Insert rows in chunks to stay well under Postgres' parameter limit. */
const INSERT_CHUNK = 400;

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: string;
  is_admin: number;
}
interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  created_at: string;
  visibility: Visibility;
}
interface MemberRow {
  project_id: string;
  user_id: string;
  role: Role;
}
interface ModelRow {
  id: string;
  project_id: string;
  slug: string;
  name: string;
  visibility: Visibility;
  default_branch: string;
  created_at: string;
  folder: string;
  kind: ModelKind;
}
interface BranchRow {
  id: string;
  model_id: string;
  name: string;
  head_commit_id: string | null;
}
interface CommitRow {
  id: string;
  model_id: string;
  branch_name: string;
  parent_commit_id: string | null;
  manifest_hash: string;
  blob_key: string;
  schema: string;
  author_id: string;
  message: string;
  created_at: string;
  entity_count: number;
  added: number;
  removed: number;
  modified: number;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    isAdmin: Boolean(row.is_admin),
  };
}
function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    visibility: row.visibility ?? "public",
  };
}
function toModel(row: ModelRow): Model {
  return {
    id: row.id,
    projectId: row.project_id,
    slug: row.slug,
    name: row.name,
    visibility: row.visibility,
    defaultBranch: row.default_branch,
    createdAt: row.created_at,
    folder: row.folder ?? "",
    kind: row.kind ?? "ifc",
  };
}
interface ActionRow {
  id: string;
  project_id: string;
  name: string;
  kind: ActionKind;
  file_key: string;
  file_name: string;
  library_file_id: string | null;
  run_on_commit: number;
  created_at: string;
}
interface LibraryFileRow {
  id: string;
  name: string;
  kind: ActionKind;
  file_key: string;
  file_name: string;
  owner_id: string;
  created_at: string;
}
interface ActionRunRow {
  id: string;
  project_id: string;
  action_id: string;
  model_id: string;
  commit_id: string;
  number: number;
  status: ActionRunStatus;
  summary: string;
  log: string;
  triggered_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function toAction(row: ActionRow): Action {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    fileKey: row.file_key,
    fileName: row.file_name,
    libraryFileId: row.library_file_id ?? null,
    runOnCommit: Boolean(row.run_on_commit),
    createdAt: row.created_at,
  };
}
function toLibraryFile(row: LibraryFileRow): LibraryFile {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    fileKey: row.file_key,
    fileName: row.file_name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}
function toActionRun(row: ActionRunRow): ActionRun {
  return {
    id: row.id,
    projectId: row.project_id,
    actionId: row.action_id,
    modelId: row.model_id,
    commitId: row.commit_id,
    number: Number(row.number),
    status: row.status,
    summary: row.summary,
    log: row.log,
    triggeredById: row.triggered_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    modelId: row.model_id,
    name: row.name,
    headCommitId: row.head_commit_id,
  };
}
function toCommit(row: CommitRow): Commit {
  return {
    id: row.id,
    modelId: row.model_id,
    branchName: row.branch_name,
    parentCommitId: row.parent_commit_id,
    manifestHash: row.manifest_hash,
    blobKey: row.blob_key,
    schema: row.schema,
    authorId: row.author_id,
    message: row.message,
    createdAt: row.created_at,
    entityCount: row.entity_count,
    added: row.added,
    removed: row.removed,
    modified: row.modified,
  };
}

/**
 * Postgres-backed Repository. Use with `createPgClient` in production, or any
 * SqlClient (e.g. PGlite in tests). Call `migrate()` once at startup.
 */
export class SqlRepository implements Repository {
  constructor(private readonly sql: SqlClient) {}

  async migrate(): Promise<void> {
    for (const statement of schemaStatements()) {
      await this.sql.query(statement);
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ---- users -----------------------------------------------------------

  async createUser(input: Omit<User, "id" | "createdAt">): Promise<User> {
    const user: User = { ...input, id: randomUUID(), createdAt: this.now() };
    await this.sql.query(
      `insert into users (id, email, name, password_hash, created_at, is_admin)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        user.id,
        user.email,
        user.name,
        user.passwordHash,
        user.createdAt,
        user.isAdmin ? 1 : 0,
      ],
    );
    return user;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { rows } = await this.sql.query<UserRow>(
      `select * from users where lower(email) = lower($1)`,
      [email],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserById(id: string): Promise<User | null> {
    const { rows } = await this.sql.query<UserRow>(
      `select * from users where id = $1`,
      [id],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async listUsers(): Promise<User[]> {
    const { rows } = await this.sql.query<UserRow>(
      `select * from users order by created_at`,
    );
    return rows.map(toUser);
  }

  async updateUser(
    userId: string,
    patch: Partial<Pick<User, "name" | "isAdmin" | "passwordHash">>,
  ): Promise<User | null> {
    const { rows } = await this.sql.query<UserRow>(
      `update users set
         name = coalesce($2, name),
         is_admin = coalesce($3, is_admin),
         password_hash = coalesce($4, password_hash)
       where id = $1
       returning *`,
      [
        userId,
        patch.name ?? null,
        patch.isAdmin === undefined ? null : patch.isAdmin ? 1 : 0,
        patch.passwordHash ?? null,
      ],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async userHasContent(userId: string): Promise<boolean> {
    for (const table of ["commits", "issues", "issue_comments"]) {
      const { rows } = await this.sql.query<{ id: string }>(
        `select id from ${table} where author_id = $1 limit 1`,
        [userId],
      );
      if (rows.length) {
        return true;
      }
    }
    return false;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.sql.query(`delete from issue_assignees where user_id = $1`, [
      userId,
    ]);
    await this.sql.query(`delete from project_members where user_id = $1`, [
      userId,
    ]);
    await this.sql.query(`delete from users where id = $1`, [userId]);
  }

  async listAllProjects(): Promise<Project[]> {
    const { rows } = await this.sql.query<ProjectRow>(
      `select * from projects order by created_at desc`,
    );
    return rows.map(toProject);
  }

  // ---- projects + membership ------------------------------------------

  async createProject(
    input: Omit<Project, "id" | "createdAt">,
  ): Promise<Project> {
    const project: Project = {
      ...input,
      id: randomUUID(),
      createdAt: this.now(),
    };
    await this.sql.query(
      `insert into projects (id, slug, name, owner_id, created_at, visibility)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        project.id,
        project.slug,
        project.name,
        project.ownerId,
        project.createdAt,
        project.visibility,
      ],
    );
    return project;
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    const { rows } = await this.sql.query<ProjectRow>(
      `select * from projects where slug = $1`,
      [slug],
    );
    return rows[0] ? toProject(rows[0]) : null;
  }

  async listProjectsForUser(userId: string): Promise<Project[]> {
    const { rows } = await this.sql.query<ProjectRow>(
      `select p.* from projects p
       join project_members m on m.project_id = p.id
       where m.user_id = $1
       order by p.created_at desc`,
      [userId],
    );
    return rows.map(toProject);
  }

  async listPublicProjects(): Promise<Project[]> {
    const { rows } = await this.sql.query<ProjectRow>(
      `select * from projects where visibility = 'public' order by created_at desc`,
    );
    return rows.map(toProject);
  }

  async updateProject(
    projectId: string,
    patch: Partial<Pick<Project, "name" | "visibility">>,
  ): Promise<Project | null> {
    const { rows } = await this.sql.query<ProjectRow>(
      `update projects set
         name = coalesce($2, name),
         visibility = coalesce($3, visibility)
       where id = $1
       returning *`,
      [projectId, patch.name ?? null, patch.visibility ?? null],
    );
    return rows[0] ? toProject(rows[0]) : null;
  }

  async addMember(member: Member): Promise<Member> {
    await this.sql.query(
      `insert into project_members (project_id, user_id, role)
       values ($1, $2, $3)
       on conflict (project_id, user_id) do update set role = excluded.role`,
      [member.projectId, member.userId, member.role],
    );
    return member;
  }

  async getMember(projectId: string, userId: string): Promise<Member | null> {
    const { rows } = await this.sql.query<MemberRow>(
      `select * from project_members where project_id = $1 and user_id = $2`,
      [projectId, userId],
    );
    return rows[0]
      ? { projectId: rows[0].project_id, userId: rows[0].user_id, role: rows[0].role }
      : null;
  }

  async listMembers(projectId: string): Promise<Member[]> {
    const { rows } = await this.sql.query<MemberRow>(
      `select * from project_members where project_id = $1`,
      [projectId],
    );
    return rows.map((r) => ({
      projectId: r.project_id,
      userId: r.user_id,
      role: r.role,
    }));
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await this.sql.query(
      `delete from project_members where project_id = $1 and user_id = $2`,
      [projectId, userId],
    );
  }

  // ---- models ----------------------------------------------------------

  async createModel(input: Omit<Model, "id" | "createdAt">): Promise<Model> {
    const model: Model = { ...input, id: randomUUID(), createdAt: this.now() };
    await this.sql.query(
      `insert into models (id, project_id, slug, name, visibility, default_branch, created_at, folder, kind)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        model.id,
        model.projectId,
        model.slug,
        model.name,
        model.visibility,
        model.defaultBranch,
        model.createdAt,
        model.folder,
        model.kind,
      ],
    );
    return model;
  }

  async getModel(projectId: string, slug: string): Promise<Model | null> {
    const { rows } = await this.sql.query<ModelRow>(
      `select * from models where project_id = $1 and slug = $2`,
      [projectId, slug],
    );
    return rows[0] ? toModel(rows[0]) : null;
  }

  async listModels(projectId: string): Promise<Model[]> {
    const { rows } = await this.sql.query<ModelRow>(
      `select * from models where project_id = $1 order by created_at desc`,
      [projectId],
    );
    return rows.map(toModel);
  }

  async updateModel(
    modelId: string,
    patch: Partial<
      Pick<Model, "name" | "visibility" | "defaultBranch" | "folder">
    >,
  ): Promise<Model | null> {
    const { rows } = await this.sql.query<ModelRow>(
      `update models set
         name = coalesce($2, name),
         visibility = coalesce($3, visibility),
         default_branch = coalesce($4, default_branch),
         folder = coalesce($5, folder)
       where id = $1
       returning *`,
      [
        modelId,
        patch.name ?? null,
        patch.visibility ?? null,
        patch.defaultBranch ?? null,
        patch.folder ?? null,
      ],
    );
    return rows[0] ? toModel(rows[0]) : null;
  }

  async deleteModel(modelId: string): Promise<string[]> {
    const { rows } = await this.sql.query<{ id: string; blob_key: string }>(
      `select id, blob_key from commits where model_id = $1`,
      [modelId],
    );
    await this.sql.query(`delete from issue_models where model_id = $1`, [
      modelId,
    ]);
    await this.sql.query(`delete from action_runs where model_id = $1`, [
      modelId,
    ]);
    // FK-sichere Reihenfolge; entity_objects bleiben (content-addressed,
    // über Commits/Modelle geteilt).
    await this.sql.query(
      `delete from commit_entities where commit_id in
         (select id from commits where model_id = $1)`,
      [modelId],
    );
    await this.sql.query(
      `delete from diffs_cache where
         from_commit in (select id from commits where model_id = $1)
         or to_commit in (select id from commits where model_id = $1)`,
      [modelId],
    );
    await this.sql.query(`delete from commits where model_id = $1`, [modelId]);
    await this.sql.query(`delete from branches where model_id = $1`, [modelId]);
    await this.sql.query(`delete from models where id = $1`, [modelId]);
    return rows.map((row) => row.blob_key);
  }

  async deleteProject(projectId: string): Promise<string[]> {
    const blobKeys: string[] = [];
    for (const model of await this.listModels(projectId)) {
      blobKeys.push(...(await this.deleteModel(model.id)));
    }
    for (const junction of [
      "issue_assignees",
      "issue_models",
      "issue_label_links",
      "issue_comments",
    ]) {
      await this.sql.query(
        `delete from ${junction} where issue_id in
           (select id from issues where project_id = $1)`,
        [projectId],
      );
    }
    await this.sql.query(`delete from issues where project_id = $1`, [projectId]);
    await this.sql.query(`delete from labels where project_id = $1`, [projectId]);
    // Bibliotheksdateien gehören nicht dem Projekt — deren Blobs bleiben.
    const { rows: actionRows } = await this.sql.query<{ file_key: string }>(
      `select file_key from actions where project_id = $1 and library_file_id is null`,
      [projectId],
    );
    blobKeys.push(...actionRows.map((row) => row.file_key));
    await this.sql.query(`delete from action_runs where project_id = $1`, [
      projectId,
    ]);
    await this.sql.query(`delete from actions where project_id = $1`, [
      projectId,
    ]);
    await this.sql.query(`delete from project_members where project_id = $1`, [
      projectId,
    ]);
    await this.sql.query(`delete from project_folders where project_id = $1`, [
      projectId,
    ]);
    await this.sql.query(`delete from projects where id = $1`, [projectId]);
    return blobKeys;
  }

  // ---- labels + issues -------------------------------------------------

  async createLabel(input: Omit<Label, "id">): Promise<Label> {
    const label: Label = { ...input, id: randomUUID() };
    await this.sql.query(
      `insert into labels (id, project_id, name, color) values ($1, $2, $3, $4)`,
      [label.id, label.projectId, label.name, label.color],
    );
    return label;
  }

  async listLabels(projectId: string): Promise<Label[]> {
    const { rows } = await this.sql.query<{
      id: string;
      project_id: string;
      name: string;
      color: string;
    }>(`select * from labels where project_id = $1 order by name`, [projectId]);
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      name: r.name,
      color: r.color,
    }));
  }

  private toIssue(row: {
    id: string;
    project_id: string;
    number: number;
    title: string;
    body: string;
    state: IssueState;
    author_id: string;
    created_at: string;
    updated_at: string;
  }): Issue {
    return {
      id: row.id,
      projectId: row.project_id,
      number: Number(row.number),
      title: row.title,
      body: row.body,
      state: row.state,
      authorId: row.author_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createIssue(
    input: Omit<Issue, "id" | "number" | "createdAt" | "updatedAt">,
  ): Promise<Issue> {
    const { rows } = await this.sql.query<{ next: number }>(
      `select coalesce(max(number), 0) + 1 as next from issues where project_id = $1`,
      [input.projectId],
    );
    const now = this.now();
    const issue: Issue = {
      ...input,
      id: randomUUID(),
      number: Number(rows[0]?.next ?? 1),
      createdAt: now,
      updatedAt: now,
    };
    await this.sql.query(
      `insert into issues (id, project_id, number, title, body, state, author_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        issue.id,
        issue.projectId,
        issue.number,
        issue.title,
        issue.body,
        issue.state,
        issue.authorId,
        issue.createdAt,
        issue.updatedAt,
      ],
    );
    return issue;
  }

  async getIssue(projectId: string, number: number): Promise<Issue | null> {
    const { rows } = await this.sql.query<Parameters<SqlRepository["toIssue"]>[0]>(
      `select * from issues where project_id = $1 and number = $2`,
      [projectId, number],
    );
    return rows[0] ? this.toIssue(rows[0]) : null;
  }

  async listIssues(projectId: string): Promise<Issue[]> {
    const { rows } = await this.sql.query<Parameters<SqlRepository["toIssue"]>[0]>(
      `select * from issues where project_id = $1 order by number desc`,
      [projectId],
    );
    return rows.map((row) => this.toIssue(row));
  }

  async updateIssue(
    issueId: string,
    patch: Partial<Pick<Issue, "title" | "body" | "state">>,
  ): Promise<Issue | null> {
    const { rows } = await this.sql.query<Parameters<SqlRepository["toIssue"]>[0]>(
      `update issues set
         title = coalesce($2, title),
         body = coalesce($3, body),
         state = coalesce($4, state),
         updated_at = $5
       where id = $1
       returning *`,
      [
        issueId,
        patch.title ?? null,
        patch.body ?? null,
        patch.state ?? null,
        this.now(),
      ],
    );
    return rows[0] ? this.toIssue(rows[0]) : null;
  }

  async setIssueLinks(
    issueId: string,
    links: Partial<IssueLinks>,
  ): Promise<void> {
    const tables: [keyof IssueLinks, string, string][] = [
      ["assigneeIds", "issue_assignees", "user_id"],
      ["modelIds", "issue_models", "model_id"],
      ["labelIds", "issue_label_links", "label_id"],
    ];
    for (const [key, table, column] of tables) {
      const ids = links[key];
      if (ids === undefined) continue;
      await this.sql.query(`delete from ${table} where issue_id = $1`, [issueId]);
      for (const id of new Set(ids)) {
        await this.sql.query(
          `insert into ${table} (issue_id, ${column}) values ($1, $2)`,
          [issueId, id],
        );
      }
    }
  }

  async getIssueLinks(issueIds: string[]): Promise<Map<string, IssueLinks>> {
    const map = new Map<string, IssueLinks>();
    if (!issueIds.length) return map;
    for (const id of issueIds) {
      map.set(id, { assigneeIds: [], modelIds: [], labelIds: [] });
    }
    const placeholders = issueIds.map((_, i) => `$${i + 1}`).join(", ");
    const tables: [keyof IssueLinks, string, string][] = [
      ["assigneeIds", "issue_assignees", "user_id"],
      ["modelIds", "issue_models", "model_id"],
      ["labelIds", "issue_label_links", "label_id"],
    ];
    for (const [key, table, column] of tables) {
      const { rows } = await this.sql.query<{
        issue_id: string;
        linked: string;
      }>(
        `select issue_id, ${column} as linked from ${table}
         where issue_id in (${placeholders})`,
        issueIds,
      );
      for (const row of rows) {
        map.get(row.issue_id)?.[key].push(row.linked);
      }
    }
    return map;
  }

  private toIssueComment(row: {
    id: string;
    issue_id: string;
    author_id: string;
    body: string;
    created_at: string;
  }): IssueComment {
    return {
      id: row.id,
      issueId: row.issue_id,
      authorId: row.author_id,
      body: row.body,
      createdAt: row.created_at,
    };
  }

  async createIssueComment(
    input: Omit<IssueComment, "id" | "createdAt">,
  ): Promise<IssueComment> {
    const comment: IssueComment = {
      ...input,
      id: randomUUID(),
      createdAt: this.now(),
    };
    await this.sql.query(
      `insert into issue_comments (id, issue_id, author_id, body, created_at)
       values ($1, $2, $3, $4, $5)`,
      [
        comment.id,
        comment.issueId,
        comment.authorId,
        comment.body,
        comment.createdAt,
      ],
    );
    return comment;
  }

  async listIssueComments(issueId: string): Promise<IssueComment[]> {
    const { rows } = await this.sql.query<
      Parameters<SqlRepository["toIssueComment"]>[0]
    >(
      `select * from issue_comments where issue_id = $1 order by created_at`,
      [issueId],
    );
    return rows.map((row) => this.toIssueComment(row));
  }

  async getIssueComment(commentId: string): Promise<IssueComment | null> {
    const { rows } = await this.sql.query<
      Parameters<SqlRepository["toIssueComment"]>[0]
    >(`select * from issue_comments where id = $1`, [commentId]);
    return rows[0] ? this.toIssueComment(rows[0]) : null;
  }

  async deleteIssueComment(commentId: string): Promise<void> {
    await this.sql.query(`delete from issue_comments where id = $1`, [commentId]);
  }

  // ---- actions + runs --------------------------------------------------

  async createAction(input: Omit<Action, "createdAt">): Promise<Action> {
    const action: Action = { ...input, createdAt: this.now() };
    await this.sql.query(
      `insert into actions (id, project_id, name, kind, file_key, file_name, library_file_id, run_on_commit, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        action.id,
        action.projectId,
        action.name,
        action.kind,
        action.fileKey,
        action.fileName,
        action.libraryFileId,
        action.runOnCommit ? 1 : 0,
        action.createdAt,
      ],
    );
    return action;
  }

  async getAction(actionId: string): Promise<Action | null> {
    const { rows } = await this.sql.query<ActionRow>(
      `select * from actions where id = $1`,
      [actionId],
    );
    return rows[0] ? toAction(rows[0]) : null;
  }

  async listActions(projectId: string): Promise<Action[]> {
    const { rows } = await this.sql.query<ActionRow>(
      `select * from actions where project_id = $1 order by created_at`,
      [projectId],
    );
    return rows.map(toAction);
  }

  // ---- zentrale Skript-/IDS-Bibliothek ---------------------------------

  async createLibraryFile(
    input: Omit<LibraryFile, "createdAt">,
  ): Promise<LibraryFile> {
    const file: LibraryFile = { ...input, createdAt: this.now() };
    await this.sql.query(
      `insert into library_files (id, name, kind, file_key, file_name, owner_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        file.id,
        file.name,
        file.kind,
        file.fileKey,
        file.fileName,
        file.ownerId,
        file.createdAt,
      ],
    );
    return file;
  }

  async getLibraryFile(fileId: string): Promise<LibraryFile | null> {
    const { rows } = await this.sql.query<LibraryFileRow>(
      `select * from library_files where id = $1`,
      [fileId],
    );
    return rows[0] ? toLibraryFile(rows[0]) : null;
  }

  async listLibraryFiles(): Promise<LibraryFile[]> {
    const { rows } = await this.sql.query<LibraryFileRow>(
      `select * from library_files order by created_at`,
    );
    return rows.map(toLibraryFile);
  }

  async updateLibraryFile(
    fileId: string,
    patch: Partial<Pick<LibraryFile, "name" | "fileName">>,
  ): Promise<LibraryFile | null> {
    const { rows } = await this.sql.query<LibraryFileRow>(
      `update library_files set
         name = coalesce($2, name),
         file_name = coalesce($3, file_name)
       where id = $1
       returning *`,
      [fileId, patch.name ?? null, patch.fileName ?? null],
    );
    return rows[0] ? toLibraryFile(rows[0]) : null;
  }

  async deleteLibraryFile(fileId: string): Promise<void> {
    await this.sql.query(`delete from library_files where id = $1`, [fileId]);
  }

  async countActionsUsingLibraryFile(fileId: string): Promise<number> {
    const { rows } = await this.sql.query<{ count: number | string }>(
      `select count(*) as count from actions where library_file_id = $1`,
      [fileId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async updateAction(
    actionId: string,
    patch: Partial<Pick<Action, "name" | "runOnCommit" | "fileName">>,
  ): Promise<Action | null> {
    const { rows } = await this.sql.query<ActionRow>(
      `update actions set
         name = coalesce($2, name),
         run_on_commit = coalesce($3, run_on_commit),
         file_name = coalesce($4, file_name)
       where id = $1
       returning *`,
      [
        actionId,
        patch.name ?? null,
        patch.runOnCommit === undefined ? null : patch.runOnCommit ? 1 : 0,
        patch.fileName ?? null,
      ],
    );
    return rows[0] ? toAction(rows[0]) : null;
  }

  async deleteAction(actionId: string): Promise<void> {
    await this.sql.query(`delete from action_runs where action_id = $1`, [
      actionId,
    ]);
    await this.sql.query(`delete from actions where id = $1`, [actionId]);
  }

  async createActionRun(
    input: Omit<ActionRun, "id" | "number" | "createdAt">,
  ): Promise<ActionRun> {
    const { rows } = await this.sql.query<{ next: number }>(
      `select coalesce(max(number), 0) + 1 as next from action_runs where project_id = $1`,
      [input.projectId],
    );
    const run: ActionRun = {
      ...input,
      id: randomUUID(),
      number: Number(rows[0]?.next ?? 1),
      createdAt: this.now(),
    };
    await this.sql.query(
      `insert into action_runs
        (id, project_id, action_id, model_id, commit_id, number, status,
         summary, log, triggered_by, created_at, started_at, finished_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        run.id,
        run.projectId,
        run.actionId,
        run.modelId,
        run.commitId,
        run.number,
        run.status,
        run.summary,
        run.log,
        run.triggeredById,
        run.createdAt,
        run.startedAt,
        run.finishedAt,
      ],
    );
    return run;
  }

  async getActionRun(runId: string): Promise<ActionRun | null> {
    const { rows } = await this.sql.query<ActionRunRow>(
      `select * from action_runs where id = $1`,
      [runId],
    );
    return rows[0] ? toActionRun(rows[0]) : null;
  }

  async listActionRuns(
    projectId: string,
    filter?: { actionId?: string; modelId?: string; commitId?: string },
  ): Promise<ActionRun[]> {
    const conditions = ["project_id = $1"];
    const params: unknown[] = [projectId];
    for (const [column, value] of [
      ["action_id", filter?.actionId],
      ["model_id", filter?.modelId],
      ["commit_id", filter?.commitId],
    ] as const) {
      if (value !== undefined) {
        params.push(value);
        conditions.push(`${column} = $${params.length}`);
      }
    }
    const { rows } = await this.sql.query<ActionRunRow>(
      `select * from action_runs where ${conditions.join(" and ")}
       order by number desc`,
      params,
    );
    return rows.map(toActionRun);
  }

  async updateActionRun(
    runId: string,
    patch: Partial<
      Pick<ActionRun, "status" | "summary" | "log" | "startedAt" | "finishedAt">
    >,
  ): Promise<ActionRun | null> {
    const { rows } = await this.sql.query<ActionRunRow>(
      `update action_runs set
         status = coalesce($2, status),
         summary = coalesce($3, summary),
         log = coalesce($4, log),
         started_at = coalesce($5, started_at),
         finished_at = coalesce($6, finished_at)
       where id = $1
       returning *`,
      [
        runId,
        patch.status ?? null,
        patch.summary ?? null,
        patch.log ?? null,
        patch.startedAt ?? null,
        patch.finishedAt ?? null,
      ],
    );
    return rows[0] ? toActionRun(rows[0]) : null;
  }

  // ---- folders ---------------------------------------------------------

  async listFolders(projectId: string): Promise<string[]> {
    const { rows } = await this.sql.query<{ path: string }>(
      `select path from project_folders where project_id = $1 order by path`,
      [projectId],
    );
    return rows.map((row) => row.path);
  }

  async addFolder(projectId: string, path: string): Promise<void> {
    await this.sql.query(
      `insert into project_folders (project_id, path)
       values ($1, $2)
       on conflict (project_id, path) do nothing`,
      [projectId, path],
    );
  }

  async removeFolder(projectId: string, path: string): Promise<void> {
    await this.sql.query(
      `delete from project_folders
       where project_id = $1 and (path = $2 or path like $3)`,
      [projectId, path, `${path.replace(/[%_\\]/g, "\\$&")}/%`],
    );
  }

  // ---- branches --------------------------------------------------------

  async createBranch(input: Omit<Branch, "id">): Promise<Branch> {
    const branch: Branch = { ...input, id: randomUUID() };
    await this.sql.query(
      `insert into branches (id, model_id, name, head_commit_id)
       values ($1, $2, $3, $4)`,
      [branch.id, branch.modelId, branch.name, branch.headCommitId],
    );
    return branch;
  }

  async getBranch(modelId: string, name: string): Promise<Branch | null> {
    const { rows } = await this.sql.query<BranchRow>(
      `select * from branches where model_id = $1 and name = $2`,
      [modelId, name],
    );
    return rows[0] ? toBranch(rows[0]) : null;
  }

  async listBranches(modelId: string): Promise<Branch[]> {
    const { rows } = await this.sql.query<BranchRow>(
      `select * from branches where model_id = $1`,
      [modelId],
    );
    return rows.map(toBranch);
  }

  async setBranchHead(branchId: string, headCommitId: string): Promise<void> {
    await this.sql.query(
      `update branches set head_commit_id = $2 where id = $1`,
      [branchId, headCommitId],
    );
  }

  // ---- commits ---------------------------------------------------------

  async createCommit(commit: Commit): Promise<Commit> {
    await this.sql.query(
      `insert into commits
        (id, model_id, branch_name, parent_commit_id, manifest_hash, blob_key,
         schema, author_id, message, created_at, entity_count, added, removed, modified)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        commit.id,
        commit.modelId,
        commit.branchName,
        commit.parentCommitId,
        commit.manifestHash,
        commit.blobKey,
        commit.schema,
        commit.authorId,
        commit.message,
        commit.createdAt,
        commit.entityCount,
        commit.added,
        commit.removed,
        commit.modified,
      ],
    );
    return commit;
  }

  async getCommit(id: string): Promise<Commit | null> {
    const { rows } = await this.sql.query<CommitRow>(
      `select * from commits where id = $1`,
      [id],
    );
    return rows[0] ? toCommit(rows[0]) : null;
  }

  async listCommits(modelId: string, branchName?: string): Promise<Commit[]> {
    const { rows } =
      branchName === undefined
        ? await this.sql.query<CommitRow>(
            `select * from commits where model_id = $1 order by created_at desc`,
            [modelId],
          )
        : await this.sql.query<CommitRow>(
            `select * from commits where model_id = $1 and branch_name = $2
             order by created_at desc`,
            [modelId, branchName],
          );
    return rows.map(toCommit);
  }

  // ---- manifests (deduped entity store) --------------------------------

  async saveManifest(
    commitId: string,
    entries: VersionManifestEntry[],
  ): Promise<void> {
    for (let i = 0; i < entries.length; i += INSERT_CHUNK) {
      const chunk = entries.slice(i, i + INSERT_CHUNK);

      // Dedup entity payloads across commits.
      const objValues: unknown[] = [];
      const objTuples = chunk.map((entry, idx) => {
        const base = idx * 4;
        objValues.push(
          entry.hash,
          entry.type,
          entry.name,
          entry.payload ?? "",
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      });
      await this.sql.query(
        `insert into entity_objects (entity_hash, entity_type, name, payload)
         values ${objTuples.join(", ")}
         on conflict (entity_hash) do nothing`,
        objValues,
      );

      // Per-commit manifest references.
      const refValues: unknown[] = [];
      const refTuples = chunk.map((entry, idx) => {
        const base = idx * 3;
        refValues.push(commitId, entry.globalId, entry.hash);
        return `($${base + 1}, $${base + 2}, $${base + 3})`;
      });
      await this.sql.query(
        `insert into commit_entities (commit_id, global_id, entity_hash)
         values ${refTuples.join(", ")}
         on conflict (commit_id, global_id) do nothing`,
        refValues,
      );
    }
  }

  async getManifest(commitId: string): Promise<VersionManifestEntry[]> {
    const { rows } = await this.sql.query<{
      global_id: string;
      entity_hash: string;
      entity_type: string;
      name: string;
    }>(
      `select ce.global_id, ce.entity_hash, eo.entity_type, eo.name
       from commit_entities ce
       join entity_objects eo on eo.entity_hash = ce.entity_hash
       where ce.commit_id = $1`,
      [commitId],
    );
    return rows.map((r) => ({
      globalId: r.global_id,
      hash: r.entity_hash,
      type: r.entity_type,
      name: r.name,
    }));
  }

  // ---- diff cache ------------------------------------------------------

  async getCachedDiff(
    fromCommitId: string,
    toCommitId: string,
  ): Promise<GuidDiffSummary | null> {
    const { rows } = await this.sql.query<{ summary: GuidDiffSummary | string }>(
      `select summary from diffs_cache where from_commit = $1 and to_commit = $2`,
      [fromCommitId, toCommitId],
    );
    if (!rows[0]) {
      return null;
    }
    // pg parst jsonb selbst; SQLite liefert den TEXT zurück.
    const summary = rows[0].summary;
    return typeof summary === "string"
      ? (JSON.parse(summary) as GuidDiffSummary)
      : summary;
  }

  async saveCachedDiff(
    fromCommitId: string,
    toCommitId: string,
    summary: GuidDiffSummary,
  ): Promise<void> {
    await this.sql.query(
      `insert into diffs_cache (from_commit, to_commit, summary)
       values ($1, $2, $3::jsonb)
       on conflict (from_commit, to_commit) do update set summary = excluded.summary`,
      [fromCommitId, toCommitId, JSON.stringify(summary)],
    );
  }
}
