import { randomUUID } from "node:crypto";

import type {
  GuidDiffSummary,
  VersionManifestEntry,
} from "../ifc";
import { schemaStatements } from "./sql/schema";
import type { SqlClient } from "./sql/sqlClient";
import type {
  Branch,
  Commit,
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
}
interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  created_at: string;
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
  };
}
function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
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
      `insert into users (id, email, name, password_hash, created_at)
       values ($1, $2, $3, $4, $5)`,
      [user.id, user.email, user.name, user.passwordHash, user.createdAt],
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
      `insert into projects (id, slug, name, owner_id, created_at)
       values ($1, $2, $3, $4, $5)`,
      [project.id, project.slug, project.name, project.ownerId, project.createdAt],
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
    await this.sql.query(`delete from project_members where project_id = $1`, [
      projectId,
    ]);
    await this.sql.query(`delete from project_folders where project_id = $1`, [
      projectId,
    ]);
    await this.sql.query(`delete from projects where id = $1`, [projectId]);
    return blobKeys;
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
    const { rows } = await this.sql.query<{ summary: GuidDiffSummary }>(
      `select summary from diffs_cache where from_commit = $1 and to_commit = $2`,
      [fromCommitId, toCommitId],
    );
    return rows[0] ? rows[0].summary : null;
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
